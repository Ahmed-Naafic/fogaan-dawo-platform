// Vercel Express-preset entry. The preset takes the FIRST of app.js, index.js, server.js, src/app.js,
// src/index.js, src/server.js that imports "express", so src/app.js (a factory with no default export)
// would win over src/index.js. This root file is checked first; the import below is what the detector
// looks for. The real entry is src/index.js; local development still uses src/server.js.
import 'express';
export { default } from './src/index.js';
