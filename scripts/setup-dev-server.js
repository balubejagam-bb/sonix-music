#!/usr/bin/env node

/**
 * Setup script to configure Capacitor for development
 * Usage:
 *   node scripts/setup-dev-server.js localhost          # Use http://localhost:3000
 *   node scripts/setup-dev-server.js 192.168.0.105      # Use http://192.168.0.105:3000
 *   node scripts/setup-dev-server.js 192.168.0.105 8080 # Use http://192.168.0.105:8080
 *   node scripts/setup-dev-server.js                    # Use production (https://sonix-music.vercel.app)
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'capacitor.config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const host = process.argv[2];
const port = process.argv[3] || '3000';

if (!host) {
  // No arguments = production
  config.server.url = 'https://sonix-music.vercel.app';
  console.log('✓ Capacitor configured for PRODUCTION (https://sonix-music.vercel.app)');
} else if (host === 'localhost') {
  config.server.url = `http://localhost:${port}`;
  console.log(`✓ Capacitor configured for LOCAL DEV (http://localhost:${port})`);
} else {
  // Assume it's an IP address
  config.server.url = `http://${host}:${port}`;
  console.log(`✓ Capacitor configured for LOCAL NETWORK (http://${host}:${port})`);
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
