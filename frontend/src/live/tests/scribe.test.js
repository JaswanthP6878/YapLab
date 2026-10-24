import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScribeSpeechController, TranscriptSequences, pcmDurationSeconds,
  scribeConnectOptions, transcriptDuration } from '../scribeController.js';

const PCM = Buffer.alloc(8192).toString('base64'); // 0.256 seconds, not milliseconds.
const token = { token: 'ephemeral', provider: 'elevenlabs', model_id: 'scribe_v2_realtime',
  vad_silence_threshold_secs: 0.7, include_timestamps: true };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

class FakeScribeConnection {
  listeners = new Map();
  closed = 0;
  frames = [];
  send(data) { this.frames.push(data); }
  close() { this.closed += 1; }
  on(type, callback) {
    const callbacks = this.listeners.get(type) || new Set();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  }
  off(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, data) { this.listeners.get(type)?.forEach((callback) => callback(data)); }
}

function harness({ getToken, connectGate, request } = {}) {
  let current = null;
  let now = 1256;
  const sdkConnections = [];
  const tokenCalls = [];
  const sdkSettings = [];
  const requests = [];
  const finals = [];
  const acks = [];
  const interim = [];
  const states = [];
  const errors = [];
  const muting = [];
  const backend = { request: (type, fields) => {
    requests.push({ type, fields });
    return request ? request(type, fields) : Promise.resolve({ accepted: true });
  } };
  const context = { sessionId: 'A', connection: backend, connectionState: 'connected', enabled: true };
  const controls = {
    connect: async (settings) => {
      sdkSettings.push(settings);
      if (connectGate) await connectGate;
      current = new FakeScribeConnection();
      sdkConnections.push(current);
    },
    disconnect() { current?.close(); current = null; },
    getConnection: () => current,
    mute: () => muting.push(true),
    unmute: () => muting.push(false),
    clearTranscripts() {},
  };
  const controller = new ScribeSpeechController({
    controls: () => controls,
    context: () => context,
    getSttToken: (id, settings) => {
      tokenCalls.push({ id, ...settings });
      return getToken ? getToken(id, settings) : Promise.resolve(token);
    },
    now: () => now,
    onInterim: (text) => interim.push(text),
    onStatus: (value) => states.push(value),
    onError: (value) => errors.push(value),
    onFinal: (text) => finals.push(text),
    onAck: (ack) => acks.push(ack),
  });
  const final = (text = 'um, uh, um', start = 0.2, end = 1.5) => current.emit('committed_transcript_with_timestamps', {
    text, words: [{ text: 'um,', type: 'word', start, end }],
  });
  return { controller, context, controls, sdkConnections, tokenCalls, sdkSettings, requests,
    finals, acks, interim, states, errors, muting, final,
    connection: () => current, setNow: (value) => { now = value; },
    audio: () => current.send({ audioBase64: PCM }),
  };
}

test('duration remains seconds, ignores non-word events, and never invents missing timings', () => {
  assert.equal(transcriptDuration([
    { type: 'spacing', start: 0, end: 1 },
    { start: 12.25, end: 12.5 }, { start: 13, end: 14.75 },
    { type: 'audio_event', start: 14, end: 30 },
  ]), 2.5);
  assert.equal(transcriptDuration([{ text: 'missing' }]), undefined);
  assert.equal(transcriptDuration([{ start: -1, end: 1 }, { start: 5, end: 4 }]), undefined);
  assert.equal(transcriptDuration([{ start: NaN, end: Infinity }]), undefined);
  assert.equal(pcmDurationSeconds(PCM), 0.256);
});

