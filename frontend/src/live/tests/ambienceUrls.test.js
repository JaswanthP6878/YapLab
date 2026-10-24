import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAmbience } from '../ambience.js';

for (const [baseUrl, expectedPrefix] of [
  ['/classroom/', '/classroom/sfx/'],
  ['/courses/frontrow', '/courses/frontrow/sfx/'],
  ['./', './sfx/'],
]) {
  test(`ambience loop and effects preserve the deployment base ${baseUrl}`, () => {
    const urls = [];
    let now = 0;
    const ambience = createAmbience({ baseUrl, now: () => now, random: () => 0,
      createAudio: (url) => {
        urls.push(url);
        return { play: () => Promise.resolve(), pause() {}, removeAttribute() {}, load() {} };
      } });
    ambience.start();
    ambience.handleEvent({ event: 'reaction', data: { listener: 'L0', attention: 20 } });
    now = 5000;
    ambience.handleEvent({ event: 'tick_complete', data: { room: { attention: 30 } } });
    now = 10000;
    ambience.handleEvent({ event: 'hand_raised', data: {} });
    assert.deepEqual(urls, [
      `${expectedPrefix}room_tone_classroom.mp3`, `${expectedPrefix}pen_click.mp3`,
      `${expectedPrefix}whisper_chatter.mp3`, `${expectedPrefix}chair_creak.mp3`,
    ]);
    ambience.dispose();
  });
}

test('the non-Vite default still loads room sounds from the site root', () => {
  const urls = [];
  const ambience = createAmbience({ createAudio: (url) => {
    urls.push(url);
    return { play: () => Promise.resolve(), pause() {} };
  } });
  ambience.start();
  assert.deepEqual(urls, ['/sfx/room_tone_classroom.mp3']);
  ambience.dispose();
});
