'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import ThemeToggle from '@/components/ThemeToggle/ThemeToggle';
import { MessageSquare, ClipboardList, User, Edit2, LogOut } from 'lucide-react';

export default function Navbar({ onChatToggle, unreadCount, user, onEditName }) {
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  function handleLogout() {
    // Clear auth cookie via API
    fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      localStorage.removeItem('hl-auth');
      router.push('/login');
    });
  }

  // Close profile menu on outside click
  useEffect(() => {
    function handleClick(e) {
      if (!e.target.closest('.profile-menu-container')) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <nav className="hl-navbar" role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <a href="/dashboard" className="hl-logo" id="nav-logo">
        HI-LINE <span>EASY LAB</span>
      </a>

      <div className="navbar-actions">
        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Chat Toggle */}
        <button
          id="chat-toggle-btn"
          className="icon-btn"
          onClick={onChatToggle}
          title="Open team chat"
          aria-label="Toggle chat panel"
        >
          <MessageSquare size={20} />
          {unreadCount > 0 && (
            <span className="badge-count" id="chat-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </button>

        {/* Logs link */}
        <button
          id="nav-logs-btn"
          className="icon-btn"
          onClick={() => router.push('/logs')}
          title="Activity Logs"
          aria-label="View activity logs"
        >
          <ClipboardList size={20} />
        </button>

        {/* Profile */}
        <div className="profile-menu-container" style={{ position: 'relative' }}>
          <button
            id="profile-btn"
            className="icon-btn"
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            title="Profile"
            aria-label="User profile menu"
          >
            <User size={20} />
          </button>

          <AnimatePresence>
            {showProfileMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  background: 'var(--bg-modal)',
                  backdropFilter: 'blur(24px)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  boxShadow: 'var(--shadow-xl)',
                  minWidth: '220px',
                  padding: '8px',
                  zIndex: 2000,
                }}
              >
                <div style={{
                  padding: '8px 12px 12px',
                  borderBottom: '1px solid var(--border-color)',
                  marginBottom: '4px',
                }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '2px' }}>Signed in as</div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                    {user?.name || 'User'}
                  </div>
                </div>
                <button
                  id="edit-name-btn"
                  onClick={() => { setShowProfileMenu(false); onEditName(); }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'none',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'var(--transition)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <Edit2 size={16} /> Edit Display Name
                </button>
                <button
                  id="logout-btn"
                  onClick={handleLogout}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'none',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: 'var(--danger)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'var(--transition)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <LogOut size={16} /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </nav>
  );
}
