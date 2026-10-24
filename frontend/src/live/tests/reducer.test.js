import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { defaultConfig } from '../../lib/config.js';
import { buildScript, initialState, reducer } from '../../lib/engine.js';
import { makeLiveConfig } from '../liveConfig.js';

function room() {
  const config = makeLiveConfig(defaultConfig('teaching', 'lecture'));
  const { deck } = buildScript(config);
  const state = {
    ...initialState(config, deck), elapsed: 12, slide: 1, words: 5, fillers: { like: 2 }, pendingAnswer: 'priya',
    transcript: [{ who: 'you', text: 'Earlier', t: 3, slide: 0 }],
    agents: {
      alex: { state: 'confused', bubble: 'I lost the definition.', ttl: 0, note: false, u: 22 },
      maya: { state: 'nodding', bubble: 'That evidence answers it.', ttl: 0, note: false, u: 81 },
      ana: { state: 'raise_hand', bubble: 'What does quorum mean?', ttl: 3, note: false, u: 43 },
      sam: { state: 'distracted', bubble: 'Could you recap?', ttl: 0, note: false, u: 18 },
      priya: { state: 'speaking', bubble: 'One edge case.', ttl: 1, note: true, u: 90 },
    },
  };
  Object.values(state.agents).forEach(Object.freeze);
  Object.freeze(state.agents);
  return { config, state };
}

test('live sentences append text without wiping backend states, hands, bubbles, or answer ownership', () => {
  const { config, state } = room();
  const snapshot = structuredClone(state);
  const random = mock.method(Math, 'random', () => { throw new Error('Live transcripts must not run demo simulation'); });
  let next = state;
  try {
    for (const text of ['Um, a quorum means most replicas.', 'Uh, that is a majority.', 'Basically, we need agreement.']) {
      next = reducer(next, { type: 'LIVE_SAY', text, config });
      assert.equal(next.agents, state.agents);
      assert.equal(next.pendingAnswer, 'priya');
      for (const field of ['perSlide', 'wpm', 'hints', 'covered', 'flags']) assert.equal(next[field], state[field]);
    }
  } finally { random.mock.restore(); }
  assert.equal(next.transcript.length, 4);
  assert.equal(next.transcript[0], state.transcript[0]);
  assert.deepEqual(next.transcript.at(-1), { who: 'you', text: 'Basically, we need agreement.', t: 12, slide: 1, fillers: 1, tags: [] });
  assert.equal(next.words, 20);
  assert.deepEqual(next.fillers, { like: 2, um: 1, uh: 1, basically: 1 });
  assert.deepEqual(state, snapshot, 'the prior reducer state must stay immutable');
});

test('a later backend event can still change a listener after live transcript updates', () => {
  const { config, state } = room();
  const spoken = reducer(state, { type: 'LIVE_SAY', text: 'Here is another explanation.', config });
  const updated = reducer(spoken, { type: 'AGENT_EVENT', config,
    event: { agentId: 'alex', action: 'listening', timestamp: 14000 } });
  assert.equal(updated.agents.alex.state, 'listening');
  assert.equal(updated.agents.alex.bubble, null);
  assert.equal(updated.agents.ana, spoken.agents.ana);
  assert.equal(updated.agents.maya, spoken.agents.maya);
});

test('empty or non-text live sentences are no-ops', () => {
  const { config, state } = room();
  for (const text of ['', '   ', null, undefined, 42]) {
    assert.equal(reducer(state, { type: 'LIVE_SAY', text, config }), state);
  }
});

test('the demo USER_SAY action keeps its existing simulated progression', () => {
  const { config, state } = room();
  const next = reducer(state, { type: 'USER_SAY', text: 'Here is the demo explanation.', config });
  assert.notEqual(next.agents, state.agents);
  assert.equal(next.agents.alex.state, 'listening');
  assert.equal(next.agents.sam.state, 'listening');
  assert.equal(next.agents.ana.state, 'raise_hand');
  assert.equal(next.agents.ana.bubble, null);
  assert.equal(next.wpm.length, state.wpm.length + 1);
  assert.equal(next.transcript.length, state.transcript.length + 1);
  assert.equal(state.agents.alex.state, 'confused');
});
