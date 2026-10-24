// Personas, modes and demo scripts.
// In production these come from the Python backend (agent orchestration service).
// Demo scripts are SIMULATED and labeled as such in the UI.

export const PERSONAS = [
  // ---- Teaching audience (Front Row core personas) ----
  { id: 'alex', name: 'Alex', role: 'student', trait: 'Curious beginner', color: '#F2C14E', acc: 'cap', pitch: 1.15, rate: 1.05, gain: 5,
    blurb: 'Asks simple clarification questions.',
    instructions: 'You are new to the topic. Ask short clarification questions whenever a term is not defined. Say when something finally clicks.' },
  { id: 'maya', name: 'Maya', role: 'student', trait: 'Skeptical professor', color: '#8EB8F0', acc: 'glasses', pitch: 1.0, rate: 0.95, gain: 6,
    blurb: 'Challenges unsupported claims.',
    instructions: 'You are a demanding professor. Challenge any claim that lacks evidence. Ask for counterexamples. Stay professional.' },
  { id: 'sam', name: 'Sam', role: 'student', trait: 'Distracted student', color: '#F07F64', acc: 'beanie', pitch: 0.9, rate: 1.0, gain: 3,
    blurb: 'Drifts off during repetition and long explanations.',
    instructions: 'You lose focus when the presenter repeats themselves or talks too long. Show distraction. Ask for a recap when you return.' },
  { id: 'priya', name: 'Priya', role: 'student', trait: 'Domain expert', color: '#7FD1AE', acc: 'headband', pitch: 1.1, rate: 1.1, gain: 8,
    blurb: 'Catches technical inaccuracies.',
    instructions: 'You know this field well. Politely correct technical inaccuracies and ask about edge cases.' },
  { id: 'jordan', name: 'Jordan', role: 'student', trait: 'Friendly peer', color: '#C9A3F0', acc: 'none', pitch: 1.05, rate: 1.0, gain: 6,
    blurb: 'Encourages nervous presenters.',
    instructions: 'You are supportive. Nod, encourage, and point out what worked. Ask easy questions that help the presenter recover.' },
  { id: 'ana', name: 'Ana', role: 'student', trait: 'Second-language learner', color: '#9ED8E8', acc: 'earrings', pitch: 1.2, rate: 0.9, gain: 3, optional: true,
    blurb: 'Asks you to define jargon and slow down.',
    instructions: 'English is your second language. Ask the presenter to define technical words and slow down.' },

  // ---- Pitch judges ----
  { id: 'okafor', name: 'Ada Okafor', role: 'judge', trait: 'VC partner', color: '#E8D7A8', acc: 'glasses', pitch: 0.85, rate: 1.0, gain: 4,
    blurb: 'Market size, moat, why now.',
    instructions: 'You are a seed-stage VC partner. Press on market size, moat, competition and why now.' },
  { id: 'leo', name: 'Leo Brandt', role: 'judge', trait: 'Angel investor', color: '#D9B39A', acc: 'none', pitch: 0.8, rate: 1.05, gain: 4,
    blurb: 'Former founder. Team, traction, focus.',
    instructions: 'You are a former founder turned angel. Ask about traction, the team, and what they will not build.' },
  { id: 'grace', name: 'Grace Liu', role: 'judge', trait: 'Accelerator director', color: '#B8C7A0', acc: 'bun', pitch: 1.05, rate: 1.0, gain: 5,
    blurb: 'Clarity, demo and the ask.',
    instructions: 'You run an accelerator. Ask for a clear demo moment, a crisp ask, and the next milestone.' },

  // ---- Interview panel ----
  { id: 'rachel', name: 'Rachel Kim', role: 'interviewer', trait: 'Hiring manager', color: '#F5C6A5', acc: 'bun', pitch: 1.0, rate: 1.0, gain: 4,
    blurb: 'Ownership, impact and follow-ups.',
    instructions: 'You are the hiring manager. Ask behavioral questions and follow up for specifics and measurable impact.' },
  { id: 'dev', name: 'Dev Patel', role: 'interviewer', trait: 'Senior engineer', color: '#A9C4E8', acc: 'glasses', pitch: 0.85, rate: 1.05, gain: 4,
    blurb: 'Technical depth and tradeoffs.',
    instructions: 'You are a senior engineer. Probe technical depth, tradeoffs and how decisions were verified.' },
  { id: 'nora', name: 'Nora Ellis', role: 'interviewer', trait: 'Recruiter', color: '#E3B8D6', acc: 'earrings', pitch: 1.15, rate: 1.0, gain: 5,
    blurb: 'Motivation, communication and fit.',
    instructions: 'You are a recruiter. Ask about motivation and teamwork. Note communication strengths and gaps.' },
];

