'use client';

export default function ProgressBar({ progress = 0, label = 'Processing...', show = true }) {
  if (!show) return null;

  return (
    <div className="progress-container" id="progress-bar-container">
      <div className="progress-label">
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{Math.round(progress)}%</span>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
