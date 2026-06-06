'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    const saved = localStorage.getItem('hl-theme') || 'system';
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (t === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      // System
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }
  }

  function handleTheme(t) {
    setTheme(t);
    localStorage.setItem('hl-theme', t);
    applyTheme(t);
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Theme selection">
      <button
        id="theme-btn-light"
        className={`theme-btn${theme === 'light' ? ' active' : ''}`}
        onClick={() => handleTheme('light')}
        title="Light mode"
      >
        ☀️ Light
      </button>
      <button
        id="theme-btn-dark"
        className={`theme-btn${theme === 'dark' ? ' active' : ''}`}
        onClick={() => handleTheme('dark')}
        title="Dark mode"
      >
        🌙 Dark
      </button>
      <button
        id="theme-btn-system"
        className={`theme-btn${theme === 'system' ? ' active' : ''}`}
        onClick={() => handleTheme('system')}
        title="System default"
      >
        💻 Auto
      </button>
    </div>
  );
}
