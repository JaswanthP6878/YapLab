const P = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3',
  cam: 'M23 7l-7 5 7 5V7z M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7z M14 4h3v16h-3z',
  stop: 'M6 6h12v12H6z',
  next: 'M9 6l6 6-6 6',
  prev: 'M15 6l-6 6 6 6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  plus: 'M12 5v14 M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12 M18 6L6 18',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 20v-1a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  podium: 'M6 10h12l-1.5 11h-9z M4 10h16 M12 10V6 M9 3h6 M12 3v3',
  chart: 'M3 3v18h18 M7 15l4-4 3 3 6-7',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z',
  volume: 'M11 5L6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14',
  volumeOff: 'M11 5L6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6',
  scale: 'M12 3v18 M6 21h12 M4 7h16 M7 7l-3 7a3 3 0 0 0 6 0z M17 7l-3 7a3 3 0 0 0 6 0z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.2L3 16 M3 21v-5h5',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11 M11 10V4a1.5 1.5 0 0 1 3 0v6 M14 10V5a1.5 1.5 0 0 1 3 0v6 M17 10.5V8a1.5 1.5 0 0 1 3 0v6c0 4.4-3.1 8-7.5 8h-.7c-2.8 0-4.6-1.3-6.3-3.4L3 14.4a1.6 1.6 0 0 1 2.4-2.1L8 14.5',
  flag: 'M4 22V4 M4 4h13l-2.5 4.5L17 13H4',
  wave: 'M2 12h2 M6 8v8 M10 4v16 M14 7v10 M18 10v4 M22 12h0',
  type: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  pen: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  settings: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
};

export default function Icon({ name, size = 18, stroke = 1.8, className = '' }) {
  const fill = name === 'play' || name === 'pause' || name === 'stop';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon ${className}`}
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name] || ''} />
    </svg>
  );
}
