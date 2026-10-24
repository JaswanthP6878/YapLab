import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
// The app's own avatar, icon, and personas, so the intro matches the demo footage.
import Avatar from '../../frontend/src/components/Avatar.jsx';
import Icon from '../../frontend/src/components/Icon.jsx';
import { PERSONAS } from '../../frontend/src/data.js';
import { colors, fonts } from './theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0 → 1 spring that starts `delay` frames into the current sequence. */
export function useEnter(delay = 0, damping = 200): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping }, durationInFrames: 24 });
}

/** Fade and rise in as `p` goes from 0 to 1. */
export const rise = (p: number, distance = 28): CSSProperties => ({
  opacity: p,
  transform: `translateY(${(1 - p) * distance}px)`,
});

/** Linear 0 → 1 between two frames of the current sequence. */
export function useProgress(start: number, end: number): number {
  return interpolate(useCurrentFrame(), [start, end], [0, 1], clamp);
}

export const Board: React.FC<{ children: ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: colors.board, color: colors.chalk, fontFamily: fonts.body }}>
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(1400px 700px at 75% -10%, rgba(242,193,78,0.10), transparent 60%),' +
          'radial-gradient(1100px 800px at -10% 110%, rgba(127,209,174,0.07), transparent 60%)',
      }}
    />
    {children}
  </AbsoluteFill>
);

/** Fades a scene in and out at its edges. */
export const SceneFade: React.FC<{ frames: number; children: ReactNode; fadeOut?: number }> = ({ frames, children, fadeOut = 12 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, frames - fadeOut, frames], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Content area that keeps clear of the caption band at the bottom. */
export const Stage: React.FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <AbsoluteFill style={{ padding: '90px 140px 210px', ...style }}>{children}</AbsoluteFill>
);

export const Caption: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [4, 14, frames - 10, frames], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 54 }}>
      <div
        style={{
          opacity,
          maxWidth: 1480,
          padding: '14px 30px',
          borderRadius: 14,
          background: 'rgba(8, 13, 11, 0.74)',
          border: `1px solid ${colors.line2}`,
          fontSize: 32,
          lineHeight: 1.38,
          textAlign: 'center',
          color: colors.chalk,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Eyebrow: React.FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <div style={{ fontFamily: fonts.mono, fontSize: 24, letterSpacing: 3, textTransform: 'uppercase', color: colors.chalk3, ...style }}>
    {children}
  </div>
);

export const Title: React.FC<{ children: ReactNode; size?: number; style?: CSSProperties }> = ({ children, size = 84, style }) => (
  <div style={{ fontFamily: fonts.display, fontSize: size, lineHeight: 1.05, color: colors.chalk, ...style }}>{children}</div>
);

export const Accent: React.FC<{ children: ReactNode }> = ({ children }) => (
  <em style={{ fontStyle: 'italic', color: colors.marigold }}>{children}</em>
);

export type AvatarState = 'listening' | 'idle' | 'confused' | 'distracted' | 'raise_hand' | 'speaking' | 'nodding';

type Persona = { id: string; name: string; color: string; acc: string };
export const persona = (id: string): Persona => (PERSONAS as Persona[]).find((p) => p.id === id)!;

/** The live room's five listeners and their backend personas. */
export const ROOM = [
  { id: 'alex', role: 'Confused first-year' },
  { id: 'maya', role: 'Skeptical professor' },
  { id: 'ana', role: 'ESL student' },
  { id: 'sam', role: 'Distracted student' },
  { id: 'priya', role: 'Domain expert' },
] as const;

/** A listener with a gentle idle bob; `hand` shows the app's raised-hand badge. */
export const Student: React.FC<{
  id: string;
  size?: number;
  state?: AvatarState;
  hand?: number;
  seed?: number;
  bob?: boolean;
  style?: CSSProperties;
}> = ({ id, size = 140, state = 'listening', hand = 0, seed = 0, bob: bobbing = true, style }) => {
  const frame = useCurrentFrame();
  const bob = bobbing ? Math.sin((frame + seed * 17) / 16) * (size / 60) : 0;
  const lift = state === 'raise_hand' ? -size * 0.06 : 0;
  const badge = Math.max(0, Math.min(1, hand));
  return (
    <div style={{ position: 'relative', width: size, height: size, transform: `translateY(${bob + lift}px)`, ...style }}>
      <Avatar p={persona(id)} size={size} state={state} />
      {badge > 0 && (
        <div
          style={{
            position: 'absolute',
            top: -size * 0.08,
            right: -size * 0.08,
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: '50%',
            background: colors.marigold,
            color: colors.marigoldInk,
            display: 'grid',
            placeItems: 'center',
            transform: `scale(${badge}) rotate(${Math.sin(frame / 5) * 12}deg)`,
            boxShadow: `0 0 ${size * 0.25}px rgba(242,193,78,0.45)`,
          }}
        >
          <Icon name="hand" size={size * 0.22} />
        </div>
      )}
    </div>
  );
};

export const Chip: React.FC<{ children: ReactNode; tone?: 'chalk' | 'marigold' | 'mint' | 'coral'; style?: CSSProperties }> = ({
  children,
  tone = 'chalk',
  style,
}) => {
  const palette = {
    chalk: { bg: colors.board3, fg: colors.chalk2, border: colors.line2 },
    marigold: { bg: colors.marigold, fg: colors.marigoldInk, border: colors.marigold },
    mint: { bg: 'rgba(127,209,174,0.14)', fg: colors.mint, border: 'rgba(127,209,174,0.4)' },
    coral: { bg: 'rgba(240,127,100,0.14)', fg: colors.coral, border: 'rgba(240,127,100,0.45)' },
  }[tone];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 20px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        fontFamily: fonts.mono,
        fontSize: 24,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Card: React.FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: colors.board2,
      border: `1px solid ${colors.line2}`,
      borderRadius: 22,
      padding: 32,
      boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
      ...style,
    }}
  >
    {children}
  </div>
);
