import assert from 'node:assert/strict';
import test from 'node:test';
import { API_URL, SessionClientError, createApiClient, normalizeApiBase, resolveApiUrl, sessionWebSocketUrl } from '../client.js';

function setup(options = {}) {
  const sockets = [];
  const timers = new Map();
  let timerId = 0;
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(JSON.parse(raw)); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(message) { this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
  }
  const api = createApiClient({ apiUrl: 'http://backend.test:8000', WebSocketImpl: Socket,
    setTimeoutImpl: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeoutImpl: (id) => timers.delete(id), ...options });
  function nextTimer() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.fn();
    return timer.delay;
  }
  const hello = (events = []) => ({ type: 'hello', session: { id: 'session', state: 'presenting',
    preset: 'default', current_slide: 0, listeners: [], slides: [] }, events });
  return { api, sockets, timers, nextTimer, hello };
}

async function connected(options) {
  const fixture = setup(options);
  const connection = fixture.api.connect('session');
  fixture.sockets[0].open();
  fixture.sockets[0].receive(fixture.hello());
  await connection.ready;
  return { ...fixture, connection, socket: fixture.sockets[0] };
}

test('API URL helpers import without Vite and preserve API prefixes and encoded session IDs', () => {
  assert.equal(API_URL, '');
  assert.equal(normalizeApiBase(' https://api.test/base/// '), 'https://api.test/base');
  assert.equal(resolveApiUrl('/sessions', 'https://api.test/base/'), 'https://api.test/base/sessions');
  assert.equal(resolveApiUrl('https://cdn.test/audio.mp3', 'https://api.test'), 'https://cdn.test/audio.mp3');
  assert.equal(sessionWebSocketUrl('a/b', 'https://api.test').href, 'wss://api.test/sessions/a%2Fb/ws');
  assert.equal(sessionWebSocketUrl('s', '/backend', 'https://app.test').href, 'wss://app.test/backend/sessions/s/ws');
});

test('HTTP methods target the actual backend, upload multipart, and forward token abort signals', async () => {
  const calls = [];
  class Form {
    fields = [];
    append(...field) { this.fields.push(field); }
  }
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: 's', token: 'ephemeral' }) };
  };
  const api = createApiClient({ apiUrl: 'http://api.test/', fetchImpl, FormDataImpl: Form });
  const signal = new AbortController().signal;
  await api.createSession({ preset: 'default', slides: [{ index: 0, text: 'A slide' }], tick_interval_seconds: 5 });
  const file = { name: 'deck.pdf' };
  await api.uploadDeck(file, 'lecture_hall');
  await api.getReport('a/b');
  await api.getSttToken('a/b', { signal });
  assert.deepEqual(calls.map(({ url }) => url), ['http://api.test/sessions', 'http://api.test/sessions/upload',
    'http://api.test/sessions/a%2Fb/report', 'http://api.test/sessions/a%2Fb/stt-token']);
  assert.deepEqual(JSON.parse(calls[0].init.body), { preset: 'default', slides: [{ index: 0, text: 'A slide' }], tick_interval_seconds: 5 });
  assert.deepEqual(calls[1].init.body.fields, [['file', file, 'deck.pdf'], ['preset', 'lecture_hall']]);
  assert.equal(calls[1].init.headers, undefined, 'browser must create the multipart boundary');
  assert.equal(calls[3].init.method, 'POST');
  assert.equal(calls[3].init.signal, signal);
  assert.equal(calls[3].init.cache, 'no-store');
});

test('HTTP errors are actionable and do not silently treat failed JSON responses as success', async () => {
  const api = createApiClient({ fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ detail: 'Session is ended' }) }) });
  await assert.rejects(api.getReport('s'), (error) => error.status === 409 && error.message === 'Session is ended');
  const malformed = createApiClient({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) });
  await assert.rejects(malformed.getReport('s'), /invalid JSON/);
});

test('session creation and PDF uploads retain human 429/503 messages and retry delays without retrying', async () => {
  class Form { append() {} }
  const calls = [];
  for (const status of [429, 503]) {
    const api = createApiClient({ apiUrl: 'https://api.test', FormDataImpl: Form,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ detail: 'The room is temporarily unavailable.' }), {
          status, headers: { 'Retry-After': '90' },
        });
      } });
    for (const request of [() => api.createSession(), () => api.uploadDeck({ name: 'talk.pdf' })]) {
      await assert.rejects(request(), (error) => {
        assert.ok(error instanceof SessionClientError);
        assert.equal(error.status, status);
        assert.equal(error.retryAfterSeconds, 90);
        assert.equal(error.message, 'The room is temporarily unavailable. Try again in 2 minutes.');
        return true;
      });
    }
  }
  assert.deepEqual(calls, ['https://api.test/sessions', 'https://api.test/sessions/upload',
    'https://api.test/sessions', 'https://api.test/sessions/upload']);
});

