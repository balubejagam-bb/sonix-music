# Port & IP Configuration Guide

## Quick Start

### Option 1: Browser Testing (Localhost)
```bash
npm run dev                    # Starts on http://localhost:3000 (default)
```
Then visit `http://localhost:3000` in your browser.

### Option 2: Mobile Device Testing (Local Network IP)
Find your machine's local IP:
```bash
# Windows
ipconfig

# Mac/Linux
ifconfig
```

Look for IPv4 address like `192.168.x.x`

Then configure Capacitor and run:
```bash
node scripts/setup-dev-server.js 192.168.x.x 3000
npm run dev
```

Visit `http://192.168.x.x:3000` from your Android device on the same network.

### Option 3: Production (Vercel)
```bash
node scripts/setup-dev-server.js
npm run build
npx cap sync
```
Uses `https://sonix-music.vercel.app`

---

## Custom Port (if 3000 is blocked)

Check what's using port 3000:
```bash
netstat -ano | find ":3000"
```

Use a different port:
```bash
npm run dev -- -p 8080
node scripts/setup-dev-server.js 192.168.x.x 8080
```

---

## Environment Variables (Alternative Method)

Copy `.env.local.example` to `.env.local` and edit:
```bash
cp .env.local.example .env.local
```

Then edit `.env.local`:
```
DEV_SERVER_URL=http://192.168.x.x:3000
```

---

## Configuration Summary

- **Default dev port**: 3000 (auto-select if blocked)
- **Flexible IP**: localhost OR local network IP address
- **Capacitor URL**: Configurable via `scripts/setup-dev-server.js` or manual edit
- **Production**: Always `https://sonix-music.vercel.app`
