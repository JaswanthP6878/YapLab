import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import Icon from '../../../frontend/src/components/Icon.jsx';
import {
  Accent, Card, Chip, Eyebrow, ROOM, Stage, Student, Title, persona, rise, useEnter, useProgress, type AvatarState,
} from '../components';
import { colors, fonts } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const CENTER = { x: 960, y: 450 };

/** Five seats on an ellipse around the centre, starting at the top. */
const seat = (index: number, rx: number, ry: number, spin = 0) => {
  const angle = ((-90 + index * 72 + spin) * Math.PI) / 180;
  return { x: CENTER.x + rx * Math.cos(angle), y: CENTER.y + ry * Math.sin(angle) };
};

const Placed: React.FC<{ x: number; y: number; size: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, size, children, style }) => (
  <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, ...style }}>{children}</div>
);

/** 0:40 — a swarm, not a chatbot. */
export const Swarm: React.FC = () => {
  const frame = useCurrentFrame();
  const title = useEnter(6);
  const spread = useEnter(14, 16);
  return (
    <AbsoluteFill>
      {ROOM.map(({ id }, index) => {
        const { x, y } = seat(index, 560 * spread, 270 * spread, frame * 0.3);
        return (
          <Placed key={id} x={x} y={y} size={120} style={{ opacity: spread }}>
            <Student id={id} size={120} seed={index} />
          </Placed>
        );
      })}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 180, textAlign: 'center' }}>
        <div style={rise(title)}>
          <Title size={96}>A swarm of agents,</Title>
          <Title size={96}><Accent>not a chatbot.</Accent></Title>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PERSONA_STATES: Record<string, AvatarState> = {
  alex: 'confused', maya: 'listening', ana: 'listening', sam: 'distracted', priya: 'nodding',
};

const PersonaCard: React.FC<{ id: string; role: string; index: number }> = ({ id, role, index }) => {
  const p = useEnter(12 + index * 12);
  return (
    <Card style={{ width: 296, padding: '30px 22px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', ...rise(p, 50) }}>
      <Student id={id} size={130} state={PERSONA_STATES[id]} seed={index} />
      <Title size={52} style={{ marginTop: 18 }}>{persona(id).name}</Title>
      <div style={{ fontSize: 26, color: colors.chalk2, marginTop: 6 }}>{role}</div>
    </Card>
  );
};

const MemoryChip: React.FC<{ label: string; delay: number }> = ({ label, delay }) => {
  const p = useEnter(delay);
  return <Chip tone="mint" style={rise(p, 20)}>{label}</Chip>;
};

/** 0:45 — five personas, each with memory. */
export const Personas: React.FC = () => {
  const eyebrow = useEnter(0);
  const memory = useEnter(165);
  return (
    <Stage style={{ justifyContent: 'center', alignItems: 'center' }}>
      <Eyebrow style={rise(eyebrow)}>Five listeners, five points of view</Eyebrow>
      <div style={{ display: 'flex', gap: 30, marginTop: 34 }}>
        {ROOM.map(({ id, role }, index) => <PersonaCard key={id} id={id} role={role} index={index} />)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 56 }}>
        <Eyebrow style={{ ...rise(memory), color: colors.chalk2 }}>Each one remembers</Eyebrow>
        <MemoryChip label="How I felt" delay={180} />
        <MemoryChip label="What I asked" delay={196} />
        <MemoryChip label="The talk so far" delay={212} />
      </div>
    </Stage>
  );
};

const REACTIONS: AvatarState[] = ['confused', 'nodding', 'confused', 'distracted', 'nodding'];

