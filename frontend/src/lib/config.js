import { PERSONAS, modeById, variantById } from '../data.js';

export function defaultConfig(modeId = 'teaching', variantId, roster = PERSONAS, keep = {}) {
  const m = modeById(modeId);
  const v = variantById(m.id, variantId);
  return {
    mode: m.id,
    variant: v.id,
    deck: v.deck,
    checklist: v.checklist || m.checklist,
    seriousness: v.seriousness,
    agents: [...v.agents],
    // Feedback is always held for the report so nothing interrupts the session.
    feedback: 'end',
    noise: v.noise,
    questionRate: 'normal',
    timeLimit: v.timeLimit || 0,
    camera: true,
    voices: true,
    roster,
    // teaching
    topic: 'Backpropagation, explained',
    slides: null, // uploaded deck (teaching, pitch): { kind: 'pdf', name, url } | { kind: 'images', name, urls }
    // pitch
    startup: 'Front Row',
    oneLiner: 'An AI audience to rehearse teaching, pitches and interviews.',
    stage: 'Pre-seed',
    // interview
    role: 'Software Engineer Intern',
    company: 'Acme Robotics',
    jobDescription: '',
    questionCount: 3,
    ...keep,
  };
}

export function sessionTitle(c) {
  if (c.mode === 'pitch') return `${c.startup || 'Your startup'} · ${c.stage} pitch`;
  if (c.mode === 'interview') return `${c.role || 'Interview'}${c.company ? ` at ${c.company}` : ''}`;
  return c.topic || 'Untitled lesson';
}

// Fields carried over when switching variants inside the same mode.
export const carry = (c) => ({
  camera: c.camera, voices: c.voices, topic: c.topic, slides: c.slides, startup: c.startup,
  oneLiner: c.oneLiner, stage: c.stage, role: c.role, company: c.company, jobDescription: c.jobDescription,
});
