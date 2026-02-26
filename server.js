const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6 // 5MB for voice data
});

app.use(express.static(path.join(__dirname, 'public')));

// ── GHOST ID GENERATOR ──
const PREFIXES = ['GHOST', 'VOID', 'SHADE', 'NULL', 'ECHO', 'NEON', 'DARK', 'CIPHER', 'SPECTER', 'MIRAGE', 'FLUX', 'GLITCH', 'PIXEL', 'STATIC', 'PHASE'];
const generateGhostId = () => {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const suffix = Math.random().toString(36).substr(2, 3).toUpperCase() + Math.floor(Math.random() * 9);
  return `${prefix}-${suffix}`;
};

// ── SERVER STATE ──
const waitingQueue = []; // sockets waiting for a match
const rooms = new Map();  // roomId → { users: [socketId, socketId], ghostIds: Map }
const socketToRoom = new Map(); // socketId → roomId
const socketGhostIds = new Map(); // socketId → ghostId
const socketGhostDisplay = new Map(); // socketId → what THEY see themselves as

// ── ROOM MANAGEMENT ──
function createRoom(socket1, socket2) {
  const roomId = uuidv4();

  // Each user sees the other as a ghost, themselves as "YOU"
  const ghost1 = generateGhostId(); // socket1 sees socket2 as this
  const ghost2 = generateGhostId(); // socket2 sees socket1 as this

  rooms.set(roomId, {
    users: [socket1.id, socket2.id],
    ghostIds: new Map([
      [socket1.id, ghost1], // socket2 will see socket1 as ghost1
      [socket2.id, ghost2], // socket1 will see socket2 as ghost2
    ]),
    createdAt: Date.now(),
    messageCount: 0,
    voiceCount: 0
  });

  socketToRoom.set(socket1.id, roomId);
  socketToRoom.set(socket2.id, roomId);

  socket1.join(roomId);
  socket2.join(roomId);

  const hops = Math.floor(Math.random() * 4) + 3; // 3–6 hops

  // Tell each user they're connected, give them partner's ghost ID
  socket1.emit('matched', {
    roomId,
    partnerGhostId: ghost2,
    myGhostId: socketGhostIds.get(socket1.id),
    hops,
    encKey: uuidv4().replace(/-/g, '').substr(0, 12)
  });

  socket2.emit('matched', {
    roomId,
    partnerGhostId: ghost1,
    myGhostId: socketGhostIds.get(socket2.id),
    hops,
    encKey: uuidv4().replace(/-/g, '').substr(0, 12)
  });

  console.log(`[MESH] Room ${roomId.substr(0,8)} — Pair connected (${hops} hops)`);
  broadcastStats();
}
// Fix Android keyboard pushing layout
function fixViewport() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
fixViewport();
window.addEventListener('resize', fixViewport);
window.addEventListener('orientationchange', () => {
  setTimeout(fixViewport, 300);
});

// Keep input visible when keyboard opens on Android
document.getElementById('msg-input').addEventListener('focus', () => {
  setTimeout(() => {
    document.getElementById('msg-input').scrollIntoView({ block: 'center' });
  }, 400);
});

function disconnectFromRoom(socketId) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (!room) return;

  // Notify the other user
  const otherId = room.users.find(id => id !== socketId);
  if (otherId) {
    const otherSocket = io.sockets.sockets.get(otherId);
    if (otherSocket) {
      otherSocket.emit('partner_disconnected');
      otherSocket.leave(roomId);
    }
    socketToRoom.delete(otherId);
  }

  socketToRoom.delete(socketId);
  rooms.delete(roomId);
  console.log(`[MESH] Room ${roomId.substr(0,8)} — Pair disconnected`);
  broadcastStats();
}

function broadcastStats() {
  io.emit('stats', {
    online: io.engine.clientsCount,
    waiting: waitingQueue.length,
    rooms: rooms.size
  });
}

