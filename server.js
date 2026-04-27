const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Filter = require('bad-words');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Initialize bad words filter
const filter = new Filter();

// ==================== DATA STORES ====================

// Store connected users: socketId -> user object
const connectedUsers = new Map();

// Store user profiles: username -> profile
const userProfiles = new Map();

// Store messages history: roomId -> messages[]
const messageHistory = new Map();

// Store chat rooms: roomId -> room object
const chatRooms = new Map();

// Store blocked users: blockerUsername -> Set(blockedUsernames)
const blockedUsers = new Map();

// Store user socket IDs for private messaging: username -> socketId
const usernameToSocket = new Map();

// Store typing timeouts: username -> timeoutId
const typingTimeouts = new Map();

// ==================== INITIALIZATION ====================

// Create default rooms
const defaultRooms = [
  { id: 'general', name: 'General', description: 'General discussion', icon: '💬', isPrivate: false },
  { id: 'random', name: 'Random', description: 'Random topics and fun', icon: '🎲', isPrivate: false },
  { id: 'tech', name: 'Tech Talk', description: 'Technology discussions', icon: '💻', isPrivate: false }
];

defaultRooms.forEach(room => {
  chatRooms.set(room.id, { ...room, createdBy: 'System', createdAt: new Date().toISOString(), members: [] });
  messageHistory.set(room.id, []);
});

// ==================== HELPER FUNCTIONS ====================

function sanitizeMessage(text) {
  let sanitized = text.trim();
  if (!sanitized) return '';
  
  // Limit length
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000) + '...';
  }
  
  // Filter bad words
  try {
    sanitized = filter.clean(sanitized);
  } catch (e) {
    // If filter fails, use original
  }
  
  return sanitized;
}

function getOnlineUsersList(roomId = null) {
  let users = Array.from(connectedUsers.entries()).map(([socketId, user]) => ({
    socketId,
    username: user.username,
    displayName: user.displayName || user.username,
    joinedAt: user.joinedAt,
    avatarColor: user.avatarColor,
    status: user.status || 'online',
    statusMessage: user.statusMessage || '',
    currentRoom: user.currentRoom || 'general',
    isTyping: user.isTyping || false,
    lastActive: user.lastActive
  }));

  if (roomId) {
    users = users.filter(u => u.currentRoom === roomId);
  }

  return users;
}

