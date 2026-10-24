import { useMemo, useState } from 'react';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Session from './screens/Session.jsx';
import Report from './screens/Report.jsx';
import InterviewComingSoon from './screens/InterviewComingSoon.jsx';
import { PERSONAS } from './data.js';
import { defaultConfig } from './lib/config.js';
import { simulateFull } from './lib/engine.js';
import { isDemo } from './lib/api.js';

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect x="3" y="3" width="26" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 9h9M8 13h14" stroke="#F2C14E" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="25" r="3" fill="#7FD1AE" />
      <circle cx="16" cy="25" r="3" fill="#F2C14E" />
      <circle cx="24" cy="25" r="3" fill="#8EB8F0" />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState('home');
  const [roster, setRoster] = useState(PERSONAS);
  const [config, setConfig] = useState(() => defaultConfig('teaching'));
  const [result, setResult] = useState(null);

  const go = (v) => {
    setView(v);
    try { window.scrollTo({ top: 0 }); } catch { /* noop */ }
  };

  const openSetup = (mode, variant) => {
    setConfig(defaultConfig(mode || config.mode, variant, roster));
    go('setup');
  };

  const sampleReport = (mode = 'teaching') => {
    if (mode === 'interview') {
      openSetup('interview');
      return;
    }
    const variant = { teaching: 'lecture', pitch: 'demoday', interview: 'behavioral' }[mode];
    setResult(simulateFull(defaultConfig(mode, variant, roster)));
    go('report');
  };

  const nav = useMemo(() => [
    { id: 'home', label: 'Modes' },
    { id: 'setup', label: 'New session' },
    { id: 'report', label: 'Last report', disabled: !result },
  ], [result]);

  return (
    <div className={`app view-${view}`}>
      {view !== 'session' && (
        <header className="topbar">
          <div className="topbar-in">
            <button className="brand" onClick={() => go('home')}>
              <Logo />
              <span>Front Row</span>
            </button>
            <nav className="nav">
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={`nav-link ${view === n.id ? 'on' : ''}`}
                  disabled={n.disabled}
                  onClick={() => (n.id === 'setup' ? openSetup(config.mode, config.variant) : go(n.id))}
                >
                  {n.label}
                </button>
              ))}
            </nav>
            <span className={`mode-chip ${isDemo ? 'demo' : 'live'}`} title={isDemo ? 'Agent behavior is simulated by the built-in demo engine. Set VITE_API_URL to connect the backend.' : 'Connected to backend'}>
              <i />{isDemo ? 'Simulated agents' : 'Backend live'}
            </span>
          </div>
        </header>
      )}

      {view === 'home' && <Home onStart={openSetup} onSample={sampleReport} roster={roster} />}
      {view === 'setup' && config.mode === 'interview' && (
        <InterviewComingSoon onBack={() => go('home')} />
      )}
      {view === 'setup' && config.mode !== 'interview' && (
        <Setup
          config={config}
          setConfig={setConfig}
          roster={roster}
          setRoster={(r) => { setRoster(r); setConfig((c) => ({ ...c, roster: r })); }}
          onStart={() => go('session')}
          onBack={() => go('home')}
        />
      )}
      {view === 'session' && (
        <Session
          config={config}
          onExit={() => go('setup')}
          onEnd={(r) => { setResult(r); go('report'); }}
        />
      )}
      {view === 'report' && result && (
        <Report
          result={result}
          onAgain={() => { setConfig(result.config); go('session'); }}
          onNew={() => { setConfig(result.config); go('setup'); }}
          onHome={() => go('home')}
        />
      )}
    </div>
  );
}