export const personaById = (id, roster = PERSONAS) => roster.find((p) => p.id === id);
export const isPanel = (p) => !!p && (p.role === 'judge' || p.role === 'interviewer');

// ---------- Checklists ----------
// `kw` drives live detection from the presenter's speech; demo lines are tagged directly.
export const CHECKLISTS = {
  feynman: {
    title: 'Feynman checklist',
    items: [
      { key: 'plain', label: 'Plain words', tip: 'Explain without jargon first.', kw: [] },
      { key: 'example', label: 'Concrete example', tip: 'Give one specific case.', kw: ['for example', 'imagine', 'say you', 'like if', 'for instance'] },
      { key: 'analogy', label: 'Analogy', tip: 'Connect it to something familiar.', kw: ['think of it like', 'is like a', 'just like', 'similar to'] },
      { key: 'checkin', label: 'Check-in', tip: 'Ask if the room is following.', kw: ['make sense', 'any questions', 'following so far', 'questions so far', 'with me'] },
    ],
  },
  pitch: {
    title: 'Pitch checklist',
    items: [
      { key: 'problem', label: 'Problem', tip: 'Who hurts, and how much.', kw: ['problem', 'pain', 'struggle', 'nobody has'] },
      { key: 'solution', label: 'Solution', tip: 'What you built, in one sentence.', kw: ['we built', 'our product', 'gives you', 'solution'] },
      { key: 'market', label: 'Market', tip: 'Who pays and how many of them.', kw: ['market', 'customers', 'million', 'billion', 'who pays'] },
      { key: 'traction', label: 'Traction', tip: 'Evidence people want it.', kw: ['users', 'traction', 'pilot', 'revenue', 'tried it'] },
      { key: 'team', label: 'Team', tip: 'Why you can win.', kw: ['team', 'we are', 'background', 'founders'] },
      { key: 'ask', label: 'The ask', tip: 'How much, and what it unlocks.', kw: ['raising', 'the ask', 'investment', 'round'] },
    ],
  },
  star: {
    title: 'STAR checklist',
    perSegment: true,
    items: [
      { key: 'S', label: 'Situation', tip: 'Set the scene in one line.', kw: ['when i', 'last spring', 'last year', 'at my', 'during'] },
      { key: 'T', label: 'Task', tip: 'What you were responsible for.', kw: ['my goal', 'i needed', 'responsible', 'my task', 'i had to'] },
      { key: 'A', label: 'Action', tip: 'What you did, with "I", not "we".', kw: ['i built', 'i decided', 'i led', 'i handled', 'i wrote', 'i break'] },
      { key: 'R', label: 'Result', tip: 'A number or a lesson.', kw: ['result', 'percent', 'increased', 'reduced', 'students used', 'learned', 'now i'] },
    ],
  },
  technical: {
    title: 'Technical answer checklist',
    perSegment: true,
    items: [
      { key: 'clarify', label: 'Clarify', tip: 'Restate scope and assumptions.', kw: ['assume', 'clarify', 'requirements', 'first i'] },
      { key: 'approach', label: 'Approach', tip: 'Walk through the design.', kw: ['then', 'design', 'architecture', 'pipeline'] },
      { key: 'tradeoffs', label: 'Tradeoffs', tip: 'Name what you gave up.', kw: ['tradeoff', 'trade-off', 'cost', 'latency', 'instead of'] },
      { key: 'verify', label: 'Verify', tip: 'How you would prove it works.', kw: ['test', 'confirm', 'trace', 'measure', 'monitor'] },
    ],
  },
};

