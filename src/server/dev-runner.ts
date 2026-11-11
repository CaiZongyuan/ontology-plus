import { spawn } from 'node:child_process';

const serverProc = spawn('pnpm', ['run', 'dev:server'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: true,
});

const webProc = spawn('pnpm', ['run', 'dev:web'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: true,
});

function cleanup() {
  serverProc.kill();
  webProc.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

