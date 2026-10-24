// Session engine. In demo mode it plays a SIMULATED scripted session locally.
// With a backend connected, the same reducer consumes AgentEvents (see agentEvents.js)
// and transcript/metrics events instead of the script.
import { CHECKLISTS, DECKS, FILLER_RE, REPLIES, isPanel, modeById } from '../data.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

export function getDeck(config) {
  const deck = DECKS[config.deck] || DECKS.backprop;
  if (config.mode === 'interview' && config.questionCount) {
    return { ...deck, segments: deck.segments.slice(0, config.questionCount) };
  }
  return deck;
}

export function buildScript(config) {
  const deck = getDeck(config);
  const ids = new Set(config.agents);
  const present = config.roster.filter((p) => ids.has(p.id));
  const students = present.filter((p) => !isPanel(p));
  const panel = present.filter(isPanel);
  const steps = [];
  let qCount = 0;
  let rot = 0;
  let lastAsker = null;

  const resolve = (ev) => {
    if (ev.agent === '$asker') return lastAsker;
    if (ids.has(ev.agent)) return ev.agent;
    const pool = ev.fallback === 'student' ? students : ev.fallback === 'panel' ? panel : [];
    if (!pool.length) return null;
    return pool[rot++ % pool.length].id;
  };

  deck.segments.forEach((seg, s) => {
    if (seg.prompt) {
      const agent = resolve(seg.prompt);
      if (agent) { steps.push({ kind: 'prompt', agent, slide: s, text: seg.prompt.text }); lastAsker = null; }
    }
    seg.lines.forEach((line, l) => {
      steps.push({ kind: 'say', slide: s, text: line.text, tags: line.tags || [] });
      seg.events
        .filter((e) => e.after === l)
        .forEach((ev) => {
          if (ev.kind === 'distracted' && !config.noise) return;
          const agent = resolve(ev);
          if (!agent || !ids.has(agent)) return;
          if (ev.kind === 'question') {
            qCount++;
            if (config.questionRate === 'rare' && qCount % 2 === 0) return;
            const p = present.find((x) => x.id === agent);
            if (!isPanel(p)) steps.push({ kind: 'raise_hand', agent, slide: s });
            lastAsker = agent;
          }
          if (ev.kind === 'interrupt') lastAsker = agent;
          steps.push({ ...ev, agent, slide: s });
          if (ev.kind === 'ack') lastAsker = null;
        });
      if (config.questionRate === 'often' && l === seg.lines.length - 1 && present.length) {
        const p = present[(s + 1) % present.length];
        if (!isPanel(p)) steps.push({ kind: 'raise_hand', agent: p.id, slide: s });
        steps.push({ kind: 'question', agent: p.id, slide: s, text: pick(REPLIES[p.trait] || REPLIES.default) });
      }
    });
  });
  return { deck, steps };
}

export function initialState(config, deck) {
  const agents = {};
  config.agents.forEach((id) => {
    agents[id] = { state: 'listening', bubble: null, u: Math.round(rand(10, 22)), ttl: 0, note: false };
  });
  return {
    i: 0,
    slide: 0,
    elapsed: 0,
    transcript: [],
    agents,
    words: 0,
    fillers: {},
    wpm: [],
    pauses: 0,
    perSlide: deck.segments.map((seg) => ({ freeform: !!seg.freeform, t: 0, words: 0, fillers: 0, questions: 0, wpm: [], u: {}, covered: {}, reached: false })),
    covered: {},
    hints: [],
    toast: null,
    done: false,
    presenterTalking: false,
    flags: {},
    pendingAnswer: null,
    acks: 0,
  };
}

function countFillers(text) {
  const m = text.match(FILLER_RE) || [];
  return m.map((x) => x.toLowerCase().replace(/^um+$/, 'um').replace(/^uh+$/, 'uh'));
}

function detectTags(text, checklistKey) {
  const cl = CHECKLISTS[checklistKey];
  if (!cl) return [];
  const t = ` ${text.toLowerCase()} `;
  const hits = cl.items.filter((it) => it.kw.some((k) => t.includes(k))).map((it) => it.key);
  if (checklistKey === 'feynman') {
    const words = text.split(/\s+/);
    if (words.length <= 28 && !words.some((w) => w.replace(/\W/g, '').length > 11)) hits.push('plain');
  }
  return hits;
}

