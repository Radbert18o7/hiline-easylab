'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import toast from 'react-hot-toast';
import { MessageSquare, X, Smile, Send } from 'lucide-react';

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const socketRef = useRef(null);
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

  // Socket.IO setup
  useEffect(() => {
    if (!user?.fingerprint) return;

    loadMessages();
    const socket = getSocket();
    socketRef.current = socket;

    // Join room
    socket.emit('user-join', {
      fingerprint: user.fingerprint,
      name: user.name || 'Anonymous',
      ip: user.ip || '',
    });

    socket.on('online-users', (users) => {
      setOnlineUsers(users);
    });

    socket.on('new-message', (msg) => {
      setMessages(prev => [...prev, msg]);

      // Play receive sound if not own message
      if (msg.user_fingerprint !== user.fingerprint) {
        createReceiveSound();

        // Increment unread if panel is closed
        if (!isOpenRef.current) {
          unreadRef.current += 1;
          onUnreadChange?.(unreadRef.current);
        }
      }
    });

    return () => {
      socket.off('online-users');
      socket.off('new-message');
    };
  }, [user]);

  // Update socket name when user changes
  useEffect(() => {
    if (socketRef.current && user?.fingerprint) {
      socketRef.current.emit('update-name', {
        fingerprint: user.fingerprint,
        name: user.name,
      });
    }
  }, [user?.name]);

  // Scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || !user) return;

    setInputText('');
    setShowEmoji(false);

    // Play send sound
    createSendSound();

    // Emit via Socket.IO
    const socket = getSocket();
    socket.emit('send-message', {
      fingerprint: user.fingerprint,
      name: user.name || 'Anonymous',
      message: text,
    });

    // Save to DB
    await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: user.fingerprint,
        user_name: user.name,
        message: text,
      }),
    });

    // Log action
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_fingerprint: user.fingerprint,
        user_name: user.name,
        ip: user.ip,
        action: 'chat_message_sent',
        metadata: { message_preview: text.slice(0, 50) },
      }),
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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
    >
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
          return (
            <div key={msg.id || i} className={`chat-message ${isOwn ? 'own' : 'other'}`} id={`msg-${i}`}>
              <div className="msg-meta">
                {!isOwn && <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '11px' }}>{msg.user_name}</span>}
                <span>{formatTime(msg.created_at)}</span>
              </div>
              <div className="msg-bubble">{msg.message}</div>
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
      <div className="chat-input-area">
        <div className="chat-input-row">
          <button
            id="emoji-toggle-btn"
            className="emoji-toggle-btn"
            onClick={() => setShowEmoji(!showEmoji)}
            title="Emoji picker"
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
            disabled={!inputText.trim()}
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
          Press Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
