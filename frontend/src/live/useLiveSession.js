import { useCallback, useEffect, useRef, useState } from 'react';
import { speak, stopSpeaking } from '../lib/media.js';
import { API_URL, createApiClient } from './client.js';
import { createAmbience } from './ambience.js';
import { createQuestionAudio } from './questionAudio.js';
import { agentIdFor, buildListenerMap, eventMetadata, listenerMetadata, mapAgentEvent, mapListenerMeters, mapRoomGauge } from './mapEvents.js';
import { demoDeckSlides } from './sessionState.js';
import { applyHandEvent, createDebugHistory, createSlideSync, createSessionErrors, preserveRaisedHand } from './hookState.js';
import { useScribeSpeech } from './useScribeSpeech.js';
import { createTalkLifecycle } from './talkLifecycle.js';

/**
 * Teaching-only bridge. `enabled` lets a caller mount this hook beside demo hooks
 * without creating a backend session. Configuration is captured when enabled;
 * voices/noise can change during a session without recreating it. Diagnostic
 * event/ack arrays publish React state only when debugLogs is explicitly enabled.
 */
export function useLiveSession({ config, onAgentEvent, onTranscript, enabled = true, debugLogs = false }) {
  const [phase, setPhase] = useState('idle');
  const [connectionState, setConnectionState] = useState('closed');
  const [sessionId, setSessionId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [agents, setAgents] = useState({});
  const [hands, setHands] = useState([]);
  const [listeners, setListeners] = useState([]);
  const [room, setRoom] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [questionPlayback, setQuestionPlayback] = useState(null);
  const [events, setEvents] = useState([]);
  const [transcriptAcks, setTranscriptAcks] = useState([]);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [latestVerdict, setLatestVerdict] = useState(null);
  const errors = useRef(null);
  if (!errors.current) errors.current = createSessionErrors(setError);
  const diagnostics = useRef(null);
  if (!diagnostics.current) diagnostics.current = createDebugHistory({ onEvents: setEvents, onAcks: setTranscriptAcks });
  const latest = useRef({});
  latest.current = { config, onAgentEvent, onTranscript };
  const runtime = useRef(null);
  const speechRef = useRef(null);
  const speech = useScribeSpeech((text) => latest.current.onTranscript?.(text), {
    sessionId, connection, connectionState, enabled,
    onAck: (ack) => diagnostics.current.addAck(ack),
    onError: (message) => errors.current.show(message, 'speech'),
  });
  speechRef.current = speech;

  useEffect(() => {
    diagnostics.current.setEnabled(debugLogs && enabled);
    return () => diagnostics.current.setEnabled(false);
  }, [debugLogs, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (latest.current.config.mode !== 'teaching') {
      setError('Live sessions currently support Teaching mode.');
      return;
    }
    const abort = new AbortController();
    const api = createApiClient();
    const run = { alive: true, api, socket: null, id: null, phase: 'idle', handMap: {}, listenerMap: {}, active: null,
      audio: null, ambience: null, unsubscribers: [], maxSequence: -1, floorId: null, speakingListener: null, starting: null,
      transportConnected: false, connectedOnce: false, transportVersion: 0, slideSync: null };
    runtime.current = run;
    const fail = (value) => { if (run.alive) errors.current.show(value); };
    const changePhase = (value) => { run.phase = value; if (run.alive) setPhase(value); };
    const publishHands = (handMap) => setHands(Object.values(handMap).map((hand) => ({ ...hand,
      agentId: agentIdFor(hand.listener, hand.persona, run.listenerMap) })));
    const emit = (event) => { if (event && run.alive) latest.current.onAgentEvent?.(event); };
    const request = async (type, fields) => {
      if (type === 'playback_started') run.floorId = fields.question_id;
      const result = await run.socket.request(type, fields);
      if (type === 'playback_ended' && run.floorId === fields.question_id) run.floorId = null;
      return result;
    };
    run.slideSync = createSlideSync({
      canSend: () => run.alive && run.transportConnected && ['idle', 'presenting', 'qa'].includes(run.phase),
      request: (type, fields) => run.socket.request(type, fields),
      onError: (problem) => { if (run.alive) errors.current.show(problem, 'slide'); },
    });
    run.talk = createTalkLifecycle(run, { request, changePhase, sendText: (text) => speechRef.current.sendText(text) });
    run.ambience = createAmbience();
    run.audio = createQuestionAudio({ request, apiBase: API_URL, speak, stopSpeaking,
      setMuted: (value) => speechRef.current?.setMuted(value),
      personaFor: (persona, listener) => latest.current.config.roster?.find((person) => person.id === agentIdFor(listener, persona, run.listenerMap)),
      onBlockedChange: (blocked) => { if (run.alive) setAudioBlocked(blocked); },
      onError: fail,
      onSpeakingChange: (id, details) => {
        run.ambience.setDucked(Boolean(id));
        run.speakingListener = id ? details?.listener : null;
        if (run.alive) setQuestionPlayback(id ? { questionId: id, status: 'playing' } : null);
        emit({ agentId: agentIdFor(details?.listener, details?.persona, run.listenerMap), action: id ? 'speaking' : 'listening', timestamp: Date.now() });
      },
    });
    run.audio.enableVoices(latest.current.config.voices !== false);
    if (latest.current.config.noise && latest.current.config.voices !== false) run.ambience.start();
    diagnostics.current.clear();
    errors.current.clear(); setLatestVerdict(null); setReport(null); setHands([]); setAgents({}); setRoom(null); setActiveQuestion(null);
    setQuestionPlayback(null); setPhase('connecting'); setConnectionState('connecting');

    function handleEvent(envelope) {
      if (!run.alive) return;
      diagnostics.current.addEvent(envelope);
      const { event, data } = envelope;
      run.audio.handleEvent(envelope); // cache even during replay; never autoplay history
      if (event === 'state') changePhase(data.state);
      if (['transcript', 'transcript_dropped'].includes(event) && Number.isInteger(data.seq)) {
        run.maxSequence = Math.max(run.maxSequence, data.seq);
        speechRef.current?.adoptSequence(data.seq);
      }
      run.handMap = applyHandEvent(run.handMap, envelope, publishHands);
      const metadata = eventMetadata(envelope, run.listenerMap);
      if (event === 'answer_verdict' && !envelope.replay) {
        setLatestVerdict({ ...metadata, verdict: data.verdict, comment: data.comment });
      }
      if (event === 'question_taken' || event === 'qa_question') {
        run.active = { ...data, ...metadata, status: 'taken' };
        setActiveQuestion(run.active);
        if (!envelope.replay) {
          setQuestionPlayback({ questionId: data.question_id, status: 'waiting' });
          void run.audio.play(data.question_id, data).then((result) => {
          // Voices may be disabled or unavailable, so there may be no onplaying/end.
            if (run.alive) {
              setQuestionPlayback((current) => !current || current.questionId === data.question_id ? { questionId: data.question_id, status: result.status } : current);
              emit({ agentId: metadata.agentId, action: 'listening', timestamp: Date.now() });
            }
          });
        }
      }
      if (['answer_verdict', 'answer_eval_error'].includes(event) && run.active?.questionId === data.question_id) {
        run.active = null; setActiveQuestion(null);
      }
      const meters = mapListenerMeters(envelope, run.listenerMap);
      if (meters) setAgents((previous) => ({ ...previous, [meters.agentId]: meters }));
      const gauge = mapRoomGauge(envelope);
      if (gauge) setRoom(gauge);
      let mapped = mapAgentEvent(envelope, run.listenerMap);
      mapped = preserveRaisedHand(mapped, envelope, run.handMap);
      if (mapped && event === 'reaction' && run.speakingListener === data.listener) mapped = { ...mapped, action: 'speaking', text: undefined };
      // A replay rebuilds visible state but must not repeat old question speech/transcripts.
      if (mapped && envelope.replay && ['speaking', 'nodding'].includes(mapped.action)) mapped = { ...mapped, action: 'listening', text: undefined };
      emit(mapped);
      if (!envelope.replay) run.ambience.handleEvent(envelope);
    }

    async function initialize() {
      const startingConfig = latest.current.config;
      let session;
      if (startingConfig.slides) {
        if (startingConfig.slides.kind !== 'pdf') throw new Error('Live mode accepts PDF decks. Choose a PDF or the demo deck.');
        const response = await fetch(startingConfig.slides.url, { signal: abort.signal });
        if (!response.ok) throw new Error('The uploaded PDF could not be read. Select it again.');
        const blob = await response.blob();
        session = await api.uploadDeck(new File([blob], startingConfig.slides.name || 'slides.pdf', { type: 'application/pdf' }), 'default', { signal: abort.signal });
      } else session = await api.createSession({ preset: 'default', slides: demoDeckSlides(startingConfig) }, { signal: abort.signal });
      if (!run.alive) return;
      run.id = session.id;
      setSessionId(session.id);
      const socket = api.connect(session.id);
      run.socket = socket;
      setConnection(socket);
      run.unsubscribers.push(socket.onState(async (state) => {
        if (!run.alive) return;
        const version = ++run.transportVersion;
        const reconnect = state === 'connected' && run.connectedOnce;
        run.transportConnected = state === 'connected';
        if (state === 'connected') run.connectedOnce = true;
        if (state === 'reconnecting' || state === 'closed') run.audio.clear({ notify: false });
        // Clear a playback floor left on the server by a severed socket before
        // Scribe resumes; otherwise genuine answers can be dropped for 30 seconds.
        if (state === 'connected' && run.floorId && ['presenting', 'qa'].includes(run.phase)) {
          try { await request('playback_ended', { question_id: run.floorId }); }
          catch (problem) { fail(problem); return; }
        }
        // Preserve local navigation made while offline; hello's current_slide may
        // be older. Re-send before Scribe resumes, without replaying start.
        if (reconnect) await run.talk.synchronize();
        if (run.alive && version === run.transportVersion) setConnectionState(state);
      }), socket.onError(fail), socket.onEvent(handleEvent), socket.onHello((hello) => {
        run.listenerMap = buildListenerMap(hello.session.listeners);
        setListeners(listenerMetadata(hello.session.listeners));
        // Reset history-derived state before each full replay.
        run.handMap = {}; run.active = null;
        setHands([]); setActiveQuestion(null);
        changePhase(hello.session.state);
      }));
      await socket.ready;
      if (!run.alive) return;
      await run.talk.synchronize();
    }
    initialize().catch((problem) => { if (problem.name !== 'AbortError') fail(problem); });
    return () => {
      run.alive = false;
      abort.abort();
      speechRef.current?.stop();
      run.audio.dispose(); run.ambience.dispose();
      run.unsubscribers.forEach((unsubscribe) => unsubscribe());
      // There is no cancel endpoint. Close the lifecycle so ticks/provider calls stop.
      void run.talk.shutdown();
      if (runtime.current === run) runtime.current = null;
    };
  }, [enabled]);

  // React has installed the new session context before replay sequences are adopted.
  useEffect(() => { if (sessionId && runtime.current?.maxSequence >= 0) speech.adoptSequence(runtime.current.maxSequence); }, [sessionId, speech.adoptSequence]);
  useEffect(() => {
    const run = runtime.current;
    if (!run) return;
    run.audio.enableVoices(config.voices !== false);
    if (config.noise && config.voices !== false) run.ambience.start(); else run.ambience.stop();
  }, [config.voices, config.noise, enabled]);

  const request = useCallback(async (type, fields = {}) => {
    const run = runtime.current;
    if (!run?.socket) throw new Error('Wait for the live session to connect.');
    errors.current.clear();
    try { return await run.socket.request(type, fields); }
    catch (problem) { if (run.alive) errors.current.show(problem); throw problem; }
  }, []);
  const callOn = useCallback((questionId) => request('take_question', { question_id: questionId }), [request]);
  const answerDone = useCallback((questionId) => request('answer_done', { question_id: questionId }), [request]);
  const setSlide = useCallback((index) => {
    const run = runtime.current;
    if (!run?.alive) return Promise.resolve(null);
    errors.current.clear('slide');
    return run.slideSync.select(index);
  }, []);
  const endTalk = useCallback(() => request('end_presenting'), [request]);
  const nextQuestion = useCallback(() => request('next_question'), [request]);
  const finishQA = useCallback(async () => {
    const run = runtime.current;
    if (!run) return;
    speechRef.current.stop();
    run.audio.clear(); run.ambience.stop();
    if (run.phase === 'presenting') await request('end_presenting');
    if (run.phase === 'qa') await request('end_qa');
    const result = await run.api.getReport(run.id);
    if (run.phase === 'reporting') await request('finish');
    if (run.alive) setReport(result);
    return result;
  }, [request]);
  const resumeAudio = useCallback(() => { runtime.current?.audio.resume(); runtime.current?.ambience.resume(); }, []);
  const beginTalk = useCallback(async () => {
    const run = runtime.current;
    if (!run?.talk) throw new Error('Wait for the live session to connect.');
    try { return await run.talk.beginTalk(); }
    catch (problem) { if (run.alive) errors.current.show(problem); throw problem; }
  }, []);
  const submitText = useCallback(async (text) => {
    const run = runtime.current;
    if (!run?.talk) return null;
    try { return await run.talk.submitText(text); }
    catch (problem) { if (run.alive) errors.current.show(problem); throw problem; }
  }, []);
  return { status: ['connecting', 'reconnecting'].includes(connectionState) ? connectionState : phase,
    connectionState, sessionId, speech, agents, hands, listeners, room, activeQuestion, error,
    events: debugLogs ? events : [], transcriptAcks: debugLogs ? transcriptAcks : [],
    audioBlocked, questionPlayback, latestVerdict, resumeAudio, callOn, answerDone, setSlide, endTalk,
    nextQuestion, finishQA, report, beginTalk, submitText };
}
