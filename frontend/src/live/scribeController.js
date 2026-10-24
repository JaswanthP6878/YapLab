/** Pure Scribe lifecycle and transcript transport; no React or browser globals. */

/** @param {Array<{start?:number,end?:number,type?:string}>|undefined} words */
export function wordSpan(words) {
  const timed = (words || []).filter((word) => (!word.type || word.type === 'word')
    && Number.isFinite(word.start) && Number.isFinite(word.end)
    && word.start >= 0 && word.end >= word.start);
  if (!timed.length) return null;
  const start = timed[0].start;
  const end = timed[timed.length - 1].end;
  return end >= start ? { start, end } : null;
}

/** Seconds of spoken audio, with no conversion to absolute/session timestamps. */
export function transcriptDuration(words) {
  const span = wordSpan(words);
  return span ? span.end - span.start : undefined;
}

export class TranscriptSequences {
  constructor() { this.nextBySession = new Map(); }
  next(id) {
    const next = this.nextBySession.get(id) || 0;
    this.nextBySession.set(id, next + 1);
    return next;
  }
  setNext(id, minNext) {
    if (!id || !Number.isSafeInteger(minNext) || minNext < 0) return;
    this.nextBySession.set(id, Math.max(this.nextBySession.get(id) || 0, minNext));
  }
}

/** SDK microphone frames are mono PCM16 at 16kHz (verified in client 1.30.0). */
export function pcmDurationSeconds(audioBase64) {
  const padding = audioBase64.endsWith('==') ? 2 : audioBase64.endsWith('=') ? 1 : 0;
  return ((audioBase64.length * 3) / 4 - padding) / 2 / 16000;
}

/** Maps token extras from the backend, keeping browser mic credentials ephemeral. */
export function scribeConnectOptions(token) {
  if (!token || typeof token.token !== 'string' || !token.token) throw new Error('The speech token response did not include a token.');
  return {
    token: token.token,
    modelId: token.model_id || 'scribe_v2_realtime',
    vadSilenceThresholdSecs: token.vad_silence_threshold_secs ?? 0.7,
    includeTimestamps: token.include_timestamps ?? true,
    commitStrategy: 'vad',
    languageCode: 'en',
    secondaryLanguages: [],
    noVerbatim: false,
    microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  };
}

/**
 * @param {{controls:Function,context:Function,getSttToken:Function,now:Function,
 * onInterim:Function,onStatus:Function,onError:Function,onFinal:Function,onAck?:Function}} options
 */
export class ScribeSpeechController {
  constructor(options) {
    this.options = options;
    this.sequences = new TranscriptSequences();
    this.wanted = false;
    this.active = false;
    this.disposed = false;
    this.muted = false;
    this.generation = 0;
    this.requestAbort = null;
    this.connecting = null;
    this.connection = null;
    this.cleanup = null;
    this.runContext = null;
    this.captureStartedAt = null;
    this.muteIntervals = [];
    this.openMute = null;
    this.guardUntimed = false;
  }

  ready(context = this.options.context()) {
    return context.enabled !== false && !!context.sessionId && !!context.connection
      && context.connectionState === 'connected';
  }

  /** Preserve the user's mic intent across backend WS reconnects. */
  updateContext() {
    this.disposed = false; // React StrictMode may mount the same hook effects again.
    const context = this.options.context();
    if (this.active && (!this.ready(context) || this.runContext.sessionId !== context.sessionId
      || this.runContext.connection !== context.connection)) this.stopCapture();
    if (this.wanted && this.ready(context) && !this.active) void this.connect();
  }

  start() {
    if (this.disposed) return Promise.resolve(false);
    this.wanted = true;
    return this.connect();
  }

  stop(notify = true) {
    this.wanted = false;
    this.stopCapture(notify);
  }

  dispose() {
    this.disposed = true;
    this.stop(false);
  }

  stopCapture(notify = true) {
    this.active = false;
    this.generation += 1;
    this.requestAbort?.abort();
    this.requestAbort = null;
    this.cleanup?.();
    this.cleanup = null;
    this.connection?.close();
    this.connection = null;
    this.options.controls().disconnect();
    if (notify) {
      this.options.onInterim('');
      this.options.onStatus('idle');
    }
  }

  isCurrent(run) { return this.active && this.generation === run; }

  async connect() {
    if (this.active) return true;
    const context = this.options.context();
    if (!this.wanted || !this.ready(context)) return false;
    const run = ++this.generation;
    this.active = true;
    this.runContext = { sessionId: context.sessionId, connection: context.connection };
    this.captureStartedAt = null;
    this.muteIntervals = [];
    this.openMute = this.muted ? { start: -Infinity, end: Infinity } : null;
    if (this.openMute) this.muteIntervals.push(this.openMute);
    this.guardUntimed = this.muted;
    this.options.onInterim('');
    this.options.onError(null);
    this.options.onStatus('connecting');
    const abort = new AbortController();
    this.requestAbort = abort;
    try {
      const token = await this.options.getSttToken(context.sessionId, { signal: abort.signal });
      if (!this.isCurrent(run)) return false;
      if (this.connecting) await this.connecting.catch(() => {});
      if (!this.isCurrent(run)) return false;
      const controls = this.options.controls();
      controls.clearTranscripts?.();
      const settings = scribeConnectOptions(token);
      const promise = controls.connect(settings);
      this.connecting = promise;
      let owned = controls.getConnection();
      if (owned) this.attach(owned, run, settings.includeTimestamps);
      try {
        await promise;
        owned ||= controls.getConnection();
        if (!this.isCurrent(run)) {
          owned?.close();
          if (controls.getConnection() === owned) controls.disconnect();
          return false;
        }
        if (!this.connection && owned) this.attach(owned, run, settings.includeTimestamps);
        return true;
      } finally {
        if (this.connecting === promise) this.connecting = null;
      }
    } catch (error) {
      if (this.isCurrent(run)) this.fail(error);
      return false;
    } finally {
      if (this.requestAbort === abort) this.requestAbort = null;
    }
  }

