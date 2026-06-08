'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { MessageSquare, X, Smile, Send, Paperclip, FileText, Image as ImageIcon, Loader2, Reply, SmilePlus } from 'lucide-react';

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
  const [readReceipts, setReadReceipts] = useState({});
  const readByMeRef = useRef(new Set());
  const [replyingTo, setReplyingTo] = useState(null);
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const [reactingToId, setReactingToId] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

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

  // Request notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // 5-minute unread reminder
  useEffect(() => {
    const reminderInterval = setInterval(() => {
      if (!isOpenRef.current && unreadRef.current > 0) {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Team Chat Reminder', {
            body: `You have ${unreadRef.current} unread message(s) waiting for you.`,
          });
        }
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(reminderInterval);
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
    setIsSubscribed(false);

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
            
            // Show browser notification
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              let bodyText = 'Sent an attachment';
              try {
                const parsed = JSON.parse(msg.message);
                if (parsed.text) bodyText = parsed.text;
                else if (!parsed.attachment) bodyText = msg.message;
              } catch {
                bodyText = msg.message;
              }
              new Notification(`New message from ${msg.user_name || 'Anonymous'}`, {
                body: bodyText,
              });
            }
          }
        }
      })
      .on('broadcast', { event: 'read-receipt' }, ({ payload }) => {
        setReadReceipts(prev => {
          const newReceipts = { ...prev };
          if (!newReceipts[payload.messageId]) {
            newReceipts[payload.messageId] = [];
          }
          if (!newReceipts[payload.messageId].includes(payload.readerName)) {
            newReceipts[payload.messageId] = [...newReceipts[payload.messageId], payload.readerName];
          }
          return newReceipts;
        });
      })
      .on('broadcast', { event: 'chat-reaction' }, ({ payload }) => {
        setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, message: payload.message } : m));
      })
      .on('broadcast', { event: 'name-change' }, ({ payload }) => {
        setMessages(prev => prev.map(m => m.user_fingerprint === payload.fingerprint ? { ...m, user_name: payload.name } : m));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsSubscribed(true);
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
    if (isSubscribed && channelRef.current && user?.fingerprint) {
      channelRef.current.track({
        fingerprint: user.fingerprint,
        name: user.name || 'Anonymous',
        ip: user.ip || '',
      });

      channelRef.current.send({
        type: 'broadcast',
        event: 'name-change',
        payload: { fingerprint: user.fingerprint, name: user.name || 'Anonymous' }
      });
    }
  }, [user?.name, user?.fingerprint, user?.ip, isSubscribed]);

  // Emit read receipts for others' messages when chat is open
  useEffect(() => {
    if (isOpen && isSubscribed && channelRef.current && user?.fingerprint) {
      messages.forEach(msg => {
        if (msg.user_fingerprint !== user.fingerprint && !readByMeRef.current.has(msg.id)) {
          readByMeRef.current.add(msg.id);
          channelRef.current.send({
            type: 'broadcast',
            event: 'read-receipt',
            payload: { messageId: msg.id, readerName: user.name || 'Anonymous' }
          });
        }
      });
    }
  }, [messages, isOpen, user, isSubscribed]);

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
    const currentReply = replyingTo;
    setReplyingTo(null);

    // Play send sound
    createSendSound();

    let finalMessageString = text;
    if (attachmentObj || replyingTo) {
      finalMessageString = JSON.stringify({
        text: text,
        attachment: attachmentObj || undefined,
        replyTo: replyingTo || undefined
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

  function handleReactionSelect(emoji) {
    if (!reactingToId) return;
    const msgToReact = messages.find((m, i) => (m.id || i) === reactingToId);
    if (!msgToReact) return;
    
    let parsed = parseMessagePayload(msgToReact.message);
    if (!parsed.reactions) parsed.reactions = {};
    if (!parsed.reactions[emoji.native]) parsed.reactions[emoji.native] = [];
    if (!parsed.reactions[emoji.native].includes(user.name || 'Anonymous')) {
      parsed.reactions[emoji.native].push(user.name || 'Anonymous');
    }

    const newMessageString = JSON.stringify(parsed);

    if (msgToReact.id) {
      fetch('/api/chat/messages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msgToReact.id, message: newMessageString })
      });
    }

    channelRef.current?.send({
      type: 'broadcast',
      event: 'chat-reaction',
      payload: { messageId: msgToReact.id, message: newMessageString }
    });

    setMessages(prev => prev.map((m, i) => (m.id || i) === reactingToId ? { ...m, message: newMessageString } : m));
    setReactingToId(null);
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
            <div 
              key={msg.id || i} 
              className={`chat-message ${isOwn ? 'own' : 'other'}`} 
              id={`msg-${i}`}
              onMouseEnter={() => setHoveredMessageId(msg.id || i)}
              onMouseLeave={() => { setHoveredMessageId(null); setReactingToId(null); }}
              style={{ position: 'relative' }}
            >
              {hoveredMessageId === (msg.id || i) && (
                <div style={{ position: 'absolute', top: '-10px', [isOwn ? 'left' : 'right']: 0, display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', zIndex: 10 }}>
                  <button className="icon-btn" style={{ padding: '4px' }} onClick={() => setReplyingTo({ id: msg.id || i, text: parsed.text || 'Attachment', user_name: msg.user_name || 'Anonymous' })} title="Reply"><Reply size={14} /></button>
                  <button className="icon-btn" style={{ padding: '4px' }} onClick={() => setReactingToId(msg.id || i)} title="React"><SmilePlus size={14} /></button>
                  {reactingToId === (msg.id || i) && EmojiPicker && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50 }}>
                      <EmojiPicker onEmojiSelect={handleReactionSelect} theme="auto" previewPosition="none" skinTonePosition="none" />
                    </div>
                  )}
                </div>
              )}
              <div className="msg-meta">
                {!isOwn && <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11px' }}>{msg.user_name}</span>}
                <span>{formatTime(msg.created_at)}</span>
              </div>
              <div className="msg-bubble" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {parsed.replyTo && (
                  <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.15)', borderLeft: '3px solid var(--accent-primary)', borderRadius: '4px', fontSize: '12px', marginBottom: '4px', opacity: 0.8 }}>
                    <div style={{ fontWeight: 600, marginBottom: '2px' }}>{parsed.replyTo.user_name}</div>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{parsed.replyTo.text}</div>
                  </div>
                )}
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
              {isOwn && readReceipts[msg.id] && readReceipts[msg.id].length > 0 && (
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', marginTop: '4px', alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>✓✓</span> Read by {readReceipts[msg.id].join(', ')}
                </div>
              )}
              {parsed.reactions && Object.keys(parsed.reactions).length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignSelf: isOwn ? 'flex-end' : 'flex-start', marginTop: '2px' }}>
                  {Object.entries(parsed.reactions).map(([emoji, users]) => (
                    <div key={emoji} title={users.join(', ')} style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '12px', fontSize: '11px', border: '1px solid var(--border)', cursor: 'default' }}>
                      {emoji} {users.length}
                    </div>
                  ))}
                </div>
              )}
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
        {replyingTo && (
          <div style={{ position: 'absolute', top: stagedFile ? '-80px' : '-40px', left: '16px', right: '16px', background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', fontSize: '12px' }}>
              <Reply size={14} className="text-muted" />
              <span style={{ fontWeight: 600 }}>{replyingTo.user_name}</span>
              <span style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '150px', opacity: 0.7 }}>{replyingTo.text}</span>
            </div>
            <button className="icon-btn" onClick={() => setReplyingTo(null)} style={{ padding: 0 }}><X size={14} /></button>
          </div>
        )}
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
            className="emoji-toggle-btn"
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
