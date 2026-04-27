# Realtime Chat App

A full-stack real-time chat application built with Node.js, Express, and Socket.IO. Users can join chat rooms with a unique username, send messages in real-time, see who's online, and receive typing indicators.

## Features

- **Real-time messaging** - Instant message delivery using WebSocket connections
- **Username system** - Join with a unique username (2-30 characters)
- **Online user tracking** - See who's currently in the chat room
- **Typing indicators** - See when other users are typing
- **Timestamps** - Messages display formatted timestamps
- **System notifications** - Join/leave messages
- **Auto-reconnection** - Automatically reconnects on connection loss
- **Responsive design** - Works on desktop and mobile devices
- **Error handling** - Graceful error messages for invalid inputs
- **Modern UI** - Dark theme with smooth animations

## Tech Stack

- **Backend**: Node.js, Express.js, Socket.IO
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Real-time Communication**: Socket.IO (WebSocket)
- **Styling**: CSS with custom properties and animations

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd realtime-chat-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### Development Mode
```bash
npm run dev
```
This starts the server with nodemon for auto-restart on file changes.

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in the `PORT` environment variable).

## How to Use

1. Open your browser and navigate to `http://localhost:3000`
2. Enter a unique username (2-30 characters)
3. Click "Join Chat" to enter the chat room
4. Start sending messages in real-time
5. View online users in the sidebar
6. See typing indicators when others are typing

## Project Structure

```
realtime-chat-app/
├── public/
│   ├── index.html      # Main HTML file
│   ├── styles.css      # CSS styles
│   └── app.js          # Client-side JavaScript
├── server.js           # Express + Socket.IO server
├── package.json        # Project dependencies
└── README.md           # Project documentation
```

## API Endpoints

- `GET /` - Serves the chat application
- WebSocket connection via Socket.IO on the same port

## Socket.IO Events

### Client to Server
- `user:join` - Join the chat with a username
- `message:send` - Send a chat message
- `typing:start` - User started typing
- `typing:stop` - User stopped typing

### Server to Client
- `message:received` - New message received
- `users:online` - Updated list of online users
- `typing:update` - Typing status update
- `error:message` - Error message

## Environment Variables

- `PORT` - Server port (default: 3000)

## License

MIT