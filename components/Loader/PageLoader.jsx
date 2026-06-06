'use client';

import { useEffect, useState } from 'react';

export default function PageLoader() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      id="page-loader"
      className="page-loader"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease',
      }}
    >
      <div className="loader-logo">HI-LINE EASY LAB</div>
      <div className="loader-spinner" />
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
        Initializing workspace...
      </div>
    </div>
  );
}