test('backend token extras and all microphone constraints become SDK runtime settings', () => {
  assert.deepEqual(scribeConnectOptions({ ...token, model_id: 'returned-model',
    vad_silence_threshold_secs: 0.9, include_timestamps: false,
    language_code: 'es', secondary_languages: ['fr'] }), {
    token: 'ephemeral', modelId: 'returned-model', vadSilenceThresholdSecs: 0.9,
    includeTimestamps: false, commitStrategy: 'vad', noVerbatim: false,
    languageCode: 'es', secondaryLanguages: ['fr'],
    microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  assert.equal(scribeConnectOptions(token).languageCode, 'en');
  assert.deepEqual(scribeConnectOptions(token).secondaryLanguages, []);
  assert.throws(() => scribeConnectOptions({}), /token/);
});

test('mic and typed text share an increasing seq; only accepted acks update the UI', async () => {
  const ack = deferred();
  const h = harness({ request: () => ack.promise });
  await h.controller.start();
  h.audio();
  h.connection().emit('partial_transcript', { text: 'um, uh' });
  assert.equal(h.interim.at(-1), 'um, uh');
  h.connection().emit('committed_transcript', { text: 'um, uh, um' });
  assert.equal(h.requests.length, 0, 'basic commit must not duplicate the timestamped commit');
  h.final();
  const typed = h.controller.sendText('Typed explanation');
  assert.deepEqual(h.requests, [
    { type: 'transcript', fields: { seq: 0, text: 'um, uh, um', duration: 1.3 } },
    { type: 'transcript', fields: { seq: 1, text: 'Typed explanation' } },
  ]);
  assert.deepEqual(h.finals, [], 'no callback before ack acceptance');
  ack.resolve({ accepted: true });
  await typed;
  await flush();
  assert.deepEqual(h.finals, ['um, uh, um', 'Typed explanation']);
  assert.equal(h.acks.length, 2);
  assert.ok(h.requests.every(({ fields }) => !('t' in fields) && !('start_ms' in fields) && !('words' in fields)));
  h.controller.stop();
});

test('rejected/dropped commits consume their seq and leave capture running', async () => {
  let calls = 0;
  const h = harness({ request: async () => {
    calls += 1;
    if (calls === 1) return { accepted: false };
    if (calls === 2) throw new Error('Transcript not allowed yet.');
    return { accepted: true };
  } });
  await h.controller.start();
  h.audio();
  h.final('Dropped');
  await flush();
  h.final('Rejected');
  await flush();
  h.final('Accepted');
  await flush();
  assert.deepEqual(h.requests.map((request) => request.fields.seq), [0, 1, 2]);
  assert.deepEqual(h.finals, ['Accepted']);
  assert.equal(h.errors.at(-1), 'Transcript not allowed yet.');
  assert.equal(h.states.at(-1), 'listening');
  assert.equal(h.connection().closed, 0);
  h.controller.stop();
});

test('backend WS reconnect fetches a fresh token and never reuses a transcript seq', async () => {
  const h = harness();
  await h.controller.start();
  h.audio(); h.final('Before');
  await flush();
  const old = h.connection();
  h.context.connectionState = 'reconnecting';
  h.controller.updateContext();
  assert.ok(old.closed > 0);
  h.context.connectionState = 'connected';
  h.controller.updateContext();
  await flush();
  h.audio(); h.final('After');
  await flush();
  assert.equal(h.tokenCalls.length, 2);
  assert.equal(h.sdkSettings.length, 2);
  for (const settings of h.sdkSettings) {
    assert.equal(settings.languageCode, 'en', 'initial and reconnect calls must pin English');
    assert.deepEqual(settings.secondaryLanguages, [], 'no other language hints are sent');
    assert.equal('keyterms' in settings, false);
  }
  assert.deepEqual(h.requests.map((request) => request.fields.seq), [0, 1]);
  assert.deepEqual(h.finals, ['Before', 'After']);
  old.emit('committed_transcript_with_timestamps', { text: 'Old late text', words: [] });
  assert.equal(h.requests.length, 2);
  h.controller.stop();
});

test('sequence seeding and per-session counters never decrease across session switches', async () => {
  const sequences = new TranscriptSequences();
  sequences.setNext('A', 8);
  sequences.setNext('A', 3);
  assert.equal(sequences.next('A'), 8);
  assert.equal(sequences.next('B'), 0);
  assert.equal(sequences.next('A'), 9);
  const h = harness();
  h.controller.adoptSequence(12);
  await h.controller.sendText('New text after replay');
  h.context.sessionId = 'B';
  await h.controller.sendText('A separate session');
  h.context.sessionId = 'A';
  h.controller.setNextSequence(4);
  await h.controller.sendText('Return to the first session');
  assert.deepEqual(h.requests.map(({ fields }) => fields.seq), [13, 0, 14]);
});

test('muting uses SDK mute and drops finals captured during playback even after unmute', async () => {
  const h = harness();
  await h.controller.start();
  h.audio(); // Audio capture started at 1000ms.
  h.setNow(3000); h.controller.setMuted(true);
  h.connection().emit('partial_transcript', { text: 'Agent echo' });
  h.final('Immediate echo', 2.1, 2.5);
  h.setNow(4500); h.controller.setMuted(false);
  h.final('Delayed echo', 2.1, 3.4);
  h.final('Presenter answer', 3.6, 4.0);
  await flush();
  assert.deepEqual(h.muting.slice(-2), [true, false]);
  assert.deepEqual(h.finals, ['Presenter answer']);
  assert.equal(h.requests.length, 1);
  assert.equal(h.interim.includes('Agent echo'), false);
  h.controller.stop();
});

test('playback starting and ending while the first PCM chunk buffers is still guarded', async () => {
  const h = harness();
  await h.controller.start();
  h.setNow(1100); h.controller.setMuted(true);
  h.setNow(1200); h.controller.setMuted(false);
  h.setNow(1256); h.audio(); // First chunk spans 1000..1256ms.
  h.final('Buffered agent echo', 0.05, 0.25);
  h.final('Clean presenter', 0.3, 0.5);
  await flush();
  assert.deepEqual(h.finals, ['Clean presenter']);
  h.controller.stop();
});

test('startup mute intent is reapplied when the SDK microphone becomes ready', async () => {
  const h = harness();
  h.controller.setMuted(true);
  await h.controller.start();
  h.audio();
  assert.equal(h.muting.at(-1), true);
  assert.equal(h.states.at(-1), 'muted');
  h.final('Muted startup', 0.1, 0.5);
  h.setNow(1800); h.controller.setMuted(false);
  h.final('Late startup echo', 0.1, 0.5);
  h.final('Answer', 1, 1.5);
  await flush();
  assert.deepEqual(h.finals, ['Answer']);
  h.controller.stop();
});

test('stop aborts a token fetch and a late token never opens the mic', async () => {
  const pending = deferred();
  const h = harness({ getToken: () => pending.promise });
  const start = h.controller.start();
  h.controller.stop(false);
  assert.equal(h.tokenCalls[0].signal.aborted, true);
  pending.resolve(token);
  assert.equal(await start, false);
  assert.equal(h.sdkConnections.length, 0);
});

test('stop releases an SDK connection that appears after a pending connect', async () => {
  const pending = deferred();
  const h = harness({ connectGate: pending.promise });
  const start = h.controller.start();
  await flush();
  h.controller.stop(false);
  pending.resolve();
  assert.equal(await start, false);
  assert.ok(h.sdkConnections[0].closed > 0);
  assert.equal(h.connection(), null);
});

test('explicit stop prevents automatic backend reconnect from restarting the mic', async () => {
  const h = harness();
  await h.controller.start();
  h.controller.stop();
  h.context.connectionState = 'reconnecting'; h.controller.updateContext();
  h.context.connectionState = 'connected'; h.controller.updateContext();
  await flush();
  assert.equal(h.tokenCalls.length, 1);
});

test('unmount disposes pending ack callbacks; a regular mic stop still accepts its pending text', async () => {
  const firstAck = deferred();
  const h = harness({ request: () => firstAck.promise });
  const pending = h.controller.sendText('Sent before unmount');
  h.controller.dispose();
  firstAck.resolve({ accepted: true });
  await pending;
  assert.deepEqual(h.finals, []);
  assert.deepEqual(h.acks, []);
  assert.equal(await h.controller.start(), false);
  // StrictMode's effect remount updates context before starting a fresh capture.
  h.controller.updateContext();
  await h.controller.sendText('After remount');
  assert.deepEqual(h.finals, ['After remount']);

  const secondAck = deferred();
  const stopped = harness({ request: () => secondAck.promise });
  const text = stopped.controller.sendText('Sent before mic stop');
  stopped.controller.stop();
  secondAck.resolve({ accepted: true });
  await text;
  assert.deepEqual(stopped.finals, ['Sent before mic stop']);
});
