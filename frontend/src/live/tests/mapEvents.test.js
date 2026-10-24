import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSONAS } from '../../data.js';
import { agentEventToAction } from '../../lib/agentEvents.js';
import { CLIENT_REQUEST_TYPES, EVENT_NAMES, isServerEnvelope } from '../protocol.js';
import { PERSONA_TO_AGENT, AGENT_TO_PERSONA, buildListenerMap, listenerMetadata, agentIdFor,
  eventMetadata, mapAgentEvent, mapListenerMeters, mapRoomGauge } from '../mapEvents.js';

const event = (name, data = {}, t = 1.2345) => ({ type: 'event', event: name, t, data });
const reaction = (attention, confusion) => event('reaction', { listener: 'L0', persona: 'confused first-year', attention, confusion });

test('all six persona mappings match existing UI IDs and default listener identities', () => {
  const expected = { 'confused first-year': 'alex', 'skeptical professor': 'maya', 'ESL student': 'ana',
    'distracted student': 'sam', 'domain expert': 'priya', 'engaged student': 'jordan' };
  assert.deepEqual(PERSONA_TO_AGENT, expected);
  Object.entries(expected).forEach(([persona, id]) => {
    assert.equal(AGENT_TO_PERSONA[id], persona);
    assert.ok(PERSONAS.some((item) => item.id === id));
    assert.equal(agentIdFor('unmapped', persona), id);
  });
  const listeners = Object.keys(expected).slice(0, 5).map((persona, index) => ({ id: `L${index}`, persona }));
  assert.deepEqual(buildListenerMap(listeners), { L0: 'alex', L1: 'maya', L2: 'ana', L3: 'sam', L4: 'priya' });
  assert.equal(agentIdFor('L0', null), 'alex');
  assert.equal(agentIdFor('L1', 'confused first-year'), 'alex', 'an explicit persona beats a default-preset assumption');
  assert.equal(agentIdFor('L0', 'unknown persona'), null);
});

test('duplicate personas preserve listener IDs without sharing UI state identities', () => {
  const listeners = [{ id: 'L0', persona: 'confused first-year' }, { id: 'L1', persona: 'confused first-year' }];
  assert.deepEqual(listenerMetadata(listeners), [
    { listenerId: 'L0', agentId: 'alex', persona: 'confused first-year' },
    { listenerId: 'L1', agentId: 'alex-L1', persona: 'confused first-year' },
  ]);
  const map = buildListenerMap(listeners);
  assert.equal(mapAgentEvent(event('hand_raised', { listener: 'L1', persona: 'confused first-year', question: 'Why?' }), map).agentId, 'alex-L1');
});

test('reaction boundaries and precedence match the live contract', () => {
  assert.equal(mapAgentEvent(reaction(34, 60)).action, 'confused');
  assert.equal(mapAgentEvent(reaction(34.9, 59.9)).action, 'distracted');
  assert.equal(mapAgentEvent(reaction(35, 59.9)).action, 'listening');
  assert.equal(mapAgentEvent(reaction(100, 0)).action, 'listening');
  assert.equal(mapAgentEvent(reaction(50, 65)).timestamp, 1235);
  assert.ok(agentEventToAction(mapAgentEvent(reaction(50, 65))), 'mapped shape must work with the unchanged reducer adapter');
});

test('hand, speech, verdict and lowered events map without an audioUrl', () => {
  const data = { listener: 'L1', persona: 'skeptical professor', question: 'What is the evidence?',
    comment: 'That covers it.', audioUrl: 'must-not-be-copied' };
  const cases = [['hand_raised', 'raise_hand', data.question], ['question_taken', 'speaking', data.question],
    ['qa_question', 'speaking', data.question], ['hand_lowered', 'listening', undefined], ['pooled', 'listening', undefined]];
  for (const [name, action, text] of cases) {
    const result = mapAgentEvent(event(name, data));
    assert.equal(result.agentId, 'maya');
    assert.equal(result.action, action);
    assert.equal(result.text, text);
    assert.equal('audioUrl' in result, false);
  }
  for (const [verdict, action] of [['answered', 'nodding'], ['partial', 'confused'], ['dodged', 'confused']]) {
    assert.equal(mapAgentEvent(event('answer_verdict', { ...data, verdict })).action, action);
    assert.equal(mapAgentEvent(event('answer_verdict', { ...data, verdict })).text, data.comment);
  }
  assert.equal(mapAgentEvent(event('answer_verdict', { ...data, verdict: 'not-a-verdict' })), null);
  assert.equal(mapAgentEvent(event('question_audio', { question_id: 'q1', url: '/audio/q1' })), null);
});

test('grounding and replay metadata remain separate and inspectable', () => {
  const source = event('hand_raised', { question_id: 'q7', listener: 'L1', persona: 'skeptical professor',
    question: 'Why?', quote: 'a real quote', source: 'slide:0', follow_up_of: 'q2', tick: 3, slide: 0 });
  source.replay = true;
  const snapshot = structuredClone(source);
  assert.deepEqual(eventMetadata(source), { listenerId: 'L1', agentId: 'maya', persona: 'skeptical professor',
    questionId: 'q7', question: 'Why?', quote: 'a real quote', source: 'slide:0', followUpOf: 'q2',
    tick: 3, slide: 0, timestamp: 1235, replay: true });
  mapAgentEvent(source);
  assert.deepEqual(source, snapshot, 'mapping is pure');
});

test('listener meters and room gauges preserve zeros/null and clamp finite values', () => {
  const meters = mapListenerMeters(event('reaction', { listener: 'L0', persona: 'confused first-year',
    attention: 120, confusion: -4, understood: 'a note', has_question: true, tick: 2, slide: 0 }));
  assert.equal(meters.attention, 100);
  assert.equal(meters.confusion, 0);
  assert.equal(meters.hasQuestion, true);
  assert.equal(meters.slide, 0);
  assert.deepEqual(mapRoomGauge(event('tick_complete', { tick: 4, room: { attention: 0, confusion: null, comprehension: 25 } })),
    { attention: 0, confusion: null, comprehension: 25, tick: 4, timestamp: 1235 });
  assert.equal(mapRoomGauge(reaction(40, 60)), null);
  assert.equal(mapListenerMeters(event('state', { state: 'qa' })), null);
  assert.equal(mapAgentEvent({ type: 'event', t: Number.NaN, event: 'reaction', data: {} }), null);
});

test('envelope guards cover actual backend commands/events and reject malformed frames', () => {
  assert.equal(CLIENT_REQUEST_TYPES.length, 12);
  for (const name of ['question_audio', 'answer_verdict', 'transcript_dropped', 'llm_fallback', 'qa_pool']) assert.ok(EVENT_NAMES.includes(name));
  assert.equal(isServerEnvelope(event('question_audio', { question_id: 'q', url: '/audio' })), true);
  assert.equal(isServerEnvelope({ type: 'error', message: 'Invalid request', id: null }), true);
  assert.equal(isServerEnvelope({ type: 'ack', id: 1, request: 'start', result: {} }), true);
  assert.equal(isServerEnvelope({ type: 'hello', session: { id: 's' }, events: [] }), true);
  assert.equal(isServerEnvelope({ type: 'event', event: 'reaction', t: 0, data: [] }), false);
  assert.equal(isServerEnvelope({ type: 'ack', id: 1 }), false);
  assert.equal(isServerEnvelope(null), false);
});