function snapshot(state, slide) {
  const u = {};
  Object.entries(state.agents).forEach(([id, a]) => (u[id] = a.u));
  state.perSlide = [...state.perSlide];
  state.perSlide[slide] = { ...state.perSlide[slide], u };
}

function addHint(state, text, kind, show) {
  const h = { text, kind, t: state.elapsed, slide: state.slide, id: state.hints.length };
  state.hints = [...state.hints, h];
  if (show) state.toast = h;
}

function changeSegment(state, config, slide) {
  if (slide === state.slide) return;
  const prev = state.slide;
  snapshot(state, prev);
  const cl = CHECKLISTS[config.checklist];
  if (cl?.perSegment && state.perSlide[prev].reached && !state.perSlide[prev].freeform) {
    const missing = cl.items.filter((it) => !state.perSlide[prev].covered[it.key]);
    if (missing.length && missing.length < cl.items.length) {
      addHint(state, `Answer ${prev + 1} skipped ${missing.map((m) => m.label).join(' and ')}. ${missing[0].tip}`, 'structure', config.feedback === 'live');
    }
  }
  state.slide = slide;
}

function presenterSays(state, text, config, slide, tags = []) {
  changeSegment(state, config, slide);
  const words = text.split(/\s+/).filter(Boolean).length;
  const f = countFillers(text);
  const fillers = { ...state.fillers };
  f.forEach((k) => (fillers[k] = (fillers[k] || 0) + 1));
  const nervous = config.seriousness / 100;
  const sample = Math.round(138 + rand(-14, 16) + f.length * 7 + nervous * 10);
  const hit = [...new Set([...tags, ...detectTags(text, config.checklist)])];

  const ps = [...state.perSlide];
  const cur = { ...ps[slide], reached: true, covered: { ...ps[slide].covered } };
  cur.words += words;
  cur.fillers += f.length;
  cur.wpm = [...cur.wpm, sample];
  hit.forEach((k) => { cur.covered[k] = true; });
  ps[slide] = cur;
  const covered = { ...state.covered };
  hit.forEach((k) => { if (covered[k] === undefined) covered[k] = state.elapsed; });

  const agents = {};
  Object.entries(state.agents).forEach(([id, a]) => {
    const p = config.roster.find((r) => r.id === id) || {};
    let { state: st, ttl, u } = a;
    if (ttl > 0) ttl -= 1;
    if (ttl <= 0 && st !== 'raise_hand') st = 'listening';
    const g = (p.gain || 4) * (st === 'confused' ? 0.2 : st === 'distracted' ? 0.4 : 1) * rand(0.45, 1.05);
    u = clamp(u + g + (state.pendingAnswer === id ? 6 : 0));
    agents[id] = { state: st, bubble: null, u: Math.round(u), ttl, note: false };
  });

  const next = {
    ...state,
    agents,
    perSlide: ps,
    covered,
    words: state.words + words,
    fillers,
    wpm: [...state.wpm, { t: state.elapsed, v: sample, slide }],
    pauses: state.pauses + (Math.random() < 0.35 ? 1 : 0),
    presenterTalking: true,
    pendingAnswer: null,
    transcript: [...state.transcript, { who: 'you', text, t: state.elapsed, slide, fillers: f.length, tags: hit }],
  };
  const live = config.feedback === 'live';
  const total = Object.values(fillers).reduce((a, b) => a + b, 0);
  if (total >= 3 && !next.flags.f3) {
    next.flags = { ...next.flags, f3: 1 };
    addHint(next, `${total} filler words so far. Swap them for a one-second pause.`, 'delivery', live);
  } else if (total >= 6 && !next.flags.f6) {
    next.flags = { ...next.flags, f6: 1 };
    addHint(next, `Filler count is at ${total}. Slow down at the start of each sentence.`, 'delivery', live);
  }
  if (sample > 168 && !next.flags['fast' + slide]) {
    next.flags = { ...next.flags, ['fast' + slide]: 1 };
    addHint(next, `You hit ${sample} words per minute. Aim for 130–160 so the room can keep up.`, 'pace', live);
  }
  if (config.checklist === 'feynman' && slide >= 2 && covered.checkin === undefined && !next.flags.checkin) {
    next.flags = { ...next.flags, checkin: 1 };
    addHint(next, 'You haven\'t checked whether the room is following. Try "Does that make sense so far?"', 'structure', live);
  }
  return next;
}

