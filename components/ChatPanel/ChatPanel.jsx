'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { MessageSquare, X, Smile, Send, Paperclip, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';

// Web Audio API sound synthesis (no external files needed)
function createSendSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch {}
}

function createReceiveSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
    osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

export default function ChatPanel({ user, isOpen, onClose, onUnreadChange }) {
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [inputText, setInputText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [EmojiPicker, setEmojiPicker] = useState(null);
  const [stagedFile, setStagedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const channelRef = useRef(null);
  const unreadRef = useRef(0);
  const isOpenRef = useRef(isOpen);

  // Keep isOpen in ref for socket callbacks
  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) {
      unreadRef.current = 0;
      onUnreadChange?.(0);
    }
  }, [isOpen, onUnreadChange]);

  // Load emoji picker lazily
  useEffect(() => {
    import('@emoji-mart/react').then(mod => {
      setEmojiPicker(() => mod.default);
    });
  }, []);

  // Load message history
  async function loadMessages() {
    try {
      const res = await fetch('/api/chat/messages');
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {}
  }

  // Supabase Channels setup
  useEffect(() => {
    if (!user?.fingerprint) return;

    loadMessages();

    const channel = supabase.channel('global-chat', {
      config: {
        presence: {
          key: user.fingerprint,
        },
      },
    });

    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users = [];
        for (const [key, presences] of Object.entries(state)) {
          if (presences.length > 0) {
            users.push(presences[0]);
          }
        }
        setOnlineUsers(users);
      })
      .on('broadcast', { event: 'new-message' }, ({ payload }) => {
        const msg = payload;
        setMessages(prev => {
          // Prevent duplicates if self-broadcast is somehow received
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // Play receive sound if not own message
        if (msg.user_fingerprint !== user.fingerprint) {
          createReceiveSound();

          // Increment unread if panel is closed
          if (!isOpenRef.current) {
            unreadRef.current += 1;
            onUnreadChange?.(unreadRef.current);
          }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            fingerprint: user.fingerprint,
            name: user.name || 'Anonymous',
            ip: user.ip || '',
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.fingerprint]);

  // Update user name in presence
  useEffect(() => {
    if (channelRef.current && user?.fingerprint) {
      channelRef.current.track({
        fingerprint: user.fingerprint,
        name: user.name || 'Anonymous',
        ip: user.ip || '',
      });
    }
  }, [user?.name, user?.fingerprint, user?.ip]);

  // Scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  function parseMessagePayload(text) {
    try {
      const obj = JSON.parse(text);
      if (obj && (obj.text !== undefined || obj.attachment)) return obj;
      return { text };
    } catch {
      return { text };
    }
  }

  async function sendMessage() {
    const text = inputText.trim();
    if ((!text && !stagedFile) || !user || isUploading) return;

    setIsUploading(true);
    let attachmentObj = null;

    try {
      if (stagedFile) {
        const formData = new FormData();
        formData.append('file', stagedFile);
        
        const uploadRes = await fetch('/api/chat/upload', {
          method: 'POST',
          body: formData
        });
        
        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          toast.error(err.error || 'Failed to upload file');
          setIsUploading(false);
          return;
        }
        
        attachmentObj = await uploadRes.json();
      }
    } catch (err) {
      toast.error('Upload failed');
      setIsUploading(false);
      return;
    }

    setInputText('');
    setStagedFile(null);
    setShowEmoji(false);
    setIsUploading(false);

    // Play send sound
    createSendSound();

    let finalMessageString = text;
    if (attachmentObj) {
      finalMessageString = JSON.stringify({
        text: text,
        attachment: attachmentObj
      });
    }

    // Emit via Supabase Broadcast
    const msgPayload = {
      id: Date.now().toString(),
      user_fingerprint: user.fingerprint,
      user_name: user.name || 'Anonymous',
      message: finalMessageString,
      created_at: new Date().toISOString(),
    };

    channelRef.current?.send({
      type: 'broadcast',
      event: 'new-message',
      payload: msgPayload,
    });
    
    // Add to local state immediately
    setMessages(prev => {
      if (prev.some(m => m.id === msgPayload.id)) return prev;
      return [...prev, msgPayload];
    });

    // Save to DB
    fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: user.fingerprint,
        user_name: user.name,
        message: finalMessageString,
      }),
    });

    // Log action
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: user.fingerprint,
        user_name: user.name,
        ip: user.ip,
        action: 'chat_message_sent',
        metadata: { has_attachment: !!attachmentObj },
      }),
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isUploading) sendMessage();
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error('File exceeds 20MB limit');
        return;
      }
      setStagedFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error('File exceeds 20MB limit');
        return;
      }
      setStagedFile(file);
    }
  }

  function onEmojiSelect(emoji) {
    setInputText(prev => prev + emoji.native);
    inputRef.current?.focus();
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div
      id="chat-panel"
      className={`chat-panel${isOpen ? '' : ' hidden'}`}
      role="complementary"
      aria-label="Team chat"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      {isDragging && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 600, borderRadius: '8px', pointerEvents: 'none' }}>
          Drop file to attach
        </div>
      )}
      {/* Header */}
      <div className="chat-panel-header">
        <MessageSquare size={20} />
        <span className="chat-panel-title">Team Chat</span>
        <button
          id="chat-close-btn"
          className="icon-btn"
          onClick={onClose}
          style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Close chat"
        ><X size={16} /></button>
      </div>

      {/* Online Users */}
      <div className="online-users-section">
        <div className="online-users-title">Online ({onlineUsers.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {onlineUsers.map((u, i) => (
            <span key={i} className="online-user-chip" id={`online-user-${i}`}>
              <span className="online-dot" />
              {u.name || 'Anonymous'}
            </span>
          ))}
          {onlineUsers.length === 0 && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No users online</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages" id="chat-messages-list">
        {messages.length === 0 && (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div style={{ marginBottom: '8px' }}><MessageSquare size={32} className="text-muted" /></div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No messages yet. Say hi!</div>
          </div>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.user_fingerprint === user?.fingerprint;
          const parsed = parseMessagePayload(msg.message);
          const hasImage = parsed.attachment && parsed.attachment.type.startsWith('image/');

          return (
            <div key={msg.id || i} className={`chat-message ${isOwn ? 'own' : 'other'}`} id={`msg-${i}`}>
              <div className="msg-meta">
                {!isOwn && <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11px' }}>{msg.user_name}</span>}
                <span>{formatTime(msg.created_at)}</span>
              </div>
              <div className="msg-bubble" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {parsed.attachment && (
                  <div className="msg-attachment">
                    {hasImage ? (
                      <a href={parsed.attachment.url} target="_blank" rel="noopener noreferrer">
                        <img 
                          src={parsed.attachment.url} 
                          alt="attachment" 
                          style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '4px', cursor: 'pointer', objectFit: 'contain' }} 
                        />
                      </a>
                    ) : (
                      <a href={parsed.attachment.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: isOwn ? 'rgba(255,255,255,0.1)' : 'var(--bg-tertiary)', borderRadius: '4px', color: isOwn ? '#fff' : 'var(--text-primary)', textDecoration: 'none', fontSize: '13px' }}>
                        <FileText size={16} />
                        <span style={{ wordBreak: 'break-all' }}>{parsed.attachment.name}</span>
                      </a>
                    )}
                  </div>
                )}
                {parsed.text && <div>{parsed.text}</div>}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Emoji Picker */}
      {showEmoji && EmojiPicker && (
        <div className="emoji-picker-container" id="emoji-picker">
          <EmojiPicker
            onEmojiSelect={onEmojiSelect}
            theme="auto"
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>
      )}

      {/* Input Area */}
      <div className="chat-input-area" style={{ position: 'relative' }}>
        {stagedFile && (
          <div style={{ position: 'absolute', top: '-40px', left: '16px', right: '16px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              {stagedFile.type.startsWith('image/') ? <ImageIcon size={16} className="text-muted" /> : <FileText size={16} className="text-muted" />}
              <span style={{ fontSize: '12px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '200px' }}>{stagedFile.name}</span>
            </div>
            <button className="icon-btn" onClick={() => setStagedFile(null)} disabled={isUploading} style={{ width: '20px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="chat-input-row">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            style={{ display: 'none' }} 
          />
          <button
            className="icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            disabled={isUploading}
            aria-label="Attach file"
          >
            <Paperclip size={20} />
          </button>
          <button
            id="emoji-toggle-btn"
            className="icon-btn"
            onClick={() => setShowEmoji(!showEmoji)}
            title="Emoji picker"
            disabled={isUploading}
            aria-label="Toggle emoji picker"
          >
            <Smile size={20} />
          </button>
          <textarea
            ref={inputRef}
            id="chat-message-input"
            className="chat-input"
            placeholder="Type a message..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Chat message input"
          />
          <button
            id="send-message-btn"
            className="send-btn"
            onClick={sendMessage}
            disabled={(!inputText.trim() && !stagedFile) || isUploading}
            aria-label="Send message"
          >
            {isUploading ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
          Press Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
