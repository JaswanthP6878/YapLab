/** A quiet, steady room tone. Room events never trigger sound effects. */

export function createAmbience(options = {}) {
  const makeAudio = options.createAudio ?? ((url) => new Audio(url));
  const baseUrl = options.baseUrl ?? import.meta.env?.BASE_URL ?? '/';
  const soundUrl = (name) => `${baseUrl.replace(/\/?$/, '/')}sfx/${name}.mp3`;
  let loop = null;
  let active = false;
  let disposed = false;
  let ducked = false;
  const gain = () => ducked ? 0.12 : 1;
  const report = () => options.onError?.('A room sound could not play.');
  const release = (item) => {
    item.audio.onerror = null;
    try { item.audio.pause(); item.audio.removeAttribute?.('src'); item.audio.load?.(); } catch { /* disposed */ }
  };
  const play = (item) => {
    item.blocked = false;
    const failed = (error) => {
      if (!active || item !== loop) return;
      if (error?.name === 'NotAllowedError') item.blocked = true;
      else { report(); release(item); loop = null; }
    };
    try {
      Promise.resolve(item.audio.play()).catch(failed);
    } catch (error) { failed(error); }
  };
  const stop = () => {
    active = false;
    if (loop) release(loop);
    loop = null;
  };
  return {
    start() {
      if (disposed || active) return;
      active = true;
      try {
        const audio = makeAudio(soundUrl('room_tone_classroom'));
        audio.loop = true;
        loop = { audio, volume: 0.035, blocked: false };
        audio.volume = loop.volume * gain();
        audio.onerror = () => { if (loop) release(loop); loop = null; report(); };
        play(loop);
      } catch { active = false; report(); }
    },
    setDucked(value) {
      ducked = Boolean(value);
      if (loop) loop.audio.volume = loop.volume * gain();
    },
    resume() {
      if (!active || disposed) return;
      if (loop?.blocked) play(loop);
    },
    stop,
    dispose() { disposed = true; stop(); },
  };
}
