'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { Tag, Upload, FileText, X, Loader2, RefreshCw, Search } from 'lucide-react';
import ProgressBar from '@/components/ProgressBar/ProgressBar';

export default function LabelsUpload({ user, onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [selectedPickwaveId, setSelectedPickwaveId] = useState('');
  const [pickwaveList, setPickwaveList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Processing...');
  const [result, setResult] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch available pickwave IDs
  async function fetchPickwaveList() {
    setLoadingList(true);
    try {
      const res = await fetch('/api/upload/pickwave');
      const data = await res.json();
      setPickwaveList(data.documents || []);
    } catch {
      toast.error('Could not load pickwave list');
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    fetchPickwaveList();
  }, []);

  const onDrop = useCallback((acceptedFiles) => {
    const f = acceptedFiles[0];
    if (!f) return;
    if (f.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      return;
    }
    setFile(f);
    setResult(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    multiple: false,
  });

  function removeFile() {
    setFile(null);
    setResult(null);
  }

  async function handleProcess() {
    if (!file) { toast.error('Please select a labels PDF'); return; }
    if (!selectedPickwaveId) { toast.error('Please select a Pickwave ID'); return; }

    setLoading(true);
    setResult(null);
    setProgress(5);
    setProgressLabel('Uploading labels file...');

    try {
      const formData = new FormData();
      formData.append('labelsFile', file);
      formData.append('pickwaveId', selectedPickwaveId);
      formData.append('fingerprint', user?.fingerprint || '');
      formData.append('userName', user?.name || 'Anonymous');
      formData.append('ip', user?.ip || '');

      // Simulate progress stages
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev < 30) { setProgressLabel('Running OCR on pickwave document...'); return prev + 2; }
          if (prev < 55) { setProgressLabel('Processing label pages...'); return prev + 1; }
          if (prev < 75) { setProgressLabel('Matching SKUs to labels...'); return prev + 0.5; }
          if (prev < 88) { setProgressLabel('Overlaying SKU text on labels...'); return prev + 0.3; }
          if (prev < 99) { setProgressLabel('Finalizing document...'); return prev + 0.1; }
          return prev;
        });
      }, 300);

      const res = await fetch('/api/process-labels', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(95);
      setProgressLabel('Saving processed file...');

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Processing failed');
      }

      setProgress(100);
      setProgressLabel('Done!');
      setResult(data);
      toast.success(`Labels processed! ${data.matchedCount}/${data.totalPages} pages matched`);
      onUploadSuccess?.();

      // Log download action when user downloads
    } catch (err) {
      toast.error(`Processing failed: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => { setProgress(0); setProgressLabel('Processing...'); }, 2000);
    }
  }

  async function handleDownload(url, type) {
    // Log download action
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: user?.fingerprint,
        user_name: user?.name,
        ip: user?.ip,
        action: 'download_file',
        metadata: { file_url: url, file_type: type, pickwave_id: selectedPickwaveId },
      }),
    });
    window.open(url, '_blank');
  }

  return (
    <div className="hl-card">
      <div className="hl-card-header">
        <div className="hl-card-icon"><Tag size={24} /></div>
        <div>
          <h2 className="hl-card-title">Upload Print Labels</h2>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Section B — PDF labels for SKU overlay processing
          </div>
        </div>
      </div>

      <div className="hl-card-body">
        {/* Pickwave selector */}
        <div style={{ marginBottom: '16px', position: 'relative' }} ref={dropdownRef}>
          <label htmlFor="labels-pickwave-select" className="hl-label">Select Pickwave ID</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div className="search-container" style={{ flex: 1, position: 'relative' }}>
              <Search className="search-icon" size={16} />
              <input
                id="labels-pickwave-select"
                type="text"
                className="hl-input search-input"
                placeholder="Search or Select a Pickwave ID..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setIsDropdownOpen(true);
                  if (e.target.value !== selectedPickwaveId) setSelectedPickwaveId('');
                }}
                onFocus={() => setIsDropdownOpen(true)}
                disabled={loading}
              />
              {searchTerm && (
                <button
                  className="search-clear"
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedPickwaveId('');
                    setIsDropdownOpen(true);
                  }}
                  disabled={loading}
                >
                  <X size={14} />
                </button>
              )}
              {isDropdownOpen && !loading && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
                  background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                  borderRadius: '12px', boxShadow: 'var(--shadow-md)', zIndex: 50,
                  maxHeight: '200px', overflowY: 'auto'
                }}>
                  {pickwaveList.filter(pw => pw.pickwave_id.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                    <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No matches found
                    </div>
                  ) : (
                    pickwaveList
                      .filter(pw => pw.pickwave_id.toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(pw => (
                        <div
                          key={pw.id}
                          onClick={() => {
                            setSelectedPickwaveId(pw.pickwave_id);
                            setSearchTerm(pw.pickwave_id);
                            setIsDropdownOpen(false);
                          }}
                          style={{
                            padding: '10px 16px', cursor: 'pointer', fontSize: '14px',
                            borderBottom: '1px solid var(--border-color)',
                            backgroundColor: selectedPickwaveId === pw.pickwave_id ? 'var(--bg-secondary)' : 'transparent',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedPickwaveId === pw.pickwave_id ? 'var(--bg-secondary)' : 'transparent'}
                        >
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pw.pickwave_id}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Uploaded: {new Date(pw.uploaded_at).toLocaleDateString()}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
            <button
              id="refresh-pickwave-list-btn"
              className="hl-btn hl-btn-secondary"
              onClick={fetchPickwaveList}
              disabled={loadingList}
              title="Refresh list"
              style={{ flexShrink: 0 }}
            >
              <RefreshCw size={16} className={loadingList ? 'animate-spin' : ''} />
            </button>
          </div>
          {pickwaveList.length === 0 && !loadingList && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
              No pickwave documents found. Upload one first.
            </div>
          )}
        </div>

        {/* Dropzone */}
        {!file ? (
          <motion.div
            {...getRootProps()}
            className={`upload-zone ${isDragActive ? 'drag-active' : ''}`}
            id="labels-dropzone"
            whileHover={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.05)' }}
            whileTap={{ scale: 0.98 }}
            animate={isDragActive ? { scale: 1.05, borderColor: 'var(--accent-primary)', backgroundColor: 'var(--accent-glow)' } : {}}
          >
            <input {...getInputProps()} id="labels-file-input" />
            <span className="upload-zone-icon"><Upload size={24} /></span>
            <p className="upload-zone-text">
              <strong>Drop labels PDF here</strong> or click to browse
            </p>
            <p className="upload-zone-text" style={{ marginTop: '4px', fontSize: '12px' }}>
              Will be OCR-processed and SKU IDs overlaid
            </p>
          </motion.div>
        ) : (
          <div className="file-info" id="labels-file-info">
            <span className="file-icon"><FileText size={20} /></span>
            <span className="file-name">{file.name}</span>
            <span className="file-size">{(file.size / 1024).toFixed(0)} KB</span>
            <button
              id="remove-labels-file-btn"
              onClick={removeFile}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--danger)', fontSize: '14px', padding: '4px', flexShrink: 0,
              }}
              title="Remove file"
            ><X size={16} /></button>
          </div>
        )}

        {/* Progress */}
        {loading && (
          <ProgressBar progress={progress} label={progressLabel} show={loading} />
        )}

        {/* Submit */}
        <motion.button
          id="process-labels-btn"
          className="hl-btn hl-btn-primary btn-full"
          onClick={handleProcess}
          disabled={loading || !file || !selectedPickwaveId}
          style={{ marginTop: '16px' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.95 }}
        >
          {loading ? <><Loader2 size={16} className="animate-spin" /> Processing...</> : <><Upload size={16} /> Process Labels</>}
        </motion.button>

        {/* Result */}
        {result && !loading && (
          <div style={{
            marginTop: '20px',
            padding: '16px',
            background: 'var(--success-bg)',
            borderRadius: '12px',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            animation: 'slide-up 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>✅</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--success)', fontSize: '14px' }}>
                  Processing Complete!
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {result.totalPages > result.originalPages ? (
                    `${result.matchedCount} of ${result.originalPages} labels matched (${result.totalPages - result.originalPages} missing labels dynamically added)`
                  ) : (
                    `${result.matchedCount} of ${result.totalPages} pages matched with SKUs`
                  )}
                  {result.unmatchedNames && result.unmatchedNames.length > 0 && (
                    <div style={{ marginTop: '8px', color: 'var(--danger, #ef4444)' }}>
                      <strong>Failed to match:</strong> {result.unmatchedNames.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                id="download-processed-btn"
                className="hl-btn hl-btn-success hl-btn-sm"
                onClick={() => handleDownload(result.processedFileUrl, 'processed')}
              >
                ⬇️ Download Processed Labels
              </button>
              <button
                id="download-original-btn"
                className="hl-btn hl-btn-secondary hl-btn-sm"
                onClick={() => handleDownload(result.originalFileUrl, 'original')}
              >
                📄 Download Original
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