test('opaque busy responses use the human fallback and preserve existing server retry advice', async () => {
  for (const status of [429, 503]) {
    const api = createApiClient({ fetchImpl: async () => new Response('<html>unavailable</html>', { status }) });
    await assert.rejects(api.createSession(), (error) => error.status === status
      && error.message === 'The practice room is busy. Try again in a few minutes.'
      && !('retryAfterSeconds' in error));
  }
  const message = 'Please try again after your current practice session.';
  const api = createApiClient({ fetchImpl: async () => new Response(JSON.stringify({ message }), {
    status: 429, headers: { 'Retry-After': '1200' },
  }) });
  await assert.rejects(api.getSttToken('s'), (error) => error.message === message && error.retryAfterSeconds === 1200);
});

test('Retry-After accepts HTTP dates and zero but ignores malformed delays', async () => {
  const now = Date.UTC(2026, 9, 25, 20, 0, 0);
  const cases = [
    [new Date(now + 90_000).toUTCString(), 90, 'Try again in 2 minutes.'],
    ['0', 0, 'Try again shortly.'],
    ['-5', undefined, ''], ['1.5', undefined, ''], ['invalid', undefined, ''],
    ['999999999999999999999999999999', undefined, ''],
  ];
  for (const [header, expected, hint] of cases) {
    const api = createApiClient({ nowImpl: () => now, fetchImpl: async () => new Response(JSON.stringify({ detail: 'Please wait.' }), {
      status: 503, headers: { 'Retry-After': header },
    }) });
    await assert.rejects(api.createSession(), (error) => {
      assert.equal(error.retryAfterSeconds, expected);
      assert.equal(error.message, `Please wait.${hint ? ` ${hint}` : ''}`);
      if (expected === undefined) assert.equal('retryAfterSeconds' in error, false);
      return true;
    });
  }
});

test('per-session voice denial preserves typed recovery without promising a same-room retry', async () => {
  const message = 'This session has reached its voice-token limit. Continue by typing to the room, or start a new session.';
  let calls = 0;
  const api = createApiClient({ fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({ detail: message }), {
      status: 429, headers: { 'Retry-After': '1200' },
    });
  } });
  await assert.rejects(api.getSttToken('s'), (error) => error.message === message
    && error.status === 429 && error.retryAfterSeconds === 1200);
  assert.equal(calls, 1);
});

test('hello gates readiness; request IDs correlate out-of-order acks and nonfatal errors', async () => {
  const f = setup();
  const connection = f.api.connect('session');
  const states = [];
  const errors = [];
  connection.onState((state) => states.push(state));
  connection.onError((error) => errors.push(error.message));
  f.sockets[0].open();
  await assert.rejects(connection.request('start'), /not connected yet/);
  assert.deepEqual(states, ['connecting']);
  f.sockets[0].receive(f.hello());
  assert.equal((await connection.ready).id, 'session');
  assert.deepEqual(states, ['connecting', 'connected']);
  const first = connection.request('slide', { index: 0, id: 99, type: 'finish' });
  const second = connection.request('start');
  const rejected = assert.rejects(second, /invalid state/);
  const third = connection.request('ping');
  assert.deepEqual(f.sockets[0].sent.map(({ type, id }) => [type, id]), [['slide', 1], ['start', 2], ['ping', 3]]);
  f.sockets[0].receive({ type: 'ack', id: 3, request: 'ping', result: { pong: true } });
  f.sockets[0].receive({ type: 'error', id: 2, request: 'start', message: 'invalid state' });
  f.sockets[0].receive({ type: 'ack', id: 1, request: 'slide', result: {} });
  assert.deepEqual(await third, { pong: true });
  await rejected;
  assert.deepEqual(await first, {});
  assert.deepEqual(errors, ['invalid state']);
  assert.equal(f.timers.size, 0);
  assert.equal(states.at(-1), 'connected');
  connection.close();
});

test('unmatched server errors and malformed frames do not cancel other requests', async () => {
  const { connection, socket } = await connected();
  const errorMessages = [];
  connection.onError((error) => errorMessages.push(error.message));
  const request = connection.request('ping');
  socket.receive('not json');
  socket.receive({ type: 'ack' });
  socket.receive({ type: 'error', id: 555, request: 'bogus', message: 'unknown request' });
  socket.receive({ type: 'ack', id: 1, request: 'ping', result: { pong: true } });
  assert.deepEqual(await request, { pong: true });
  assert.deepEqual(errorMessages, ['unknown request']);
  connection.close();
});

