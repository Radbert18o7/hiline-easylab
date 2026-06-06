'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast, { Toaster } from 'react-hot-toast';

const VALID_EMAIL = 'admin@hilinegift.com';
const VALID_PASSWORD = 'e&^Mb*s&s32a*#Y@&(';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    // If already authenticated, redirect to dashboard
    const auth = localStorage.getItem('hl-auth');
    if (auth === 'authenticated') {
      router.replace('/dashboard');
    }
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
  }, [router]);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }

    setLoading(true);

    // Small artificial delay for UX
    await new Promise(r => setTimeout(r, 600));

    if (email.trim().toLowerCase() === VALID_EMAIL && password === VALID_PASSWORD) {
      // Set auth cookie via API
      await fetch('/api/auth/login', { method: 'POST' });
      localStorage.setItem('hl-auth', 'authenticated');
      toast.success('Welcome back! 🎉');
      setTimeout(() => router.push('/dashboard'), 500);
    } else {
      setLoading(false);
      toast.error('Invalid email or password');
    }
  }

  return (
    <>
      <Toaster position="top-center" />
      <div className="login-page">
        <div className="login-bg-glow" />

        <div className="login-card">
          {/* Brand */}
          <div className="login-brand">
            <div className="login-logo">HI-LINE EASY LAB</div>
            <div className="login-subtitle">Warehouse Operations Platform</div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} autoComplete="off">
            <div className="mb-16">
              <label htmlFor="login-email" className="hl-label">Email Address</label>
              <input
                id="login-email"
                type="email"
                className="hl-input"
                placeholder="admin@hilinegift.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="username"
                required
              />
            </div>

            <div className="mb-20">
              <label htmlFor="login-password" className="hl-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  className="hl-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: '42px' }}
                />
                <button
                  type="button"
                  id="toggle-password-btn"
                  onClick={() => setShowPass(!showPass)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '16px',
                    color: 'var(--text-muted)',
                  }}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className="hl-btn hl-btn-primary hl-btn-lg btn-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    display: 'inline-block',
                  }} />
                  Signing in...
                </>
              ) : (
                <>🔑 Sign In</>
              )}
            </button>
          </form>

          {/* Footer */}
          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
            Authorized personnel only
          </div>
        </div>

        {/* Footer */}
        <div style={{
          position: 'absolute',
          bottom: '20px',
          textAlign: 'center',
          fontSize: '12px',
          color: 'var(--text-muted)',
        }}>
          © 2025 HI-LINE GIFT. Developed by{' '}
          <a
            href="https://radbert18o7.github.io/portfolio/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 500 }}
          >
            Raul J — Portfolio
          </a>
        </div>
      </div>
    </>
  );
}