function setAgent(s, id, patch) {
  if (!s.agents[id]) return;
  s.agents = { ...s.agents, [id]: { ...s.agents[id], ...patch } };
}

function agentSpeaks(s, step, kind) {
  setAgent(s, step.agent, { state: 'speaking', bubble: step.text, ttl: 1 });
  s.presenterTalking = false;
  s.pendingAnswer = step.agent;
  if (kind !== 'prompt') {
    s.perSlide = [...s.perSlide];
    s.perSlide[step.slide] = { ...s.perSlide[step.slide], questions: s.perSlide[step.slide].questions + 1 };
  }
  s.transcript = [...s.transcript, { who: step.agent, text: step.text, t: s.elapsed, slide: step.slide, kind }];
}

export function reducer(state, action) {
  const { config } = action;
  switch (action.type) {
    case 'CLOCK': {
      const ps = [...state.perSlide];
      ps[state.slide] = { ...ps[state.slide], t: ps[state.slide].t + 1 };
      return { ...state, elapsed: state.elapsed + 1, perSlide: ps };
    }
    case 'STEP': {
      const step = action.steps[state.i];
      if (!step) {
        if (state.done) return state;
        const s = { ...state, done: true, presenterTalking: false };
        snapshot(s, s.slide);
        return s;
      }
      const s = { ...state, i: state.i + 1 };
      const show = config.feedback !== 'end';
      switch (step.kind) {
        case 'say':
          return presenterSays(s, step.text, config, step.slide, step.tags);
        case 'prompt':
          changeSegment(s, config, step.slide);
          agentSpeaks(s, step, 'prompt');
          return s;
        case 'raise_hand':
          setAgent(s, step.agent, { state: 'raise_hand', ttl: 3 });
          s.presenterTalking = false;
          return s;
        case 'question':
        case 'interrupt':
          agentSpeaks(s, step, step.kind);
          return s;
        case 'ack':
          setAgent(s, step.agent, { state: 'nodding', bubble: step.text || null, ttl: 1, u: clamp((s.agents[step.agent]?.u || 0) + 8) });
          s.acks += 1;
          if (step.text) s.transcript = [...s.transcript, { who: step.agent, text: step.text, t: s.elapsed, slide: step.slide, kind: 'ack' }];
          return s;
        case 'distracted':
          setAgent(s, step.agent, { state: 'distracted', bubble: step.text, ttl: 2, u: Math.max(0, (s.agents[step.agent]?.u || 0) - 4) });
          s.transcript = [...s.transcript, { who: step.agent, text: step.text, t: s.elapsed, slide: step.slide, kind: 'distracted' }];
          return s;
        case 'confused':
          setAgent(s, step.agent, { state: 'confused', ttl: 2, u: Math.max(0, (s.agents[step.agent]?.u || 0) - 8) });
          addHint(s, step.hint, 'room', show);
          return s;
        case 'note':
          setAgent(s, step.agent, { state: 'listening', note: true, ttl: 1 });
          s.transcript = [...s.transcript, { who: step.agent, text: step.text, t: s.elapsed, slide: step.slide, kind: 'note' }];
          return s;
        default:
          return s;
      }
    }
    case 'AGENT_EVENT': {
      // Event from the backend orchestrator (or a test harness), see agentEvents.js
      const ev = action.event;
      const s = { ...state };
      if (!s.agents[ev.agentId]) return state;
      const patch = { state: ev.action, bubble: ev.text || null, ttl: ev.action === 'raise_hand' ? 3 : 1 };
      if (ev.action === 'nodding') patch.u = clamp(s.agents[ev.agentId].u + 6);
      setAgent(s, ev.agentId, patch);
      if (ev.text && (ev.action === 'speaking' || ev.action === 'nodding')) {
        s.transcript = [...s.transcript, { who: ev.agentId, text: ev.text, audioUrl: ev.audioUrl, t: s.elapsed, slide: s.slide, kind: ev.action === 'nodding' ? 'ack' : 'question' }];
        if (ev.action === 'speaking') {
          s.pendingAnswer = ev.agentId;
          s.perSlide = [...s.perSlide];
          s.perSlide[s.slide] = { ...s.perSlide[s.slide], questions: s.perSlide[s.slide].questions + 1 };
        }
      }
      return s;
    }
    case 'LIVE_SAY': {
      // Backend events own the room; a transcript must not advance demo timers
      // or clear listener states, raised questions, and verdict comments.
      if (typeof action.text !== 'string' || !action.text.trim()) return state;
      const text = action.text.trim();
      const found = countFillers(text);
      const fillers = { ...state.fillers };
      found.forEach((word) => (fillers[word] = (fillers[word] || 0) + 1));
      return {
        ...state,
        words: state.words + text.split(/\s+/).length,
        fillers,
        transcript: [...state.transcript, { who: 'you', text, t: state.elapsed, slide: state.slide, fillers: found.length, tags: [] }],
      };
    }
    case 'USER_SAY':
      return presenterSays({ ...state }, action.text, config, state.slide);
    case 'SET_SLIDE': {
      const s = { ...state };
      changeSegment(s, config, action.slide);
      return s;
    }
    case 'AGENT_REPLY':
      return reducer(state, { ...action, type: 'AGENT_EVENT', event: { agentId: action.agent, action: 'speaking', text: action.text, timestamp: Date.now() } });
    case 'CALM':
      return { ...state, presenterTalking: false };
    case 'DISMISS_TOAST':
      return { ...state, toast: null };
    default:
      return state;
  }
}

