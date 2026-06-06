'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Default to dark mode instead of system
    const saved = localStorage.getItem('hl-theme') || 'dark';
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
  }

  function toggleTheme() {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('hl-theme', newTheme);
    applyTheme(newTheme);
  }

  // Prevent hydration mismatch by not rendering the visual state until mounted
  if (!mounted) {
    return <div style={{ width: '64px', height: '32px' }} />;
  }

  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      style={{
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        width: '64px',
        height: '32px',
        borderRadius: '20px',
        backgroundColor: isDark ? '#1F1F2E' : '#E2E8F0',
        border: '1px solid',
        borderColor: isDark ? '#3F3F5A' : '#CBD5E1',
        cursor: 'pointer',
        padding: '0',
        transition: 'background-color 0.3s ease, border-color 0.3s ease',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
      }}
      aria-label="Toggle theme"
      title={`Switch to ${isDark ? 'Light' : 'Dark'} Mode`}
    >
      {/* Track Background Icons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0 8px', pointerEvents: 'none' }}>
        <Sun size={14} color="#94A3B8" style={{ opacity: isDark ? 0.3 : 0 }} />
        <Moon size={14} color="#94A3B8" style={{ opacity: isDark ? 0 : 0.3 }} />
      </div>

      {/* The Thumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'absolute',
          left: isDark ? '34px' : '4px',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          backgroundColor: isDark ? '#2D2D3D' : '#FFFFFF',
          border: '1px solid',
          borderColor: isDark ? '#4C4C6D' : '#E2E8F0',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        {isDark ? (
          <Moon size={14} color="#A78BFA" />
        ) : (
          <Sun size={14} color="#F59E0B" />
        )}
      </div>
    </button>
  );
}
