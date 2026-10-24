/** FIFO question playback. Backend audio is cached until the presenter calls on a hand. */

const noop = () => {};
const isBlocked = (error) => error?.name === 'NotAllowedError' || error?.error === 'not-allowed';

/**
 * Adapt media.speak's void return to actual browser utterance events. The temporary
 * wrapper exists only during that synchronous call; it is restored immediately.
 * Polling is a backup for hosts that do not permit replacing the native method.
 */
export function startBrowserSpeech({ speak, stopSpeaking = noop, speechSynthesis, text, persona,
  onStart = noop, onEnd = noop, onError = noop, onBlocked = noop,
  setTimeout: later = globalThis.setTimeout.bind(globalThis),
  clearTimeout: cancelLater = globalThis.clearTimeout.bind(globalThis),
  setInterval: every = globalThis.setInterval.bind(globalThis),
  clearInterval: cancelEvery = globalThis.clearInterval.bind(globalThis) }) {
  const synthesis = speechSynthesis ?? globalThis.window?.speechSynthesis;
  if (!synthesis || typeof speak !== 'function') {
    onError(new Error('Browser speech is unavailable. The question remains visible as text.'));
    return noop;
  }
  let done = false;
  let started = false;
  let captured = false;
  let interval;
  let deadline;
  let watchdog;
  const detach = [];
  const cleanup = () => {
    cancelEvery(interval);
    cancelLater(deadline);
    cancelLater(watchdog);
    detach.splice(0).forEach((remove) => remove());
  };
  const begin = () => {
    if (done || started) return;
    started = true;
    cancelLater(deadline);
    onStart();
  };
  const finish = (callback, value) => {
    if (done) return;
    done = true;
    cleanup();
    callback(value);
  };
  const attach = (utterance, event, callback) => {
    if (typeof utterance.addEventListener === 'function') {
      utterance.addEventListener(event, callback);
      detach.push(() => utterance.removeEventListener(event, callback));
    } else {
      const key = `on${event}`;
      const previous = utterance[key];
      const handler = (...args) => { previous?.(...args); callback(...args); };
      utterance[key] = handler;
      detach.push(() => { if (utterance[key] === handler) utterance[key] = previous; });
    }
  };
  const original = synthesis.speak;
  const intercept = function (utterance) {
    captured = true;
    attach(utterance, 'start', begin);
    attach(utterance, 'end', () => finish(onEnd));
    attach(utterance, 'error', (error) => finish(isBlocked(error) ? onBlocked : onError, error));
    return original.call(synthesis, utterance);
  };
  try {
    try { synthesis.speak = intercept; } catch { /* Native method can be read-only. */ }
    speak(text, persona, true);
  } catch (error) {
    finish(isBlocked(error) ? onBlocked : onError, error);
  } finally {
    if (synthesis.speak === intercept) synthesis.speak = original;
  }
  if (!done) {
    interval = every(() => {
      if (!captured && synthesis.speaking) begin();
      if (started && !synthesis.speaking && !synthesis.pending) finish(onEnd);
    }, 50);
    deadline = later(() => {
      if (!started) finish(onBlocked, new Error('Click Enable audio to start the browser voice.'));
    }, 2500);
    watchdog = later(() => {
      finish(onError, new Error('Browser speech timed out. The question remains visible as text.'));
      stopSpeaking();
    }, 45000);
  }
  return () => { done = true; cleanup(); stopSpeaking(); };
}

export class QuestionAudio {
  /** All browser and transport dependencies can be replaced by node tests. */
  constructor(options = {}) {
    this.options = options;
    this.createAudio = options.createAudio ?? ((url) => new Audio(url));
    this.later = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.cancelLater = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.cache = new Map();
    this.questions = new Map();
    this.seen = new Map();
    this.pending = [];
    this.current = null;
    this.disposed = false;
    this.enabled = true;
    this.settling = false;
    this.muteOwner = null;
    this.blocked = false;
  }

  handleEvent(event) {
    const name = event?.event ?? event?.type;
    const data = event?.data ?? event;
    const id = data?.question_id;
    if (!id || this.disposed) return;
    if (['hand_raised', 'question_taken', 'qa_question', 'pooled', 'hand_lowered'].includes(name)) {
      this.questions.set(id, { ...this.questions.get(id), ...data });
    } else if (name === 'question_audio') {
      this.cache.set(id, { url: data.url, contentType: data.content_type, failed: false });
    } else if (name === 'question_audio_failed') {
      this.cache.set(id, { failed: true });
    }
    if (this.current?.id === id && this.current.mode === 'waiting') this.selectSource(this.current);
  }