export function pickResponder(config) {
  const roster = config.roster.filter((p) => config.agents.includes(p.id));
  const p = pick(roster.filter((x) => x.trait !== 'Distracted student').length ? roster.filter((x) => x.trait !== 'Distracted student') : roster);
  return { agent: p.id, text: pick(REPLIES[p.trait] || REPLIES.default) };
}

// ---------- Scoring ----------
export function decisionFor(mode, u) {
  if (mode === 'pitch') return u >= 70 ? ['Would invest', 'good'] : u >= 50 ? ['Second meeting', 'mid'] : ['Pass', 'bad'];
  if (mode === 'interview') return u >= 72 ? ['Strong hire', 'good'] : u >= 58 ? ['Hire', 'good'] : u >= 45 ? ['Lean no', 'mid'] : ['No hire', 'bad'];
  return u >= 60 ? ['Got it', 'good'] : u >= 40 ? ['Partly', 'mid'] : ['Lost', 'bad'];
}

export function coverageOf(config, state) {
  const cl = CHECKLISTS[config.checklist];
  if (!cl) return 0;
  if (cl.perSegment) {
    const reached = state.perSlide.filter((p) => p.reached && !p.freeform);
    if (!reached.length) return 0;
    return reached.reduce((a, p) => a + cl.items.filter((it) => p.covered[it.key]).length / cl.items.length, 0) / reached.length;
  }
  return cl.items.filter((it) => state.covered[it.key] !== undefined).length / cl.items.length;
}

