import { useCurrentFrame } from 'remotion';
import { Accent, Card, Eyebrow, ROOM, Stage, Student, Title, persona, rise, useEnter, useProgress, type AvatarState } from '../components';
import { colors, fonts } from '../theme';

/** 0:00 — a student rehearsing to a blank wall. */
export const Alone: React.FC = () => {
  const title = useEnter(8);
  const student = useEnter(0);
  const speech = useProgress(36, 110);
  return (
    <Stage style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={rise(title)}>
        <Title size={104}>Most students rehearse <Accent>alone.</Accent></Title>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 90 }}>
        <div style={rise(student)}>
          <Student id="alex" size={150} state="idle" />
        </div>
        <svg width={900} height={60} style={{ margin: '0 24px' }}>
          <line
            x1={0} y1={30} x2={Math.max(1, 880 * speech)} y2={30}
            stroke={colors.chalk3} strokeWidth={4} strokeDasharray="14 16" strokeLinecap="round"
          />
        </svg>
        <div
          style={{
            width: 260,
            height: 300,
            borderRadius: 12,
            border: `3px dashed ${colors.line2}`,
            background: colors.board2,
            display: 'grid',
            placeItems: 'center',
            ...rise(student),
          }}
        >
          <span style={{ fontFamily: fonts.hand, fontSize: 46, color: colors.chalk3 }}>the wall</span>
        </div>
      </div>
    </Stage>
  );
};

const WallLine: React.FC<{ text: string; delay: number; accent?: boolean }> = ({ text, delay, accent }) => {
  const p = useEnter(delay);
  return (
    <div style={rise(p, 40)}>
      <Title size={128} style={accent ? { color: colors.marigold, fontStyle: 'italic' } : undefined}>{text}</Title>
    </div>
  );
};

/** 0:06 — what a wall can't do. */
export const Wall: React.FC = () => (
  <Stage style={{ justifyContent: 'center', gap: 18 }}>
    <WallLine text="No audience." delay={10} />
    <WallLine text="No questions." delay={48} />
    <WallLine text="No idea what landed." delay={86} accent />
  </Stage>
);

const BrandSeat: React.FC<{ id: string; index: number }> = ({ id, index }) => {
  const frame = useCurrentFrame();
  const p = useEnter(84 + index * 9, 12);
  const hand = useEnter(214, 12);
  let state: AvatarState = 'listening';
  if (id === 'alex' && frame >= 210) state = 'raise_hand';
  if (id === 'sam' && frame >= 170) state = 'distracted';
  if (id === 'ana' && frame >= 240) state = 'confused';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, opacity: p, transform: `scale(${0.6 + 0.4 * p})` }}>
      <Student id={id} size={150} state={state} hand={id === 'alex' ? hand : 0} seed={index} />
      <span style={{ fontFamily: fonts.hand, fontSize: 44, color: colors.chalk2 }}>{persona(id).name}</span>
    </div>
  );
};

/** 0:15 — the product: a room that talks back. */
export const Brand: React.FC = () => {
  const mark = useEnter(4, 14);
  const tag = useEnter(36);
  return (
    <Stage style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ opacity: mark, transform: `scale(${0.85 + 0.15 * mark})` }}>
        <Title size={230} style={{ letterSpacing: -2 }}>
          Yap<span style={{ color: colors.marigold }}>Lab</span>
        </Title>
      </div>
      <div style={{ ...rise(tag), marginTop: 6 }}>
        <Title size={64} style={{ color: colors.chalk2 }}>
          Rehearse in front of a room that <Accent>talks back.</Accent>
        </Title>
      </div>
      <div style={{ display: 'flex', gap: 64, marginTop: 70 }}>
        {ROOM.map((seat, index) => <BrandSeat key={seat.id} id={seat.id} index={index} />)}
      </div>
    </Stage>
  );
};

const AUDIENCES = [
  { title: 'No study group', sub: 'An audience whenever you need one.' },
  { title: 'Practicing in a second language', sub: 'A room that asks you to define your terms.' },
  { title: 'No time for office hours', sub: 'Rehearse at 2 a.m. No appointment.' },
];

const AudienceCard: React.FC<{ title: string; sub: string; delay: number; index: number }> = ({ title, sub, delay, index }) => {
  const p = useEnter(delay);
  return (
    <Card style={{ width: 500, minHeight: 300, ...rise(p, 50) }}>
      <div style={{ fontFamily: fonts.hand, fontSize: 52, color: colors.marigold }}>0{index + 1}</div>
      <Title size={54} style={{ marginTop: 10 }}>{title}</Title>
      <div style={{ fontSize: 30, color: colors.chalk2, marginTop: 18, lineHeight: 1.35 }}>{sub}</div>
    </Card>
  );
};

/** 0:27 — who it's for. */
export const ForWho: React.FC = () => {
  const eyebrow = useEnter(0);
  const closing = useEnter(230);
  return (
    <Stage style={{ justifyContent: 'center' }}>
      <Eyebrow style={rise(eyebrow)}>Built for every student</Eyebrow>
      <div style={{ display: 'flex', gap: 40, marginTop: 34 }}>
        {AUDIENCES.map((audience, index) => (
          <AudienceCard key={audience.title} {...audience} index={index} delay={22 + index * 28} />
        ))}
      </div>
      <div style={{ ...rise(closing), marginTop: 60 }}>
        <Title size={80}>Practice anytime. <Accent>No judgment.</Accent></Title>
      </div>
    </Stage>
  );
};
