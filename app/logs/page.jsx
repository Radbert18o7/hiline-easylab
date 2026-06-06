'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';
import Navbar from '@/components/Navbar/Navbar';
import ActivityLogs from '@/components/ActivityLogs/ActivityLogs';
import ChatPanel from '@/components/ChatPanel/ChatPanel';
import { getFingerprint, getUserIP } from '@/lib/fingerprint';

export default function LogsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const theme = localStorage.getItem('hl-theme') || 'system';
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    initUser();
  }, []);

  async function initUser() {
    try {
      const fingerprint = await getFingerprint();
      const ip = await getUserIP();
      const res = await fetch(`/api/users?fingerprint=${fingerprint}`);
      const { user: u } = await res.json();
      setUser({ ...(u || {}), fingerprint, ip });
    } catch {}
  }

  return (
    <>
      <Toaster position="top-right" />
      <Navbar
        onChatToggle={() => { setChatOpen(!chatOpen); if (!chatOpen) setUnreadCount(0); }}
        unreadCount={unreadCount}
        user={user}
        onEditName={() => {}}
      />
      <main
        className="main-content"
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '0 24px 40px',
          paddingRight: chatOpen ? '376px' : undefined,
          transition: 'padding-right 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <button
              id="logs-back-btn"
              onClick={() => router.push('/dashboard')}
              className="hl-btn hl-btn-secondary hl-btn-sm"
            >
              ← Dashboard
            </button>
          </div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', margin: '12px 0 4px' }}>
            📋 Activity Logs
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
            Full audit trail of all user actions
          </p>
        </div>

        <ActivityLogs />
      </main>

      <ChatPanel
        user={user}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onUnreadChange={setUnreadCount}
      />

      <footer className="hl-footer">
        © 2025 HI-LINE GIFT. Developed by{' '}
        <a href="https://radbert18o7.github.io/portfolio/" target="_blank" rel="noopener noreferrer">
          Raul J — Portfolio
        </a>
      </footer>
    </>
  );
}
