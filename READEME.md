# 👻 GhostMesh v2.0 — Anonymous Real-Time Chat

> Talk to real humans. Be absolutely no one.

## ✦ Stack
- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla HTML/CSS/JS (no build step needed)
- **Voice**: Web Audio API + MediaRecorder (browser-native)

## ✦ Features
- 🔗 **Real human-to-human matching** via server-side queue
- 👻 **Ghost IDs** assigned server-side (e.g. `VOID-X3F9`)
- 🌐 **Multi-hop relay** — messages route through server, no direct P2P
- 🔊 **Voice messages** — recorded in browser, relayed as base64, playable on receipt
- 🎙 **Voice modulation modes**: Robotic, Deep, Ghost, Chipmunk, Alien, Echo
- ⏭ **Skip / Next** — instantly queue for the next ghost
- 📡 **Live stats** — online count, active chats, waiting queue
- 🔒 **Zero identity exposure** — no accounts, no IPs logged, ephemeral session keys
- 📱 **Mobile-friendly** — touch support for voice recording

## ✦ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run the server
npm start

# 3. Open in browser
# http://localhost:3000
```

For development with auto-reload:
```bash
npm run dev
```

## ✦ How Matching Works

```
User A connects → gets GHOST-AB1
User B connects → gets GHOST-CD2

A clicks "Find a Ghost" → enters queue
B clicks "Find a Ghost" → server sees A in queue → pairs A+B

Server creates a Room:
  - A sees B as "VOID-X3F7"  (B's display name to A)
  - B sees A as "SHADE-4K2"  (A's display name to B)

All messages relay through server:
  A sends "hey" → server receives → forwards to B only
  B's socket ID is never exposed to A
```

## ✦ Voice Architecture

1. User holds 🎤 button → `MediaRecorder` captures audio stream
2. On release → audio blob → base64 encoded
3. Sent via `socket.emit('send_voice', { audioData, duration, modulation })`
4. Server relays to partner's socket
5. Partner receives base64 → decoded to Blob → played via Web Audio

> **Note**: True real-time voice modulation requires a DSP library (like Tone.js or native Web Audio nodes). The current implementation labels modulation mode but the audio processing hook is ready in `server.js` for expansion.

## ✦ Production Deployment

```bash
# Set port via environment variable
PORT=8080 npm start

# Or use PM2
npm install -g pm2
pm2 start server.js --name ghostmesh
```

For HTTPS (required for microphone access in production):
- Use a reverse proxy like nginx with Let's Encrypt SSL
- Or deploy to Railway/Render/Fly.io which handles SSL automatically

## ✦ Security Notes
- No user data is stored — all state is in-memory
- Socket IDs are never shared between users
- Ghost IDs are reassigned each session
- Server cleans stale queue entries every 30s
- Room keys are ephemeral UUIDs shown to users as visual confirmation