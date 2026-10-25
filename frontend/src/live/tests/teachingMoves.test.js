import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { MEASURED_TEACHING_MOVES, PROMPT_TEACHING_MOVES, reportWithTeachingMoves } from './fixtures/teachingMoves.js';

let server;
let LiveReport;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  });
  LiveReport = (await server.ssrLoadModule('/src/live/LiveReport.jsx')).default;
});
after(async () => { await server?.close(); });

const render = (payload) => renderToStaticMarkup(createElement(LiveReport, {
  report: reportWithTeachingMoves(payload), onExit: () => {},
}));

function teachingSection(html) {
  // Exclude Session details JSON: payload strings there cannot prove a card rendered.
  const section = html.match(/<section\b[^>]*aria-labelledby="live-teaching-moves-heading"[^>]*>[\s\S]*?<\/section>/);
  assert.ok(section, 'the optional teaching card must render as an accessible named section');
  return section[0];
}

function textOf(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|#160);/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

test('teaching card renders all four moves and real text values from the prompt contract', () => {
  const section = teachingSection(render(PROMPT_TEACHING_MOVES));
  const text = textOf(section);
  assert.match(section, /<h2\b[^>]*id="live-teaching-moves-heading"[^>]*>Teaching moves<\/h2>/);
  assert.match(text, /42 presenter sentences analyzed/);
  for (const move of PROMPT_TEACHING_MOVES.moves) {
    assert.ok(text.includes(move.label), `missing move label: ${move.label}`);
    assert.ok(text.includes(`${move.count} ${move.count === 1 ? 'time' : 'times'}`), `missing textual count: ${move.key}`);
    assert.ok(text.includes(`${move.per_100} per 100 sentences`), `missing rate: ${move.key}`);
    assert.ok(text.includes(move.f1.toFixed(2)), `missing per-move F1: ${move.key}`);
    if (move.examples.length) {
      assert.ok(text.includes(move.examples[0]), `missing own-sentence example: ${move.key}`);
    }
  }
  assert.match(text, /You said:/);
  assert.ok(text.includes(PROMPT_TEACHING_MOVES.dataset));
  assert.ok(text.includes(PROMPT_TEACHING_MOVES.model.method));
  assert.match(text, /504 real classroom lessons/);
  assert.match(text, /accuracy\s+72(?:\.0+)?%/i);
  assert.match(text, /Advisory, not a grade/i);
  assert.match(text, /median/i);
  assert.match(text, /middle\s*50%/i);
  for (const value of ['9.8', '5.1', '14.6']) assert.ok(text.includes(value), `missing visible reference value: ${value}`);
});

test('teaching card is absent when optional feedback is omitted or null', () => {
  for (const payload of [undefined, null]) {
    const html = render(payload);
    assert.doesNotMatch(html, /id="live-teaching-moves-heading"/);
    assert.doesNotMatch(html, /<h2\b[^>]*>Teaching moves<\/h2>/);
    assert.match(html, /Delivery/);
  }
});

test('measured payload supplies its actual lesson count, accuracy and per-move F1', () => {
  const text = textOf(teachingSection(render(MEASURED_TEACHING_MOVES)));
  assert.match(text, /566 real classroom lessons/);
  assert.match(text, /accuracy\s+73\.23%/i);
  assert.doesNotMatch(text, /504 real classroom lessons|accuracy\s+72(?:\.0+)?%/i);
  for (const move of MEASURED_TEACHING_MOVES.moves) assert.ok(text.includes(move.f1.toFixed(2)), `missing measured F1: ${move.key}`);
  assert.match(text, /middle\s*50%/i);
  for (const value of ['13.61', '9.73', '19.17']) assert.ok(text.includes(value), `missing measured reference value: ${value}`);
});

test('zero counts and all-zero benchmark ranges render finite comparison bars', () => {
  const payload = structuredClone(PROMPT_TEACHING_MOVES);
  payload.sentences = 0;
  for (const move of payload.moves) {
    Object.assign(move, { count: 0, per_100: 0, examples: [] });
    Object.assign(move.benchmark, { median: 0, p25: 0, p75: 0, ci95_median: [0, 0] });
  }
  const section = teachingSection(render(payload));
  const text = textOf(section);
  assert.equal((text.match(/0 times/g) || []).length, 4);
  assert.equal((text.match(/0 per 100 sentences/g) || []).length, 4);
  assert.doesNotMatch(section, /NaN|Infinity|undefined/);
});

test('presenter examples render as escaped text, never executable markup', () => {
  const payload = structuredClone(PROMPT_TEACHING_MOVES);
  const example = '<img src=x onerror="alert(1)"> & <script>alert("x")</script>';
  payload.moves[0].examples = [example];
  const section = teachingSection(render(payload));
  assert.ok(textOf(section).includes(example));
  assert.match(section, /&lt;img/);
  assert.match(section, /&lt;script&gt;/);
  assert.doesNotMatch(section, /<script\b|<img\b[^>]*onerror/i);
});