// ---------- Modes ----------
export const MODES = [
  {
    id: 'teaching', name: 'Teaching', icon: 'book', accent: 'mint',
    tagline: 'Explain it until the room gets it.',
    blurb: 'Teach a concept to AI students who ask questions, get confused, and show you exactly what landed. The Feynman technique with an audience.',
    segment: 'Slide', meter: 'Understanding', checklist: 'feynman',
    variants: [
      { id: 'study', name: 'Study group', seriousness: 20, agents: ['alex', 'jordan', 'sam'], noise: true, deck: 'backprop',
        blurb: 'Three classmates, relaxed pace, live tips.' },
      { id: 'lecture', name: 'Lecture rehearsal', seriousness: 45, agents: ['alex', 'maya', 'sam', 'priya', 'jordan'], noise: true, deck: 'backprop',
        blurb: 'A full section before the real lecture.' },
      { id: 'talk', name: 'Conference talk', seriousness: 70, agents: ['alex', 'maya', 'sam', 'priya', 'jordan', 'ana'], noise: true, deck: 'backprop',
        blurb: 'A formal audience and sharper questions.' },
    ],
  },
  {
    id: 'pitch', name: 'Pitch', icon: 'chart', accent: 'marigold',
    tagline: 'Convince the panel before the real one.',
    blurb: 'Pitch to investors and accelerator judges who take notes, cut in with hard questions, and decide whether they would invest.',
    segment: 'Slide', meter: 'Conviction', checklist: 'pitch',
    variants: [
      { id: 'practice', name: 'Peer practice', seriousness: 35, agents: ['grace', 'jordan', 'priya'], noise: false, deck: 'pitch', timeLimit: 300,
        blurb: 'A friendly run-through with one judge.' },
      { id: 'demoday', name: 'Demo day', seriousness: 75, agents: ['okafor', 'leo', 'grace'], noise: false, deck: 'pitch', timeLimit: 180,
        blurb: 'Three minutes, three judges, a scorecard.' },
      { id: 'partner', name: 'Partner meeting', seriousness: 92, agents: ['okafor', 'leo'], noise: false, deck: 'pitch', timeLimit: 600,
        blurb: 'Two investors and a long, hard Q&A.' },
    ],
  },
  {
    id: 'interview', name: 'Interview', icon: 'chat', accent: 'sky',
    tagline: 'Answer the panel with structure.',
    blurb: 'Face a hiring panel that asks behavioral and technical questions, follows up on vague answers, and gives a hire recommendation.',
    segment: 'Question', meter: 'Impression', checklist: 'star',
    variants: [
      { id: 'behavioral', name: 'Behavioral', seriousness: 60, agents: ['rachel', 'nora'], noise: false, deck: 'behavioral', checklist: 'star',
        blurb: 'Tell-me-about-a-time questions, scored on STAR.' },
      { id: 'technical', name: 'Technical', seriousness: 75, agents: ['dev', 'rachel'], noise: false, deck: 'technical', checklist: 'technical',
        blurb: 'System design, debugging and tradeoffs.' },
      { id: 'panel', name: 'Final-round panel', seriousness: 88, agents: ['rachel', 'dev', 'nora'], noise: false, deck: 'panel', checklist: 'star',
        blurb: 'Three interviewers, mixed questions, no hints.' },
    ],
  },
];

export const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];
export const variantById = (mode, vid) => modeById(mode).variants.find((v) => v.id === vid) || modeById(mode).variants[0];

export const seriousnessLabel = (v) => (v < 25 ? 'Chill' : v < 50 ? 'Focused' : v < 75 ? 'Formal' : 'High stakes');

// ---------- Demo decks (SIMULATED) ----------
// segment: { title, points, prompt?: {agent, fallback, text}, lines: [{text, tags?}], events: [{after, ...}] }
// event kinds: question (raise_hand → speaking; panel skips the hand), interrupt (speaking, no hand),
//              ack (nodding + optional text; agent '$asker' = whoever asked last), confused, distracted, note (panel)
const L = (text, ...tags) => ({ text, tags });

const BEHAVIORAL = [
  {
    title: 'Tell me about yourself', points: ['Present: who you are', 'Past: how you got here', 'Future: why this role'], freeform: true,
    prompt: { agent: 'rachel', fallback: 'panel', text: 'Thanks for coming in. To start, tell me a bit about yourself.' },
    lines: [L('Sure. I am a junior at BU studying data science.'),
      L('Um, I got into machine learning through a robotics club in high school.'),
      L('Lately I have been focused on speech models and building things people use.')],
    events: [{ after: 2, agent: 'rachel', fallback: 'panel', kind: 'question', text: 'What kind of speech models? Give me something specific.' }],
  },
  {
    title: 'A project you\'re proud of', points: ['Situation', 'Your actions', 'Measurable result'],
    prompt: { agent: 'nora', fallback: 'panel', text: 'Tell me about a project you are proud of.' },
    lines: [L('Last spring I built a tool that turns lecture recordings into searchable notes.', 'S'),
      L('I handled the transcription pipeline and, like, the search ranking myself.', 'A'),
      L('About three hundred students used it during finals week.', 'R')],
    events: [
      { after: 1, agent: 'nora', fallback: 'panel', kind: 'note', text: 'Clear ownership of the pipeline.' },
      { after: 2, agent: 'rachel', fallback: 'panel', kind: 'question', text: 'How did you know it actually helped those students?' },
    ],
  },
  {
    title: 'A time you failed', points: ['Own it', 'What changed', 'What you do now'],
    prompt: { agent: 'rachel', fallback: 'panel', text: 'Tell me about a time you failed.' },
    lines: [L('Early in that project I promised a feature I had not scoped.', 'S'),
      L('We missed the deadline by a week and I had to tell the team myself.', 'A'),
      L('Now I break work into small pieces and estimate before I commit.', 'R')],
    events: [
      { after: 1, agent: 'nora', fallback: 'panel', kind: 'question', text: 'How did the team react when you told them?' },
      { after: 2, agent: '$asker', kind: 'ack', text: 'That is a mature answer. Thank you.' },
    ],
  },
];

