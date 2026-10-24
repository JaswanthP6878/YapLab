// Scene order, length, and voice-over captions for Parts 1-2 of the video.
// Keep in sync with docs/demo-video-script.md.

export const FPS = 30;

export type SceneId =
  | 'Alone' | 'Wall' | 'Brand' | 'ForWho'
  | 'Swarm' | 'Personas' | 'Orchestrator' | 'Grounding' | 'Moderator' | 'Voices';

type SceneSpec = { id: SceneId; part: 'Purpose' | 'Design'; seconds: number; caption: string };

const SPECS: SceneSpec[] = [
  { id: 'Alone', part: 'Purpose', seconds: 6,
    caption: 'Most students rehearse presentations alone, talking to a wall.' },
  { id: 'Wall', part: 'Purpose', seconds: 9,
    caption: "A wall doesn't get confused. It doesn't drift off when you ramble, and it never asks the question your professor will." },
  { id: 'Brand', part: 'Purpose', seconds: 12,
    caption: 'YapLab gives every student a room that talks back: a classroom of AI students who listen, react, raise their hands, and question you out loud.' },
  { id: 'ForWho', part: 'Purpose', seconds: 13,
    caption: "It's built for students without a study group, students practicing in a second language, or anyone without time for office hours. Practice whenever you want, with no judgment." },
  { id: 'Swarm', part: 'Design', seconds: 5,
    caption: 'Under the hood, YapLab is a swarm of agents, not a single chatbot.' },
  { id: 'Personas', part: 'Design', seconds: 13,
    caption: 'Five listeners with their own personas, from a confused first-year to a skeptical professor. Each one remembers how it felt, what it asked, and the talk so far.' },
  { id: 'Orchestrator', part: 'Design', seconds: 7,
    caption: 'Every fifteen seconds, the orchestrator sends what you just said to all of them at once.' },
  { id: 'Grounding', part: 'Design', seconds: 7,
    caption: "Every question must quote something you actually said or showed, or it's thrown out." },
  { id: 'Moderator', part: 'Design', seconds: 10,
    caption: 'A moderator keeps it a real class: no interrupting your intro, one hand at a time, the quietest confused student first, and the rest saved for Q&A.' },
  { id: 'Voices', part: 'Design', seconds: 8,
    caption: 'Students speak in their own ElevenLabs voices, and your speech is transcribed live in the browser.' },
];

export type Scene = SceneSpec & { from: number; frames: number };

export const SCENES: Scene[] = SPECS.reduce<Scene[]>((list, spec) => {
  const from = list.length ? list[list.length - 1].from + list[list.length - 1].frames : 0;
  return [...list, { ...spec, from, frames: Math.round(spec.seconds * FPS) }];
}, []);

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.frames, 0);