function generateAvatarColor(username) {
  const colors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#ef4444', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7'
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getRoomMembers(roomId) {
  const members = [];
  connectedUsers.forEach((user, socketId) => {
    if (user.currentRoom === roomId) {
      members.push({
        socketId,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarColor: user.avatarColor
      });
    }
  });
  return members;
}

// ==================== SOCKET.IO EVENT HANDLING ====================

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // ==================== AUTHENTICATION & JOINING ====================

  socket.on('user:join', (data) => {
    const { username, displayName, statusMessage } = data;
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

    // Create or update user profile
    if (!userProfiles.has(trimmedUsername)) {
      userProfiles.set(trimmedUsername, {
        username: trimmedUsername,
        displayName: displayName || trimmedUsername,
        avatarColor: generateAvatarColor(trimmedUsername),
        statusMessage: statusMessage || '',
        joinedAt: new Date().toISOString(),
        messageCount: 0,
        rooms: ['general']
      });
    }

    const profile = userProfiles.get(trimmedUsername);
    
    // Store user info
    const userData = {
      username: trimmedUsername,
      displayName: displayName || profile.displayName || trimmedUsername,
      joinedAt: new Date().toISOString(),
      avatarColor: profile.avatarColor,
      status: 'online',
      statusMessage: statusMessage || profile.statusMessage || '',
      currentRoom: 'general',
      isTyping: false,
      lastActive: new Date().toISOString()
    };

    connectedUsers.set(socket.id, userData);
    usernameToSocket.set(trimmedUsername, socket.id);
    socket.username = trimmedUsername;

    // Join default room
    socket.join('general');
    
    // Update room members
    chatRooms.get('general').members = getRoomMembers('general');

    // Send welcome message
    const welcomeMsg = createSystemMessage(`Welcome to the chat, ${trimmedUsername}!`);
    socket.emit('message:received', welcomeMsg);

    // Broadcast join notification
    const joinMsg = createSystemMessage(`${trimmedUsername} has joined the chat`);
    socket.to('general').emit('message:received', joinMsg);

    // Send room list
    socket.emit('rooms:list', getRoomsList());

    // Send message history for current room
    socket.emit('messages:history', messageHistory.get('general') || []);

    // Update online users
    updateOnlineUsers();

    // Send user profile
    socket.emit('profile:update', profile);
  });

  // ==================== MESSAGE HANDLING ====================

  socket.on('message:send', (data) => {
    const { text, roomId = 'general', replyTo = null } = data;
    const username = socket.username;
    
    if (!username) {
      socket.emit('error:message', 'You must join with a username first');
      return;
    }

    const sanitizedText = sanitizeMessage(text);
    if (!sanitizedText) {
      socket.emit('error:message', 'Message cannot be empty');
      return;
    }

    const user = connectedUsers.get(socket.id);
    const message = {
      id: uuidv4(),
      username: username,
      displayName: user.displayName || username,
      text: sanitizedText,
      timestamp: new Date().toISOString(),
      type: 'user',
      roomId: roomId,
      avatarColor: user.avatarColor,
      replyTo: replyTo,
      reactions: {},
      edited: false,
      editedAt: null,
      readBy: [username]
    };

    // Store in message history
    const history = messageHistory.get(roomId) || [];
    history.push(message);
    messageHistory.set(roomId, history);

    // Update user message count
    const profile = userProfiles.get(username);
    if (profile) {
      profile.messageCount++;
    }

    // Broadcast to room
    io.to(roomId).emit('message:received', message);

    // Send notification to users who mentioned @username
    const mentions = sanitizedText.match(/@(\w+)/g);
    if (mentions) {
      mentions.forEach(mention => {
        const mentionedUser = mention.substring(1);
        const targetSocket = usernameToSocket.get(mentionedUser);
        if (targetSocket && targetSocket !== socket.id) {
          io.to(targetSocket).emit('notification', {
            type: 'mention',
            from: username,
            message: `${username} mentioned you: ${sanitizedText.substring(0, 50)}...`,
            roomId: roomId
          });
        }
      });
    }
  });

  // ==================== MESSAGE ACTIONS ====================

  socket.on('message:edit', (data) => {
    const { messageId, newText, roomId = 'general' } = data;
    const username = socket.username;
    
    if (!username) return;

    const history = messageHistory.get(roomId);
    if (!history) return;

    const messageIndex = history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const message = history[messageIndex];
    if (message.username !== username) return;

    const sanitizedText = sanitizeMessage(newText);
    if (!sanitizedText) return;

    message.text = sanitizedText;
    message.edited = true;
    message.editedAt = new Date().toISOString();

    io.to(roomId).emit('message:edited', {
      messageId,
      newText: sanitizedText,
      editedAt: message.editedAt,
      username
    });
  });

  socket.on('message:delete', (data) => {
    const { messageId, roomId = 'general' } = data;
    const username = socket.username;
    
    if (!username) return;

    const history = messageHistory.get(roomId);
    if (!history) return;

    const messageIndex = history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const message = history[messageIndex];
    if (message.username !== username) return;

    history.splice(messageIndex, 1);

    io.to(roomId).emit('message:deleted', {
      messageId,
      username
    });
  });

  socket.on('message:react', (data) => {
    const { messageId, reaction, roomId = 'general' } = data;
    const username = socket.username;
    
    if (!username) return;

    const history = messageHistory.get(roomId);
    if (!history) return;

    const message = history.find(m => m.id === messageId);
    if (!message) return;

    if (!message.reactions) {
      message.reactions = {};
    }

    // Toggle reaction
    if (message.reactions[reaction]) {
      const users = message.reactions[reaction];
      const userIndex = users.indexOf(username);
      if (userIndex > -1) {
        users.splice(userIndex, 1);
        if (users.length === 0) {
          delete message.reactions[reaction];
        }
      } else {
        users.push(username);
      }
    } else {
      message.reactions[reaction] = [username];
    }

    io.to(roomId).emit('message:reactions', {
      messageId,
      reactions: message.reactions
    });
  });

  socket.on('message:read', (data) => {
    const { messageId, roomId = 'general' } = data;
    const username = socket.username;
    
    if (!username) return;

    const history = messageHistory.get(roomId);
    if (!history) return;

    const message = history.find(m => m.id === messageId);
    if (!message) return;

    if (!message.readBy.includes(username)) {
      message.readBy.push(username);
      io.to(roomId).emit('message:readReceipt', {
        messageId,
        readBy: username
      });
    }
  });

  // ==================== PRIVATE MESSAGING ====================

  socket.on('private:message', (data) => {
    const { to, text } = data;
    const from = socket.username;
    
    if (!from || !to) return;

    const sanitizedText = sanitizeMessage(text);
    if (!sanitizedText) return;

    const targetSocketId = usernameToSocket.get(to);
    if (!targetSocketId) {
      socket.emit('error:message', `User ${to} is not online`);
      return;
    }

    // Check if blocked
    const blocked = blockedUsers.get(to);
    if (blocked && blocked.has(from)) {
      socket.emit('error:message', `You have been blocked by ${to}`);
      return;
    }

    const user = connectedUsers.get(socket.id);
    const message = {
      id: uuidv4(),
      from: from,
      to: to,
      text: sanitizedText,
      timestamp: new Date().toISOString(),
      type: 'private',
      avatarColor: user.avatarColor,
      displayName: user.displayName || from
    };

    // Send to recipient
    io.to(targetSocketId).emit('private:message', message);
    
    // Send back to sender with different flag
    io.to(socket.id).emit('private:message', { ...message, sent: true });
  });

  // ==================== ROOM MANAGEMENT ====================

  socket.on('room:join', (roomId) => {
    const username = socket.username;
    if (!username) return;

    const room = chatRooms.get(roomId);
    if (!room) {
      socket.emit('error:message', 'Room does not exist');
      return;
    }

    // Leave current room
    const currentUser = connectedUsers.get(socket.id);
    if (currentUser && currentUser.currentRoom) {
      socket.leave(currentUser.currentRoom);
      
      // Notify old room
      const leaveMsg = createSystemMessage(`${username} has left the room`);
      io.to(currentUser.currentRoom).emit('message:received', leaveMsg);
    }

    // Join new room
    socket.join(roomId);
    if (currentUser) {
      currentUser.currentRoom = roomId;
    }

    // Update room members
    room.members = getRoomMembers(roomId);

    // Send room change notification
    const joinMsg = createSystemMessage(`${username} has joined ${room.name}`);
    io.to(roomId).emit('message:received', joinMsg);

    // Send room info and history
    socket.emit('room:changed', {
      roomId: room.id,
      roomName: room.name,
      roomIcon: room.icon
    });
    socket.emit('messages:history', messageHistory.get(roomId) || []);
    
    // Update online users for both rooms
    updateOnlineUsers();
  });

  socket.on('room:create', (data) => {
    const { name, description, icon = '📁', isPrivate = false } = data;
    const username = socket.username;
    
    if (!username) return;
    if (!name || name.trim().length < 2) {
      socket.emit('error:message', 'Room name must be at least 2 characters');
      return;
    }

    const roomId = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    if (chatRooms.has(roomId)) {
      socket.emit('error:message', 'A room with this name already exists');
      return;
    }

    const newRoom = {
      id: roomId,
      name: name.trim(),
      description: description || '',
      icon: icon,
      isPrivate: isPrivate,
      createdBy: username,
      createdAt: new Date().toISOString(),
      members: []
    };

    chatRooms.set(roomId, newRoom);
    messageHistory.set(roomId, []);

    // Broadcast new room to all users
    io.emit('room:created', newRoom);
    
    // Join the creator to the room
    socket.emit('room:join', roomId);
  });

  // ==================== USER ACTIONS ====================

  socket.on('user:block', (usernameToBlock) => {
    const username = socket.username;
    if (!username || !usernameToBlock) return;

    if (!blockedUsers.has(username)) {
      blockedUsers.set(username, new Set());
    }
    blockedUsers.get(username).add(usernameToBlock);

    socket.emit('user:blocked', usernameToBlock);
  });

  socket.on('user:unblock', (usernameToUnblock) => {
    const username = socket.username;
    if (!username || !usernameToUnblock) return;

    const blocked = blockedUsers.get(username);
    if (blocked) {
      blocked.delete(usernameToUnblock);
      socket.emit('user:unblocked', usernameToUnblock);
    }
  });

  socket.on('user:status', (status) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      user.status = status.status || 'online';
      user.statusMessage = status.message || '';
      updateOnlineUsers();
    }
  });

  // ==================== TYPING INDICATORS ====================

  socket.on('typing:start', (data) => {
    const { roomId = 'general' } = data;
    const username = socket.username;
    if (!username) return;

    const user = connectedUsers.get(socket.id);
    if (user) {
      user.isTyping = true;
    }

    socket.to(roomId).emit('typing:update', {
      username,
      displayName: user?.displayName || username,
      isTyping: true,
      roomId
    });

    // Clear existing timeout
    if (typingTimeouts.has(username)) {
      clearTimeout(typingTimeouts.get(username));
    }

    // Auto-stop typing after 5 seconds
    const timeout = setTimeout(() => {
      socket.emit('typing:stop', { roomId });
    }, 5000);
    typingTimeouts.set(username, timeout);
  });

  socket.on('typing:stop', (data) => {
    const { roomId = 'general' } = data;
    const username = socket.username;
    if (!username) return;

    const user = connectedUsers.get(socket.id);
    if (user) {
      user.isTyping = false;
    }

    socket.to(roomId).emit('typing:update', {
      username,
      isTyping: false,
      roomId
    });

    if (typingTimeouts.has(username)) {
      clearTimeout(typingTimeouts.get(username));
      typingTimeouts.delete(username);
    }
  });

  // ==================== FILE SHARING ====================

  socket.on('file:share', (data) => {
    const { url, fileName, fileSize, fileType, roomId = 'general' } = data;
    const username = socket.username;
    
    if (!username || !url) return;

    const user = connectedUsers.get(socket.id);
    const message = {
      id: uuidv4(),
      username: username,
      displayName: user?.displayName || username,
      text: `[File] ${fileName || 'Shared file'}`,
      timestamp: new Date().toISOString(),
      type: 'file',
      roomId: roomId,
      avatarColor: user?.avatarColor,
      file: {
        url: url,
        name: fileName || 'shared_file',
        size: fileSize || 0,
        type: fileType || 'unknown'
      },
      reactions: {},
      readBy: [username]
    };

    const history = messageHistory.get(roomId) || [];
    history.push(message);
    messageHistory.set(roomId, history);

    io.to(roomId).emit('message:received', message);
  });

  // ==================== SEARCH ====================

  socket.on('search:messages', (data) => {
    const { query, roomId = 'general' } = data;
    const username = socket.username;
    
    if (!username || !query) return;

    const history = messageHistory.get(roomId) || [];
    const results = history.filter(msg => 
      msg.text.toLowerCase().includes(query.toLowerCase()) &&
      msg.type !== 'system'
    );

    socket.emit('search:results', {
      query,
      results: results.slice(0, 50) // Limit to 50 results
    });
  });

  // ==================== DISCONNECTION ====================

  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const username = user.username;
      
      // Remove from connected users
      connectedUsers.delete(socket.id);
      usernameToSocket.delete(username);

      // Clear typing timeout
      if (typingTimeouts.has(username)) {
        clearTimeout(typingTimeouts.get(username));
        typingTimeouts.delete(username);
      }

      // Update room members
      chatRooms.forEach(room => {
        room.members = getRoomMembers(room.id);
      });

      // Broadcast user left
      const leaveMsg = createSystemMessage(`${username} has left the chat`);
      io.emit('message:received', leaveMsg);

      // Update online users
      updateOnlineUsers();
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

// ==================== HELPER FUNCTIONS ====================

function createSystemMessage(text) {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    username: 'System',
    displayName: 'System',
    text: text,
    timestamp: new Date().toISOString(),
    type: 'system',
    avatarColor: '#64748b',
    reactions: {}
  };
}

function getRoomsList() {
  return Array.from(chatRooms.values()).map(room => ({
    ...room,
    memberCount: getRoomMembers(room.id).length
  }));
}

function updateOnlineUsers() {
  const users = getOnlineUsersList();
  io.emit('users:online', users);
}

// ==================== STATIC FILES & SERVER START ====================

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 Chat server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.IO server ready for connections`);
  console.log(`👥 Default rooms: ${defaultRooms.map(r => r.name).join(', ')}`);
});