const TECHNICAL = [
  {
    title: 'A system you designed', points: ['Requirements', 'Components', 'Data flow'],
    prompt: { agent: 'dev', fallback: 'panel', text: 'Walk me through a system you designed end to end.' },
    lines: [L('Sure. For my notes tool, audio comes in, gets transcribed, then chunked and indexed.', 'approach'),
      L('Um, I used a queue so uploads do not block, and workers do the transcription.', 'approach'),
      L('Search runs on embeddings plus a keyword index, merged at query time.', 'approach')],
    events: [
      { after: 1, agent: 'dev', fallback: 'panel', kind: 'question', text: 'Why a queue and not just async requests? What fails without it?' },
      { after: 2, agent: '$asker', kind: 'ack', text: 'Okay. Good, you thought about load.' },
    ],
  },
  {
    title: 'Debugging a slow API', points: ['What changed?', 'Where is the time?', 'Prove the cause'],
    prompt: { agent: 'dev', fallback: 'panel', text: 'An API got slow overnight. How do you debug it?' },
    lines: [L('First I would check what changed: deploys, traffic, and data size.', 'clarify'),
      L('Then I would look at latency by endpoint and, like, find where the time goes.', 'approach'),
      L('Usually it is a missing index or a new N plus one query, so I would confirm with a trace.', 'verify')],
    events: [
      { after: 1, agent: 'rachel', fallback: 'panel', kind: 'note', text: 'Structured approach.' },
      { after: 2, agent: 'dev', fallback: 'panel', kind: 'question', text: 'Say it is a database lock. How do you prove it?' },
    ],
  },
  {
    title: 'A tradeoff you made', points: ['Options', 'What you gave up', 'How you decided'],
    prompt: { agent: 'rachel', fallback: 'panel', text: 'Tell me about a technical tradeoff you made.' },
    lines: [L('We chose a smaller transcription model to keep costs down.', 'tradeoffs'),
      L('Accuracy dropped about two points, but latency halved and, um, cost went down a lot.', 'tradeoffs'),
      L('We added a re-run button for lectures where accuracy mattered.', 'approach')],
    events: [
      { after: 1, agent: 'dev', fallback: 'panel', kind: 'question', text: 'How did you decide two points was acceptable?' },
      { after: 2, agent: '$asker', kind: 'ack', text: 'Reasonable. I like the escape hatch.' },
    ],
  },
];

