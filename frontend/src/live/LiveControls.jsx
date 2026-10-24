import { useState } from 'react';
import { PERSONAS } from '../data.js';

const STATUS_TEXT = {
  idle: 'Preparing your classroom…',
  creating: 'Opening your classroom…',
  connecting: 'Connecting to your classroom…',
  reconnecting: 'Reconnecting. Your microphone is paused.',
  connected: 'Your classroom is connected.',
  presenting: 'Teach the room. Call on a raised hand when you’re ready.',
  qa: 'Q&A is open. Take the next question when you’re ready.',
  reporting: 'Preparing your report…',
  ended: 'Session complete.',
  closed: 'The session connection is closed.',
  error: 'The classroom needs your attention.',
};
const nameFor = (id) => PERSONAS.find((persona) => persona.id === id)?.name || id || 'A listener';
const messageFor = (error) => typeof error === 'string' ? error : error?.message || '';
const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 };
const cardStyle = { ...rowStyle, justifyContent: 'space-between', padding: '12px 14px',
  border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', background: 'var(--board-2)' };

/** Small live-only controls; the Session screen keeps its existing room and slides. */
export default function LiveControls({ live }) {
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');
  const phase = live.status;
  const presenting = phase === 'presenting';
  const qa = phase === 'qa';
  const active = live.activeQuestion;
  const pending = (live.hands || []).filter((hand) =>
    hand.questionId !== active?.questionId && (!hand.status || ['raised', 'pending'].includes(hand.status)));
  const pooled = (live.hands || []).filter((hand) => hand.status === 'pooled').length;
  const error = actionError || messageFor(live.error);

  async function run(label, action, ...args) {
    if (busy || typeof action !== 'function') return;
    setBusy(label);
    setActionError('');
    try { await action(...args); }
    catch (failure) { setActionError(messageFor(failure) || 'The action could not finish. Please try again.'); }
    finally { setBusy(null); }
  }

  return (
    <section aria-label="Live classroom controls" style={{ display: 'grid', gap: 12, padding: '14px max(16px, env(safe-area-inset-left, 0px))',
      borderTop: '1px solid var(--line)', background: 'var(--board)', fontSize: 13 }}>
      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <p role="status" aria-live="polite" style={{ color: 'var(--chalk-2)' }}>
          {busy ? `${busy}…` : STATUS_TEXT[phase] || 'Live classroom'}{pooled > 0 && ` ${pooled} saved for Q&A.`}
          {live.questionPlayback?.status === 'playing' && ' A student is speaking.'}{live.speech?.muted && ' Your microphone is paused for playback.'}
        </p>
        <div style={rowStyle}>
          {live.audioBlocked && <button type="button" className="btn btn-sm btn-primary" disabled={Boolean(busy)}
            onClick={() => run('Enabling audio', live.resumeAudio)}>Enable student audio</button>}
          {presenting && <button type="button" className="btn btn-sm btn-end" disabled={Boolean(busy)}
            onClick={() => run('Ending your talk', live.endTalk)}>End talk</button>}
          {qa && <>
            <button type="button" className="btn btn-sm btn-ghost" disabled={Boolean(busy)}
              onClick={() => run('Getting the next question', live.nextQuestion)}>Next question</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={Boolean(busy)}
              onClick={() => run('Preparing your report', live.finishQA)}>Finish and see report</button>
          </>}
        </div>
      </div>
      {error && <p role="alert" style={{ color: 'var(--coral)', overflowWrap: 'anywhere' }}>{error}</p>}
      {active && (presenting || qa) && <div style={cardStyle}>
        <div style={{ flex: '1 1 260px' }}>
          <p style={{ fontWeight: 600 }}>{nameFor(active.agentId)} asked</p>
          <p style={{ color: 'var(--chalk-2)' }}>{active.question}</p>
        </div>
        <button type="button" className="btn btn-sm btn-primary" disabled={Boolean(busy)}
          onClick={() => run('Sending your answer', live.answerDone, active.questionId)}>Done answering</button>
      </div>}
      {presenting && pending.length > 0 && <ul aria-label="Questions waiting" style={{ listStyle: 'none', display: 'grid', gap: 8, margin: 0, padding: 0, maxHeight: 130, overflowY: 'auto' }}>
        {pending.map((hand) => <li key={hand.questionId} style={cardStyle}>
          <div style={{ flex: '1 1 260px' }}>
            <p style={{ fontWeight: 600 }}>{nameFor(hand.agentId)} has a question</p>
            <p style={{ color: 'var(--chalk-2)' }}>{hand.question}</p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" disabled={Boolean(busy)}
            onClick={() => run(`Calling on ${nameFor(hand.agentId)}`, live.callOn, hand.questionId)}>Call on {nameFor(hand.agentId)}</button>
        </li>)}
      </ul>}
    </section>
  );
}
