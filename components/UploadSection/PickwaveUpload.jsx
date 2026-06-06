'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { Package, FileText, X, Upload, Loader2 } from 'lucide-react';
import ProgressBar from '@/components/ProgressBar/ProgressBar';

export default function PickwaveUpload({ user, onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [pickwaveId, setPickwaveId] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const onDrop = useCallback((acceptedFiles) => {
    const f = acceptedFiles[0];
    if (!f) return;
    if (f.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      return;
    }
    setFile(f);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    multiple: false,
  });

  function removeFile() {
    setFile(null);
  }

  async function handleUpload() {
    if (!file) { toast.error('Please select a PDF file'); return; }
    if (!pickwaveId.trim()) { toast.error('Please enter a Pickwave ID'); return; }

    setLoading(true);
    setProgress(10);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('pickwaveId', pickwaveId.trim().toUpperCase());
      formData.append('fingerprint', user?.fingerprint || '');
      formData.append('userName', user?.name || 'Anonymous');
      formData.append('ip', user?.ip || '');

      setProgress(30);
      const res = await fetch('/api/upload/pickwave', {
        method: 'POST',
        body: formData,
      });

      setProgress(80);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setProgress(100);
      toast.success(`Pickwave "${pickwaveId}" uploaded successfully!`);
      setFile(null);
      setPickwaveId('');
      onUploadSuccess?.();
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(0), 1000);
    }
  }

  return (
    <div className="hl-card">
      <div className="hl-card-header">
        <div className="hl-card-icon"><Package size={24} /></div>
        <div>
          <h2 className="hl-card-title">Upload Pickwave Document</h2>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Section A — PDF with order &amp; SKU data
          </div>
        </div>
      </div>

      <div className="hl-card-body">
        {/* Pickwave ID Input */}
        <div style={{ marginBottom: '20px' }}>
          <label htmlFor="pickwave-id-input" className="hl-label">Pickwave ID</label>
          <input
            id="pickwave-id-input"
            type="text"
            className="hl-input"
            placeholder="e.g. PW-2025-001"
            value={pickwaveId}
            onChange={e => setPickwaveId(e.target.value)}
            disabled={loading}
            maxLength={50}
          />
        </div>

        {/* Dropzone */}
        {!file ? (
          <motion.div
            {...getRootProps()}
            className={`upload-zone ${isDragActive ? 'drag-active' : ''}`}
            id="pickwave-dropzone"
            whileHover={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.05)' }}
            whileTap={{ scale: 0.98 }}
            animate={isDragActive ? { scale: 1.05, borderColor: 'var(--accent-primary)', backgroundColor: 'var(--accent-glow)' } : {}}
          >
            <input {...getInputProps()} id="pickwave-file-input" />
            <span className="upload-zone-icon"><Upload size={24} /></span>
            <p className="upload-zone-text">
              <strong>Drop your PDF here</strong> or click to browse
            </p>
            <p className="upload-zone-text" style={{ marginTop: '4px', fontSize: '12px' }}>
              Pickwave document · PDF only
            </p>
          </motion.div>
        ) : (
          <div className="file-info" id="pickwave-file-info">
            <span className="file-icon"><FileText size={20} /></span>
            <span className="file-name">{file.name}</span>
            <span className="file-size">{(file.size / 1024).toFixed(0)} KB</span>
            <button
              id="remove-pickwave-file-btn"
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
        {loading && <ProgressBar progress={progress} label="Uploading pickwave..." show={loading} />}

        {/* Submit */}
        <motion.button
          id="upload-pickwave-btn"
          className="hl-btn hl-btn-primary btn-full"
          onClick={handleUpload}
          disabled={loading || !file || !pickwaveId.trim()}
          style={{ marginTop: '16px' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.95 }}
        >
          {loading ? <><Loader2 size={16} className="animate-spin" /> Uploading...</> : <><Upload size={16} /> Upload Pickwave</>}
        </motion.button>
      </div>
    </div>
  );
}