// ── SOCKET EVENTS ──
io.on('connection', (socket) => {
  const ghostId = generateGhostId();
  socketGhostIds.set(socket.id, ghostId);

  console.log(`[+] ${ghostId} connected (${io.engine.clientsCount} total)`);

  // Send initial identity
  socket.emit('identity', { ghostId });
  broadcastStats();

  // ── FIND MATCH ──
  socket.on('find_match', () => {
    // Already in a room
    if (socketToRoom.has(socket.id)) {
      socket.emit('error_msg', 'Already in a room. Disconnect first.');
      return;
    }
    // Already in queue
    if (waitingQueue.includes(socket.id)) {
      socket.emit('error_msg', 'Already searching...');
      return;
    }

    const queueIdx = waitingQueue.findIndex(id => id !== socket.id);
    if (queueIdx !== -1) {
      const partnerId = waitingQueue.splice(queueIdx, 1)[0];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        createRoom(socket, partnerSocket);
      } else {
        waitingQueue.push(socket.id);
        socket.emit('searching');
      }
    } else {
      waitingQueue.push(socket.id);
      socket.emit('searching');
      console.log(`[QUEUE] ${ghostId} waiting... (${waitingQueue.length} in queue)`);
    }
    broadcastStats();
  });

  // ── CANCEL SEARCH ──
  socket.on('cancel_search', () => {
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    socket.emit('search_cancelled');
    broadcastStats();
  });

  // ── SEND TEXT MESSAGE ──
  socket.on('send_message', ({ text }) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    if (!text || text.length > 1000) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.messageCount++;

    // Relay to the other user only — sender's ID never exposed
    socket.to(roomId).emit('receive_message', {
      text: text.trim(),
      timestamp: Date.now()
    });

    console.log(`[MSG] Room ${roomId.substr(0,8)} — text relay`);
  });

  // ── SEND VOICE MESSAGE ──
  socket.on('send_voice', ({ audioData, duration, modulation }) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.voiceCount++;

    socket.to(roomId).emit('receive_voice', {
      audioData,  // base64 audio blob
      duration,
      modulation,
      timestamp: Date.now()
    });

    console.log(`[VOICE] Room ${roomId.substr(0,8)} — voice relay (${modulation})`);
  });

  // ── TYPING INDICATOR ──
  socket.on('typing_start', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.to(roomId).emit('partner_typing', true);
  });

  socket.on('typing_stop', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.to(roomId).emit('partner_typing', false);
  });

  // ── VOICE CALL SIGNALING ──
  socket.on('call_offer', ({ signal }) => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.to(roomId).emit('call_offer', { signal });
  });

  socket.on('call_answer', ({ signal }) => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.to(roomId).emit('call_answer', { signal });
  });

  socket.on('call_ice', ({ candidate }) => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.to(roomId).emit('call_ice', { candidate });
  });

  socket.on('call_end', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.to(roomId).emit('call_ended');
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    console.log(`[-] ${ghostId} disconnected`);
    disconnectFromRoom(socket.id);
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);
    socketGhostIds.delete(socket.id);
    socketToRoom.delete(socket.id);
    broadcastStats();
  });

  // ── MANUAL SKIP / NEXT ──
  socket.on('skip', () => {
    disconnectFromRoom(socket.id);
    // Auto-queue for next
    waitingQueue.push(socket.id);
    socket.emit('searching');
    broadcastStats();
  });
});

// ── CLEANUP stale waiting sockets every 30s ──
setInterval(() => {
  for (let i = waitingQueue.length - 1; i >= 0; i--) {
    const s = io.sockets.sockets.get(waitingQueue[i]);
    if (!s || !s.connected) waitingQueue.splice(i, 1);
  }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   G H O S T M E S H   v2.0           ║
  ║   Anonymous Relay Network             ║
  ║   http://localhost:${PORT}              ║
  ╚═══════════════════════════════════════╝
  `);
});