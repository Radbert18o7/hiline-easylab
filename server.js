const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Track online users: Map<socketId, { fingerprint, name, ip }>
const onlineUsers = new Map();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Make io accessible to API routes via global
  global.io = io;

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // User joins with their info
    socket.on('user-join', ({ fingerprint, name, ip }) => {
      onlineUsers.set(socket.id, { fingerprint, name, ip });
      socket.join('global-chat');

      // Broadcast updated online users list
      const users = Array.from(onlineUsers.values());
      io.to('global-chat').emit('online-users', users);

      console.log(`User joined: ${name} (${fingerprint})`);
    });

    // Handle chat message
    socket.on('send-message', (data) => {
      // Broadcast to all users in global-chat including sender
      io.to('global-chat').emit('new-message', {
        id: Date.now().toString(),
        user_fingerprint: data.fingerprint,
        user_name: data.name,
        message: data.message,
        created_at: new Date().toISOString(),
      });
    });

    // Update user name
    socket.on('update-name', ({ fingerprint, name }) => {
      const user = onlineUsers.get(socket.id);
      if (user && user.fingerprint === fingerprint) {
        onlineUsers.set(socket.id, { ...user, name });
        const users = Array.from(onlineUsers.values());
        io.to('global-chat').emit('online-users', users);
      }
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(socket.id);
      const users = Array.from(onlineUsers.values());
      io.to('global-chat').emit('online-users', users);
      console.log('Socket disconnected:', socket.id);
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
