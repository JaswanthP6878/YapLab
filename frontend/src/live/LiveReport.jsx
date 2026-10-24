import { PERSONAS } from '../data.js';
import { PERSONA_TO_AGENT } from './mapEvents.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const numeric = (value, digits = 0) => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
const percent = (value) => finite(value) ? `${numeric(value, 1)}%` : '—';
const duration = (value) => {
  if (!finite(value) || value < 0) return '—';
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const verdictLabel = { answered: 'Answered', partial: 'Partly answered', dodged: 'Not answered' };
const panelStyle = { background: 'var(--board-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: 22 };

function ListenerName({ answer }) {
  const persona = PERSONAS.find((item) => item.id === PERSONA_TO_AGENT[answer.persona]);
  return <>{persona?.name || answer.persona || answer.listener || 'Listener'}</>;
}

/** Render only the backend's measured delivery and recorded question verdicts. */
export default function LiveReport({ report, onExit }) {
  if (!report) return <main className="report wrap mode-teaching">
    <div className="report-head"><div><p className="eyebrow">Session report</p><h1>Your report is not ready yet.</h1></div></div>
    <button type="button" className="btn btn-ghost" onClick={onExit}>Back to setup</button>
  </main>;

  const delivery = report.delivery || {};
  const questions = report.questions || {};
  const verdicts = questions.verdicts || {};
  const answers = Array.isArray(questions.answers) ? questions.answers : [];
  const ticks = Array.isArray(report.ticks) ? report.ticks : [];
  const lastRoom = ticks.at(-1)?.room;
  const facts = [
    ['Talk duration', duration(delivery.duration_seconds)],
    ['Words spoken', numeric(delivery.words)],
    ['Average pace', finite(delivery.words_per_minute) ? `${numeric(delivery.words_per_minute, 1)} wpm` : '—'],
    ['Filler words', numeric(delivery.filler_words)],
    ['Longest pause', finite(delivery.longest_pause_seconds) ? `${numeric(delivery.longest_pause_seconds, 2)} s` : '—'],
  ];

  return (
    <main className="report wrap mode-teaching">
      <div className="report-head">
        <div><p className="eyebrow">Session report</p><h1>Your teaching session</h1><p className="muted">Delivery measurements and the room’s recorded responses.</p></div>
        <button type="button" className="btn btn-ghost" onClick={onExit}>Back to setup</button>
      </div>

      <section className="report-sec" aria-labelledby="live-delivery-heading">
        <h2 id="live-delivery-heading">Delivery</h2>
        <dl className="score-facts" style={{ ...panelStyle, gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))' }}>
          {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tnum" style={{ fontSize: 25 }}>{value}</dd></div>)}
        </dl>
      </section>

      <section className="report-sec" aria-labelledby="live-questions-heading">
        <h2 id="live-questions-heading">Questions and answers</h2>
        <p className="muted">Raised: {numeric(questions.raised)} · Asked: {numeric(questions.asked)} · Answered: {numeric(verdicts.answered)} · Partly answered: {numeric(verdicts.partial)} · Not answered: {numeric(verdicts.dodged)}</p>
        {answers.length > 0 ? <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
          {answers.map((answer, index) => <li key={`${answer.question_id || 'answer'}-${index}`} style={panelStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
              <h3 style={{ fontSize: 16 }}><ListenerName answer={answer} /> · Question {answer.question_id || index + 1}</h3>
              <strong style={{ color: answer.verdict === 'answered' ? 'var(--mint)' : 'var(--marigold)', fontSize: 13 }}>
                {verdictLabel[answer.verdict] || answer.verdict || 'No verdict'}
              </strong>
            </div>
            {answer.question && <p style={{ marginBottom: 8 }}>{answer.question}</p>}
            {answer.comment && <p style={{ color: 'var(--chalk-2)', whiteSpace: 'pre-wrap' }}>{answer.comment}</p>}
          </li>)}
        </ol> : <p className="muted" style={panelStyle}>No answer verdicts were recorded.</p>}
      </section>

      <section className="report-sec" aria-labelledby="live-room-heading">
        <h2 id="live-room-heading">Last room check</h2>
        {lastRoom ? <dl className="score-facts" style={{ ...panelStyle, gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))' }}>
          <div><dt>Attention</dt><dd className="tnum">{percent(lastRoom.attention)}</dd></div>
          <div><dt>Confusion</dt><dd className="tnum">{percent(lastRoom.confusion)}</dd></div>
          <div><dt>Comprehension</dt><dd className="tnum">{percent(lastRoom.comprehension)}</dd></div>
        </dl> : <p className="muted">No room checks were recorded.</p>}
      </section>

      <details style={panelStyle}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Session details (JSON)</summary>
        <pre style={{ margin: '18px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, color: 'var(--chalk-2)' }}>{JSON.stringify(report, null, 2)}</pre>
      </details>
    </main>
  );
}
