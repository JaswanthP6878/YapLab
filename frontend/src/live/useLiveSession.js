import { useCallback, useEffect, useRef, useState } from 'react';
import { speak, stopSpeaking } from '../lib/media.js';
import { API_URL, createApiClient } from './client.js';
import { createAmbience } from './ambience.js';
import { createQuestionAudio } from './questionAudio.js';
import { agentIdFor, buildListenerMap, eventMetadata, listenerMetadata, mapAgentEvent, mapListenerMeters, mapRoomGauge } from './mapEvents.js';
import { demoDeckSlides, updateHands } from './sessionState.js';
import { useScribeSpeech } from './useScribeSpeech.js';

/**
 * Teaching-only bridge. `enabled` lets a caller mount this hook beside demo hooks
 * without creating a backend session. Configuration is captured when enabled;
 * voices/noise can change during a session without recreating it.
 */
export function useLiveSession({ config, onAgentEvent, onTranscript, enabled = true }) {
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
  const latest = useRef({});
  latest.current = { config, onAgentEvent, onTranscript };
  const runtime = useRef(null);
  const speechRef = useRef(null);
  const speech = useScribeSpeech((text) => latest.current.onTranscript?.(text), {
    sessionId, connection, connectionState, enabled,
    onAck: (ack) => setTranscriptAcks((previous) => [...previous.slice(-99), ack]),
    onError: (message) => setError(message),
  });
  speechRef.current = speech;

  useEffect(() => {
    if (!enabled) return;
    if (latest.current.config.mode !== 'teaching') {
      setError('Live sessions currently support Teaching mode.');
      return;
    }
    const abort = new AbortController();
    const api = createApiClient();
    const run = { alive: true, api, socket: null, id: null, phase: 'idle', handMap: {}, listenerMap: {}, active: null,
      audio: null, ambience: null, unsubscribers: [], maxSequence: -1, floorId: null, speakingListener: null, starting: null };
    runtime.current = run;
    const fail = (value) => { if (run.alive) setError(value?.message || String(value)); };
    const changePhase = (value) => { run.phase = value; if (run.alive) setPhase(value); };
    const publishHands = () => setHands(Object.values(run.handMap).map((hand) => ({ ...hand,
      agentId: agentIdFor(hand.listener, hand.persona, run.listenerMap) })));
    const emit = (event) => { if (event && run.alive) latest.current.onAgentEvent?.(event); };
    const request = async (type, fields) => {
      if (type === 'playback_started') run.floorId = fields.question_id;
      const result = await run.socket.request(type, fields);
      if (type === 'playback_ended' && run.floorId === fields.question_id) run.floorId = null;
      return result;
    };
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
    setError(null); setReport(null); setEvents([]); setTranscriptAcks([]); setHands([]); setAgents({}); setRoom(null); setActiveQuestion(null);
    setQuestionPlayback(null); setPhase('connecting'); setConnectionState('connecting');

    function handleEvent(envelope) {
      if (!run.alive) return;
      setEvents((previous) => [...previous.slice(-299), envelope]);
      const { event, data } = envelope;
      run.audio.handleEvent(envelope); // cache even during replay; never autoplay history
      if (event === 'state') changePhase(data.state);
      if (['transcript', 'transcript_dropped'].includes(event) && Number.isInteger(data.seq)) {
        run.maxSequence = Math.max(run.maxSequence, data.seq);
        speechRef.current?.adoptSequence(data.seq);
      }
      run.handMap = updateHands(run.handMap, envelope);
      publishHands();
      const metadata = eventMetadata(envelope, run.listenerMap);
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
      // A periodic reaction must not hide a still-raised, actionable hand.
      const raised = Object.values(run.handMap).find((hand) => hand.status === 'raised' && hand.listener === data.listener);
      if (mapped && event === 'reaction' && raised) mapped = { ...mapped, action: 'raise_hand', text: raised.question };
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
        if (state === 'reconnecting' || state === 'closed') run.audio.clear({ notify: false });
        // Clear a playback floor left on the server by a severed socket before
        // Scribe resumes; otherwise genuine answers can be dropped for 30 seconds.
        if (state === 'connected' && run.floorId && ['presenting', 'qa'].includes(run.phase)) {
          try { await request('playback_ended', { question_id: run.floorId }); }
          catch (problem) { fail(problem); return; }
        }
        if (run.alive) setConnectionState(state);
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
      await socket.request('slide', { index: 0 });
      if (!run.alive) return;
      // Track an in-flight start so exit cannot close the socket before stopping
      // a start that the server may already have processed.
      run.phase = 'presenting';
      run.starting = socket.request('start');
      await run.starting;
      changePhase('presenting');
    }
    initialize().catch((problem) => { if (problem.name !== 'AbortError') fail(problem); });
    return () => {
      run.alive = false;
      abort.abort();
      speechRef.current?.stop();
      run.audio.dispose(); run.ambience.dispose();
      run.unsubscribers.forEach((unsubscribe) => unsubscribe());
      // There is no cancel endpoint. Close the lifecycle so ticks/provider calls stop.
      async function shutdown() {
        if (!run.socket) return;
        try {
          await run.starting?.catch(() => {});
          if (run.phase === 'presenting') { await request('end_presenting'); run.phase = 'qa'; }
          if (run.phase === 'qa') { await request('end_qa'); run.phase = 'reporting'; }
          if (run.phase === 'reporting') await request('finish');
        } catch { /* A disconnected in-memory session cannot be cancelled over HTTP. */ }
        finally { run.socket.close(); }
      }
      void shutdown();
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
    setError(null);
    try { return await run.socket.request(type, fields); }
    catch (problem) { if (run.alive) setError(problem.message); throw problem; }
  }, []);
  const callOn = useCallback((questionId) => request('take_question', { question_id: questionId }), [request]);
  const answerDone = useCallback((questionId) => request('answer_done', { question_id: questionId }), [request]);
  const setSlide = useCallback((index) => request('slide', { index }), [request]);
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
  return { status: ['connecting', 'reconnecting'].includes(connectionState) ? connectionState : phase,
    connectionState, sessionId, speech, agents, hands, listeners, room, activeQuestion, error,
    events, transcriptAcks, audioBlocked, questionPlayback, resumeAudio, callOn, answerDone, setSlide, endTalk,
    nextQuestion, finishQA, report, submitText: speech.sendText };
}
