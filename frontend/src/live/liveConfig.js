import { PERSONAS } from '../data.js';

export const LIVE_AGENT_IDS = Object.freeze(['alex', 'maya', 'ana', 'sam', 'priya']);

/** Match the backend's default audience while preserving the user's other settings. */
export function makeLiveConfig(config = {}) {
  const roster = Array.isArray(config.roster) ? [...config.roster] : [...PERSONAS];
  const present = new Set(roster.map((persona) => persona.id));
  for (const id of LIVE_AGENT_IDS) {
    if (!present.has(id)) roster.push(PERSONAS.find((persona) => persona.id === id));
  }
  return { ...config, agents: [...LIVE_AGENT_IDS], roster };
}
