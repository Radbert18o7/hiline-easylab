'use client';

// On Vercel, the custom server.js is not executed, so there is no Socket.IO server.
// Attempting to connect causes socket.io-client to poll Vercel, which returns HTML 404s,
// leading to parsing errors that crash the Next.js client application.
// We provide a dummy socket object to prevent crashes while keeping the UI intact.

let dummySocket = {
  emit: () => {},
  on: () => {},
  off: () => {},
  disconnect: () => {},
};

export function getSocket() {
  return dummySocket;
}

export function disconnectSocket() {
  // Do nothing
}
