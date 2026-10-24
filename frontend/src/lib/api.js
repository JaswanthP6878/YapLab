// Backend contract for the Python service (FastAPI suggested).
// Set VITE_API_URL (e.g. http://localhost:8000) to leave demo mode.
//
// REST
//   POST /api/sessions
//     body: { scenario, topic, seriousness, agents: [{id, name, trait, instructions, role}],
//             feedback: 'live'|'hints'|'end', noise, questionRate, camera, deck? }
//     -> { sessionId }
//   POST /api/sessions/:id/slides   (multipart PDF/PPTX) -> { slides: [{title, points}] }
//   GET  /api/sessions/:id/report   -> report JSON (same shape as computeResult in engine.js)
//
// WebSocket  /ws/sessions/:id
//   client -> server
//     { type: 'audio', pcm16: <base64>, sampleRate: 16000 }   mic chunks for STT (ElevenLabs / realtime API)
//     { type: 'slide', index }                                 presenter changed slide
//     { type: 'text', text }                                   typed message to the room
//     { type: 'frame', jpeg: <base64> }                        optional camera frame for posture/gesture analysis
//   server -> client
//     { type: 'transcript', who: 'you'|agentId, text, final, t }
//     { type: 'agent_state', agent, state: 'listening'|'hand'|'speaking'|'confused'|'bored'|'laughing'|'noting', u }
//     { type: 'agent_speech', agent, text, audio: <url or base64 mp3> }
//     { type: 'metrics', wpm, fillers: {um: n}, pauses, energy, pitchVar }
//     { type: 'hint', text, kind }
//     { type: 'report', report }

export const API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
export const isDemo = !API_URL;

export async function createSession(config) {
  if (isDemo) return { sessionId: 'demo-' + Date.now() };
  const res = await fetch(`${API_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario: config.scenario,
      topic: config.topic,
      seriousness: config.seriousness,
      feedback: config.feedback,
      noise: config.noise,
      questionRate: config.questionRate,
      camera: config.camera,
      agents: config.roster.filter((p) => config.agents.includes(p.id)),
    }),
  });
  if (!res.ok) throw new Error(`Could not start the session (${res.status}). Check that the backend is running.`);
  return res.json();
}

export function openSocket(sessionId, onEvent) {
  if (isDemo) return null;
  const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws/sessions/${sessionId}`);
  ws.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data)); } catch { /* ignore malformed */ }
  };
  return ws;
}
