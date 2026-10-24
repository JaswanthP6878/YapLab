import test from 'node:test';
import assert from 'node:assert/strict';
import { createTalkLifecycle } from '../talkLifecycle.js';
import { ScribeSpeechController } from '../scribeController.js';

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ start } = {}) {
  const requests = [];
  let closed = 0;
  const run = { alive: true, phase: 'idle', transportConnected: true, starting: null,
    socket: { close: () => { closed += 1; } } };
  const request = async (type, fields) => {
    requests.push({ type, ...fields });
    if (type === 'start') return start ? start() : {};
    if (type === 'transcript') {
      assert.ok(['presenting', 'qa'].includes(run.phase), 'the backend rejects idle transcripts');
      return { accepted: true };
    }
    return {};
  };
  run.slideSync = { synchronize: () => request('slide', { index: 0 }) };
  // Exercise the real typed transport and its shared per-session sequence counter.
  const connection = { request };
  const speech = new ScribeSpeechController({
    context: () => ({ enabled: true, sessionId: 'room', connection, connectionState: 'connected' }),
    onFinal: () => {}, onError: () => {},
  });
  const talk = createTalkLifecycle(run, { request,
    changePhase: (phase) => { run.phase = phase; },
    sendText: (text) => speech.sendText(text) });
  return { run, talk, requests, closed: () => closed };
}

test('connect and idle reconnect synchronize slides without starting the talk', async () => {
  const h = harness();
  await h.talk.synchronize();
  h.run.transportConnected = false;
  h.run.transportConnected = true; // hello still says idle
  await h.talk.synchronize();
  assert.deepEqual(h.requests, [{ type: 'slide', index: 0 }, { type: 'slide', index: 0 }]);
  assert.equal(h.run.phase, 'idle');
  assert.equal(h.run.starting, null);
});

test('concurrent and repeated beginTalk calls send exactly one start and await presenting', async () => {
  const start = deferred();
  const h = harness({ start: () => start.promise });
  const first = h.talk.beginTalk();
  const second = h.talk.beginTalk();
  assert.equal(first, second);
  await flush();
  assert.deepEqual(h.requests, [{ type: 'start' }]);
  assert.equal(h.run.phase, 'idle');
  start.resolve({ state: 'presenting' });
  await first;
  assert.equal(h.run.phase, 'presenting');
  await h.talk.beginTalk();
  assert.equal(h.requests.length, 1);
});

test('the first idle typed line waits for start before sending transcript seq0', async () => {
  const start = deferred();
  const h = harness({ start: () => start.promise });
  const line = h.talk.submitText('Welcome to the class.');
  await flush();
  assert.deepEqual(h.requests, [{ type: 'start' }]);
  start.resolve({});
  assert.deepEqual(await line, { accepted: true });
  assert.deepEqual(h.requests, [{ type: 'start' }, { type: 'transcript', seq: 0, text: 'Welcome to the class.' }]);
  await h.talk.submitText('Here is the next point.');
  assert.deepEqual(h.requests.at(-1), { type: 'transcript', seq: 1, text: 'Here is the next point.' });
});

test('leaving a never-started idle room only closes its socket', async () => {
  const h = harness();
  h.run.alive = false;
  await h.talk.shutdown();
  assert.deepEqual(h.requests, []);
  assert.equal(h.closed(), 1);
});

test('leaving during start waits for its ack and closes the complete lifecycle', async () => {
  const start = deferred();
  const h = harness({ start: () => start.promise });
  const beginning = h.talk.beginTalk();
  h.run.alive = false;
  const shutdown = h.talk.shutdown();
  await flush();
  assert.equal(h.closed(), 0);
  assert.deepEqual(h.requests, [{ type: 'start' }]);
  start.resolve({});
  await beginning;
  await shutdown;
  assert.deepEqual(h.requests.map(({ type }) => type), ['start', 'end_presenting', 'end_qa', 'finish']);
  assert.equal(h.closed(), 1);
});

test('offline or failed starts send no transcript; a rejected start can be retried', async () => {
  let fail = true;
  const h = harness({ start: async () => { if (fail) throw new Error('Start rejected'); return {}; } });
  h.run.transportConnected = false;
  await assert.rejects(h.talk.submitText('Offline'), /connect/);
  assert.deepEqual(h.requests, []);
  h.run.transportConnected = true;
  await assert.rejects(h.talk.submitText('Rejected'), /Start rejected/);
  assert.equal(h.run.starting, null);
  fail = false;
  await h.talk.submitText('Retry');
  assert.deepEqual(h.requests.at(-1), { type: 'transcript', seq: 0, text: 'Retry' });
  h.run.phase = 'qa';
  await h.talk.submitText('An answer');
  assert.equal(h.requests.filter(({ type }) => type === 'start').length, 2);
});