/** 0:58 — every tick, everyone hears the latest stretch at once. */
export const Orchestrator: React.FC = () => {
  const frame = useCurrentFrame();
  const intro = useEnter(0);
  const timer = useProgress(12, 92);
  const pulse = useProgress(92, 122);
  const snippetX = interpolate(frame, [8, 70], [140, 700], clamp);
  const snippetOpacity = interpolate(frame, [8, 20, 60, 76], [0, 1, 1, 0], clamp);
  const ringR = 150;
  const ringC = 2 * Math.PI * ringR;
  const seats = ROOM.map((_, index) => seat(index, 600, 300));
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 90, ...rise(intro) }}>
        <Eyebrow>The orchestrator</Eyebrow>
        <Chip tone="marigold" style={{ marginTop: 18 }}>every 15 s · in parallel</Chip>
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {seats.map(({ x, y }, index) => (
          <g key={index} opacity={intro}>
            <line x1={CENTER.x} y1={CENTER.y} x2={x} y2={y} stroke={colors.line2} strokeWidth={3} strokeDasharray="6 12" />
            {pulse > 0 && pulse < 1 && (
              <circle
                cx={CENTER.x + (x - CENTER.x) * pulse}
                cy={CENTER.y + (y - CENTER.y) * pulse}
                r={14}
                fill={colors.marigold}
                style={{ filter: 'drop-shadow(0 0 12px rgba(242,193,78,0.8))' }}
              />
            )}
          </g>
        ))}
        <circle cx={CENTER.x} cy={CENTER.y} r={ringR} fill={colors.board2} stroke={colors.board4} strokeWidth={10} />
        <circle
          cx={CENTER.x} cy={CENTER.y} r={ringR} fill="none" stroke={colors.marigold} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={ringC} strokeDashoffset={ringC * (1 - timer)}
          transform={`rotate(-90 ${CENTER.x} ${CENTER.y})`}
        />
      </svg>
      <Placed x={CENTER.x} y={CENTER.y} size={260} style={{ display: 'grid', placeItems: 'center', textAlign: 'center', opacity: intro }}>
        <div>
          <Title size={46}>Orchestrator</Title>
          <div style={{ fontFamily: fonts.mono, fontSize: 26, color: colors.chalk2, marginTop: 8 }}>
            {Math.min(15, Math.floor(timer * 15))} s
          </div>
        </div>
      </Placed>
      <div
        style={{
          position: 'absolute', left: snippetX, top: CENTER.y - 30, opacity: snippetOpacity,
          fontFamily: fonts.display, fontStyle: 'italic', fontSize: 40, color: colors.chalk2,
        }}
      >
        “…every layer after it.”
      </div>
      {seats.map(({ x, y }, index) => {
        const reached = frame >= 122;
        const glow = interpolate(frame, [122, 132, 175, 200], [0, 1, 1, 0.35], clamp);
        return (
          <Placed key={ROOM[index].id} x={x} y={y} size={124} style={{ opacity: intro }}>
            <div style={{ borderRadius: '50%', boxShadow: `0 0 ${50 * glow}px rgba(242,193,78,${0.55 * glow})` }}>
              <Student id={ROOM[index].id} size={124} state={reached ? REACTIONS[index] : 'listening'} seed={index} />
            </div>
          </Placed>
        );
      })}
    </AbsoluteFill>
  );
};

const QUOTE = 'passes through every layer after it';