test('request mismatch and timeouts reject only their own promise', async () => {
  const { connection, socket, nextTimer, timers } = await connected({ requestTimeoutMs: 100 });
  const mismatch = connection.request('ping');
  const mismatchRejected = assert.rejects(mismatch, /different request/);
  socket.receive({ type: 'ack', id: 1, request: 'start', result: {} });
  await mismatchRejected;
  const timedOut = connection.request('ping');
  const timeoutRejected = assert.rejects(timedOut, /timed out/);
  assert.equal(nextTimer(), 100);
  await timeoutRejected;
  assert.equal(timers.size, 0);
  const healthy = connection.request('ping');
  socket.receive({ type: 'ack', id: 3, request: 'ping', result: { pong: true } });
  assert.equal((await healthy).pong, true);
  connection.close();
});

test('reconnect rejects uncertain requests, uses capped backoff and replay, and preserves IDs', async () => {
  const { connection, socket, sockets, hello, nextTimer, timers } = await connected();
  const received = [];
  const order = [];
  connection.onHello(() => order.push('hello'));
  connection.onEvent((event) => { received.push(event); order.push(event.replay ? 'replay' : 'event'); });
  const pending = connection.request('transcript', { seq: 0, text: 'Uncertain delivery' });
  const rejected = assert.rejects(pending, /not replayed/);
  socket.close();
  await rejected;
  const delays = [];
  for (let i = 0; i < 7; i++) {
    delays.push(nextTimer());
    assert.match(sockets.at(-1).url, /replay=1/);
    if (i < 6) sockets.at(-1).close();
  }
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 10000, 10000]);
  const restored = sockets.at(-1);
  restored.open();
  const event = { type: 'event', event: 'hand_raised', t: 3, data: { question_id: 'q1' } };
  restored.receive(hello([event]));
  assert.deepEqual(order.slice(-2), ['hello', 'replay']);
  assert.equal(received[0].replay, true);
  assert.equal(restored.sent.length, 0, 'unacknowledged commands must never be replayed automatically');
  const ping = connection.request('ping');
  assert.equal(restored.sent[0].id, 2);
  restored.receive({ type: 'ack', id: 2, request: 'ping', result: { pong: true } });
  await ping;
  restored.close();
  assert.equal(nextTimer(), 500, 'a successful hello resets backoff');
  connection.close();
  assert.equal(timers.size, 0);
});

test('manual cleanup stops retries and stale callbacks; late hello subscriptions see current metadata', async () => {
  const { connection, socket, timers, hello } = await connected();
  const calls = [];
  const unsubscribe = connection.onHello((message) => calls.push(message.session.id));
  assert.deepEqual(calls, ['session']);
  unsubscribe();
  const stale = socket.onmessage;
  connection.close();
  stale({ data: JSON.stringify(hello()) });
  const states = [];
  connection.onState((state) => states.push(state));
  assert.deepEqual(states, ['closed']);
  assert.equal(timers.size, 0);
  await assert.rejects(connection.request('ping'), /not connected/);
});

test('closing during hello cannot revive a disposed connection', async () => {
  const f = setup();
  const connection = f.api.connect('session');
  connection.onHello(() => connection.close());
  const readyRejected = assert.rejects(connection.ready, /closed/);
  f.sockets[0].open();
  f.sockets[0].receive(f.hello());
  await readyRejected;
  const states = [];
  connection.onState((state) => states.push(state));
  assert.deepEqual(states, ['closed']);
  assert.equal(f.timers.size, 0);
});


test('unknown-session close 4404 is terminal and explains how to recover', async () => {
  const { connection, socket, timers } = await connected();
  const errors = [];
  const states = [];
  connection.onError((error) => errors.push(error));
  connection.onState((state) => states.push(state));
  const request = connection.request('ping');
  const rejected = assert.rejects(request, /Start a new session/);
  socket.close(4404);
  await rejected;
  assert.deepEqual(states, ['connected', 'closed']);
  assert.equal(errors.at(-1).code, 4404);
  assert.equal(timers.size, 0);
  await assert.rejects(connection.request('start'), /not connected/);
  const f = setup();
  const initial = f.api.connect('missing');
  const readyRejected = assert.rejects(initial.ready, /no longer available/);
  f.sockets[0].close(4404);
  await readyRejected;
  assert.equal(f.timers.size, 0);
});
