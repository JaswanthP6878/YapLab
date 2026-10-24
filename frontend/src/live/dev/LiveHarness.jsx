import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PERSONAS } from '../../data.js';
import { defaultConfig } from '../../lib/config.js';
import { API_URL } from '../client.js';
import { useLiveSession } from '../useLiveSession.js';

function LiveHarness() {
  const [started, setStarted] = useState(false);
  const [draft, setDraft] = useState('');
  const [captions, setCaptions] = useState([]);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ambience, setAmbience] = useState(false);
  const config = useMemo(() => defaultConfig('teaching', 'lecture', PERSONAS, { camera: false, noise: ambience }), [ambience]);
  const live = useLiveSession({ config, enabled: started,
    onTranscript: (text) => setCaptions((previous) => [...previous, text]) });
  const action = async (callback) => {
    setBusy(true); setActionError('');
    try { await callback(); } catch (error) { setActionError(error.message); } finally { setBusy(false); }
  };
  const ready = ['presenting', 'qa'].includes(live.status);
  return <main style={{ fontFamily: 'system-ui', maxWidth: 1100, margin: '24px auto', padding: 20, lineHeight: 1.5 }}>
    <h1>FrontRow live bridge test bench</h1>
    <p>API: {API_URL || '(set VITE_API_URL)'} · <strong data-testid="phase">{live.status}</strong> · socket {live.connectionState} · mic {live.speech.status}</p>
    <p>Session: <code>{live.sessionId || 'not started'}</code>. Use headphones for voice checks. Camera stays off.</p>
    <p>Students speak after <strong>Call on</strong> during your talk, or <strong>Next question</strong> in Q&A. Background sounds are separate from student voices.</p>
    <label><input type="checkbox" checked={ambience} onChange={(event) => setAmbience(event.target.checked)} /> Room ambience (creaks, yawns, whispers)</label>
    <p role="status">Student audio: {live.audioBlocked ? 'blocked — click Enable audio' : live.questionPlayback?.status || 'waiting for you to call on a question'}{live.speech.muted ? ' · microphone muted for playback' : ''}</p>
    {!started && <button onClick={() => setStarted(true)}>Start session</button>}
    {started && !live.report && <>
      <button disabled={!ready || !live.speech.supported} onClick={() => action(() => live.speech.listening ? live.speech.stop() : live.speech.start())}>{live.speech.listening ? 'Stop microphone' : 'Start microphone'}</button>{' '}
      <button onClick={live.resumeAudio}>Enable audio</button>{' '}
      {live.status === 'presenting' && <button disabled={busy} onClick={() => action(live.endTalk)}>End talk</button>}
      {live.status === 'qa' && <><button disabled={busy} onClick={() => action(live.nextQuestion)}>Next question</button>{' '}<button disabled={busy} onClick={() => action(live.finishQA)}>Finish and get report</button></>}
    </>}
    {(live.error || actionError) && <p role="alert" style={{ color: '#a21d1d' }}>{actionError || live.error}</p>}
    {live.audioBlocked && <p role="status">Audio is blocked. Click Enable audio to hear the question.</p>}
    <section aria-label="Listeners" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '20px 0' }}>
      {live.listeners.map((listener) => {
        const meters = live.agents[listener.agentId];
        return <div key={listener.listenerId} style={{ border: '1px solid #bbb', padding: 12, minWidth: 160 }}>
          <strong>{listener.agentId}</strong> ({listener.listenerId})<br />{listener.persona}<br />
          Attention: <meter min="0" max="100" value={meters?.attention ?? 0} /> {meters?.attention ?? '—'}<br />
          Confusion: <meter min="0" max="100" value={meters?.confusion ?? 0} /> {meters?.confusion ?? '—'}
          <p>{meters?.understood}</p>
        </div>;
      })}
    </section>
    <p>Room attention {live.room?.attention ?? '—'} · confusion {live.room?.confusion ?? '—'} · comprehension {live.room?.comprehension ?? '—'} · tick {live.room?.tick ?? '—'}</p>
    <section aria-label="Hands"><h2>Hands / answers</h2>
      {live.hands.map((hand) => <article key={hand.questionId} style={{ borderBottom: '1px solid #ccc', padding: 8 }}>
        <strong>{hand.agentId} · {hand.status}</strong>: {hand.question}<br />
        {hand.quote && <small>Grounded in “{hand.quote}” ({hand.source})</small>}{' '}
        {hand.status === 'raised' && live.status === 'presenting' && <button disabled={busy} onClick={() => action(() => live.callOn(hand.questionId))}>Call on {hand.agentId}</button>}
        {live.activeQuestion?.questionId === hand.questionId && <button disabled={busy} onClick={() => action(() => live.answerDone(hand.questionId))}>Done answering {hand.agentId}</button>}
        {hand.verdict && <p>Verdict: {hand.verdict} · {hand.comment}</p>}
      </article>)}
    </section>
    <section aria-label="Captions"><h2>Captions</h2><p aria-live="polite">{captions.join(' ')} <em>{live.speech.interim}</em></p>
      <form onSubmit={(event) => { event.preventDefault(); const text = draft; setDraft(''); action(() => live.submitText(text)); }}>
        <input aria-label="Typed transcript" value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: '75%' }} placeholder="Typed transcript uses the same sequence as the microphone" />{' '}
        <button disabled={!ready || busy || !draft.trim()}>Send transcript</button>
      </form>
      <h3>Transcript acknowledgements</h3><pre data-testid="acks">{JSON.stringify(live.transcriptAcks, null, 2)}</pre>
    </section>
    <details open><summary>Event log ({live.events.length})</summary><pre style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{live.events.map((event) => JSON.stringify(event)).join('\n')}</pre></details>
    {live.report && <section><h2>Report JSON</h2><pre data-testid="report" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(live.report, null, 2)}</pre></section>}
  </main>;
}

const root = import.meta.hot?.data.root || createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<LiveHarness />);