export const DECKS = {
  backprop: {
    title: 'Backpropagation, explained',
    segments: [
      {
        title: 'A network that guesses wrong', points: ['Input: a photo', 'Output: "cat" (it was a dog)', 'We need a way to correct it'],
        lines: [L('Okay, so today I want to explain how a neural network actually learns.', 'plain'),
          L('Um, imagine a network that looks at a photo and says "cat" when it is a dog.', 'example'),
          L('It is wrong, and we need a way to tell it how wrong, and which knobs to turn.', 'plain')],
        events: [
          { after: 0, agent: 'alex', fallback: 'student', kind: 'question', text: 'Sorry, quick one. What is a "network" here? Like the internet?' },
          { after: 2, agent: '$asker', kind: 'ack', text: 'Oh, okay. So it is a function with knobs.' },
        ],
      },
      {
        title: 'Loss: measuring how wrong', points: ['One number for "how bad"', 'Big miss → big loss', 'Goal: push loss down'],
        lines: [L('So first we need a loss function, basically a score for how bad the guess was.', 'plain'),
          L('Like, if it says ninety percent cat and it is a dog, the loss is big.', 'example'),
          L('Lower loss always means a better network. That is the whole goal.')],
        events: [
          { after: 0, agent: 'sam', kind: 'distracted', text: '*scrolling on phone*' },
          { after: 2, agent: 'maya', fallback: 'student', kind: 'interrupt', text: 'Always? A network can memorize the training set and still be useless. What about overfitting?' },
        ],
      },
      {
        title: 'The chain rule as gears', points: ['Each layer is a gear', 'Derivative = gear ratio', 'Multiply ratios along the chain'],
        lines: [L('Fair point, lower loss on new data is what we want. Now the chain rule. Think of it like a row of gears.', 'analogy'),
          L('If you turn the last gear, how much does the first one move? You multiply the ratios.', 'analogy'),
          L('Each layer is a gear, and the derivative is the gear ratio.', 'analogy')],
        events: [
          { after: 0, agent: 'maya', kind: 'ack', text: 'Better. Held-out data. Go on.' },
          { after: 0, agent: 'jordan', kind: 'ack', text: null },
          { after: 1, agent: 'alex', fallback: 'student', kind: 'confused', hint: 'Alex looks lost at "multiply the ratios". Try numbers: gear A turns twice per turn of B, B turns three times per turn of C, so A turns six times per C.' },
          { after: 2, agent: 'priya', fallback: 'student', kind: 'question', text: 'Small correction: a derivative is a local rate of change, not a fixed ratio. Does the analogy hold for nonlinear layers?' },
        ],
      },
      {
        title: 'Walking the error backwards', points: ['Start at the output', 'Blame each weight for its share', 'Layer by layer to the input'],
        lines: [L('Good catch. The ratio changes depending on where you are, so we measure it at the current point.', 'plain'),
          L('Backprop applies the chain rule from the output back to the input, um, layer by layer.', 'plain'),
          L('That is why it is called backward propagation. The error flows backwards.')],
        events: [
          { after: 0, agent: '$asker', kind: 'ack', text: 'Right, local slope at the current point. That is correct.' },
          { after: 1, agent: 'sam', fallback: 'student', kind: 'question', text: 'Wait, I zoned out. Is this the gears thing again?' },
          { after: 2, agent: 'ana', fallback: 'student', kind: 'question', text: 'What does "propagation" mean? Can you use a simpler word?' },
        ],
      },
      {
        title: 'Nudging the weights', points: ['Step against the gradient', 'Learning rate = step size', 'Repeat thousands of times'],
        lines: [L('Finally, we nudge every weight a little in the direction that lowers the loss.', 'plain'),
          L('The size of the nudge is the learning rate. Too big and you overshoot.', 'analogy'),
          L('Repeat that thousands of times and, like, the network gets good.')],
        events: [
          { after: 1, agent: 'maya', fallback: 'student', kind: 'question', text: 'How do you choose the learning rate? Show me evidence, not intuition.' },
          { after: 2, agent: 'jordan', fallback: 'student', kind: 'interrupt', text: 'That was really clear. The gears picture stuck with me.' },
        ],
      },
    ],
  },
  pitch: {
    title: 'Front Row: seed pitch',
    segments: [
      {
        title: 'Nobody has a room to teach to', points: ['"Teach it to learn it" works', 'Study groups flake', 'Mirrors don\'t ask questions'],
        lines: [L('Every student has heard "teach it to learn it", but nobody has a room to teach to.', 'problem'),
          L('Um, office hours are packed, study groups flake, and a mirror does not ask questions.', 'problem'),
          L('So people walk into exams, pitches and interviews having never said it out loud.', 'problem')],
        events: [
          { after: 1, agent: 'okafor', fallback: 'panel', kind: 'note', text: 'Problem is clear. Evidence is anecdotal.' },
          { after: 2, agent: 'leo', fallback: 'panel', kind: 'question', text: 'How many students rehearse out loud today? Do you have a number?' },
        ],
      },
      {
        title: 'An audience of AI agents', points: ['Voices and personalities', 'They interrupt and get confused', 'Feedback on what landed'],
        lines: [L('Front Row gives you an audience of AI agents with voices and personalities.', 'solution'),
          L('They listen, interrupt, get confused and ask follow-ups, so, like, it feels like the real room.', 'solution'),
          L('Afterwards you see your pace, your filler words, and what each listener understood.', 'solution')],
        events: [
          { after: 0, agent: '$asker', kind: 'ack', text: null },
          { after: 2, agent: 'grace', fallback: 'panel', kind: 'question', text: 'Walk me through the exact moment a student gets value.' },
        ],
      },
      {
        title: 'Who pays', points: ['Courses assign sessions', 'Then pitch and interview prep', 'Students, TAs, job seekers'],
        lines: [L('We start with university courses, where a professor can assign a session as homework.', 'market'),
          L('Then pitch and interview practice, which students and job seekers already pay coaches for.', 'market'),
          L('Every course we land brings a few hundred students with it.', 'market')],
        events: [
          { after: 0, agent: '$asker', kind: 'ack', text: 'Okay, that helps.' },
          { after: 1, agent: 'okafor', fallback: 'panel', kind: 'question', text: 'Who signs the check first, the student or the university?' },
        ],
      },
      {
        title: 'Early traction', points: ['Built at Hackachusetts 2026', 'Classmates asked for more', 'Course pilots next'],
        lines: [L('We built the first version this weekend at Hackachusetts.', 'traction'),
          L('Um, classmates who tried it asked to use it again before their next exam.', 'traction'),
          L('Next we want to pilot it with two courses this spring.', 'traction')],
        events: [
          { after: 0, agent: '$asker', kind: 'ack', text: 'Fair. Universities are slow, though.' },
          { after: 1, agent: 'leo', fallback: 'panel', kind: 'note', text: 'Weekend build. Traction is early.' },
        ],
      },
      {
        title: 'Team and the ask', points: ['Data science, speech, design', 'Pre-seed round', 'Voice pipeline + pilots'],
        lines: [L('We are three builders with backgrounds in data science, speech and design.', 'team'),
          L('We are raising a small pre-seed round to build the voice pipeline and run those pilots.', 'ask'),
          L('Thank you. I would love your questions.')],
        events: [
          { after: 0, agent: 'grace', fallback: 'panel', kind: 'interrupt', text: 'How much exactly, and which milestone does it get you to?' },
          { after: 2, agent: 'okafor', fallback: 'panel', kind: 'question', text: 'What is your moat once the big labs ship a voice tutor?' },
        ],
      },
    ],
  },
  behavioral: { title: 'Behavioral round', segments: BEHAVIORAL },
  technical: { title: 'Technical round', segments: TECHNICAL },
  panel: {
    title: 'Final-round panel',
    segments: [
      BEHAVIORAL[0],
      { ...TECHNICAL[0], freeform: true },
      { ...BEHAVIORAL[2], prompt: { agent: 'nora', fallback: 'panel', text: 'Last one. Tell me about a time you failed.' } },
    ],
  },
};