  fail(error) {
    this.wanted = false;
    this.stopCapture();
    this.options.onError(error?.message || String(error));
    this.options.onStatus('error');
  }

  /** SDK track muting can race permission/setup. Keep intent and retry at first audio. */
  applyMute() {
    try {
      if (this.muted) this.options.controls().mute();
      else this.options.controls().unmute();
    } catch { /* The public SDK throws until its microphone track is ready. */ }
  }

  setMuted(value) {
    value = !!value;
    if (value === this.muted) return;
    this.muted = value;
    this.options.onInterim('');
    if (value) {
      this.guardUntimed = true;
      // Keep local wall-clock intervals even before the first PCM chunk. This
      // covers playback that starts AND ends while the first chunk is buffering.
      this.openMute = { start: this.options.now(), end: Infinity };
      this.muteIntervals.push(this.openMute);
    } else if (this.openMute) {
      this.openMute.end = this.options.now();
      this.openMute = null;
    }
    if (this.active) {
      this.applyMute();
      if (this.captureStartedAt !== null) this.options.onStatus(value ? 'muted' : 'listening');
    }
  }

  setNextSequence(minNext) { this.sequences.setNext(this.options.context().sessionId, minNext); }
  adoptSequence(seq) { if (Number.isSafeInteger(seq)) this.setNextSequence(seq + 1); }

  /** Typed input uses exactly the same counter as mic commits, even with mic stopped. */
  sendText(text) { return this.submit(text); }

  async submit(text, words) {
    const context = this.options.context();
    if (this.disposed || !this.ready(context) || typeof text !== 'string' || !text.trim()) return null;
    const sessionId = context.sessionId;
    const connection = context.connection;
    const seq = this.sequences.next(sessionId);
    const duration = transcriptDuration(words);
    const fields = { seq, text, ...(duration === undefined ? {} : { duration }) };
    try {
      const result = await connection.request('transcript', fields);
      const current = this.options.context();
      if (this.disposed || current.sessionId !== sessionId || current.connection !== connection || current.enabled === false) return result;
      this.options.onAck?.({ sessionId, ...fields, result });
      if (result?.accepted === true) this.options.onFinal(text);
      return result;
    } catch (error) {
      const current = this.options.context();
      if (!this.disposed && current.sessionId === sessionId && current.connection === connection) {
        // A rejected transcript request is nonfatal: keep the microphone running.
        this.options.onError(error?.message || String(error));
      }
      return null;
    }
  }

  attach(connection, run, includeTimestamps) {
    this.connection = connection;
    const originalSend = connection.send;
    const observe = (data) => {
      if (this.captureStartedAt === null && data.audioBase64) {
        this.captureStartedAt = this.options.now() - pcmDurationSeconds(data.audioBase64) * 1000;
        this.applyMute();
        if (this.isCurrent(run)) this.options.onStatus(this.muted ? 'muted' : 'listening');
        // The first frame anchors local mute filtering; no absolute time goes out.
        if (connection.send === observe) connection.send = originalSend;
      }
      originalSend.call(connection, data);
    };
    connection.send = observe;
    const partial = (data) => {
      if (this.isCurrent(run)) this.options.onInterim(this.muted ? '' : data.text);
    };
    const boundary = () => { if (this.isCurrent(run)) this.options.onInterim(''); };
    const final = (data) => {
      if (!this.isCurrent(run)) return;
      boundary();
      if (this.muted) return;
      const span = wordSpan(data.words);
      if (span && this.captureStartedAt !== null && this.muteIntervals.some((interval) =>
        span.start < (interval.end - this.captureStartedAt) / 1000
        && span.end > (interval.start - this.captureStartedAt) / 1000)) return;
      if (!span && this.guardUntimed) { this.guardUntimed = false; return; }
      if (span) this.guardUntimed = false;
      void this.submit(data.text, data.words);
    };
    const error = (data) => { if (this.isCurrent(run)) this.fail(new Error(data.error || 'Speech recognition failed.')); };
    const close = () => { if (this.isCurrent(run)) this.fail(new Error('Speech recognition disconnected. Start the microphone to retry.')); };
    connection.on('partial_transcript', partial);
    connection.on('committed_transcript', includeTimestamps ? boundary : final);
    if (includeTimestamps) connection.on('committed_transcript_with_timestamps', final);
    connection.on('error', error);
    connection.on('close', close);
    this.cleanup = () => {
      if (connection.send === observe) connection.send = originalSend;
      connection.off('partial_transcript', partial);
      connection.off('committed_transcript', includeTimestamps ? boundary : final);
      if (includeTimestamps) connection.off('committed_transcript_with_timestamps', final);
      connection.off('error', error);
      connection.off('close', close);
    };
  }
}
