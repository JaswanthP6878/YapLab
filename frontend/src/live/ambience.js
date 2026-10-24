/** Quiet room sounds, driven only by real backend events. */

export const FIDGET_SOUNDS = ['pen_click', 'yawn', 'chair_creak', 'paper_rustle', 'phone_buzz'];

/** Pure throttle policy: no browser/audio dependency. Times are milliseconds. */
export function createAmbiencePolicy({ now = () => Date.now(), random = Math.random } = {}) {
  let lastRoom = -Infinity;
  const listeners = new Map();
  return {
    next(event) {
      const name = event?.event ?? event?.type;
      const data = event?.data ?? event;
      const time = now();
      if (time - lastRoom < 5000) return null;
      let sound;
      let volume;
      if (name === 'reaction' && Number.isFinite(data.attention) && data.attention < 35 && data.listener) {
        if (time - (listeners.get(data.listener) ?? -Infinity) < 20000) return null;
        listeners.set(data.listener, time);
        sound = FIDGET_SOUNDS[Math.min(FIDGET_SOUNDS.length - 1, Math.max(0, Math.floor(random() * FIDGET_SOUNDS.length)))];
        volume = 0.065;
      } else if (name === 'tick_complete' && Number.isFinite(data.room?.attention) && data.room.attention < 40) {
        sound = 'whisper_chatter';
        volume = 0.045;
      } else if (name === 'hand_raised') {
        sound = 'chair_creak';
        volume = 0.045;
      } else return null;
      lastRoom = time;
      return { name: sound, volume };
    },
    reset() { lastRoom = -Infinity; listeners.clear(); },
  };
}

export function createAmbience(options = {}) {
  const makeAudio = options.createAudio ?? ((url) => new Audio(url));
  const policy = createAmbiencePolicy(options);
  const effects = new Set();
  let loop = null;
  let active = false;
  let disposed = false;
  let ducked = false;
  const gain = () => ducked ? 0.12 : 1;
  const report = () => options.onError?.('A room sound could not play.');
  const release = (item) => {
    item.audio.onended = null;
    item.audio.onerror = null;
    try { item.audio.pause(); item.audio.removeAttribute?.('src'); item.audio.load?.(); } catch { /* disposed */ }
    effects.delete(item);
  };
  const play = (item) => {
    item.blocked = false;
    const failed = (error) => {
      if (!active || (item !== loop && !effects.has(item))) return;
      if (error?.name === 'NotAllowedError') item.blocked = true;
      else { report(); release(item); if (loop === item) loop = null; }
    };
    try {
      Promise.resolve(item.audio.play()).catch(failed);
    } catch (error) { failed(error); }
  };
  const stop = () => {
    active = false;
    if (loop) release(loop);
    loop = null;
    [...effects].forEach(release);
    policy.reset();
  };
  return {
    start() {
      if (disposed || active) return;
      active = true;
      try {
        const audio = makeAudio('/sfx/room_tone_classroom.mp3');
        audio.loop = true;
        loop = { audio, volume: 0.035, blocked: false };
        audio.volume = loop.volume * gain();
        audio.onerror = () => { if (loop) release(loop); loop = null; report(); };
        play(loop);
      } catch { active = false; report(); }
    },
    handleEvent(event) {
      if (!active || disposed || ducked) return;
      const decision = policy.next(event);
      if (!decision) return;
      try {
        const audio = makeAudio(`/sfx/${decision.name}.mp3`);
        const item = { audio, volume: decision.volume, blocked: false };
        effects.add(item);
        audio.volume = item.volume * gain();
        audio.onended = () => release(item);
        audio.onerror = () => { report(); release(item); };
        play(item);
      } catch { report(); }
    },
    setDucked(value) {
      ducked = Boolean(value);
      if (loop) loop.audio.volume = loop.volume * gain();
      effects.forEach((item) => { item.audio.volume = item.volume * gain(); });
    },
    resume() {
      if (!active || disposed) return;
      if (loop?.blocked) play(loop);
      effects.forEach((item) => { if (item.blocked) play(item); });
    },
    stop,
    dispose() { disposed = true; stop(); },
  };
}