export function computeResult(config, deck, state) {
  const s = { ...state, perSlide: [...state.perSlide] };
  snapshot(s, s.slide);
  const mode = modeById(config.mode);
  const minutes = Math.max(s.elapsed, 30) / 60;
  const wpmVals = s.wpm.map((w) => w.v);
  const avgWpm = wpmVals.length ? Math.round(wpmVals.reduce((a, b) => a + b, 0) / wpmVals.length) : 0;
  const fillerTotal = Object.values(s.fillers).reduce((a, b) => a + b, 0);
  const fpm = fillerTotal / minutes;
  const listeners = Object.entries(s.agents);
  const avgU = listeners.length ? Math.round(listeners.reduce((a, [, v]) => a + v.u, 0) / listeners.length) : 0;
  const questions = s.perSlide.reduce((a, p) => a + p.questions, 0);
  const reached = s.perSlide.filter((p) => p.reached).length;
  const inBand = wpmVals.filter((v) => v >= 120 && v <= 160).length / (wpmVals.length || 1);
  const coverage = coverageOf(config, s);

  const delivery = clamp(Math.round(inBand * 70 + 30 - fpm * 5));
  let scores;
  if (config.mode === 'pitch') {
    const limit = config.timeLimit;
    const timing = !limit ? 85 : s.elapsed > limit ? clamp(95 - (s.elapsed - limit)) : s.elapsed < limit * 0.3 ? 70 : 95;
    const story = clamp(Math.round(coverage * 90 + (reached / deck.segments.length) * 10));
    const qa = clamp(Math.round(45 + questions * 5 + s.acks * 6));
    scores = [
      { key: 'story', label: 'Story', value: story, desc: 'Problem, solution, market, traction, team, ask' },
      { key: 'conviction', label: 'Conviction', value: avgU, desc: 'How convinced the panel ended up' },
      { key: 'delivery', label: 'Delivery', value: delivery, desc: 'Pace and filler words' },
      { key: 'timing', label: 'Timing', value: timing, desc: limit ? `Against your ${Math.round(limit / 60)}:00 slot` : 'No time limit set' },
      { key: 'qa', label: 'Q&A', value: qa, desc: 'Questions handled and won over' },
    ];
    scores.overall = Math.round(story * 0.25 + avgU * 0.25 + delivery * 0.2 + timing * 0.15 + qa * 0.15);
  } else if (config.mode === 'interview') {
    const answers = s.perSlide.filter((p) => p.reached);
    const concise = clamp(Math.round((answers.filter((p) => p.words >= 30 && p.words <= 220).length / (answers.length || 1)) * 100));
    const structure = clamp(Math.round(coverage * 100));
    scores = [
      { key: 'structure', label: 'Structure', value: structure, desc: CHECKLISTS[config.checklist].title.replace(' checklist', '') + ' coverage per answer' },
      { key: 'impression', label: 'Impression', value: avgU, desc: 'How the panel rated you' },
      { key: 'delivery', label: 'Delivery', value: delivery, desc: 'Pace and filler words' },
      { key: 'concise', label: 'Conciseness', value: concise, desc: 'Answers between 30 and 220 words' },
    ];
    scores.overall = Math.round(structure * 0.3 + avgU * 0.35 + delivery * 0.2 + concise * 0.15);
  } else {
    const structure = clamp(Math.round(coverage * 60 + (reached / deck.segments.length) * 40));
    const engagement = clamp(Math.round(45 + questions * 5 + s.acks * 4 - (s.flags.f6 ? 6 : 0)));
    scores = [
      { key: 'clarity', label: 'Clarity', value: avgU, desc: 'How much the room understood' },
      { key: 'delivery', label: 'Delivery', value: delivery, desc: 'Pace and filler words' },
      { key: 'structure', label: 'Structure', value: structure, desc: 'Examples, analogies, check-ins' },
      { key: 'engagement', label: 'Engagement', value: engagement, desc: 'Questions you drew out and answered' },
    ];
    scores.overall = Math.round(avgU * 0.35 + delivery * 0.25 + structure * 0.25 + engagement * 0.15);
  }

  return {
    config, deck, mode: mode.id, elapsed: s.elapsed, transcript: s.transcript, perSlide: s.perSlide,
    wpm: s.wpm, avgWpm, fillers: s.fillers, fillerTotal, pauses: s.pauses, agents: s.agents,
    hints: s.hints, questions, acks: s.acks, covered: s.covered, coverage, scores, overall: scores.overall,
    finishedAt: new Date().toISOString(),
  };
}

// Plays an entire scripted session instantly (used for the sample report).
export function simulateFull(config) {
  const { deck, steps } = buildScript(config);
  let st = initialState(config, deck);
  const pace = { say: 4, raise_hand: 1, question: 4, interrupt: 3, prompt: 3, ack: 2, distracted: 2, confused: 2, note: 2 };
  for (let k = 0; k <= steps.length; k++) {
    const step = steps[k];
    const n = step ? pace[step.kind] || 2 : 0;
    for (let j = 0; j < n; j++) st = reducer(st, { type: 'CLOCK', config });
    st = reducer(st, { type: 'STEP', steps, config });
  }
  return computeResult(config, deck, st);
}
