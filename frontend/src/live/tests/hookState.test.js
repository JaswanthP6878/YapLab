import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHandEvent, createDebugHistory, createSlideSync, createSessionErrors, preserveRaisedHand } from '../hookState.js';

test('product diagnostics retain bounded histories without publishing state until opted in', () => {
  const eventSnapshots = [];
  const ackSnapshots = [];
  const history = createDebugHistory({ onEvents: (items) => eventSnapshots.push(items), onAcks: (items) => ackSnapshots.push(items) });
  for (let n = 0; n < 350; n += 1) history.addEvent({ n });
  for (let seq = 0; seq < 120; seq += 1) history.addAck({ seq });
  assert.equal(eventSnapshots.length, 0);
  assert.equal(ackSnapshots.length, 0);
  history.setEnabled(true);
  assert.equal(eventSnapshots.length, 1);
  assert.equal(ackSnapshots.length, 1);
  assert.equal(eventSnapshots[0].length, 300);
  assert.equal(eventSnapshots[0][0].n, 50);
  assert.equal(ackSnapshots[0].length, 100);
  assert.equal(ackSnapshots[0][0].seq, 20);
  history.addEvent({ n: 350 });
  assert.equal(eventSnapshots.length, 2);
  assert.equal(eventSnapshots[0].at(-1).n, 349, 'published snapshots must not mutate');
  history.setEnabled(false);
  history.addEvent({ n: 351 });
  history.addAck({ seq: 120 });
  assert.equal(eventSnapshots.length, 2);
  assert.equal(ackSnapshots.length, 1);
  history.clear();
  assert.deepEqual(history.snapshot(), { events: [], acks: [] });
});

test('bench diagnostics publish new events, acks, and clears when opted in', () => {
  const events = [];
  const acks = [];
  const history = createDebugHistory({ onEvents: (items) => events.push(items), onAcks: (items) => acks.push(items) });
  history.setEnabled(true);
  history.addEvent({ event: 'tick_start' });
  history.addAck({ seq: 0, accepted: true });
  assert.deepEqual(events.at(-1), [{ event: 'tick_start' }]);
  assert.deepEqual(acks.at(-1), [{ seq: 0, accepted: true }]);
  history.clear();
  assert.deepEqual(events.at(-1), []);
  assert.deepEqual(acks.at(-1), []);
});

test('transcript/audio/tick events do not publish unchanged hands or clear a visible question', () => {
  const publications = [];
  let hands = applyHandEvent({}, { type: 'event', event: 'hand_raised', t: 1,
    data: { question_id: 'q1', listener: 'L0', persona: 'confused first-year', question: 'Why does this work?' } }, (next) => publications.push(next));
  const raised = hands;
  for (const event of ['transcript', 'question_audio', 'tick_start', 'reaction']) {
    hands = applyHandEvent(hands, { type: 'event', event, t: 2, data: { seq: 3, listener: 'L0', attention: 20 } }, (next) => publications.push(next));
  }
  assert.equal(hands, raised);
  assert.equal(publications.length, 1);
  assert.equal(hands.q1.question, 'Why does this work?');
  hands = applyHandEvent(hands, { type: 'event', event: 'question_taken', t: 3, data: { question_id: 'q1', listener: 'L0' } }, (next) => publications.push(next));
  assert.equal(publications.length, 2);
  assert.equal(hands.q1.status, 'taken');
});

test('local slide changes survive disconnection and resend the latest index on reconnect', async () => {
  let connected = false;
  const requests = [];
  const slides = createSlideSync({ canSend: () => connected, request: async (type, fields) => { requests.push({ type, ...fields }); return {}; } });
  assert.equal(slides.index, 0);
  await slides.select(2);
  await slides.select(4);
  assert.equal(slides.index, 4);
  assert.deepEqual(requests, []);
  connected = true;
  await slides.synchronize();
  assert.deepEqual(requests, [{ type: 'slide', index: 4 }]);
  await slides.select(5);
  assert.deepEqual(requests.at(-1), { type: 'slide', index: 5 });
});

test('failed or late slide acknowledgements never roll local navigation back', async () => {
  const problems = [];
  const requests = [];
  let resolveOld;
  let fail = false;
  const slides = createSlideSync({ canSend: () => true,
    request: (type, { index }) => {
      requests.push(index);
      if (fail) return Promise.reject(new Error('Connection lost'));
      if (index === 1) return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve({});
    }, onError: (error) => problems.push(error.message) });
  const old = slides.select(1);
  await slides.select(2);
  resolveOld({});
  await old;
  assert.equal(slides.index, 2);
  fail = true;
  assert.equal(await slides.select(3), null);
  assert.equal(slides.index, 3);
  assert.deepEqual(problems, ['Connection lost']);
  fail = false;
  await slides.synchronize();
  assert.deepEqual(requests, [1, 2, 3, 3]);
});


test("pooling a different question never hides this listener's raised hand", () => {
  const raised = { type: 'event', event: 'hand_raised', t: 1,
    data: { question_id: 'q1', listener: 'L0', persona: 'confused first-year', question: 'Define a quorum?' } };
  let hands = applyHandEvent({}, raised, () => {});
  const pooled = { type: 'event', event: 'pooled', t: 2,
    data: { question_id: 'q2', listener: 'L0', persona: 'confused first-year', question: 'Another question' } };
  hands = applyHandEvent(hands, pooled, () => {});
  assert.deepEqual(preserveRaisedHand({ agentId: 'alex', action: 'listening', timestamp: 2000 }, pooled, hands),
    { agentId: 'alex', action: 'raise_hand', text: 'Define a quorum?', timestamp: 2000 });
  const lowered = { ...pooled, event: 'hand_lowered', data: { ...pooled.data, question_id: 'q1' } };
  assert.equal(preserveRaisedHand({ agentId: 'alex', action: 'listening' }, lowered, hands).action, 'listening');
  const taken = { ...lowered, event: 'question_taken' };
  assert.equal(preserveRaisedHand({ agentId: 'alex', action: 'speaking' }, taken, hands).action, 'speaking');
  assert.equal(preserveRaisedHand({ agentId: 'maya', action: 'nodding' }, { ...pooled, data: { listener: 'L1' } }, hands).action, 'nodding');
});

test('slide navigation clears only a slide-sync error, preserving speech and session failures', () => {
  const changes = [];
  const errors = createSessionErrors((message) => changes.push(message));
  errors.show('Microphone permission denied', 'speech');
  errors.clear('slide');
  assert.deepEqual(changes, ['Microphone permission denied']);
  errors.show('The slide could not sync', 'slide');
  errors.clear('slide');
  assert.deepEqual(changes.slice(-2), ['The slide could not sync', null]);
  errors.show('Session is no longer available');
  errors.clear('slide');
  assert.equal(changes.at(-1), 'Session is no longer available');
});
