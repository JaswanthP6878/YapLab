import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import { CHECKLISTS, isPanel, modeById, seriousnessLabel } from '../data.js';
import { decisionFor } from '../lib/engine.js';
import { sessionTitle } from '../lib/config.js';
import { fmt } from '../lib/media.js';

function ScoreRing({ value }) {
  const r = 54, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 132 132" className="ring-score" role="img" aria-label={`Overall score ${value} out of 100`}>
      <circle cx="66" cy="66" r={r} className="ring-bg" />
      <circle cx="66" cy="66" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 66 66)" />
      <text x="66" y="68" textAnchor="middle" className="ring-num">{value}</text>
      <text x="66" y="90" textAnchor="middle" className="ring-sub">of 100</text>
    </svg>
  );
}

function PaceChart({ wpm, segments, elapsed, segLabel }) {
  const W = 900, H = 260, L = 40, R = 12, T = 18, B = 34;
  const lo = 100, hi = 200;
  const tMax = Math.max(elapsed, wpm.length ? wpm[wpm.length - 1].t + 4 : 60);
  const x = (t) => L + (t / tMax) * (W - L - R);
  const y = (v) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - T - B);
  const pts = wpm.map((w) => [x(w.t), y(w.v)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const starts = segments.map((_, i) => ({ t: wpm.find((w) => w.slide === i)?.t, i })).filter((s) => s.t !== undefined);
  const step = tMax > 240 ? 60 : 30;
  const ticks = [];
  for (let t = 0; t <= tMax; t += step) ticks.push(t);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="pace-chart" role="img" aria-label="Speaking pace over time">
        <rect x={L} y={y(160)} width={W - L - R} height={y(130) - y(160)} className="band" />
        <text x={W - R - 4} y={y(160) + 12} textAnchor="end" className="band-label">target 130–160</text>
        {[100, 125, 150, 175, 200].map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}</text></g>
        ))}
        {starts.map((s) => (
          <g key={s.i}><line x1={x(s.t)} x2={x(s.t)} y1={T} y2={H - B} className="slide-line" /><text x={x(s.t) + 4} y={T + 10} className="slide-tag">{segLabel[0]}{s.i + 1}</text></g>
        ))}
        {ticks.map((t) => <text key={t} x={x(t)} y={H - B + 18} textAnchor="middle" className="axis">{fmt(t)}</text>)}
        {pts.length > 1 && <path d={`${d} L${pts[pts.length - 1][0]},${H - B} L${pts[0][0]},${H - B} Z`} className="area" />}
        {pts.length > 1 && <path d={d} className="line" />}
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4 : 2.5} className={wpm[i].v > 160 || wpm[i].v < 130 ? 'pt off' : 'pt'} />)}
      </svg>
      <span className="axis-title">words per minute</span>
    </div>
  );
}

const VERDICTS = {
  teaching: [['Ready for the real room', 'Clear, well paced, and the class followed you.'], ['Almost there', 'Most of the class followed. A couple of slides need a cleaner explanation.'], ['Worth another run', 'The class lost the thread in places. The notes below show where.']],
  pitch: [['The panel would lean in', 'Your story landed and you held up in Q&A.'], ['Promising, needs sharpening', 'The panel is interested but not convinced yet.'], ['Not fundable yet', 'The panel could not see the business. Start with the gaps below.']],
  interview: [['You would move to the next round', 'Structured, specific answers. The panel trusts your claims.'], ['Borderline', 'Good material, but some answers lacked structure or a clear result.'], ['Needs more prep', 'Answers were hard to follow. Practice the structure below.']],
};

function Scorecard({ cats, score }) {
  return (
    <ul className="jscores">
      {cats.map(([c, v]) => (
        <li key={c}><span>{c}</span><span className="pips">{Array.from({ length: 10 }).map((_, n) => <i key={n} className={n < v ? 'on' : ''} />)}</span><strong className="tnum">{v}</strong></li>
      ))}
      {score}
    </ul>
  );
}

