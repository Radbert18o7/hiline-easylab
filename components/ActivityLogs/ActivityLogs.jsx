'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const ACTION_COLORS = {
  login: { bg: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5' },
  logout: { bg: 'rgba(107, 114, 128, 0.1)', color: '#6B7280' },
  upload_pickwave: { bg: 'rgba(16, 185, 129, 0.1)', color: '#10B981' },
  upload_labels: { bg: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B' },
  download_file: { bg: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6' },
  search: { bg: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6' },
  chat_message_sent: { bg: 'rgba(236, 72, 153, 0.1)', color: '#EC4899' },
  name_change: { bg: 'rgba(20, 184, 166, 0.1)', color: '#14B8A6' },
};

const ACTION_LABELS = {
  login: '🔑 Login',
  logout: '🚪 Logout',
  upload_pickwave: '📦 Upload Pickwave',
  upload_labels: '🏷️ Upload Labels',
  download_file: '⬇️ Download',
  search: '🔍 Search',
  chat_message_sent: '💬 Chat',
  name_change: '✏️ Name Change',
};

function SkeletonRow() {
  return (
    <tr>
      {[140, 100, 90, 110, 90, 180].map((w, i) => (
        <td key={i} style={{ padding: '12px 16px' }}>
          <div className="skeleton skeleton-text" style={{ width: w, height: 13 }} />
        </td>
      ))}
    </tr>
  );
}

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const LIMIT = 50;

  async function fetchLogs() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (actionFilter) params.append('action', actionFilter);
      if (fromDate) params.append('from', new Date(fromDate).toISOString());
      if (toDate) {
        const d = new Date(toDate);
        d.setHours(23, 59, 59);
        params.append('to', d.toISOString());
      }
      const res = await fetch(`/api/logs?${params}`);
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch {
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchLogs(); }, [page, actionFilter, fromDate, toDate]);

  function handleFilterChange() {
    setPage(1);
    fetchLogs();
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px',
        background: 'var(--bg-card)', padding: '16px', borderRadius: '12px',
        border: '1px solid var(--border-color)',
      }}>
        <div style={{ flex: '1', minWidth: '160px' }}>
          <label htmlFor="log-action-filter" className="hl-label">Action Type</label>
          <select
            id="log-action-filter"
            className="hl-select"
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Actions</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1', minWidth: '140px' }}>
          <label htmlFor="log-from-date" className="hl-label">From Date</label>
          <input
            id="log-from-date"
            type="date"
            className="hl-input"
            value={fromDate}
            onChange={e => { setFromDate(e.target.value); setPage(1); }}
          />
        </div>
        <div style={{ flex: '1', minWidth: '140px' }}>
          <label htmlFor="log-to-date" className="hl-label">To Date</label>
          <input
            id="log-to-date"
            type="date"
            className="hl-input"
            value={toDate}
            onChange={e => { setToDate(e.target.value); setPage(1); }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            id="log-clear-filters-btn"
            className="hl-btn hl-btn-secondary"
            onClick={() => { setActionFilter(''); setFromDate(''); setToDate(''); setPage(1); }}
          >
            🔄 Clear
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
        {loading ? 'Loading...' : `Showing ${logs.length} of ${total} records`}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
        <table className="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>IP</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array(8).fill(0).map((_, i) => <SkeletonRow key={i} />)}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No logs found
                </td>
              </tr>
            )}
            {!loading && logs.map((log, i) => {
              const style = ACTION_COLORS[log.action] || { bg: 'rgba(0,0,0,0.05)', color: 'var(--text-muted)' };
              return (
                <tr key={log.id || i} id={`log-row-${i}`}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>{log.user_name || '—'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {log.user_fingerprint?.slice(0, 8)}...
                    </div>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>{log.ip || '—'}</td>
                  <td>
                    <span
                      className="action-pill"
                      style={{ background: style.bg, color: style.color }}
                    >
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td style={{ maxWidth: '280px' }}>
                    {log.metadata && Object.keys(log.metadata).length > 0 ? (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {Object.entries(log.metadata).map(([k, v]) => (
                          <div key={k}><strong>{k}:</strong> {String(v).slice(0, 60)}</div>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
          <button
            id="logs-prev-btn"
            className="hl-btn hl-btn-secondary hl-btn-sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >← Prev</button>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            id="logs-next-btn"
            className="hl-btn hl-btn-secondary hl-btn-sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >Next →</button>
        </div>
      )}
    </div>
  );
}
