import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionAudio } from '../questionAudio.js';
import { createAmbience } from '../ambience.js';

const flush = async () => { for (let i = 0; i < 25; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const event = (name, data) => ({ type: 'event', event: name, data });

class Timers {
  now = 0;
  next = 0;
  jobs = new Map();
  setTimeout = (fn, delay) => { const id = ++this.next; this.jobs.set(id, { fn, at: this.now + delay }); return id; };
  clearTimeout = (id) => this.jobs.delete(id);
  setInterval = (fn, delay) => { const id = ++this.next; this.jobs.set(id, { fn, at: this.now + delay, repeat: delay }); return id; };
  clearInterval = (id) => this.jobs.delete(id);
  advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next;
      this.now = job.at;
      this.jobs.delete(id);
      if (job.repeat) this.jobs.set(id, { ...job, at: this.now + job.repeat });
      job.fn();
    }
    this.now = end;
  }
  options() { return { setTimeout: this.setTimeout, clearTimeout: this.clearTimeout, setInterval: this.setInterval, clearInterval: this.clearInterval }; }
}

class FakeAudio {
  constructor(url) { this.url = url; this.playCalls = 0; this.paused = false; this.volume = 1; }
  play() {
    this.playCalls += 1;
    if (this.blockNext) { this.blockNext = false; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); }
    return Promise.resolve();
  }
  start() { this.onplaying?.(); }
  end() { this.onended?.(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
}

function harness(extra = {}) {
  const audio = [];
  const requests = [];
  const muted = [];
  const speaking = [];
  const blocked = [];
  const timers = new Timers();
  const options = {
    ...timers.options(), apiBase: 'http://127.0.0.1:8000',
    createAudio: (url) => { const item = new FakeAudio(url); audio.push(item); return item; },
    request: (type, fields) => { requests.push({ type, ...fields }); return Promise.resolve({}); },
    setMuted: (value) => muted.push(value),
    onSpeakingChange: (id) => speaking.push(id),
    onBlockedChange: (value) => blocked.push(value),
    ...extra,
  };
  return { queue: createQuestionAudio(options), audio, requests, muted, speaking, blocked, timers };
}

test('default native timers retain their global receiver when stored on the queue', async () => {
  const nativeSet = globalThis.setTimeout;
  const nativeClear = globalThis.clearTimeout;
  let scheduled = 0;
  let cleared = 0;
  globalThis.setTimeout = function (...args) {
    assert.equal(this, globalThis, 'browser setTimeout rejects a QuestionAudio receiver');
    scheduled += 1;
    return nativeSet(...args);
  };
  globalThis.clearTimeout = function (...args) {
    assert.equal(this, globalThis, 'browser clearTimeout rejects a QuestionAudio receiver');
    cleared += 1;
    return nativeClear(...args);
  };
  let queue;
  try {
    const media = new FakeAudio('/one.mp3');
    queue = createQuestionAudio({ createAudio: () => media, request: () => Promise.resolve({}) });
    queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/one.mp3' }));
    const done = queue.play('q1');
    await flush();
    media.start();
    media.end();
    await flush();
    await done;
    assert.ok(scheduled > 0 && cleared > 0);
  } finally {
    queue?.dispose({ notify: false });
    globalThis.setTimeout = nativeSet;
    globalThis.clearTimeout = nativeClear;
  }
});

test('cache is silent; actual playback is FIFO, ack-first, and deduplicated', async () => {
  const ack = deferred();
  const h = harness({ request: (type) => type === 'playback_started' ? ack.promise : Promise.resolve({}) });
  h.queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/one.mp3' }));
  h.queue.handleEvent(event('question_audio', { question_id: 'q2', url: '/two.mp3' }));
  assert.equal(h.audio.length, 0);
  const first = h.queue.play('q1');
  assert.equal(h.queue.play('q1'), first);
  const second = h.queue.play('q2');
  assert.deepEqual(h.muted, [true]);
  assert.equal(h.audio[0].playCalls, 0);
  ack.resolve({});
  await flush();
  assert.equal(h.audio[0].playCalls, 1);
  assert.equal(h.audio[0].url, 'http://127.0.0.1:8000/one.mp3');
  assert.deepEqual(h.speaking, []);
  h.audio[0].start();
  assert.deepEqual(h.speaking, ['q1']);
  assert.equal(h.audio.length, 1);
  h.audio[0].end();
  await flush();
  assert.equal(h.audio.length, 2);
  h.audio[1].start();
  h.audio[1].end();
  await flush();
  assert.deepEqual(await first, { status: 'played' });
  assert.deepEqual(await second, { status: 'played' });
  assert.deepEqual(h.speaking, ['q1', null, 'q2', null]);
  assert.equal(h.muted.at(-1), false);
  h.queue.dispose();
});

test('mic stays muted until playback_ended ack; clear stops actual media and queued questions', async () => {
  const ended = deferred();
  const h = harness({ request: (type) => type === 'playback_ended' ? ended.promise : Promise.resolve({}) });
  h.queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/one.mp3' }));
  const first = h.queue.play('q1');
  const pending = h.queue.play('q2');
  await flush();
  h.audio[0].start();
  h.queue.clear();
  assert.equal(h.audio[0].paused, true);
  assert.equal(h.muted.at(-1), true);
  assert.deepEqual(await first, { status: 'cancelled' });
  assert.deepEqual(await pending, { status: 'cancelled' });
  ended.resolve({});
  await flush();
  assert.equal(h.muted.at(-1), false);
  h.queue.dispose();
});

test('autoplay rejection releases mic/floor and resumes synchronously in a click', async () => {
  const h = harness();
  h.queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/one.mp3' }));
  const done = h.queue.play('q1');
  h.audio[0].blockNext = true;
  await flush();
  assert.equal(h.blocked.at(-1), true);
  assert.equal(h.muted.at(-1), false);
  assert.deepEqual(h.speaking, []);
  h.queue.resume();
  assert.equal(h.audio[0].playCalls, 2, 'play must run before awaiting a resumed ack');
  assert.equal(h.muted.at(-1), true);
  h.audio[0].start();
  h.audio[0].end();
  await flush();
  await done;
  assert.deepEqual(h.requests.map((request) => request.type), ['playback_started', 'playback_ended', 'playback_started', 'playback_ended']);
  assert.equal(h.muted.at(-1), false);
  h.queue.dispose();
});

function browserSpeech() {
  const synthesis = {
    pending: false, speaking: false, utterance: null,
    speak(utterance) { this.utterance = utterance; this.pending = true; },
    cancel() { this.pending = false; this.speaking = false; },
  };
  const calls = [];
  const original = synthesis.speak;
  const speak = (...args) => { calls.push(args); synthesis.speak({}); }; // Like media.speak: returns void.
  return { synthesis, calls, original, speak,
    start() { synthesis.pending = false; synthesis.speaking = true; synthesis.utterance.onstart?.(); },
    end() { synthesis.speaking = false; synthesis.utterance.onend?.(); },
  };
}

test('five-second missing audio fallback tracks void media.speak through actual utterance end', async () => {
  const speech = browserSpeech();
  const persona = { id: 'alex', pitch: 1.15 };
  const h = harness({ speak: speech.speak, stopSpeaking: () => speech.synthesis.cancel(), speechSynthesis: speech.synthesis, personaFor: () => persona });
  h.queue.handleEvent(event('hand_raised', { question_id: 'q1', persona: 'confused first-year', question: 'Could you explain it again?' }));
  const done = h.queue.play('q1');
  h.timers.advance(4999);
  await flush();
  assert.equal(speech.calls.length, 0);
  assert.deepEqual(h.muted, []);
  h.timers.advance(1);
  await flush();
  assert.deepEqual(speech.calls, [['Could you explain it again?', persona, true]]);
  assert.equal(speech.synthesis.speak, speech.original, 'native method must be restored after the synchronous call');
  assert.deepEqual(h.speaking, []);
  speech.start();
  assert.deepEqual(h.speaking, ['q1']);
  speech.end();
  await flush();
  assert.deepEqual(await done, { status: 'fallback' });
  assert.deepEqual(h.requests.map((request) => request.type), ['playback_started', 'playback_ended']);
  assert.equal(h.muted.at(-1), false);
  assert.equal(h.timers.jobs.size, 0);
  h.queue.dispose();
});

test('provider failure falls back immediately and disabling voices ends playback safely', async () => {
  const speech = browserSpeech();
  const h = harness({ speak: speech.speak, stopSpeaking: () => speech.synthesis.cancel(), speechSynthesis: speech.synthesis });
  h.queue.handleEvent(event('question_audio_failed', { question_id: 'q1', error: 'provider unavailable' }));
  const done = h.queue.play('q1', { text: 'A fallback question', persona: 'domain expert' });
  await flush();
  assert.equal(speech.calls.length, 1);
  assert.equal(h.audio.length, 0);
  speech.start();
  h.queue.enableVoices(false);
  await flush();
  assert.deepEqual(await done, { status: 'muted' });
  assert.equal(speech.synthesis.speaking, false);
  assert.equal(h.muted.at(-1), false);
  assert.deepEqual(await h.queue.play('q2'), { status: 'muted' });
  h.queue.dispose();
});

test('an audio URL that never starts falls back after five seconds instead of holding the mic', async () => {
  const speech = browserSpeech();
  const h = harness({ speak: speech.speak, stopSpeaking: () => speech.synthesis.cancel(), speechSynthesis: speech.synthesis });
  h.queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/stalled.mp3' }));
  const done = h.queue.play('q1', { text: 'A stalled audio question' });
  await flush();
  h.timers.advance(5000);
  await flush();
  assert.equal(h.audio[0].paused, true);
  assert.equal(speech.calls.length, 1);
  speech.start();
  speech.end();
  await flush();
  assert.deepEqual(await done, { status: 'fallback' });
  assert.equal(h.muted.at(-1), false);
  h.queue.dispose();
});

test('disconnected clear stops audio without sending an extra ended request', async () => {
  const completed = [];
  const h = harness({ onComplete: (...args) => completed.push(args) });
  h.queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/one.mp3' }));
  const done = h.queue.play('q1', { listener: 'L0' });
  await flush();
  h.audio[0].start();
  h.queue.clear({ notify: false });
  h.queue.clear({ notify: false });
  assert.equal(h.audio[0].paused, true);
  assert.equal(h.muted.at(-1), false);
  assert.deepEqual(h.requests.map((request) => request.type), ['playback_started']);
  assert.deepEqual(await done, { status: 'cancelled' });
  assert.equal(completed.length, 1);
  assert.equal(completed[0][1].listener, 'L0');
  h.queue.dispose({ notify: false });
});

test('late ended ack cannot unmute a new playback after disconnected clear', async () => {
  const ended = deferred();
  const h = harness({ request: (type) => type === 'playback_ended' ? ended.promise : Promise.resolve({}) });
  h.queue.handleEvent(event('question_audio', { question_id: 'q1', url: '/one.mp3' }));
  const first = h.queue.play('q1');
  await flush();
  h.audio[0].start();
  h.audio[0].end();
  await first;
  h.queue.clear({ notify: false });
  h.queue.handleEvent(event('question_audio', { question_id: 'q2', url: '/two.mp3' }));
  const second = h.queue.play('q2');
  await flush();
  h.audio[1].start();
  assert.equal(h.muted.at(-1), true);
  const beforeAck = h.muted.length;
  ended.resolve({});
  await flush();
  assert.equal(h.muted.length, beforeAck);
  assert.equal(h.muted.at(-1), true);
  h.audio[1].end();
  await flush();
  await second;
  h.queue.dispose();
});

test('disabled voices complete the question without audio, browser fallback, or mic changes', async () => {
  const completed = [];
  const speech = browserSpeech();
  const h = harness({ speak: speech.speak, onComplete: (...args) => completed.push(args) });
  h.queue.enableVoices(false);
  assert.deepEqual(await h.queue.play('q1', { question: 'A visible question', listener: 'L2' }), { status: 'muted' });
  h.timers.advance(10000);
  await flush();
  assert.equal(h.audio.length, 0);
  assert.equal(speech.calls.length, 0);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.muted, []);
  assert.equal(completed[0][0], 'q1');
  assert.equal(completed[0][1].listener, 'L2');
  assert.deepEqual(completed[0][2], { status: 'muted' });
  h.queue.dispose();
});

test('room loop ducks for questions; blocked loop recovers and dispose stops it', async () => {
  const audio = [];
  const ambience = createAmbience({ createAudio: (url) => {
    const item = new FakeAudio(url);
    if (audio.length === 0) item.blockNext = true;
    audio.push(item);
    return item;
  } });
  ambience.start();
  await flush();
  assert.equal(audio[0].loop, true);
  assert.equal(audio[0].volume, 0.035);
  ambience.resume();
  assert.equal(audio[0].playCalls, 2);
  ambience.setDucked(true);
  assert.ok(audio[0].volume < 0.01);
  ambience.setDucked(false);
  assert.equal(audio[0].volume, 0.035);
  assert.equal(ambience.handleEvent, undefined, 'room events never trigger sound effects');
  ambience.dispose();
  assert.ok(audio.every((item) => item.paused));
  ambience.start();
  assert.equal(audio.length, 1);
});