export default function Report({ result, onAgain, onNew, onHome }) {
  const { config, deck, perSlide, scores, agents } = result;
  const mode = modeById(config.mode);
  const cl = CHECKLISTS[config.checklist];
  const roster = config.roster;
  const present = roster.filter((p) => config.agents.includes(p.id));
  const panel = present.filter(isPanel);
  const audience = present.filter((p) => !isPanel(p));
  const v = VERDICTS[mode.id][result.overall >= 80 ? 0 : result.overall >= 65 ? 1 : 2];
  const level = Math.min(3, Math.floor(config.seriousness / 25));
  const segs = deck.segments;

  const rows = segs.map((s, i) => {
    const ps = perSlide[i];
    const us = Object.values(ps.u || {});
    const u = us.length ? Math.round(us.reduce((a, b) => a + b, 0) / us.length) : 0;
    const avg = ps.wpm.length ? Math.round(ps.wpm.reduce((a, b) => a + b, 0) / ps.wpm.length) : 0;
    const missing = cl.perSegment && !ps.freeform ? cl.items.filter((it) => !ps.covered[it.key]) : [];
    return { ...ps, title: s.title, prompt: s.prompt?.text, i, u, avg, missing };
  });
  const covered = rows.filter((r) => r.reached);
  const prevU = (i) => (i === 0 ? 15 : rows[i - 1].u);
  const lost = covered.length > 1 ? covered.reduce((m, r) => (r.u - prevU(r.i) < m.u - prevU(m.i) ? r : m), covered[0]) : null;
  const fillerRow = covered.length ? covered.reduce((m, r) => (r.fillers > m.fillers ? r : m), covered[0]) : null;
  const topFiller = Object.entries(result.fillers).sort((a, b) => b[1] - a[1])[0];
  const maxT = Math.max(...rows.map((r) => r.t), 1);
  const globalMissing = cl.perSegment ? [] : cl.items.filter((it) => result.covered[it.key] === undefined);
  const scoredAnswers = covered.filter((r) => !r.freeform);
  const weakest = cl.perSegment && scoredAnswers.length ? scoredAnswers.reduce((m, r) => (r.missing.length > m.missing.length ? r : m), covered[0]) : null;

  const todo = [];
  if (mode.id === 'teaching' && lost) todo.push({ icon: 'users', h: `Re-teach slide ${lost.i + 1}`, p: `“${lost.title}” gained the least understanding. Add a concrete example before the abstract version.` });
  if (globalMissing.length) todo.push({ icon: 'check', h: `Add: ${globalMissing.map((m) => m.label.toLowerCase()).join(', ')}`, p: globalMissing[0].tip + (globalMissing.length > 1 ? ` Also: ${globalMissing.slice(1).map((m) => m.tip.toLowerCase()).join(' ')}` : '') });
  if (weakest && weakest.missing.length) todo.push({ icon: 'check', h: `Restructure answer ${weakest.i + 1}`, p: `“${weakest.prompt || weakest.title}” was missing ${weakest.missing.map((m) => m.label).join(' and ')}. ${weakest.missing[0].tip}` });
  if (mode.id === 'pitch' && config.timeLimit) {
    const over = result.elapsed - config.timeLimit;
    todo.push(over > 0
      ? { icon: 'clock', h: `Cut ${fmt(over)}`, p: `You ran over your ${fmt(config.timeLimit)} slot. Judges stop listening after the bell.` }
      : { icon: 'clock', h: result.elapsed < config.timeLimit * 0.4 ? 'Use more of your slot' : 'Timing held', p: result.elapsed < config.timeLimit * 0.4 ? `You used ${fmt(result.elapsed)} of ${fmt(config.timeLimit)}. Spend it on traction and the ask.` : `You finished in ${fmt(result.elapsed)} of ${fmt(config.timeLimit)}.` });
  }
  if (topFiller) todo.push({ icon: 'type', h: `Cut “${topFiller[0]}”`, p: `You said it ${topFiller[1]} ${topFiller[1] === 1 ? 'time' : 'times'}, most on ${mode.segment.toLowerCase()} ${fillerRow.i + 1}. Pause for a beat instead.` });

  const asked = (id) => result.transcript.filter((l) => l.who === id && (l.kind === 'question' || l.kind === 'interrupt'));
  const notes = (id) => result.transcript.filter((l) => l.who === id && l.kind === 'note');
  const s = Object.fromEntries(scores.map((x) => [x.key, x.value]));
  const seedScore = (id, base, k) => {
    const seed = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const u = agents[id]?.u || 50;
    return Math.max(2, Math.min(10, Math.round((u * 0.6 + base * 0.4) / 10 + ((seed + k * 7) % 3) - 1)));
  };

  return (
    <main className={`report wrap mode-${mode.id}`}>
      <div className="report-head">
        <div>
          <p className="eyebrow"><Icon name={mode.icon} size={13} /> {mode.name} report · simulated session</p>
          <h1>{sessionTitle(config)}</h1>
          <p className="muted">
            {mode.variants.find((x) => x.id === config.variant)?.name} · <span className={`stakes stakes-${level}`}>{seriousnessLabel(config.seriousness)}</span> · {fmt(result.elapsed)}{config.timeLimit ? ` of ${fmt(config.timeLimit)}` : ''} · {present.length} in the room
          </p>
        </div>
        <div className="report-actions">
          <button className="btn btn-ghost" onClick={onNew}><Icon name="settings" size={16} /> Change setup</button>
          <button className="btn btn-primary" onClick={onAgain}><Icon name="refresh" size={16} /> Run it again</button>
        </div>
      </div>

      <section className="score-hero">
        <ScoreRing value={result.overall} />
        <div className="score-copy">
          <h2>{v[0]}</h2>
          <p>{v[1]}</p>
          <div className="subscores">
            {scores.map((x) => (
              <div key={x.key} className="sub">
                <div className="sub-top"><span>{x.label}</span><strong className="tnum">{x.value}</strong></div>
                <span className="sub-bar"><i style={{ width: `${x.value}%` }} /></span>
                <span className="sub-d">{x.desc}</span>
              </div>
            ))}
          </div>
        </div>
        <dl className="score-facts">
          <div><dt>Average pace</dt><dd className="tnum">{result.avgWpm} <small>wpm</small></dd></div>
          <div><dt>Filler words</dt><dd className="tnum">{result.fillerTotal}</dd></div>
          <div><dt>{mode.id === 'interview' ? 'Follow-ups' : 'Questions'}</dt><dd className="tnum">{result.questions}</dd></div>
          <div><dt>{mode.id === 'interview' ? 'Answers' : 'Won over'}</dt><dd className="tnum">{mode.id === 'interview' ? covered.length : result.acks}</dd></div>
        </dl>
      </section>

      <section className="report-sec">
        <h2>Work on next</h2>
        <div className="todo">
          {todo.slice(0, 3).map((t) => (
            <div key={t.h} className="todo-item"><Icon name={t.icon} size={20} /><div><h3>{t.h}</h3><p>{t.p}</p></div></div>
          ))}
        </div>
      </section>

      {!cl.perSegment && (
        <section className="report-sec">
          <h2>{cl.title}</h2>
          <div className="beats">
            {cl.items.map((it) => {
              const t = result.covered[it.key];
              return (
                <div key={it.key} className={`beat ${t !== undefined ? 'done' : ''}`}>
                  <span className="cmark">{t !== undefined ? <Icon name="check" size={12} stroke={2.6} /> : <Icon name="x" size={11} stroke={2.6} />}</span>
                  <div><strong>{it.label}</strong><span>{t !== undefined ? `First at ${fmt(t)}` : it.tip}</span></div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {mode.id === 'interview' && (
        <section className="report-sec">
          <h2>Answer by answer</h2>
          <div className="answers">
            {rows.map((r) => {
              const asker = segs[r.i].prompt && present.find((p) => p.id === segs[r.i].prompt.agent);
              const followups = result.transcript.filter((l) => l.slide === r.i && l.kind === 'question');
              return (
                <article key={r.i} className={`answer ${r.reached ? '' : 'na'}`}>
                  <header>
                    <span className="sn tnum">{r.i + 1}</span>
                    <div><h3>{r.prompt || r.title}</h3><span className="muted">{asker ? `${asker.name} · ` : ''}{r.reached ? `${fmt(r.t)} · ${r.words} words · ${r.avg} wpm` : 'Not reached'}</span></div>
                  </header>
                  {r.reached && r.freeform && <p className="muted freeform">Open question. Not scored on {cl.title.replace(' checklist', '')}; judged on clarity and length.</p>}
                  {r.reached && !r.freeform && (
                    <ul className="star-row">
                      {cl.items.map((it) => (
                        <li key={it.key} className={r.covered[it.key] ? 'done' : 'miss'}>
                          <span className="cmark">{r.covered[it.key] ? <Icon name="check" size={11} stroke={2.6} /> : <Icon name="x" size={10} stroke={2.6} />}</span>{it.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  {followups.map((f, k) => {
                    const p = present.find((x) => x.id === f.who);
                    return <p key={k} className="followup"><Avatar p={p} size={18} /> “{f.text}”</p>;
                  })}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {mode.id !== 'interview' && (
        <section className="report-sec">
          <h2>Slide by slide</h2>
          <div className="table-wrap">
            <table className="slides-table">
              <thead><tr><th>Slide</th><th>Time</th><th className="num">Pace</th><th className="num">Fillers</th><th className="num">Questions</th><th>Room {mode.meter.toLowerCase()}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.i} className={lost && r.i === lost.i && mode.id === 'teaching' ? 'flag' : ''}>
                    <td><span className="sn tnum">{r.i + 1}</span>{r.title}{lost && r.i === lost.i && mode.id === 'teaching' && <span className="flag-tag">Room got lost</span>}</td>
                    <td><span className="tbar"><i style={{ width: `${(r.t / maxT) * 100}%` }} /></span><span className="tnum">{fmt(r.t)}</span></td>
                    <td className={`num tnum ${r.avg > 160 ? 'warn' : ''}`}>{r.avg || '–'}</td>
                    <td className={`num tnum ${r.fillers > 1 ? 'warn' : ''}`}>{r.fillers}</td>
                    <td className="num tnum">{r.questions}</td>
                    <td>{r.reached ? <><span className="ubar wide"><i style={{ width: `${r.u}%` }} /></span><span className="tnum">{r.u}%</span></> : <span className="muted">Not reached</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {panel.length > 0 && (
        <section className="report-sec">
          <h2>{mode.id === 'interview' ? 'Panel recommendations' : 'Judges\' verdicts'}</h2>
          <div className="judges">
            {panel.map((j) => {
              const u = agents[j.id]?.u || 0;
              const [dec, tone] = decisionFor(mode.id, u);
              const cats = mode.id === 'interview'
                ? [['Communication', seedScore(j.id, s.delivery, 0)], ['Structure', seedScore(j.id, s.structure, 1)], ['Specificity', seedScore(j.id, s.concise, 2)], [j.trait === 'Senior engineer' ? 'Technical depth' : 'Ownership', seedScore(j.id, u, 3)]]
                : [['Problem', seedScore(j.id, s.story, 0)], ['Market', seedScore(j.id, u, 1)], ['Traction', seedScore(j.id, s.qa, 2)], ['Delivery', seedScore(j.id, s.delivery, 3)]];
              return (
                <article key={j.id} className="judge">
                  <header>
                    <Avatar p={j} size={44} state={tone === 'good' ? 'nodding' : tone === 'mid' ? 'listening' : 'confused'} />
                    <div><h3>{j.name}</h3><span className="muted">{j.trait}</span></div>
                    <span className={`decision ${tone}`}>{dec}</span>
                  </header>
                  <Scorecard cats={cats} />
                  {notes(j.id).map((n, k) => <p key={k} className="jnote">“{n.text}” <span className="tnum">{fmt(n.t)}</span></p>)}
                  {asked(j.id).slice(0, 2).map((q, k) => <p key={'q' + k} className="take-q">Asked: “{q.text}”</p>)}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {audience.length > 0 && (
        <section className="report-sec">
          <h2>{mode.id === 'teaching' ? 'What each student took away' : 'What the audience took away'}</h2>
          <div className="takeaways">
            {audience.map((p, idx) => {
              const a = agents[p.id];
              const q = asked(p.id).slice(-1)[0];
              return (
                <article key={p.id} className="take">
                  <header>
                    <Avatar p={p} size={44} state={a.u >= 60 ? 'nodding' : 'confused'} delay={idx * 0.5} />
                    <div><h3>{p.name}</h3><span className="muted">{p.trait}</span></div>
                    <strong className="take-u tnum">{a.u}%</strong>
                  </header>
                  <ul className="concepts">
                    {segs.map((sg, i) => {
                      const val = perSlide[i].u?.[p.id];
                      const reached = perSlide[i].reached;
                      const got = reached && val >= 50;
                      return (
                        <li key={i} className={got ? 'got' : reached ? 'miss' : 'na'}>
                          <span className="cmark">{got ? <Icon name="check" size={12} stroke={2.6} /> : reached ? <Icon name="x" size={11} stroke={2.6} /> : '–'}</span>
                          {sg.title}
                        </li>
                      );
                    })}
                  </ul>
                  {q && <p className="take-q">Asked: “{q.text}”</p>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="report-sec">
        <h2>Pace over time</h2>
        <PaceChart wpm={result.wpm} segments={segs} elapsed={result.elapsed} segLabel={mode.segment} />
      </section>

      {result.hints.length > 0 && (
        <section className="report-sec">
          <h2>Moments</h2>
          <ol className="moments">
            {result.hints.map((h) => (
              <li key={h.id}><span className="tnum">{fmt(h.t)}</span><span className="m-slide">{mode.segment} {h.slide + 1}</span><p>{h.text}</p></li>
            ))}
          </ol>
        </section>
      )}

      <footer className="report-foot">
        <button className="btn btn-ghost" onClick={onHome}>Back to modes</button>
        <button className="btn btn-primary" onClick={onAgain}><Icon name="refresh" size={16} /> Run it again</button>
      </footer>
    </main>
  );
}