const QuestionCard: React.FC<{
  id: string; question: string; quote: string; delay: number; verdict: 'grounded' | 'rejected'; verdictAt: number;
}> = ({ id, question, quote, delay, verdict, verdictAt }) => {
  const frame = useCurrentFrame();
  const p = useEnter(delay);
  const verdictIn = useEnter(verdictAt);
  const strike = useProgress(verdictAt, verdictAt + 16);
  const rejected = verdict === 'rejected';
  const dim = rejected ? interpolate(frame, [verdictAt + 10, verdictAt + 30], [1, 0.55], clamp) : 1;
  return (
    <Card style={{ width: 780, position: 'relative', ...rise(p, 50), opacity: p * dim }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Student id={id} size={76} state={rejected ? 'listening' : 'raise_hand'} />
        <div>
          <div style={{ fontSize: 30, fontWeight: 600 }}>{persona(id).name}</div>
          <div style={{ fontSize: 22, color: colors.chalk3 }}>{ROOM.find((r) => r.id === id)?.role}</div>
        </div>
      </div>
      <div style={{ position: 'relative', marginTop: 22 }}>
        <div style={{ fontSize: 36, lineHeight: 1.3 }}>{question}</div>
        <div style={{ fontFamily: fonts.mono, fontSize: 24, color: rejected ? colors.chalk3 : colors.marigold, marginTop: 14 }}>
          quote: “{quote}”
        </div>
        {rejected && (
          <div style={{ position: 'absolute', left: -8, right: -8, top: '50%', height: 5, borderRadius: 3, background: colors.coral, transform: `scaleX(${strike})`, transformOrigin: 'left' }} />
        )}
      </div>
      <div style={{ marginTop: 22, ...rise(verdictIn, 12) }}>
        {rejected
          ? <Chip tone="coral">Rejected · not in your talk</Chip>
          : <Chip tone="mint">Grounded · quoted from your talk</Chip>}
      </div>
    </Card>
  );
};

/** 1:05 — questions must quote the talk. */
export const Grounding: React.FC = () => {
  const intro = useEnter(0);
  const highlight = useProgress(52, 80);
  return (
    <Stage style={{ justifyContent: 'center' }}>
      <div style={rise(intro)}>
        <Eyebrow>What you said</Eyebrow>
        <div style={{ fontSize: 44, lineHeight: 1.35, marginTop: 14, maxWidth: 1600 }}>
          “The chain rule just says the effect of an early weight{' '}
          <span
            style={{
              backgroundImage: 'linear-gradient(transparent 60%, rgba(242,193,78,0.45) 60%)',
              backgroundSize: `${highlight * 100}% 100%`,
              backgroundRepeat: 'no-repeat',
            }}
          >
            {QUOTE}
          </span>
          .”
        </div>
      </div>
      <div style={{ display: 'flex', gap: 40, marginTop: 50 }}>
        <QuestionCard
          id="alex" question="Sorry, could you walk through the chain rule again?" quote={QUOTE}
          delay={30} verdict="grounded" verdictAt={86}
        />
        <QuestionCard
          id="maya" question="Why do you claim backprop is always slow?" quote="backprop is always slow"
          delay={96} verdict="rejected" verdictAt={136}
        />
      </div>
    </Stage>
  );
};

const TRACK = { left: 140, right: 1780, y: 640 };
const PLAYHEAD_END = 0.88;
const WARMUP = 0.3;
const RAISE_AT = 118;
const SAVED = [
  { id: 'maya', at: 146 },
  { id: 'priya', at: 178 },
  { id: 'ana', at: 212 },
];
const FLIGHT = 26;
const TRAY = { x: 1500, y: 230 };

const trackX = (fraction: number) => TRACK.left + (TRACK.right - TRACK.left) * fraction;

const FlyingQuestion: React.FC<{ id: string; at: number; fromX: number }> = ({ id, at, fromX }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + FLIGHT], [0, 1], clamp);
  if (frame < at || frame > at + FLIGHT) return null;
  const eased = 1 - (1 - t) ** 3;
  const x = fromX + (TRAY.x - fromX) * eased;
  const y = TRACK.y - 90 + (TRAY.y - (TRACK.y - 90)) * eased - Math.sin(Math.PI * t) * 120;
  return (
    <div style={{ position: 'absolute', left: x - 40, top: y - 40, opacity: 1 - t * 0.3 }}>
      <Student id={id} size={80} state="raise_hand" />
    </div>
  );
};

