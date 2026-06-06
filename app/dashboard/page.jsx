'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Search, Edit2, Hand, Loader2, Check } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import Navbar from '@/components/Navbar/Navbar';
import PageLoader from '@/components/Loader/PageLoader';
import ChatPanel from '@/components/ChatPanel/ChatPanel';
import PickwaveUpload from '@/components/UploadSection/PickwaveUpload';
import LabelsUpload from '@/components/UploadSection/LabelsUpload';
import SearchResults from '@/components/SearchResults/SearchResults';
import { getFingerprint, getUserIP } from '@/lib/fingerprint';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    // Apply saved theme
    const theme = localStorage.getItem('hl-theme') || 'system';
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    initUser();
  }, []);

  async function initUser() {
    try {
      const fingerprint = await getFingerprint();
      const ip = await getUserIP();

      // Check for existing user
      const res = await fetch(`/api/users?fingerprint=${fingerprint}`);
      const { user: existingUser } = await res.json();

      if (existingUser) {
        // Update last_seen
        await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fingerprint, name: existingUser.name, ip }),
        });
        setUser({ ...existingUser, fingerprint, ip });
        setLoading(false);
        logAction('login', { ...existingUser, fingerprint, ip });
      } else {
        // New user — prompt for name
        setUser({ fingerprint, ip, name: 'Anonymous' });
        setLoading(false);
        setShowNameModal(true);
      }
    } catch (err) {
      console.error('Init user error:', err);
      setLoading(false);
    }
  }

  async function logAction(action, userCtx, metadata = {}) {
    const u = userCtx || user;
    if (!u) return;
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: u.fingerprint,
        user_name: u.name,
        ip: u.ip,
        action,
        metadata,
      }),
    });
  }

  async function saveName() {
    if (!nameInput.trim()) { toast.error('Please enter a name'); return; }
    setSavingName(true);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint: user.fingerprint,
          name: nameInput.trim(),
          ip: user.ip,
        }),
      });
      const { user: savedUser } = await res.json();
      const updated = { ...savedUser, fingerprint: user.fingerprint, ip: user.ip };
      setUser(updated);
      setShowNameModal(false);
      setNameInput('');
      toast.success(`Welcome, ${savedUser.name}! 👋`);
      logAction('name_change', updated, { new_name: savedUser.name });
    } catch {
      toast.error('Failed to save name');
    } finally {
      setSavingName(false);
    }
  }

  async function updateName() {
    if (!nameInput.trim()) { toast.error('Please enter a name'); return; }
    setSavingName(true);

    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint: user.fingerprint,
          name: nameInput.trim(),
        }),
      });
      const { user: updated } = await res.json();
      setUser(prev => ({ ...prev, name: updated.name }));
      setShowNameModal(false);
      setNameInput('');
      toast.success('Name updated!');
      logAction('name_change', { ...user, name: updated.name }, { new_name: updated.name });
    } catch {
      toast.error('Failed to update name');
    } finally {
      setSavingName(false);
    }
  }

  function handleEditName() {
    setNameInput(user?.name || '');
    setShowNameModal(true);
  }

  function handleUploadSuccess() {
    setRefreshTrigger(t => t + 1);
  }

  if (loading) {
    return <PageLoader />;
  }

  return (
    <>
      <Toaster position="top-right" />

      {/* Navbar */}
      <Navbar
        onChatToggle={() => { setChatOpen(!chatOpen); if (!chatOpen) setUnreadCount(0); }}
        unreadCount={unreadCount}
        user={user}
        onEditName={handleEditName}
      />

      {/* Main content */}
      <main className={`main-content dashboard-container ${chatOpen ? 'chat-open' : ''}`}>
        {/* Page header */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Package size={28} className="text-accent" /> Operations Dashboard
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
                Upload, process, and search warehouse documents
                {user?.name && <> · <span style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>Hi, {user.name}!</span></>}
              </p>
            </div>
          </div>
        </div>

        {/* Search Section */}
        <div className="hl-card" style={{ marginBottom: '24px' }}>
          <div className="hl-card-header">
            <div className="hl-card-icon"><Search size={24} /></div>
            <div>
              <h2 className="hl-card-title">Search Documents</h2>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Search by Pickwave ID or Order ID
              </div>
            </div>
          </div>
          <div className="hl-card-body">
            <SearchResults user={user} key={refreshTrigger} />
          </div>
        </div>

        {/* Upload Grid */}
        <div className="dashboard-grid">
          <PickwaveUpload user={user} onUploadSuccess={handleUploadSuccess} />
          <LabelsUpload user={user} onUploadSuccess={handleUploadSuccess} />
        </div>
      </main>

      {/* Chat Panel */}
      <ChatPanel
        user={user}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onUnreadChange={setUnreadCount}
      />

      {/* Name Modal */}
      <AnimatePresence>
        {showNameModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="modal-overlay" 
            id="name-modal-overlay" 
            onClick={e => { if (e.target === e.currentTarget && user?.name !== 'Anonymous') setShowNameModal(false); }}
            style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          >
            <motion.div 
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.95 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
              className="modal-box" 
              id="name-modal"
            >
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {user?.name && user.name !== 'Anonymous' ? <><Edit2 size={20} /> Edit Display Name</> : <><Hand size={20} /> Welcome! Set Your Name</>}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                This name will be shown in chat and activity logs.
              </p>
              <div className="mb-16">
                <label htmlFor="display-name-input" className="hl-label">Display Name</label>
                <input
                  id="display-name-input"
                  type="text"
                  className="hl-input"
                  placeholder="Enter your name..."
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (user?.name === 'Anonymous' ? saveName() : updateName())}
                  autoFocus
                  maxLength={50}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  id="save-name-btn"
                  className="hl-btn hl-btn-primary"
                  onClick={user?.name === 'Anonymous' ? saveName : updateName}
                  disabled={savingName || !nameInput.trim()}
                  style={{ flex: 1 }}
                >
                  {savingName ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Check size={16} /> Save Name</>}
                </button>
                {user?.name !== 'Anonymous' && (
                  <button
                    id="cancel-name-btn"
                    className="hl-btn hl-btn-secondary"
                    onClick={() => setShowNameModal(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="hl-footer">
        © 2025 HI-LINE GIFT. Developed by{' '}
        <a href="https://radbert18o7.github.io/portfolio/" target="_blank" rel="noopener noreferrer">
          Raul J — Portfolio
        </a>
      </footer>
    </>
  );
}
