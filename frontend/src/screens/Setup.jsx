import { useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import { CHECKLISTS, DECKS, MODES, isPanel, modeById, seriousnessLabel } from '../data.js';
import { carry, defaultConfig, sessionTitle } from '../lib/config.js';
import { deckFromFiles } from '../lib/slides.jsx';

const COLORS = ['#F2C14E', '#8EB8F0', '#7FD1AE', '#F07F64', '#C9A3F0', '#F5A6C4', '#9ED8E8'];
const ACCS = ['none', 'glasses', 'bun', 'beanie', 'cap', 'headband', 'earrings'];
const MAX = { teaching: 6, pitch: 6, interview: 4 };

function Segmented({ value, options, onChange, name }) {
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          <strong>{o.label}</strong>
          {o.sub && <span>{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Toggle({ id, checked, onChange, label, sub }) {
  return (
    <label className="toggle" htmlFor={id}>
      <span className="toggle-text"><strong>{label}</strong>{sub && <span>{sub}</span>}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Field({ id, label, children }) {
  return <label className="field" htmlFor={id}><span>{label}</span>{children}</label>;
}

function NewPersona({ mode, onAdd, onCancel }) {
  const defRole = mode === 'pitch' ? 'judge' : mode === 'interview' ? 'interviewer' : 'student';
  const [name, setName] = useState('');
  const [trait, setTrait] = useState('');
  const [instructions, setInstructions] = useState('');
  const [role, setRole] = useState(defRole);
  const [color, setColor] = useState(COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [acc, setAcc] = useState('none');
  const valid = name.trim() && trait.trim();
  const placeholder = {
    student: ['Rosa', 'Devil\'s advocate', 'Argue the opposite of every claim. Ask one sharp question per slide.'],
    judge: ['Kai Moreno', 'Climate-tech investor', 'Push on unit economics and regulatory risk. Decide whether you would invest.'],
    interviewer: ['Tom Hale', 'Engineering director', 'Ask about leadership and conflict. Follow up when answers are vague.'],
  }[role];
  return (
    <form
      className="new-persona"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAdd({
          id: 'c-' + Date.now(), name: name.trim(), trait: trait.trim(), role, color, acc,
          instructions: instructions.trim() || `You are ${name.trim()}, a ${trait.trim().toLowerCase()}.`,
          blurb: instructions.trim().slice(0, 70) || trait.trim(), pitch: 1, rate: 1, gain: 5, custom: true,
        });
      }}
    >
      <div className="np-preview"><Avatar p={{ id: 'new', name: name || 'New agent', color, acc }} size={72} /></div>
      <div className="np-fields">
        <div className="field-row">
          <Field id="np-name" label="Name"><input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder[0]} /></Field>
          <Field id="np-trait" label="Personality"><input id="np-trait" value={trait} onChange={(e) => setTrait(e.target.value)} placeholder={placeholder[1]} /></Field>
        </div>
        <Field id="np-instr" label="Instructions for this agent">
          <textarea id="np-instr" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={placeholder[2]} />
        </Field>
        <div className="field-row">
          <div className="field">
            <span>Role</span>
            <Segmented name="Role" value={role} onChange={setRole} options={[{ value: 'student', label: 'Audience' }, { value: 'judge', label: 'Judge' }, { value: 'interviewer', label: 'Interviewer' }]} />
          </div>
          <div className="field">
            <span>Look</span>
            <div className="swatches">
              {COLORS.map((c) => <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />)}
              <select id="np-acc" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="Accessory">
                {ACCS.map((a) => <option key={a} value={a}>{a === 'none' ? 'No accessory' : a}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="np-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>Add to roster</button>
        </div>
      </div>
    </form>
  );
}

function ContentSection({ config, set }) {
  if (config.mode === 'pitch') {
    return (
      <section className="panel">
        <h2 className="panel-h">Your startup</h2>
        <div className="field-row">
          <Field id="startup" label="Startup name"><input id="startup" value={config.startup} onChange={(e) => set({ startup: e.target.value })} placeholder="YapLab" /></Field>
          <div className="field">
            <span>Stage</span>
            <Segmented name="Stage" value={config.stage} onChange={(v) => set({ stage: v })} options={['Pre-seed', 'Seed', 'Series A'].map((s) => ({ value: s, label: s }))} />
          </div>
        </div>
        <Field id="oneliner" label="One-line description">
          <input id="oneliner" value={config.oneLiner} onChange={(e) => set({ oneLiner: e.target.value })} placeholder="What you do, for whom, in one sentence" />
        </Field>
        <div className="field">
          <span>Pitch slot</span>
          <Segmented name="Pitch slot" value={config.timeLimit} onChange={(v) => set({ timeLimit: v })}
            options={[{ value: 60, label: '1 min', sub: 'Elevator' }, { value: 180, label: '3 min', sub: 'Demo day' }, { value: 300, label: '5 min', sub: 'Competition' }, { value: 600, label: '10 min', sub: 'Partner meeting' }]} />
        </div>
        <SlidesDrop config={config} set={set} label="Upload your pitch deck" />
      </section>
    );
  }
  if (config.mode === 'interview') {
    return (
      <section className="panel">
        <h2 className="panel-h">The role</h2>
        <div className="field-row">
          <Field id="role" label="Role"><input id="role" value={config.role} onChange={(e) => set({ role: e.target.value })} placeholder="Data Science Intern" /></Field>
          <Field id="company" label="Company"><input id="company" value={config.company} onChange={(e) => set({ company: e.target.value })} placeholder="Company name" /></Field>
        </div>
        <Field id="jd" label="Job description (optional)">
          <textarea id="jd" rows={3} value={config.jobDescription} onChange={(e) => set({ jobDescription: e.target.value })} placeholder="Paste the posting. The backend tailors questions to it." />
        </Field>
        <div className="field">
          <span>Number of questions</span>
          <Segmented name="Number of questions" value={config.questionCount} onChange={(v) => set({ questionCount: v })}
            options={[1, 2, 3].map((n) => ({ value: n, label: String(n), sub: n === 1 ? 'Quick drill' : n === 2 ? 'Short round' : 'Full round' }))} />
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2 className="panel-h">What you're teaching</h2>
      <Field id="topic" label="Topic">
        <input id="topic" value={config.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. How the Krebs cycle produces ATP" />
      </Field>
      <SlidesDrop config={config} set={set} label="Upload slides" />
    </section>
  );
}

function SlidesDrop({ config, set, label }) {
  const [error, setError] = useState(null);
  const slides = config.slides;
  return (
    <div className="field">
      <label className={`dropzone ${slides ? 'has' : ''}`} htmlFor="slides">
        <Icon name={slides ? 'file' : 'upload'} size={22} />
        {slides
          ? <span><strong>{slides.name}</strong> · shown full-size in the room. Use ← → or a clicker to change slides.</span>
          : <span><strong>{label}</strong> (PDF, or slide images), or keep the demo deck: “{DECKS[config.deck].title}”</span>}
        <input id="slides" type="file" accept=".pdf,application/pdf,image/*" multiple
          onChange={(e) => {
            const { deck, error: err } = deckFromFiles(e.target.files);
            setError(err || null);
            if (deck) set({ slides: deck });
            e.target.value = '';
          }} />
      </label>
      {error && <p className="fine warn">{error}</p>}
      {slides && <button type="button" className="link" onClick={() => set({ slides: null })}>Use the demo deck instead</button>}
    </div>
  );
}

export default function Setup({ config, setConfig, roster, setRoster, onStart, onBack }) {
  const [adding, setAdding] = useState(false);
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const mode = modeById(config.mode);
  const variant = mode.variants.find((v) => v.id === config.variant) || mode.variants[0];
  const max = MAX[mode.id];
  const eligible = roster.filter((p) =>
    mode.id === 'teaching' ? p.role === 'student' : mode.id === 'pitch' ? p.role !== 'interviewer' : p.role === 'interviewer' || p.custom);
  const selected = roster.filter((p) => config.agents.includes(p.id));
  const students = selected.filter((p) => !isPanel(p));
  const panel = selected.filter(isPanel);
  const toggleAgent = (id) =>
    set({ agents: config.agents.includes(id) ? config.agents.filter((a) => a !== id) : [...config.agents, id].slice(-max) });
  const level = Math.min(3, Math.floor(config.seriousness / 25));
  const cl = CHECKLISTS[config.checklist];

  return (
    <main className={`setup wrap mode-${mode.id}`}>
      <div className="setup-head">
        <button className="link-back" onClick={onBack}><Icon name="prev" size={16} /> Modes</button>
        <h1>Set up your {mode.name.toLowerCase()} session</h1>
        <div className="mode-tabs" role="tablist" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={m.id === mode.id} className={`mode-tab mode-${m.id} ${m.id === mode.id ? 'on' : ''}`}
              onClick={() => m.id !== mode.id && setConfig(defaultConfig(m.id, undefined, roster, { camera: config.camera, voices: config.voices, slides: config.slides }))}>
              <Icon name={m.icon} size={16} /> {m.name}{m.id === 'interview' ? ' · Upcoming soon' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="setup-grid">
        <div className="setup-form">
          <section className="panel">
            <h2 className="panel-h">{mode.id === 'interview' ? 'Interview type' : mode.id === 'pitch' ? 'Pitch setting' : 'Room'}</h2>
            <div className="variant-row">
              {mode.variants.map((v) => (
                <button key={v.id} className={`variant ${v.id === variant.id ? 'on' : ''}`}
                  onClick={() => setConfig(defaultConfig(mode.id, v.id, roster, carry(config)))}>
                  <span className="v-top"><strong>{v.name}</strong><span className={`stakes stakes-${Math.min(3, Math.floor(v.seriousness / 25))}`}>{seriousnessLabel(v.seriousness)}</span></span>
                  <span className="v-blurb">{v.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          <ContentSection config={config} set={set} />

          <section className="panel">
            <div className="panel-h-row">
              <h2 className="panel-h">{mode.id === 'teaching' ? 'Students' : mode.id === 'pitch' ? 'Judges and audience' : 'Interview panel'}</h2>
              <span className="count-ctl"><span className="tnum">{selected.length}</span> of {max}</span>
            </div>
            <div className="roster">
              {eligible.map((p, i) => {
                const on = config.agents.includes(p.id);
                return (
                  <button key={p.id} className={`roster-item ${on ? 'on' : ''}`} onClick={() => toggleAgent(p.id)} aria-pressed={on}>
                    <span className="check">{on && <Icon name="check" size={13} stroke={2.6} />}</span>
                    <Avatar p={p} size={40} delay={i * 0.3} />
                    <span className="ri-text">
                      <strong>{p.name} {isPanel(p) && <span className="role-dot">{p.role === 'judge' ? 'Judge' : 'Panel'}</span>}</strong>
                      <span>{p.trait} · {p.blurb}</span>
                    </span>
                  </button>
                );
              })}
              {!adding && (
                <button className="roster-item add" onClick={() => setAdding(true)}>
                  <span className="add-ic"><Icon name="plus" size={18} /></span>
                  <span className="ri-text"><strong>Create an agent</strong><span>Name, personality and its own instructions</span></span>
                </button>
              )}
            </div>
            {adding && (
              <NewPersona
                mode={mode.id}
                onCancel={() => setAdding(false)}
                onAdd={(p) => {
                  const r = [...roster, p];
                  setRoster(r);
                  setConfig((c) => ({ ...c, roster: r, agents: [...c.agents, p.id].slice(-max) }));
                  setAdding(false);
                }}
              />
            )}
          </section>

          <section className="panel">
            <h2 className="panel-h">How serious is it?</h2>
            <div className="serious">
              <input id="seriousness" type="range" min="0" max="100" value={config.seriousness}
                onChange={(e) => set({ seriousness: +e.target.value })} aria-valuetext={seriousnessLabel(config.seriousness)} />
              <div className="serious-scale">
                {['Chill', 'Focused', 'Formal', 'High stakes'].map((l, i) => <span key={l} className={i === level ? 'on' : ''}>{l}</span>)}
              </div>
              <p className="muted">
                {{
                  teaching: ['Relaxed classmates. Gentle questions, lots of encouragement.', 'An attentive section. Questions when you skip a step.', 'A formal audience. Fewer interruptions, sharper follow-ups.', 'Experts in the room. Every inaccuracy gets caught.'],
                  pitch: ['Friendly feedback, no scorecard pressure.', 'Curious judges who want you to succeed.', 'Real judges. They interrupt when you go long.', 'Investors deciding with their own money. Expect hard Q&A.'],
                  interview: ['A practice chat. Easy follow-ups.', 'A standard screen. Follow-ups on vague answers.', 'An onsite round. Probing on every claim.', 'A final round. The panel pushes until you run out of detail.'],
                }[mode.id][level]}
              </p>
            </div>
            <div className="field">
              <span>{mode.id === 'interview' ? 'Follow-up questions' : 'Question frequency'}</span>
              <Segmented name="Question frequency" value={config.questionRate} onChange={(v) => set({ questionRate: v })}
                options={[{ value: 'rare', label: 'Rare' }, { value: 'normal', label: 'Normal' }, { value: 'often', label: 'Often' }]} />
            </div>
            {mode.id === 'teaching' && (
              <>
                <Toggle id="noise" checked={config.noise} onChange={(v) => set({ noise: v })} label="Distractions and background noise" sub="Phones out, side chatter, someone arriving late" />
                <Toggle id="timer" checked={!!config.timeLimit} onChange={(v) => set({ timeLimit: v ? 600 : 0 })} label="Time limit" sub={config.timeLimit ? '10:00 countdown' : 'Off'} />
              </>
            )}
          </section>

          <section className="panel">
            <h2 className="panel-h">In the room</h2>
            <p className="muted">No scores or tips while you present. Your full report opens when you end the session.</p>
            <Toggle id="camera" checked={config.camera} onChange={(v) => set({ camera: v })} label="Self-view camera" sub="Only you see it." />
            <Toggle id="voices" checked={config.voices} onChange={(v) => set({ voices: v })} label="Agent voices" sub="Each agent speaks with its own voice" />
          </section>
        </div>

        <aside className="setup-side">
          <div className="preview-card">
            <div className="pv-head">
              <span className="mode-pill"><Icon name={mode.icon} size={13} /> {mode.name} · {variant.name}</span>
              <span className={`stakes stakes-${level}`}>{seriousnessLabel(config.seriousness)}</span>
            </div>
            <h3>{sessionTitle(config)}</h3>
            {mode.id === 'pitch' && config.oneLiner && <p className="muted">{config.oneLiner}</p>}
            <div className="pv-room">
              {panel.length > 0 && (
                <div className="pv-panel">
                  <span className="pv-label">{mode.id === 'interview' ? 'Panel' : 'Judges'}</span>
                  <div className="pv-row wrap-row">{panel.map((p, i) => <Avatar key={p.id} p={p} size={42} delay={i} />)}</div>
                </div>
              )}
              {students.length > 0 && <div className="pv-row wrap-row">{students.map((p, i) => <Avatar key={p.id} p={p} size={40} delay={i * 0.5} />)}</div>}
              {selected.length === 0 && <span className="muted">Pick at least one agent.</span>}
              <div className="pv-you"><span>You</span></div>
            </div>
            <dl className="pv-facts">
              <div><dt>Scored on</dt><dd>{cl.title.replace(' checklist', '')}</dd></div>
              <div><dt>{mode.id === 'interview' ? 'Feedback' : 'Slides'}</dt><dd>{mode.id === 'interview' ? 'After the session' : config.slides ? 'Your deck' : 'Demo deck'}</dd></div>
              <div><dt>{mode.id === 'interview' ? 'Questions' : 'Timer'}</dt><dd>{mode.id === 'interview' ? config.questionCount : config.timeLimit ? `${Math.round(config.timeLimit / 60)}:00` : 'Off'}</dd></div>
              <div><dt>Camera</dt><dd>{config.camera ? 'Self-view' : 'Off'}</dd></div>
            </dl>
            <button className="btn btn-primary btn-lg btn-block" disabled={!selected.length} onClick={onStart}>
              <Icon name="mic" /> {mode.id === 'pitch' ? 'Step on stage' : mode.id === 'interview' ? 'Join the interview' : 'Enter the classroom'}
            </button>
            <p className="fine">Your browser will ask for microphone and camera access.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
