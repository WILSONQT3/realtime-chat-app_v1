const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});

// DOM Elements
const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const joinForm = document.getElementById('join-form');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const leaveBtn = document.getElementById('leave-btn');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages-container');
const onlineUsersList = document.getElementById('online-users');
const onlineCount = document.getElementById('online-count');
const currentUserSpan = document.getElementById('current-user');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');

let currentUsername = null;
let typingTimeout = null;
let isTyping = false;

// ==================== JOIN HANDLING ====================

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    
    if (!username) {
        showError('Please enter a username');
        return;
    }
    
    if (username.length < 2 || username.length > 30) {
        showError('Username must be between 2 and 30 characters');
        return;
    }
    
    joinBtn.disabled = true;
    joinBtn.textContent = 'Connecting...';
    
    // Emit join event
    socket.emit('user:join', username);
});

socket.on('error:message', (error) => {
    showError(error);
    joinBtn.disabled = false;
    joinBtn.innerHTML = 'Join Chat <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10H16M16 10L11 5M16 10L11 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
});

function showError(message) {
    joinError.textContent = message;
    joinError.classList.remove('hidden');
}

function hideError() {
    joinError.classList.add('hidden');
}

// ==================== CHAT HANDLING ====================

// Successful join
socket.on('message:received', (message) => {
    if (message.type === 'system' && message.text.includes('Welcome')) {
        // We've joined successfully
        currentUsername = socket.username || usernameInput.value.trim();
        enterChat();
    }
    addMessage(message);
});

function enterChat() {
    hideError();
    joinScreen.classList.remove('active');
    chatScreen.classList.add('active');
    currentUserSpan.textContent = currentUsername;
    messageInput.focus();
    
    // Reset join button
    joinBtn.disabled = false;
    joinBtn.innerHTML = 'Join Chat <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10H16M16 10L11 5M16 10L11 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

// Leave chat
leaveBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave the chat?')) {
        socket.disconnect();
        resetToJoinScreen();
    }
});

function resetToJoinScreen() {
    chatScreen.classList.remove('active');
    joinScreen.classList.add('active');
    messagesContainer.innerHTML = '';
    onlineUsersList.innerHTML = '';
    onlineCount.textContent = '0';
    usernameInput.value = '';
    usernameInput.focus();
    currentUsername = null;
    hideError();
}

// ==================== MESSAGE HANDLING ====================

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    
    socket.emit('message:send', text);
    messageInput.value = '';
    sendBtn.disabled = true;
    
    // Stop typing indicator
    stopTyping();
});

messageInput.addEventListener('input', () => {
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.disabled = !hasText;
    
    // Handle typing indicator
    if (hasText && !isTyping) {
        startTyping();
    } else if (!hasText && isTyping) {
        stopTyping();
    }
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.dispatchEvent(new Event('submit'));
    }
});

function startTyping() {
    isTyping = true;
    socket.emit('typing:start');
    
    // Clear existing timeout
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    }
    
    // Set timeout to stop typing after 3 seconds of inactivity
    typingTimeout = setTimeout(() => {
        stopTyping();
    }, 3000);
}

function stopTyping() {
    if (isTyping) {
        isTyping = false;
        socket.emit('typing:stop');
    }
    if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
    }
}

// ==================== MESSAGE RENDERING ====================

function addMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.type}`;
    
    if (message.type === 'user') {
        const isOwn = message.username === currentUsername;
        if (isOwn) {
            messageEl.classList.add('own');
        }
        
        const avatarLetter = message.username.charAt(0).toUpperCase();
        const time = formatTime(message.timestamp);
        
        messageEl.innerHTML = `
            <div class="message-avatar">${avatarLetter}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">${escapeHtml(message.username)}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-bubble">${escapeHtml(message.text)}</div>
            </div>
        `;
    } else {
        // System message
        messageEl.innerHTML = `
            <div class="message-bubble">${escapeHtml(message.text)}</div>
        `;
    }
    
    messagesContainer.appendChild(messageEl);
    scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    // Check if it's today
    if (date.toDateString() === now.toDateString()) {
        return `${hours}:${minutes}`;
    }
    
    // Check if it's yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${hours}:${minutes}`;
    }
    
    // Otherwise show date
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== ONLINE USERS ====================

socket.on('users:online', (users) => {
    updateOnlineUsers(users);
});

function updateOnlineUsers(users) {
    onlineUsersList.innerHTML = '';
    onlineCount.textContent = users.length;
    
    users.forEach((user) => {
        const li = document.createElement('li');
        li.className = 'online-user';
        const avatarLetter = user.username.charAt(0).toUpperCase();
        const isCurrent = user.username === currentUsername;
        
        li.innerHTML = `
            <div class="avatar">${avatarLetter}</div>
            <div class="user-info">
                <span class="username">${escapeHtml(user.username)}${isCurrent ? ' (You)' : ''}</span>
                <span class="status">● Online</span>
            </div>
        `;
        
        onlineUsersList.appendChild(li);
    });
}

// ==================== TYPING INDICATOR ====================

socket.on('typing:update', (data) => {
    if (data.username === currentUsername) return;
    
    if (data.isTyping) {
        typingText.textContent = `${escapeHtml(data.username)} is typing...`;
        typingIndicator.classList.remove('hidden');
    } else {
        // Check if there are other users typing
        typingIndicator.classList.add('hidden');
    }
});

// ==================== SOCKET EVENTS ====================

socket.on('connect', () => {
    console.log('Connected to server');
    if (currentUsername) {
        // Rejoin if we were in a chat
        socket.emit('user:join', currentUsername);
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    if (chatScreen.classList.contains('active')) {
        // Show reconnection message
        const msg = {
            id: `system-${Date.now()}`,
            username: 'System',
            text: 'Connection lost. Attempting to reconnect...',
            timestamp: new Date().toISOString(),
            type: 'system'
        };
        addMessage(msg);
    }
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    if (joinScreen.classList.contains('active')) {
        showError('Failed to connect to server. Please try again.');
        joinBtn.disabled = false;
        joinBtn.innerHTML = 'Join Chat <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10H16M16 10L11 5M16 10L11 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
});

// ==================== INITIALIZATION ====================

// Focus username input on load
usernameInput.focus();

// Prevent form submission on enter in username input
usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        joinForm.dispatchEvent(new Event('submit'));
    }
});