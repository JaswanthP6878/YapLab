import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import { isPanel, modeById } from '../data.js';
import { buildScript, computeResult, initialState, pickResponder, reducer } from '../lib/engine.js';
import { agentEventToAction, diffAgentEvents } from '../lib/agentEvents.js';
import { sessionTitle } from '../lib/config.js';
import { fmt, speak, stopSpeaking, useCamera, useSpeechRecognition } from '../lib/media.js';
import { PdfPage, usePageCount } from '../lib/slides.jsx';
import { API_URL } from '../live/client.js';
import { makeLiveConfig } from '../live/liveConfig.js';
import { useLiveSession } from '../live/useLiveSession.js';
import LiveControls from '../live/LiveControls.jsx';

// The room is distraction-free: no scores, tips or transcript while you present.
// Everything is still measured by the engine and shown in the report afterwards.

const PACE = { say: 3600, raise_hand: 1300, question: 3900, interrupt: 3400, prompt: 3600, ack: 2200, distracted: 2200, confused: 2400, note: 2000 };
const STATE_LABEL = {
  idle: 'Idle', listening: 'Listening', raise_hand: 'Hand raised', speaking: 'Speaking', confused: 'Lost', distracted: 'Distracted', nodding: 'Nodding',
};

function AgentTile({ p, a, i, onCall }) {
  const st = a.state;
  const label = a.note ? 'Taking notes' : STATE_LABEL[st] || st;
  const said = a.bubble?.replace(/\*/g, '');
  return (
    <button className={`tile agent-tile st-${st} ${a.note ? 'noting' : ''}`} onClick={() => onCall(p.id)} aria-label={`${p.name}: ${label}`} title={st === 'raise_hand' ? `Call on ${p.name}` : p.trait}>
      {st === 'raise_hand' && <span className="tile-badge hand"><Icon name="hand" size={15} /></span>}
      {st === 'confused' && <span className="tile-badge q">?</span>}
      {a.note && <span className="tile-badge note"><Icon name="pen" size={12} /></span>}
      <span className="tile-av">
        <Avatar p={p} size={64} state={st} delay={i * 0.63} />
        {st === 'speaking' && <span className="ring" />}
      </span>
      {said && <span className={`tile-said ${a.bubble.startsWith('*') ? 'noise' : ''}`}>{said}</span>}
      <span className="tile-name">{p.name}<em>{label}</em></span>
    </button>
  );
}

function SelfTile({ camera, listening, interim }) {
  const { videoRef, status } = useCamera(camera);
  return (
    <div className={`tile self-tile ${listening ? 'live' : ''}`}>
      <video ref={videoRef} muted playsInline hidden={status !== 'live'} />
      {status !== 'live' && (
        <div className="self-ph">
          <Icon name="cam" size={22} />
          <span>{!camera ? 'Camera off' : status === 'unavailable' ? 'Camera unavailable' : 'Starting camera…'}</span>
        </div>
      )}
      {interim && <span className="tile-said self-said">{interim}</span>}
      <span className="tile-name">You{listening && <em className="on-air">Speaking</em>}</span>
    </div>
  );
}