// Replies used when the presenter speaks or types off-script.
export const REPLIES = {
  'Curious beginner': ['Sorry, what does that word mean?', 'Can you give me an example of that?', 'Oh wait, so how does that connect to the last part?'],
  'Skeptical professor': ['What evidence supports that?', 'What would a counterexample look like?', 'That claim is doing a lot of work. Defend it.'],
  'Distracted student': ['Sorry, can you say that again?', 'Wait, which part are we on?', 'Is this the same thing as before?'],
  'Domain expert': ['That is not quite right technically. Can you be more precise?', 'Does that still hold at the edges?', 'Which definition are you using?'],
  'Friendly peer': ['That makes sense to me. Keep going!', 'Nice, I liked that example.', 'Can you say a bit more about that part?'],
  'Second-language learner': ['Can you say it more slowly, please?', 'What is the meaning of that word?', 'Can you use a simpler word?'],
  'VC partner': ['How big is that market, in dollars?', 'Why are you the team to win this?', 'What happens when a big company copies you?'],
  'Angel investor': ['What have users actually done so far?', 'What are you choosing not to build?', 'How fast is that growing?'],
  'Accelerator director': ['What is the one milestone before demo day?', 'Can you show me that instead of telling me?', 'What exactly are you asking for?'],
  'Hiring manager': ['What was your specific role in that?', 'What was the outcome, in numbers?', 'What would you do differently?'],
  'Senior engineer': ['What was the tradeoff there?', 'How did you verify that?', 'What breaks first at ten times the load?'],
  Recruiter: ['What draws you to this role?', 'How do you handle disagreement on a team?', 'What kind of team do you do your best work in?'],
  default: ['Interesting. Can you go deeper on that?', 'Could you give an example?'],
};

export const FILLER_RE = /\b(um+|uh+|like|basically|you know)\b/gi;
