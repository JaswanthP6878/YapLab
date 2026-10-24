import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAmbience } from '../ambience.js';

for (const [baseUrl, expectedPrefix] of [
  ['/classroom/', '/classroom/sfx/'],
  ['/courses/frontrow', '/courses/frontrow/sfx/'],
  ['./', './sfx/'],
]) {
  test(`the room tone preserves the deployment base ${baseUrl}`, () => {
    const urls = [];
    const ambience = createAmbience({ baseUrl,
      createAudio: (url) => {
        urls.push(url);
        return { play: () => Promise.resolve(), pause() {}, removeAttribute() {}, load() {} };
      } });
    ambience.start();
    assert.deepEqual(urls, [`${expectedPrefix}room_tone_classroom.mp3`]);
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
