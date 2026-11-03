// Runs the web and API dev servers together with prefixed output (no extra dependencies).
import { spawn, spawnSync } from 'node:child_process';

const apps = [
  { name: 'web', workspace: '@fogaan-dawo/web', color: '\x1b[36m' },
  { name: 'api', workspace: '@fogaan-dawo/api', color: '\x1b[35m' },
];
const reset = '\x1b[0m';
const children = [];

const prefix = (app, chunk) =>
  chunk
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `${app.color}[${app.name}]${reset} ${line}`)
    .join('\n') + '\n';

for (const app of apps) {
  // Single command string + shell: needed for npm.cmd on Windows; workspace names are constants, not user input.
  const child = spawn(`npm run dev -w ${app.workspace}`, { shell: true, env: process.env });
  child.stdout.on('data', (d) => process.stdout.write(prefix(app, d)));
  child.stderr.on('data', (d) => process.stderr.write(prefix(app, d)));
  child.on('exit', (code) => {
    console.log(`${app.color}[${app.name}]${reset} exited with code ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // On Windows, kill() only ends the shell; take down the whole tree (npm → vite/node).
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
