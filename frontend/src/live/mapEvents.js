/** Exact semantic correspondence; avatar names need not match provider voice names. */
export const PERSONA_TO_AGENT = Object.freeze({
  'confused first-year': 'alex',
  'skeptical professor': 'maya',
  'ESL student': 'ana',
  'distracted student': 'sam',
  'domain expert': 'priya',
  'engaged student': 'jordan',
});
export const AGENT_TO_PERSONA = Object.freeze(Object.fromEntries(Object.entries(PERSONA_TO_AGENT).map(([persona, id]) => [id, persona])));
export const DEFAULT_LISTENER_MAP = Object.freeze({ L0: 'alex', L1: 'maya', L2: 'ana', L3: 'sam', L4: 'priya' });

/** Preserve listener identities even if a later preset repeats one persona. */
export function listenerMetadata(listeners = []) {
  const used = new Set();
  return listeners.map(({ id, persona }) => {
    const base = PERSONA_TO_AGENT[persona] ?? null;
    const agentId = base && used.has(base) ? `${base}-${id}` : base;
    if (base) used.add(base);
    return { listenerId: id, agentId, persona };
  });
}

export function buildListenerMap(listeners = []) {
  return Object.fromEntries(listenerMetadata(listeners).filter((item) => item.agentId).map((item) => [item.listenerId, item.agentId]));
}

export function agentIdFor(listenerId, persona, listenerMap) {
  return listenerMap?.[listenerId] ?? PERSONA_TO_AGENT[persona]
    ?? (persona == null ? DEFAULT_LISTENER_MAP[listenerId] : null) ?? null;
}

const isEvent = (event) => event?.type === 'event' && Number.isFinite(event.t) && event.data && typeof event.data === 'object';
const meter = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
const stamp = (event) => Math.round(event.t * 1000);

/** Metadata stays outside AgentEvent so question IDs and grounding remain inspectable. */
export function eventMetadata(event, listenerMap) {
  if (!isEvent(event)) return null;
  const data = event.data;
  return {
    listenerId: data.listener ?? null,
    agentId: agentIdFor(data.listener, data.persona, listenerMap),
    persona: data.persona ?? null,
    questionId: data.question_id ?? null,
    question: data.question ?? null,
    quote: data.quote ?? null,
    source: data.source ?? null,
    followUpOf: data.follow_up_of ?? null,
    tick: data.tick ?? null,
    slide: data.slide ?? null,
    timestamp: stamp(event),
    replay: event.replay === true,
  };
}

/** @returns {import('../lib/agentEvents.js').AgentEvent|null} */
export function mapAgentEvent(event, listenerMap) {
  if (!isEvent(event)) return null;
  const { data } = event;
  const agentId = agentIdFor(data.listener, data.persona, listenerMap);
  if (!agentId) return null;
  let action;
  let text;
  switch (event.event) {
    case 'reaction':
      action = data.confusion >= 60 ? 'confused' : data.attention < 35 ? 'distracted' : 'listening';
      break;
    case 'hand_raised':
      action = 'raise_hand';
      text = data.question;
      break;
    case 'question_taken':
    case 'qa_question':
      action = 'speaking';
      text = data.question;
      break;
    case 'answer_verdict':
      if (!['answered', 'partial', 'dodged'].includes(data.verdict)) return null;
      action = data.verdict === 'answered' ? 'nodding' : 'confused';
      text = data.comment;
      break;
    case 'hand_lowered':
    case 'pooled':
      action = 'listening';
      break;
    default:
      return null;
  }
  // Never attach audioUrl: the bridge owns audio, playback events, and mic muting.
  return { agentId, action, ...(typeof text === 'string' && text ? { text } : {}), timestamp: stamp(event) };
}

export function mapListenerMeters(event, listenerMap) {
  if (!isEvent(event) || event.event !== 'reaction') return null;
  return {
    listenerId: event.data.listener,
    agentId: agentIdFor(event.data.listener, event.data.persona, listenerMap),
    persona: event.data.persona,
    attention: meter(event.data.attention),
    confusion: meter(event.data.confusion),
    understood: event.data.understood ?? '',
    hasQuestion: event.data.has_question === true,
    tick: event.data.tick,
    slide: event.data.slide ?? null,
    timestamp: stamp(event),
  };
}

export function mapRoomGauge(event) {
  if (!isEvent(event) || event.event !== 'tick_complete') return null;
  const room = event.data.room ?? {};
  return { attention: meter(room.attention), confusion: meter(room.confusion),
    comprehension: meter(room.comprehension), tick: event.data.tick, timestamp: stamp(event) };
}
