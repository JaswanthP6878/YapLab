import { getDeck } from '../lib/engine.js';

/** Only slide content is grounded; scripted demo utterances must not reach the API. */
export function demoDeckSlides(config = {}) {
  return getDeck(config).segments.map((segment, index) => ({
    index,
    text: [segment.title, ...(segment.points || [])]
      .filter((line) => typeof line === 'string' && line.trim())
      .join('\n'),
  }));
}

const HAND_STATUS = Object.freeze({
  hand_raised: 'raised', hand_lowered: 'pooled', pooled: 'pooled',
  question_taken: 'taken', qa_question: 'taken',
  answer_verdict: 'answered', answer_eval_error: 'error',
});
const HAND_RANK = Object.freeze({ raised: 0, pooled: 1, taken: 2, answered: 3, error: 3 });

/**
 * Immutable question_id map, keeping grounding and follow-up links for the UI.
 * `active` means a taken question is waiting for its answer/evaluation. A replay
 * of an earlier hand event cannot revive a question that has already resolved.
 */
export function updateHands(handsById = {}, event) {
  if (event?.type !== 'event' || !event.data || typeof event.data !== 'object') return handsById;
  const data = event.data;
  const questionId = data.question_id;
  const status = HAND_STATUS[event.event];
  if (!status || typeof questionId !== 'string' || !questionId) return handsById;
  const previous = handsById[questionId];
  if (previous && HAND_RANK[previous.status] > HAND_RANK[status]) return handsById;
  if (previous && Number.isFinite(event.t) && Number.isFinite(previous.updatedAt)
    && event.t < previous.updatedAt) return handsById;
  const next = { ...handsById };
  if (status === 'taken') {
    Object.entries(next).forEach(([id, hand]) => {
      if (id !== questionId && hand.active) next[id] = { ...hand, active: false };
    });
  }
  next[questionId] = { ...previous, ...data, questionId, status, active: status === 'taken',
    ...(Number.isFinite(event.t) ? { updatedAt: event.t } : {}) };
  return next;
}

/**
 * Seed the shared mic/typed counter after hello/replay. Echo-dropped segments also
 * consume a seq on the backend, so accepted transcript events alone are not enough.
 */
export function replayTranscriptSequence(events = []) {
  let next = 0;
  for (const event of events) {
    if (event?.type !== 'event' || !['transcript', 'transcript_dropped'].includes(event.event)) continue;
    const seq = event.data?.seq;
    if (Number.isSafeInteger(seq) && seq >= 0) next = Math.max(next, seq + 1);
  }
  return next;
}

const PHASES = new Set(['idle', 'presenting', 'qa', 'reporting', 'ended']);

/** The hello snapshot is authoritative; replay must never auto-start a completed talk. */
export function backendPhaseFromHello(hello) {
  const phase = hello?.session?.state;
  return PHASES.has(phase) ? phase : 'idle';
}
