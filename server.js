const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Store connected users
const connectedUsers = new Map(); // socketId -> { username, joinedAt }

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for any route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Handle user joining with username
  socket.on('user:join', (username) => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || trimmedUsername.length < 2 || trimmedUsername.length > 30) {
      socket.emit('error:message', 'Username must be between 2 and 30 characters');
      return;
    }

    // Check if username is already taken
    const usernameTaken = Array.from(connectedUsers.values()).some(
      (user) => user.username.toLowerCase() === trimmedUsername.toLowerCase()
    );

    if (usernameTaken) {
      socket.emit('error:message', 'Username is already taken. Please choose another.');
      return;
    }

    // Store user info
    connectedUsers.set(socket.id, {
      username: trimmedUsername,
      joinedAt: new Date().toISOString()
    });

    // Update user's socket data
    socket.username = trimmedUsername;

    // Join the general chat room
    socket.join('general');

    // Send welcome message to the user
    socket.emit('message:received', {
      id: `system-${Date.now()}`,
      username: 'System',
      text: `Welcome to the chat, ${trimmedUsername}!`,
      timestamp: new Date().toISOString(),
      type: 'system'
    });

    // Broadcast to all other users that someone joined
    socket.broadcast.to('general').emit('message:received', {
      id: `system-${Date.now()}`,
      username: 'System',
      text: `${trimmedUsername} has joined the chat`,
      timestamp: new Date().toISOString(),
      type: 'system'
    });

    // Update online users list for everyone
    io.to('general').emit('users:online', getOnlineUsersList());
  });

  // Handle chat messages
  socket.on('message:send', (text) => {
    const username = socket.username;
    if (!username) {
      socket.emit('error:message', 'You must join with a username first');
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      socket.emit('error:message', 'Message cannot be empty');
      return;
    }

    if (trimmedText.length > 1000) {
      socket.emit('error:message', 'Message is too long (max 1000 characters)');
      return;
    }

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      username: username,
      text: trimmedText,
      timestamp: new Date().toISOString(),
      type: 'user'
    };

    // Broadcast to all users in the room including sender
    io.to('general').emit('message:received', message);
  });

  // Handle typing indicators
  socket.on('typing:start', () => {
    const username = socket.username;
    if (username) {
      socket.broadcast.to('general').emit('typing:update', {
        username,
        isTyping: true
      });
    }
  });

  socket.on('typing:stop', () => {
    const username = socket.username;
    if (username) {
      socket.broadcast.to('general').emit('typing:update', {
        username,
        isTyping: false
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      // Remove from connected users
      connectedUsers.delete(socket.id);

      // Broadcast that user left
      io.to('general').emit('message:received', {
        id: `system-${Date.now()}`,
        username: 'System',
        text: `${user.username} has left the chat`,
        timestamp: new Date().toISOString(),
        type: 'system'
      });

      // Update online users list
      io.to('general').emit('users:online', getOnlineUsersList());

      // Clear typing indicator
      io.to('general').emit('typing:update', {
        username: user.username,
        isTyping: false
      });
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

// Helper function to get formatted online users list
function getOnlineUsersList() {
  return Array.from(connectedUsers.entries()).map(([socketId, user]) => ({
    socketId,
    username: user.username,
    joinedAt: user.joinedAt
  }));
}

server.listen(PORT, () => {
  console.log(`Chat server running on http://localhost:${PORT}`);
  console.log(`Socket.IO server ready for connections`);
});