function Slide({ config, deck, page }) {
  const up = config.slides;
  if (up?.kind === 'pdf') return <PdfPage url={up.url} page={page} />;
  if (up?.kind === 'images') return <img className="slide-img" src={up.urls[page]} alt={`Slide ${page + 1}`} />;
  const seg = deck.segments[page];
  return (
    <div className="demo-slide">
      <span className="chalk-label">Demo deck · {deck.title}</span>
      <h2>{seg.title}</h2>
      <ul>{seg.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>
    </div>
  );
}

export default function Session({ config: initialConfig, onExit, onEnd, onAgentEvent }) {
  const liveMode = Boolean(API_URL) && initialConfig.mode === 'teaching';
  const config = useMemo(() => liveMode ? makeLiveConfig(initialConfig) : initialConfig, [initialConfig, liveMode]);
  const { deck, steps } = useMemo(() => buildScript(config), [config]);
  const [st, rawDispatch] = useReducer(reducer, null, () => initialState(config, deck));
  const dispatch = (a) => rawDispatch({ ...a, config, steps });
  const mode = modeById(config.mode);
  const hasSlides = mode.id !== 'interview';
  const [running, setRunning] = useState(true);
  const [voices, setVoices] = useState(config.voices);
  const [draft, setDraft] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [upPage, setUpPage] = useState(0);
  const stepTimer = useRef(null);
  const roster = config.roster;
  const present = roster.filter((p) => config.agents.includes(p.id));
  const panel = present.filter(isPanel);
  const audience = present.filter((p) => !isPanel(p));
  const prevAgents = useRef(null);
  const reportedLiveReport = useRef(null);
  const live = useLiveSession({ config: { ...config, voices }, enabled: liveMode,
    onTranscript: (text) => dispatch({ type: 'LIVE_SAY', text }),
    onAgentEvent: (event) => { const action = agentEventToAction(event); if (action) dispatch(action); },
  });
  const liveReady = ['presenting', 'qa'].includes(live.status) && live.connectionState === 'connected';
  const liveCanSpeak = live.connectionState === 'connected' && ['idle', 'presenting', 'qa'].includes(live.status);
  const clockRunning = liveMode ? liveReady : running;

  useEffect(() => {
    if (!liveMode || !live.report || reportedLiveReport.current === live.report) return;
    reportedLiveReport.current = live.report;
    onEnd({ kind: 'live', report: live.report, config: { ...initialConfig, voices } });
  }, [liveMode, live.report, initialConfig, voices, onEnd]);

  // Uploaded decks are paged by you; the demo deck follows the scripted presenter.
  const upCount = usePageCount(config.slides);
  const page = config.slides ? upPage : st.slide;
  const pageCount = config.slides ? upCount : deck.segments.length;
  const goTo = (n) => {
    if (n < 0 || n >= pageCount) return;
    if (config.slides) setUpPage(n);
    else dispatch({ type: 'SET_SLIDE', slide: n });
    if (liveMode) void live.setSlide(n).catch(() => {}); // Best-effort sync; slides stay responsive offline.
  };

  const respond = (text) => {
    if (!text.trim()) return false;
    if (liveMode) return live.submitText(text.trim()).then((result) => result?.accepted === true).catch(() => false);
    dispatch({ type: 'USER_SAY', text: text.trim() });
    setTimeout(() => dispatch({ type: 'AGENT_REPLY', ...pickResponder(config) }), 1700);
  };
  const demoSpeech = useSpeechRecognition(respond);
  const speech = liveMode ? live.speech : demoSpeech;
  const toggleSpeech = async () => {
    if (speech.listening) { speech.stop(); return; }
    try {
      if (liveMode) await live.beginTalk();
      await speech.start();
    } catch { /* The bridge displays request errors and keeps Speak retryable. */ }
  };

  // Outbound AgentEvents for a 3D classroom or analytics; inbound test hook on window.
  useEffect(() => {
    const events = diffAgentEvents(prevAgents.current, st.agents);
    prevAgents.current = st.agents;
    if (onAgentEvent) events.forEach(onAgentEvent);
  }, [st.agents, onAgentEvent]);
  useEffect(() => {
    window.frontRow = { sendAgentEvent: (ev) => { const a = agentEventToAction(ev); if (a) dispatch(a); return !!a; } };
    return () => { delete window.frontRow; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clockRunning) return;
    const t = setInterval(() => dispatch({ type: 'CLOCK' }), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockRunning]);

  useEffect(() => {
    if (liveMode || !running || st.done || speech.listening) return;
    const step = steps[st.i];
    const delay = st.i === 0 ? 1400 : step ? PACE[step.kind] || 2000 : 2000;
    stepTimer.current = setTimeout(() => dispatch({ type: 'STEP' }), delay);
    return () => clearTimeout(stepTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, running, st.i, st.done, speech.listening]);

  useEffect(() => {
    if (liveMode) return; // The bridge owns provider audio, browser fallback, and mic muting.
    const last = st.transcript[st.transcript.length - 1];
    if (!last) return;
    if (last.who === 'you') {
      const t = setTimeout(() => dispatch({ type: 'CALM' }), 2600);
      return () => clearTimeout(t);
    }
    if (last.kind !== 'note' && last.kind !== 'distracted') speak(last.text, roster.find((r) => r.id === last.who), voices, last.audioUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, st.transcript.length]);

  useEffect(() => () => stopSpeaking(), []);

  // Arrow keys and presenter clickers (PageUp/PageDown) change slides.
  useEffect(() => {
    if (!hasSlides) return;
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea')) return;
      if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); goTo(page + 1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); goTo(page - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const callOn = (id) => {
    if (liveMode) {
      const hand = live.hands.find((item) => item.agentId === id && item.status === 'raised');
      if (hand) void live.callOn(hand.questionId).catch(() => {});
      return;
    }
    const step = steps[st.i];
    if (st.agents[id]?.state === 'raise_hand' && step && step.agent === id) {
      clearTimeout(stepTimer.current);
      dispatch({ type: 'STEP' });
    }
  };

  const finish = async () => {
    if (liveMode) {
      setConfirmEnd(false);
      try {
        if (live.status === 'presenting') await live.endTalk();
        else if (live.status === 'qa') await live.finishQA();
      } catch { /* The bridge displays nonfatal request errors. */ }
      return;
    }
    stopSpeaking();
    speech.stop();
    onEnd(computeResult(config, deck, st));
  };

  const remaining = config.timeLimit ? config.timeLimit - st.elapsed : null;
  const tiles = [...panel, ...audience].map((p, i) => st.agents[p.id] && <AgentTile key={p.id} p={p} a={st.agents[p.id]} i={i} onCall={callOn} />);
  const self = <SelfTile camera={config.camera} listening={speech.listening && !speech.muted} interim={speech.interim} />;
  const question = !hasSlides && deck.segments[st.slide]?.prompt?.text;

  return (
    <div className={`session room-only mode-${mode.id}`} style={liveMode ? { gridTemplateRows: 'auto minmax(0, 1fr) auto auto' } : undefined}>
      <header className="s-bar">
        <button className="s-exit" onClick={onExit} aria-label="Leave the room"><Icon name="prev" size={18} /></button>
        <div className="s-title">
          <span className="s-kicker"><span className="mode-pill"><Icon name={mode.icon} size={12} /> {mode.name}</span></span>
          <strong>{sessionTitle(config)}</strong>
        </div>
        <div className={`s-clock tnum ${remaining !== null && remaining <= 30 ? 'urgent' : ''}`}>
          <span className={`rec ${clockRunning ? 'on' : ''}`} />
          {remaining !== null ? (remaining > 0 ? fmt(remaining) : `+${fmt(-remaining)}`) : fmt(st.elapsed)}
        </div>
      </header>

      {hasSlides ? (
        <main className="stage">
          <section className="slide-frame" aria-label={`Slide ${page + 1} of ${pageCount || '…'}`}>
            <Slide config={config} deck={deck} page={page} />
          </section>
          <aside className="rail">
            {self}
            <div className="rail-agents">{tiles}</div>
          </aside>
        </main>
      ) : (
        <main className="stage gallery">
          <div className={`gallery-grid n-${tiles.length + 1}`}>
            {tiles}
            {self}
          </div>
          {question && <p className="gallery-q"><span className="tnum">Q{st.slide + 1}</span> {question}</p>}
        </main>
      )}

      {liveMode && <LiveControls live={live} />}

      <footer className="controls">
        <div className="ctl-left">
          {hasSlides && (
            <span className="pager">
              <button className="icon-btn" disabled={page === 0} onClick={() => goTo(page - 1)} aria-label="Previous slide"><Icon name="prev" size={16} /></button>
              <span className="tnum">{page + 1} / {pageCount || '…'}</span>
              <button className="icon-btn" disabled={page >= pageCount - 1} onClick={() => goTo(page + 1)} aria-label="Next slide"><Icon name="next" size={16} /></button>
            </span>
          )}
        </div>

        <div className="ctl-mid">
          <button
            className={`btn btn-mic ${speech.listening ? 'on' : ''}`}
            onClick={toggleSpeech}
            disabled={!speech.supported || (liveMode && !liveCanSpeak)}
            title={speech.supported ? '' : liveMode ? 'Your microphone is unavailable in this browser' : 'Live speech needs Chrome or Edge'}
          >
            <Icon name="mic" /> {speech.listening ? 'Stop' : mode.id === 'interview' ? 'Answer' : 'Speak'}
          </button>
          <form className="say" onSubmit={async (e) => { e.preventDefault(); if (await respond(draft) !== false) setDraft(''); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={mode.id === 'interview' ? 'Or type your answer…' : 'Or type to the room…'} autoComplete="off" aria-label="Type to the room" />
            <button type="submit" className="icon-btn" aria-label="Send" disabled={!draft.trim() || (liveMode && !liveCanSpeak)}><Icon name="arrow" size={16} /></button>
          </form>
        </div>

        <div className="ctl-right">
          <button className="icon-btn" onClick={() => setVoices(!voices)} aria-pressed={voices} title={voices ? 'Mute agent voices' : 'Unmute agent voices'}>
            <Icon name={voices ? 'volume' : 'volumeOff'} />
          </button>
          {!liveMode && <button className="icon-btn" onClick={() => setRunning(!running)} title={running ? 'Pause session' : 'Resume session'}>
            <Icon name={running ? 'pause' : 'play'} size={16} />
          </button>}
          {confirmEnd ? (
            <span className="confirm">
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmEnd(false)}>Keep going</button>
              <button className="btn btn-sm btn-danger" onClick={finish} disabled={liveMode && !liveReady}>{liveMode ? live.status === 'qa' ? 'Finish and see report' : 'End talk and open Q&A' : 'End and see report'}</button>
            </span>
          ) : (
            <button className="btn btn-sm btn-end" onClick={() => setConfirmEnd(true)} disabled={liveMode && !liveReady}><Icon name="stop" size={12} /> {liveMode ? live.status === 'qa' ? 'Finish Q&A' : 'End talk' : 'End'}</button>
          )}
        </div>
      </footer>
    </div>
  );
}
