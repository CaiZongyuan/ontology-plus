import { spawn } from 'node:child_process';

const serverProc = spawn('npx', ['tsx', 'watch', 'src/server/node-server.ts'], {
  stdio: 'inherit',
  shell: true,
});

const webProc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173'], {
  stdio: 'inherit',
  shell: true,
});

function cleanup() {
  serverProc.kill();
  webProc.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

