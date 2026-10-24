import { useEffect, useRef, useState } from 'react';

// Microphone level meter. Falls back to a simulated signal when the mic is unavailable.
export function useMicLevels(enabled) {
  const levelRef = useRef(0);
  const [status, setStatus] = useState('off'); // off | live | demo
  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let stream, ctx, raf, cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no media');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          levelRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 4);
          raf = requestAnimationFrame(loop);
        };
        loop();
        setStatus('live');
      } catch {
        if (!cancelled) setStatus('demo');
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close?.();
    };
  }, [enabled]);
  return { levelRef, status };
}

export function useCamera(enabled) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('off'); // off | live | unavailable
  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let stream, cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no media');
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setStatus('live');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [enabled]);
  return { videoRef, status };
}

// Browser speech recognition as a zero-cost STT fallback for local testing.
// Production STT runs server-side (ElevenLabs Scribe or a realtime speech API).
export function useSpeechRecognition(onFinal) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const supported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const start = () => {
    if (!supported) return false;
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new R();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) cb.current(r[0].transcript.trim());
        else txt += r[0].transcript;
      }
      setInterim(txt);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try { rec.start(); recRef.current = rec; setListening(true); return true; } catch { return false; }
  };
  const stop = () => { recRef.current?.stop(); setListening(false); setInterim(''); };
  useEffect(() => () => recRef.current?.stop(), []);
  return { supported, listening, interim, start, stop };
}

// Agent voices. Uses the backend's generated audio (audioUrl, e.g. ElevenLabs) when present,
// otherwise browser speech synthesis with a per-persona pitch and rate.
let currentAudio = null;
export function stopSpeaking() {
  try { currentAudio?.pause(); } catch { /* noop */ }
  currentAudio = null;
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
}

export function speak(text, persona, enabled, audioUrl) {
  if (!enabled || typeof window === 'undefined') return;
  stopSpeaking();
  if (audioUrl) {
    currentAudio = new Audio(audioUrl);
    currentAudio.play().catch(() => {});
    return;
  }
  if (!window.speechSynthesis) return;
  const clean = (text || '').replace(/\*[^*]+\*/g, '').trim();
  if (!clean) return;
  try {
    const u = new SpeechSynthesisUtterance(clean);
    u.pitch = persona?.pitch ?? 1;
    u.rate = persona?.rate ?? 1;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('en'));
    if (voices.length && persona) {
      const idx = [...persona.id].reduce((a, c) => a + c.charCodeAt(0), 0) % voices.length;
      u.voice = voices[idx];
    }
    window.speechSynthesis.speak(u);
  } catch { /* voice unavailable */ }
}

export const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