  /** Never called automatically by cached/replayed events. Resolves when this question ends. */
  play(questionId, details = {}) {
    if (this.disposed) return Promise.resolve({ status: 'cancelled' });
    if (this.seen.has(questionId)) return this.seen.get(questionId);
    let resolve;
    const promise = new Promise((finish) => { resolve = finish; });
    this.seen.set(questionId, promise);
    this.questions.set(questionId, { ...this.questions.get(questionId), ...details });
    if (!this.enabled) {
      this.complete({ id: questionId, resolve }, 'muted');
      return promise;
    }
    this.pending.push({ id: questionId, resolve, mode: 'waiting', actual: false,
      floorOwner: null, attempt: 0, blocked: false, audio: null, fallback: null, timer: null });
    this.pump();
    return promise;
  }

  pump() {
    if (this.disposed || this.current || this.settling || !this.enabled) return;
    const next = this.pending.shift();
    if (!next) return;
    this.current = next;
    next.timer = this.later(() => this.fallback(next), 5000);
    this.selectSource(next);
  }

  selectSource(playback) {
    if (this.current !== playback || playback.mode !== 'waiting') return;
    const cached = this.cache.get(playback.id);
    if (!cached) return;
    this.cancelLater(playback.timer);
    if (cached.failed || !cached.url) { this.fallback(playback); return; }
    try {
      const base = this.options.apiBase || globalThis.location?.origin || 'http://localhost';
      const url = new URL(cached.url, `${base.replace(/\/$/, '')}/`).href;
      playback.audio = this.createAudio(url);
      playback.mode = 'audio';
      playback.audio.onplaying = () => this.markPlaying(playback);
      playback.audio.onended = () => this.finish(playback, 'played');
      playback.audio.onerror = () => this.fallback(playback);
      this.attempt(playback);
    } catch { this.fallback(playback); }
  }

