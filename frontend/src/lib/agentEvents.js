// Agent event contract shared with the orchestration backend and the 3D classroom module.
//
// type AgentAction = 'idle' | 'listening' | 'confused' | 'raise_hand' | 'speaking' | 'nodding' | 'distracted';
// type AgentEvent  = { agentId: string; action: AgentAction; text?: string; audioUrl?: string; timestamp: number };
//
// Inbound:  backend → reducer, via agentEventToAction(ev) → dispatch.
// Outbound: Session diffs agent state after every change and calls onAgentEvent(ev) for each change,
//           so a 3D <ClassroomScene> can mirror exactly what the 2D room shows.

export const AGENT_ACTIONS = ['idle', 'listening', 'confused', 'raise_hand', 'speaking', 'nodding', 'distracted'];

/** @typedef {'idle'|'listening'|'confused'|'raise_hand'|'speaking'|'nodding'|'distracted'} AgentAction */
/** @typedef {{agentId: string, action: AgentAction, text?: string, audioUrl?: string, timestamp: number}} AgentEvent */

/** @param {any} ev @returns {ev is AgentEvent} */
export function isAgentEvent(ev) {
  return !!ev && typeof ev.agentId === 'string' && AGENT_ACTIONS.includes(ev.action) && typeof ev.timestamp === 'number';
}

/** Convert a validated AgentEvent into a reducer action. Returns null for invalid input. */
export function agentEventToAction(ev) {
  return isAgentEvent(ev) ? { type: 'AGENT_EVENT', event: ev } : null;
}

/** Emit one AgentEvent per agent whose visible state or speech changed. */
export function diffAgentEvents(prev, next, now = Date.now()) {
  const out = [];
  Object.entries(next).forEach(([agentId, a]) => {
    const p = prev?.[agentId];
    if (!p || p.state !== a.state || p.bubble !== a.bubble) {
      out.push({ agentId, action: a.state, ...(a.bubble ? { text: a.bubble } : {}), timestamp: now });
    }
  });
  return out;
}
