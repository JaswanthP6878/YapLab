import { Board, ROOM, Student, Title } from './components';
import { colors } from './theme';

/** The app's logo mark (same paths as the header in frontend/src/App.jsx). */
export const LogoMark: React.FC<{ size: number }> = ({ size }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <rect x="3" y="3" width="26" height="15" rx="2.5" fill="none" stroke={colors.chalk} strokeWidth="2" />
    <path d="M8 9h9M8 13h14" stroke={colors.marigold} strokeWidth="2" strokeLinecap="round" />
    <circle cx="8" cy="25" r="3" fill={colors.mint} />
    <circle cx="16" cy="25" r="3" fill={colors.marigold} />
    <circle cx="24" cy="25" r="3" fill={colors.sky} />
  </svg>
);

const BANNER_STATES = ['raise_hand', 'listening', 'confused', 'distracted', 'nodding'] as const;

/** README banner: logo, wordmark, tagline, and the room. Rendered as a still. */
export const Banner: React.FC = () => (
  <Board>
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 110px',
        borderBottom: `6px solid ${colors.marigold}`,
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
          <LogoMark size={150} />
          <Title size={170} style={{ letterSpacing: -2 }}>
            Yap<span style={{ color: colors.marigold }}>Lab</span>
          </Title>
        </div>
        <Title size={54} style={{ color: colors.chalk2, marginTop: 18 }}>
          Rehearse in front of a room that <em style={{ color: colors.marigold }}>talks back.</em>
        </Title>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        {[ROOM.slice(0, 3), ROOM.slice(3)].map((row, r) => (
          <div key={r} style={{ display: 'flex', gap: 28 }}>
            {row.map(({ id }) => {
              const index = ROOM.findIndex((seat) => seat.id === id);
              return <Student key={id} id={id} size={120} state={BANNER_STATES[index]} hand={index === 0 ? 1 : 0} bob={false} />;
            })}
          </div>
        ))}
      </div>
    </div>
  </Board>
);
