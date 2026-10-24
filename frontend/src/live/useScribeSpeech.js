import { useCallback, useEffect, useRef, useState } from 'react';
import { useScribe } from '@elevenlabs/react';
import { getSttToken as fetchSttToken } from './client.js';
import { ScribeSpeechController } from './scribeController.js';

/**
 * Drop-in speech shape; onFinal(text) fires only after a transcript ack is accepted.
 * `getSttToken(id,{signal})` and `connection.request(type,fields)` are injectable.
 * Backend WS state reconnects Scribe with a fresh token while keeping transcript seq.
 */
export function useScribeSpeech(onFinal, options = {}) {
  const { sessionId = null, connection = null, connectionState = 'connected', enabled = true,
    getSttToken = fetchSttToken, onAck, onError } = options;
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const latest = useRef(null);
  latest.current = { sessionId, connection, connectionState, enabled, getSttToken, onFinal, onAck, onError };
  // Runtime connect options come from this session's token response, including VAD.
  // SDK API verified against @elevenlabs/react 1.19.1 and official React Scribe docs.
  const scribe = useScribe({ autoConnect: false, noVerbatim: false });
  const controls = useRef(scribe);
  controls.current = scribe;
  const controller = useRef(null);
  if (!controller.current) {
    controller.current = new ScribeSpeechController({
      controls: () => controls.current,
      context: () => latest.current,
      getSttToken: (id, settings) => latest.current.getSttToken(id, settings),
      now: () => performance.now(),
      onInterim: setInterim,
      onStatus: setStatus,
      onError: (message) => { setError(message); if (message) latest.current.onError?.(message); },
      onFinal: (text) => latest.current.onFinal?.(text),
      onAck: (ack) => latest.current.onAck?.(ack),
    });
  }
  const start = useCallback(() => controller.current.start(), []);
  const stop = useCallback(() => controller.current.stop(), []);
  const setMuted = useCallback((muted) => controller.current.setMuted(muted), []);
  const sendText = useCallback((text) => controller.current.sendText(text), []);
  const setNextSequence = useCallback((next) => controller.current.setNextSequence(next), []);
  const adoptSequence = useCallback((seq) => controller.current.adoptSequence(seq), []);
  useEffect(() => { controller.current.updateContext(); }, [sessionId, connection, connectionState, enabled]);
  useEffect(() => () => controller.current.dispose(), []);
  const supported = typeof window !== 'undefined' && !!window.WebSocket
    && !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || window.webkitAudioContext);
  return { supported, listening: status === 'listening' || status === 'muted', muted: status === 'muted', interim, start, stop, setMuted,
    status, error, sendText, setNextSequence, adoptSequence };
}
