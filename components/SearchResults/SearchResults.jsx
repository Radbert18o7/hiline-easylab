'use client';

import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { Search, Package, Tag, Download, CheckCircle, File } from 'lucide-react';

function SkeletonCard() {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div className="skeleton skeleton-card" />
    </div>
  );
}

export default function SearchResults({ user }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  async function doSearch(q) {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams({
        q,
        fingerprint: user?.fingerprint || '',
        userName: user?.name || '',
        ip: user?.ip || '',
      });
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleInput(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 400);
  }

  function handleClear() {
    setQuery('');
    setResults([]);
    setSearched(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      clearTimeout(debounceRef.current);
      doSearch(query);
    }
  }

  async function handleDownload(url, type, pickwaveId) {
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: user?.fingerprint,
        user_name: user?.name,
        ip: user?.ip,
        action: 'download_file',
        metadata: { file_url: url, file_type: type, pickwave_id: pickwaveId },
      }),
    });
    window.open(url, '_blank');
  }

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* Search Bar */}
      <div className="search-container" style={{ marginBottom: '20px' }}>
        <span className="search-icon">🔍</span>
        <input
          id="search-input"
          type="text"
          className="hl-input search-input"
          placeholder="Search by Pickwave ID or Order ID..."
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          aria-label="Search documents"
        />
        {query && (
          <button className="search-clear" onClick={handleClear} id="search-clear-btn" aria-label="Clear search">
            ✕
          </button>
        )}
      </div>

      {/* Results */}
      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><Search size={32} /></div>
          <div className="empty-state-text">No results found for <strong>&ldquo;{query}&rdquo;</strong></div>
        </div>
      )}

      {!loading && results.map((result, i) => (
        <div key={i} className="result-card" id={`result-card-${i}`}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span className="result-badge badge-pickwave"><Package size={14} /> Pickwave</span>
                <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {result.pickwave_id}
                </span>
              </div>
              {result.uploaded_at && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Uploaded {new Date(result.uploaded_at).toLocaleString()}
                  {result.expires_at && (
                    <> · Expires {new Date(result.expires_at).toLocaleDateString()}</>
                  )}
                </div>
              )}
            </div>
            {result.file_url && (
              <button
                id={`download-pickwave-${i}`}
                className="hl-btn hl-btn-secondary hl-btn-sm"
                onClick={() => handleDownload(result.file_url, 'pickwave', result.pickwave_id)}
              >
                <Download size={14} /> Pickwave PDF
              </button>
            )}
          </div>

          {/* Labels section */}
          {result.labels?.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '10px',
              padding: '12px 16px',
              border: '1px solid var(--border-color)',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Tag size={14} /> Labels Documents ({result.labels.length})
              </div>
              {result.labels.map((label, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 0', borderBottom: j < result.labels.length - 1 ? '1px solid var(--border-color)' : 'none', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="result-badge badge-labels" style={{ marginRight: '6px' }}><Tag size={12} /> Labels</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(label.uploaded_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {label.processed_file_url && (
                      <button
                        id={`download-processed-result-${i}-${j}`}
                        className="hl-btn hl-btn-success hl-btn-sm"
                        onClick={() => handleDownload(label.processed_file_url, 'processed', label.pickwave_id)}
                      >
                        <CheckCircle size={14} /> Processed
                      </button>
                    )}
                    {label.original_file_url && (
                      <button
                        id={`download-original-result-${i}-${j}`}
                        className="hl-btn hl-btn-secondary hl-btn-sm"
                        onClick={() => handleDownload(label.original_file_url, 'original', label.pickwave_id)}
                      >
                        <File size={14} /> Original
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
