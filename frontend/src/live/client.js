import { CLIENT_REQUEST_TYPES, isServerEnvelope } from './protocol.js';

/** Pure so URL configuration can be verified without Vite or a browser. */
export function normalizeApiBase(value = '') {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export const API_URL = normalizeApiBase(import.meta.env?.VITE_API_URL || '');

export function resolveApiUrl(path, base = API_URL) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${normalizeApiBase(base)}/${String(path).replace(/^\/+/, '')}`;
}

export function sessionWebSocketUrl(sessionId, base = API_URL, origin = globalThis.location?.origin) {
  const url = new URL(resolveApiUrl(`/sessions/${encodeURIComponent(sessionId)}/ws`, base), origin || 'http://localhost');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('VITE_API_URL must use HTTP or HTTPS.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

export class SessionClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SessionClientError';
    Object.assign(this, details);
  }
}

function serverError(envelope) {
  return new SessionClientError(envelope.message, { envelope, request: envelope.request, id: envelope.id, detail: envelope.detail });
}

function notify(listeners, value) {
  listeners.forEach((listener) => {
    try {
      const result = listener(value);
      result?.catch?.((error) => console.error('Live session callback failed:', error));
    } catch (error) {
      console.error('Live session callback failed:', error);
    }
  });
}

/**
 * Injectable transport for tests. No provider keys belong in this client.
 * @param {{apiUrl?:string,fetchImpl?:typeof fetch,WebSocketImpl?:typeof WebSocket,FormDataImpl?:typeof FormData,setTimeoutImpl?:typeof setTimeout,clearTimeoutImpl?:typeof clearTimeout,requestTimeoutMs?:number,origin?:string}} options
 */
export function createApiClient(options = {}) {
  const base = normalizeApiBase(options.apiUrl ?? API_URL);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const Socket = options.WebSocketImpl ?? globalThis.WebSocket;
  const Form = options.FormDataImpl ?? globalThis.FormData;
  const later = options.setTimeoutImpl ?? globalThis.setTimeout.bind(globalThis);
  const cancel = options.clearTimeoutImpl ?? globalThis.clearTimeout.bind(globalThis);
  const timeoutMs = options.requestTimeoutMs ?? 15_000;

  async function jsonRequest(path, init = {}) {
    if (typeof fetchImpl !== 'function') throw new SessionClientError('This browser does not support HTTP requests.');
    const response = await fetchImpl(resolveApiUrl(path, base), init);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof body?.detail === 'string' ? body.detail : body?.message;
      throw new SessionClientError(detail || `The backend request failed (${response.status}).`, { status: response.status });
    }
    if (!body || typeof body !== 'object') throw new SessionClientError('The backend returned an invalid JSON response.');
    return body;
  }

  /** @param {import('./protocol.js').CreateSessionRequest} config */
  function createSession({ preset = 'default', slides = [], tick_interval_seconds } = {}, { signal } = {}) {
    return jsonRequest('/sessions', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset, slides, ...(tick_interval_seconds == null ? {} : { tick_interval_seconds }) }),
    });
  }

  function uploadDeck(file, preset = 'default', { signal } = {}) {
    if (typeof Form !== 'function') throw new SessionClientError('This browser does not support file uploads.');
    const form = new Form();
    form.append('file', file, file.name || 'slides.pdf');
    form.append('preset', preset);
    return jsonRequest('/sessions/upload', { method: 'POST', body: form, signal });
  }

  function getReport(id, { signal } = {}) {
    return jsonRequest(`/sessions/${encodeURIComponent(id)}/report`, { signal });
  }

  function getSttToken(id, { signal } = {}) {
    return jsonRequest(`/sessions/${encodeURIComponent(id)}/stt-token`, { method: 'POST', signal, cache: 'no-store' });
  }

  function connect(sessionId) {
    if (typeof Socket !== 'function') throw new SessionClientError('This browser does not support WebSockets.');
    const eventListeners = new Set();
    const stateListeners = new Set();
    const helloListeners = new Set();
    const errorListeners = new Set();
    const pending = new Map();
    let socket = null;
    let retryTimer = null;
    let retries = 0;
    let openedBefore = false;
    let helloReceived = false;
    let lastHello = null;
    let stopped = false;
    let state = 'connecting';
    let nextId = 1;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Subscribers can use onHello without awaiting ready; manual cleanup is still safe.
    ready.catch(() => {});

    function setState(next) {
      if (state === next) return;
      state = next;
      notify(stateListeners, state);
    }

    function rejectPending(error) {
      pending.forEach((entry) => { cancel(entry.timer); entry.reject(error); });
      pending.clear();
    }

    function detach(old) {
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
    }

    function retry() {
      if (stopped || retryTimer !== null) return;
      helloReceived = false;
      const delay = Math.min(500 * 2 ** Math.min(retries, 5), 10_000);
      retries += 1;
      setState('reconnecting');
      retryTimer = later(() => { retryTimer = null; open(); }, delay);
    }

    function receive(raw) {
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      if (!isServerEnvelope(message)) return;
      if (message.type === 'hello') {
        helloReceived = true;
        lastHello = message;
        retries = 0;
        notify(helloListeners, message);
        message.events.forEach((event) => {
          if (isServerEnvelope(event) && event.type === 'event') notify(eventListeners, { ...event, replay: true });
        });
        if (stopped) return;
        resolveReady(message.session);
        setState('connected');
      } else if (message.type === 'event') {
        notify(eventListeners, message);
      } else {
        const entry = pending.get(message.id);
        if (message.type === 'error') notify(errorListeners, serverError(message));
        if (!entry) return;
        pending.delete(message.id);
        cancel(entry.timer);
        if (message.type === 'error') entry.reject(serverError(message));
        else if (message.request !== entry.type) entry.reject(new SessionClientError('The backend acknowledged a different request.', { envelope: message }));
        else entry.resolve(message.result);
      }
    }

    function open() {
      if (stopped) return;
      setState(retries ? 'reconnecting' : 'connecting');
      const url = sessionWebSocketUrl(sessionId, base, options.origin);
      if (openedBefore) url.searchParams.set('replay', '1');
      openedBefore = true;
      let current;
      try { current = new Socket(url.href); } catch {
        retry();
        return;
      }
      socket = current;
      current.onopen = () => {};
      current.onmessage = (event) => {
        if (socket === current && typeof event.data === 'string') receive(event.data);
      };
      current.onerror = () => {}; // Browser close owns retry and outstanding request cleanup.
      current.onclose = (event) => {
        if (socket !== current) return;
        socket = null;
        detach(current);
        helloReceived = false;
        if (event?.code === 4404) {
          const error = new SessionClientError('This session is no longer available. Start a new session.', { code: 4404 });
          rejectPending(error);
          rejectReady(error);
          notify(errorListeners, error);
          close();
          return;
        }
        rejectPending(new SessionClientError('Connection lost. The request was not replayed.'));
        retry();
      };
    }

    /** Resolves with ack.result; a server error rejects only this request. */
    function request(type, fields = {}) {
      if (!CLIENT_REQUEST_TYPES.includes(type)) return Promise.reject(new SessionClientError(`Unknown session request: ${type}`));
      if (stopped || !helloReceived || socket?.readyState !== (Socket.OPEN ?? 1)) {
        return Promise.reject(new SessionClientError('The session is not connected yet.'));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = later(() => {
          pending.delete(id);
          reject(new SessionClientError(`The ${type} request timed out.`, { id, request: type }));
        }, timeoutMs);
        pending.set(id, { type, resolve, reject, timer });
        try { socket.send(JSON.stringify({ ...fields, type, id })); } catch {
          pending.delete(id);
          cancel(timer);
          reject(new SessionClientError('The request could not be sent.'));
        }
      });
    }

    function subscribe(listeners, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function close() {
      if (stopped) return;
      stopped = true;
      helloReceived = false;
      if (retryTimer !== null) cancel(retryTimer);
      retryTimer = null;
      const old = socket;
      socket = null;
      if (old) { detach(old); old.close(1000, 'Session screen closed'); }
      const error = new SessionClientError('The session connection was closed.');
      rejectPending(error);
      rejectReady(error);
      setState('closed');
      eventListeners.clear();
      stateListeners.clear();
      helloListeners.clear();
      errorListeners.clear();
    }

    open();
    return {
      request, ready, close,
      onEvent: (listener) => subscribe(eventListeners, listener),
      onError: (listener) => subscribe(errorListeners, listener),
      onState(listener) { const unsubscribe = subscribe(stateListeners, listener); notify(new Set([listener]), state); return unsubscribe; },
      onHello(listener) {
        const unsubscribe = subscribe(helloListeners, listener);
        if (helloReceived && lastHello) notify(new Set([listener]), lastHello);
        return unsubscribe;
      },
    };
  }

  return { createSession, uploadDeck, getReport, getSttToken, connect, resolveUrl: (path) => resolveApiUrl(path, base) };
}

const defaultClient = createApiClient();
export const createSession = (...args) => defaultClient.createSession(...args);
export const uploadDeck = (...args) => defaultClient.uploadDeck(...args);
export const getReport = (...args) => defaultClient.getReport(...args);
export const getSttToken = (...args) => defaultClient.getSttToken(...args);
export const connect = (...args) => defaultClient.connect(...args);
