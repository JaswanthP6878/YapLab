import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECKS } from '../../data.js';
import { backendPhaseFromHello, demoDeckSlides, replayTranscriptSequence,
  updateHands } from '../sessionState.js';

const event = (name, data = {}, t = 0) => ({ type: 'event', event: name, t, data });
const hand = { question_id: 'q1', listener: 'L0', persona: 'confused first-year',
  question: 'What does the learning rate mean?', quote: 'learning rate',
  source: 'slide:0', follow_up_of: null };

test('demo slides contain deterministic titles and bullet points, never scripted talk lines', () => {
  const slides = demoDeckSlides({ mode: 'teaching', deck: 'backprop' });
  assert.equal(slides.length, DECKS.backprop.segments.length);
  DECKS.backprop.segments.forEach((segment, index) => {
    assert.deepEqual(slides[index], { index, text: [segment.title, ...segment.points].join('\n') });
    assert.ok(!slides[index].text.includes(segment.lines[0].text));
  });
  assert.deepEqual(demoDeckSlides({ deck: 'unknown' }), slides);
  assert.deepEqual(demoDeckSlides(), slides);
  slides[0].text = 'mutated caller copy';
  assert.notEqual(demoDeckSlides({ deck: 'backprop' })[0].text, slides[0].text);
});

test('slide extraction follows the existing deck selection and interview limit without scripting', () => {
  const slides = demoDeckSlides({ mode: 'interview', deck: 'behavioral', questionCount: 2 });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].text.split('\n')[0], DECKS.behavioral.segments[0].title);
});

test('hand lifecycle preserves backend identity and grounding through verdict', () => {
  const raised = updateHands({}, event('hand_raised', hand, 1));
  assert.equal(raised.q1.status, 'raised');
  assert.equal(raised.q1.questionId, 'q1');
  assert.equal(raised.q1.active, false);
  const pooled = updateHands(raised, event('hand_lowered', hand, 2));
  assert.equal(pooled.q1.status, 'pooled');
  const taken = updateHands(pooled, event('qa_question', hand, 3));
  assert.equal(taken.q1.status, 'taken');
  assert.equal(taken.q1.active, true);
  const answered = updateHands(taken, event('answer_verdict', {
    question_id: 'q1', listener: 'L0', verdict: 'partial', comment: 'Show an example.',
  }, 4));
  assert.equal(answered.q1.active, false);
  assert.equal(answered.q1.status, 'answered');
  assert.equal(answered.q1.verdict, 'partial');
  assert.equal(answered.q1.question, hand.question);
  assert.equal(answered.q1.quote, hand.quote);
  assert.equal(raised.q1.status, 'raised', 'earlier snapshots must remain immutable');
});

test('a new taken question owns the floor, and evaluation failure clears its active state', () => {
  const first = updateHands({}, event('question_taken', hand));
  const second = updateHands(first, event('question_taken', { ...hand, question_id: 'q2', follow_up_of: 'q1' }));
  assert.equal(first.q1.active, true);
  assert.equal(second.q1.active, false);
  assert.equal(second.q2.active, true);
  assert.equal(second.q2.follow_up_of, 'q1');
  const failed = updateHands(second, event('answer_eval_error', { question_id: 'q2', error: 'Evaluation failed.' }));
  assert.equal(failed.q2.active, false);
  assert.equal(failed.q2.status, 'error');
  assert.equal(failed.q2.error, 'Evaluation failed.');
});

test('replayed old hand events never revive a resolved question, even with equal timestamps', () => {
  const backlog = [event('hand_raised', hand), event('pooled', hand),
    event('question_taken', hand), event('answer_verdict', { question_id: 'q1', verdict: 'answered' })];
  const restored = backlog.reduce(updateHands, {});
  assert.equal(restored.q1.status, 'answered');
  const replayed = backlog.reduce(updateHands, restored);
  assert.deepEqual(replayed, restored);
  assert.equal(replayed.q1.active, false);
});

test('unrelated/malformed events are no-ops and older events do not overwrite current metadata', () => {
  const hands = updateHands({}, event('hand_raised', hand, 10));
  for (const unrelated of [null, {}, event('reaction', { listener: 'L0' }),
    event('hand_raised', {}), event('hand_raised', { question_id: 4 })]) {
    assert.equal(updateHands(hands, unrelated), hands);
  }
  assert.equal(updateHands(hands, event('hand_raised', { ...hand, question: 'Old wording' }, 9)), hands);
});

test('transcript replay seeds above accepted AND echo-dropped seq values, ignoring bad input', () => {
  assert.equal(replayTranscriptSequence(), 0);
  assert.equal(replayTranscriptSequence([
    event('transcript', { seq: 2 }), event('transcript', { seq: 0 }),
    event('transcript_dropped', { seq: 7 }), event('transcript', { seq: 2 }),
    event('transcript', { seq: -1 }), event('transcript', { seq: '100' }),
    event('transcript', { seq: 9.5 }), event('reaction', { seq: 100 }), null,
  ]), 8);
});

test('hello preserves every backend lifecycle phase instead of restarting replayed sessions', () => {
  for (const state of ['idle', 'presenting', 'qa', 'reporting', 'ended']) {
    assert.equal(backendPhaseFromHello({ type: 'hello', session: { state }, events: [] }), state);
  }
  assert.equal(backendPhaseFromHello(null), 'idle');
});