  request(type, questionId) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = this.later(() => reject(new Error('Playback acknowledgement timed out.')), 4000);
    });
    let request;
    try { request = this.options.request?.(type, { question_id: questionId }); }
    catch (error) { request = Promise.reject(error); }
    return Promise.race([Promise.resolve(request), timeout]).finally(() => this.cancelLater(timer));
  }

  claimFloor(playback) {
    if (playback.floorOwner) return playback.floorOwner.ready;
    const owner = { ready: null };
    playback.floorOwner = owner;
    this.muteOwner = owner;
    this.options.setMuted?.(true);
    owner.ready = this.request('playback_started', playback.id);
    return owner.ready;
  }

  releaseFloor(playback, { notify = true } = {}) {
    const owner = playback.floorOwner;
    if (!owner) return Promise.resolve();
    playback.floorOwner = null;
    if (!notify) {
      if (this.muteOwner === owner) {
        this.muteOwner = null;
        this.options.setMuted?.(false);
      }
      return Promise.resolve();
    }
    return this.request('playback_ended', playback.id).catch(() => {
      this.options.onError?.('Playback ended while the connection was unavailable.');
    }).finally(() => {
      if (this.muteOwner === owner) {
        this.muteOwner = null;
        this.options.setMuted?.(false);
      }
    });
  }

  attempt(playback, fromGesture = false) {
    if (this.current !== playback) return;
    playback.blocked = false;
    this.updateBlocked();
    const attempt = ++playback.attempt;
    const ready = this.claimFloor(playback);
    const run = () => {
      if (this.current !== playback || playback.attempt !== attempt) return;
      if (playback.mode === 'fallback') { this.speakFallback(playback); return; }
      this.cancelLater(playback.timer);
      playback.timer = this.later(() => {
        if (this.current === playback && !playback.actual && !playback.blocked) this.fallback(playback);
      }, 5000);
      try {
        Promise.resolve(playback.audio.play()).catch((error) => this.playFailed(playback, attempt, error));
      } catch (error) { this.playFailed(playback, attempt, error); }
    };
    // A recovery click must invoke play/speak synchronously to keep user activation.
    if (fromGesture) run();
    ready.then(() => { if (!fromGesture) run(); }).catch(() => {
      if (this.current !== playback || playback.attempt !== attempt) return;
      this.options.onError?.('The question could not start while the connection was unavailable.');
      this.finish(playback, 'unavailable');
    });
  }

  markPlaying(playback) {
    if (this.current !== playback || playback.actual) return;
    playback.actual = true;
    this.cancelLater(playback.timer);
    playback.timer = this.later(() => {
      if (this.current !== playback) return;
      this.options.onError?.('Question playback timed out. The question remains visible as text.');
      this.finish(playback, 'unavailable');
    }, 30000);
    playback.blocked = false;
    this.updateBlocked();
    this.options.onSpeakingChange?.(playback.id, this.questions.get(playback.id));
  }

  playFailed(playback, attempt, error) {
    if (this.current !== playback || playback.attempt !== attempt) return;
    if (isBlocked(error)) {
      this.cancelLater(playback.timer);
      playback.blocked = true;
      this.releaseFloor(playback);
      this.updateBlocked();
    } else this.fallback(playback);
  }

  fallback(playback) {
    if (this.current !== playback || playback.mode === 'fallback') return;
    this.cancelLater(playback.timer);
    this.releaseAudio(playback.audio);
    playback.audio = null;
    if (playback.actual) this.options.onSpeakingChange?.(null, this.questions.get(playback.id));
    playback.actual = false;
    playback.mode = 'fallback';
    playback.attempt += 1;
    this.releaseFloor(playback).finally(() => {
      if (this.current === playback) this.attempt(playback);
    });
  }

  speakFallback(playback) {
    playback.fallback?.();
    const details = this.questions.get(playback.id) ?? {};
    const text = details.text ?? details.question ?? '';
    if (!text.trim()) {
      this.options.onError?.('Question audio is unavailable; no fallback text was provided.');
      this.finish(playback, 'unavailable');
      return;
    }
    playback.fallback = startBrowserSpeech({
      ...this.options,
      text,
      persona: this.options.personaFor?.(details.persona, details.listener)
        ?? (typeof details.persona === 'object' ? details.persona : null),
      onStart: () => this.markPlaying(playback),
      onEnd: () => this.finish(playback, 'fallback'),
      onError: () => {
        this.options.onError?.('Browser speech is unavailable. The question remains visible as text.');
        this.finish(playback, 'unavailable');
      },
      onBlocked: () => {
        if (this.current !== playback) return;
        playback.blocked = true;
        this.releaseFloor(playback);
        this.updateBlocked();
      },
    });
  }

  complete(playback, status) {
    const result = { status };
    playback.resolve(result);
    this.options.onComplete?.(playback.id, this.questions.get(playback.id), result);
  }

  finish(playback, status, { notify = true } = {}) {
    if (this.current !== playback) return;
    this.current = null;
    this.settling = true;
    this.cancelLater(playback.timer);
    playback.attempt += 1;
    this.releaseAudio(playback.audio);
    playback.fallback?.();
    if (playback.actual) this.options.onSpeakingChange?.(null, this.questions.get(playback.id));
    this.complete(playback, status);
    this.updateBlocked();
    this.releaseFloor(playback, { notify }).finally(() => { this.settling = false; this.pump(); });
  }

  updateBlocked() {
    const blocked = Boolean(this.current?.blocked);
    if (blocked !== this.blocked) {
      this.blocked = blocked;
      this.options.onBlockedChange?.(blocked);
    }
  }

  releaseAudio(audio) {
    if (!audio) return;
    audio.onplaying = null;
    audio.onended = null;
    audio.onerror = null;
    try { audio.pause(); audio.removeAttribute?.('src'); audio.load?.(); } catch { /* disposed media */ }
  }

  resume() { if (this.current?.blocked) this.attempt(this.current, true); }

  enableVoices(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.pending.splice(0).forEach((item) => this.complete(item, 'muted'));
      if (this.current) this.finish(this.current, 'muted');
    }
  }

  /** notify:false is for an already disconnected socket: stop and unmute locally. */
  clear({ notify = true } = {}) {
    this.pending.splice(0).forEach((item) => this.complete(item, 'cancelled'));
    if (this.current) this.finish(this.current, 'cancelled', { notify });
    if (!notify) {
      // An older playback_ended request may still be settling. Its callback must
      // not unmute a later session/question after this disconnected cleanup.
      if (this.muteOwner) this.options.setMuted?.(false);
      this.muteOwner = null;
      this.settling = false;
    }
    this.cache.clear();
    this.questions.clear();
    this.seen.clear();
  }

  dispose(options) { this.disposed = true; this.clear(options); }
}

export const createQuestionAudio = (options) => new QuestionAudio(options);
