import { updateHands } from './sessionState.js';

/** Bounded diagnostics stay outside React; only an opted-in bench gets snapshots. */
export function createDebugHistory({ onEvents = () => {}, onAcks = () => {} } = {}) {
  let enabled = false;
  const events = [];
  const acks = [];
  const append = (items, value, limit, publish) => {
    items.push(value);
    if (items.length > limit) items.splice(0, items.length - limit);
    if (enabled) publish([...items]);
  };
  return {
    setEnabled(value) {
      const next = Boolean(value);
      if (next === enabled) return;
      enabled = next;
      if (enabled) { onEvents([...events]); onAcks([...acks]); }
    },
    addEvent(event) { append(events, event, 300, onEvents); },
    addAck(ack) { append(acks, ack, 100, onAcks); },
    clear() {
      events.length = 0;
      acks.length = 0;
      if (enabled) { onEvents([]); onAcks([]); }
    },
    snapshot() { return { events: [...events], acks: [...acks] }; },
  };
}

/** Non-hand events keep object identity and must not publish a new React array. */
export function applyHandEvent(previous, event, publish) {
  const next = updateHands(previous, event);
  if (next !== previous) publish(next);
  return next;
}

/** Local slide intent survives failed sends; a reconnect resends the latest index. */
export function createSlideSync({ canSend, request, onError = () => {} }) {
  let index = 0;
  const synchronize = async () => {
    if (!canSend()) return null;
    const requestedIndex = index;
    try { return await request('slide', { index: requestedIndex }); }
    catch (error) { onError(error); return null; }
  };
  return {
    get index() { return index; },
    select(value) {
      if (!Number.isSafeInteger(value) || value < 0) {
        onError(new Error('Slide index must be a nonnegative integer.'));
        return Promise.resolve(null);
      }
      index = value;
      return synchronize();
    },
    synchronize,
  };
}


/** Keep another question's pool/lower event from hiding an actionable hand. */
export function preserveRaisedHand(mapped, envelope, hands) {
  if (!mapped) return mapped;
  const data = envelope.data || {};
  const ownHandEnds = ['hand_lowered', 'question_taken', 'qa_question'].includes(envelope.event);
  const raised = Object.values(hands).find((hand) => hand.status === 'raised' && hand.listener === data.listener
    && !(ownHandEnds && hand.questionId === data.question_id));
  return raised ? { ...mapped, action: 'raise_hand', text: raised.question } : mapped;
}

/** Only an error's owning action may clear it as part of routine navigation. */
export function createSessionErrors(publish) {
  let current = null;
  return {
    show(problem, source = 'general') {
      current = { source, message: problem?.message || String(problem) };
      publish(current.message);
    },
    clear(source) {
      if (source && current?.source !== source) return;
      current = null;
      publish(null);
    },
  };
}
