const INK = '#14201C';

function Accessory({ type, color, layer }) {
  const shade = 'rgba(20,32,28,.38)';
  if (layer === 'back') {
    if (type === 'bun') return <g><circle cx="32" cy="10" r="7.5" fill={color} /><circle cx="32" cy="10" r="7.5" fill={shade} /></g>;
    return null;
  }
  switch (type) {
    case 'glasses':
      return (
        <g fill="none" stroke={INK} strokeWidth="1.8">
          <circle cx="24" cy="32" r="5.6" /><circle cx="40" cy="32" r="5.6" /><path d="M29.6 32h4.8" />
        </g>
      );
    case 'beanie':
      return (
        <g>
          <path d="M8.5 28a23.5 22 0 0 1 47 0z" fill="#2E5A4E" />
          <rect x="7.5" y="24.5" width="49" height="6" rx="3" fill="#3C7263" />
          <circle cx="32" cy="7.5" r="3.5" fill="#3C7263" />
        </g>
      );
    case 'cap':
      return (
        <g>
          <path d="M9.5 25a22.5 18 0 0 1 45 0z" fill="#2C4A7A" />
          <path d="M33 22h24a3 3 0 0 1 0 6H33z" fill="#3A5E96" />
        </g>
      );
    case 'headband':
      return <path d="M11 22.5c13-9 29-9 42 0" fill="none" stroke="#F2C14E" strokeWidth="4.5" strokeLinecap="round" />;
    case 'earrings':
      return <g fill="#F2C14E"><circle cx="8.6" cy="41" r="2.3" /><circle cx="55.4" cy="41" r="2.3" /></g>;
    default:
      return null;
  }
}

function Face({ state }) {
  const eyes = {
    distracted: <g fill={INK}><rect x="23" y="31.5" width="6" height="2" rx="1" /><rect x="39" y="31.5" width="6" height="2" rx="1" /></g>,
    nodding: <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round"><path d="M21 33q3-4 6 0" /><path d="M37 33q3-4 6 0" /></g>,
    idle: <g fill={INK}><ellipse cx="24" cy="32.5" rx="2.4" ry="2.6" /><ellipse cx="40" cy="32.5" rx="2.4" ry="2.6" /></g>,
  }[state] || (
    <g className="av-eyes" fill={INK}>
      <ellipse cx="24" cy="32" rx="2.6" ry="3.2" />
      <ellipse cx="40" cy="32" rx="2.6" ry="3.2" />
    </g>
  );
  const brows = state === 'confused'
    ? <g stroke={INK} strokeWidth="2" strokeLinecap="round"><path d="M19 24.5l8 1.5" /><path d="M37 23l7-2.5" /></g>
    : state === 'raise_hand' || state === 'speaking'
      ? <g stroke={INK} strokeWidth="2" strokeLinecap="round"><path d="M20 23.5q4-2 7 0" /><path d="M37 23.5q4-2 7 0" /></g>
      : null;
  const mouth = {
    speaking: <ellipse className="av-mouth-talk" cx="32" cy="45" rx="4" ry="3" fill={INK} />,
    confused: <path d="M26 46.5q3-2.5 6 0t6 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />,
    distracted: <path d="M28.5 45.5h9" stroke={INK} strokeWidth="2" strokeLinecap="round" />,
    raise_hand: <path d="M26 43q6 5.5 12 0z" fill={INK} />,
    nodding: <path d="M25.5 42.5q6.5 6.5 13 0" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />,
    idle: <path d="M28 45h8" stroke={INK} strokeWidth="2" strokeLinecap="round" />,
  }[state] || <path d="M27 44q5 3.5 10 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />;
  return (
    <g>
      {brows}
      {eyes}
      <circle cx="18.5" cy="40.5" r="3" fill="rgba(240,127,100,.35)" />
      <circle cx="45.5" cy="40.5" r="3" fill="rgba(240,127,100,.35)" />
      {mouth}
    </g>
  );
}

export default function Avatar({ p, size = 64, state = 'listening', delay = 0, className = '' }) {
  if (!p) return null;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`avatar av-${state} ${className}`}
      style={{ '--blink-delay': `${delay}s` }}
      role="img"
      aria-label={`${p.name}, ${state}`}
    >
      <g className="av-head">
      <Accessory type={p.acc} color={p.color} layer="back" />
      <circle cx="32" cy="34" r="24" fill={p.color} />
      <Accessory type={p.acc} color={p.color} layer="front" />
      <Face state={state} />
      </g>
    </svg>
  );
}
