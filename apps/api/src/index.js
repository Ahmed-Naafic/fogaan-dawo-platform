import { createApp } from './app.js';

/**
 * Vercel entry point (Express preset): exports the app, never listens, starts no intervals.
 * Local development keeps using src/server.js (listen + background loops + WebSocket signaling).
 * The signaling hub cannot run here (in-memory rooms/tickets), so its path answers 503 SIGNALING_UNAVAILABLE.
 */
const app = createApp({ signalingAvailable: false });

export default app;