/** 1:12 — warm-up, one hand at a time, the rest saved for Q&A. */
export const Moderator: React.FC = () => {
  const frame = useCurrentFrame();
  const intro = useEnter(0);
  const play = interpolate(frame, [10, 285], [0, PLAYHEAD_END], clamp);
  const headX = trackX(play);
  const warmupEnd = trackX(WARMUP);
  const raiseX = trackX(interpolate(RAISE_AT, [10, 285], [0, PLAYHEAD_END], clamp));
  const raised = useEnter(RAISE_AT, 12);
  const callout = useEnter(RAISE_AT + 22);
  const saved = SAVED.filter((q) => frame >= q.at + FLIGHT);
  const trayIn = useEnter(20);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 90, ...rise(intro) }}>
        <Eyebrow>The moderator</Eyebrow>
        <Title size={88} style={{ marginTop: 14 }}>One hand at a <Accent>time.</Accent></Title>
      </div>

      <div style={{ position: 'absolute', left: TRAY.x - 190, top: 110, width: 420, ...rise(trayIn) }}>
        <Card style={{ padding: '26px 30px' }}>
          <Eyebrow style={{ fontSize: 20 }}>Saved for Q&amp;A</Eyebrow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 10, minHeight: 90 }}>
            <Title size={96} style={{ color: colors.marigold, minWidth: 60 }}>{saved.length}</Title>
            <div style={{ display: 'flex', gap: 8 }}>
              {saved.map((q) => <Student key={q.id} id={q.id} size={64} bob={false} />)}
            </div>
          </div>
        </Card>
      </div>

      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, opacity: intro }}>
        <rect x={TRACK.left} y={TRACK.y - 6} width={TRACK.right - TRACK.left} height={12} rx={6} fill={colors.board4} />
        <rect x={TRACK.left} y={TRACK.y - 6} width={(TRACK.right - TRACK.left) * WARMUP} height={12} rx={6} fill="rgba(127,209,174,0.25)" />
        {/* Mint while warming up, marigold once hands are allowed. */}
        <rect x={TRACK.left} y={TRACK.y - 6} width={Math.max(0, Math.min(headX, warmupEnd) - TRACK.left)} height={12} rx={6} fill={colors.mint} />
        {headX > warmupEnd && (
          <rect x={warmupEnd} y={TRACK.y - 6} width={headX - warmupEnd} height={12} rx={6} fill={colors.marigold} />
        )}
        <line x1={warmupEnd} y1={TRACK.y - 20} x2={warmupEnd} y2={TRACK.y + 20} stroke={colors.mint} strokeWidth={3} strokeDasharray="4 5" />
        <line x1={headX} y1={TRACK.y - 34} x2={headX} y2={TRACK.y + 34} stroke={colors.marigold} strokeWidth={4} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: TRACK.left, top: TRACK.y + 30, fontFamily: fonts.mono, fontSize: 24, color: colors.mint, opacity: intro }}>
        Warm-up · hands down while you introduce the topic
      </div>

      <div style={{ position: 'absolute', left: raiseX - 60, top: TRACK.y - 190, opacity: raised, transform: `translateY(${(1 - raised) * 30}px)` }}>
        <Student id="alex" size={120} state={frame >= RAISE_AT ? 'raise_hand' : 'listening'} hand={raised} />
      </div>
      <div style={{ position: 'absolute', left: raiseX + 90, top: TRACK.y - 160, ...rise(callout, 16) }}>
        <Chip tone="marigold">Call on Alex</Chip>
        <div style={{ fontFamily: fonts.mono, fontSize: 22, color: colors.chalk2, marginTop: 12 }}>
          least heard · most confused goes first
        </div>
      </div>

      {SAVED.map((q) => <FlyingQuestion key={q.id} id={q.id} at={q.at} fromX={raiseX + 40} />)}
    </AbsoluteFill>
  );
};

const BARS = 30;

/** 1:22 — voices out, transcription in, then the hand-off to the demo. */
export const Voices: React.FC = () => {
  const frame = useCurrentFrame();
  const left = useEnter(4);
  const right = useEnter(26);
  const typed = useProgress(40, 150);
  const outro = interpolate(frame, [160, 178], [1, 0], clamp);
  const live = useEnter(182);
  const line = 'So we start at the loss and walk backwards, layer by layer';
  const shown = line.slice(0, Math.floor(line.length * typed));
  return (
    <AbsoluteFill>
      <Stage style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: outro }}>
        <div style={{ width: 760, ...rise(left) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
            <Student id="alex" size={170} state="speaking" />
            <svg width={480} height={160}>
              {Array.from({ length: BARS }, (_, i) => {
                const h = 18 + Math.abs(Math.sin(frame / 4 + i * 0.7) * Math.cos(frame / 9 + i * 0.3)) * 130;
                return <rect key={i} x={i * 16} y={80 - h / 2} width={9} height={h} rx={4.5} fill={colors.marigold} opacity={0.4 + 0.6 * (i / BARS)} />;
              })}
            </svg>
          </div>
          <Title size={56} style={{ marginTop: 36 }}>Students speak in <Accent>their own voices.</Accent></Title>
          <Chip style={{ marginTop: 22 }}>ElevenLabs text-to-speech</Chip>
        </div>
        <div style={{ width: 760, ...rise(right) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            <div style={{ width: 120, height: 120, borderRadius: '50%', background: colors.board3, border: `2px solid ${colors.line2}`, display: 'grid', placeItems: 'center', color: colors.mint, flex: 'none' }}>
              <Icon name="mic" size={56} />
            </div>
            <Card style={{ padding: '22px 26px', flex: 1, minHeight: 120 }}>
              <div style={{ fontSize: 32, lineHeight: 1.35 }}>
                {shown}
                <span style={{ opacity: Math.floor(frame / 12) % 2 ? 0 : 1, color: colors.mint }}>▍</span>
              </div>
            </Card>
          </div>
          <Title size={56} style={{ marginTop: 36 }}>Your speech, <Accent>transcribed live</Accent> in the browser.</Title>
          <Chip tone="mint" style={{ marginTop: 22 }}>ElevenLabs Scribe · keys stay on our server</Chip>
        </div>
      </Stage>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 140 }}>
        <div style={rise(live, 30)}>
          <Title size={120}>Let’s see it <Accent>live →</Accent></Title>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
