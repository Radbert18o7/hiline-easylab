'use client';

import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'Inter, sans-serif',
      padding: '20px',
    }}>
      <div style={{ fontSize: '64px' }}>🏭</div>
      <h1 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '32px', fontWeight: 800, margin: 0 }}>
        404 — Page Not Found
      </h1>
      <p style={{ color: 'var(--text-muted)', margin: 0 }}>
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <button
        className="hl-btn hl-btn-primary"
        onClick={() => router.push('/dashboard')}
        style={{ marginTop: '8px' }}
      >
        ← Back to Dashboard
      </button>
    </div>
  );
}
