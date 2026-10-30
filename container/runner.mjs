// PID 1 is a small trusted supervisor. Development commands run as uid/gid 1000.
// Their stdin is never the control pipe; they cannot renew the host's lease.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
let child, started = false, lastLease = Date.now(), timer, drainTimer;
const finish = code => process.exit(Number.isInteger(code) ? Math.max(0, Math.min(255, code)) : 1);
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const lease = setInterval(() => { if (Date.now() - lastLease > 20000) finish(125); }, 2000);
process.on('SIGTERM', () => finish(143));
process.on('SIGINT', () => finish(130));
lines.on('close', () => finish(125));
lines.on('line', line => {
  if (Buffer.byteLength(line) > 1100000) return finish(125);
  let message;
  try { message = JSON.parse(line); } catch { return finish(125); }
  if (started) { if (message.type === 'lease') lastLease = Date.now(); return; }
  started = true;
  if (!['file', 'command'].includes(message.kind) || !Number.isSafeInteger(message.timeout) || message.timeout < 100 || message.timeout > 3600000) return finish(125);
  const executable = message.kind === 'file' ? '/usr/local/bin/node' : '/bin/bash';
  const args = message.kind === 'file' ? ['/opt/bridge/container/file-worker.mjs'] : ['--noprofile', '--norc', '-c', message.cmd];
  const cwd = message.cwd || '/workspace';
  if (typeof cwd !== 'string' || !(cwd === '/workspace' || cwd.startsWith('/workspace/')) || cwd.split('/').includes('..')) return finish(125);
  const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/home/developer', LANG: 'C.UTF-8', NO_COLOR: '1', PYTHONUNBUFFERED: '1', GOTOOLCHAIN: 'local', GOPATH: '/home/developer/go', GOCACHE: '/home/developer/.cache/go-build', CARGO_HOME: '/home/developer/.cargo', WRANGLER_SEND_METRICS: 'false' };
  child = spawn(executable, args, { cwd, uid: 1000, gid: 1000, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.once('error', () => finish(126));
  // Flush complete output when possible. Descendants retaining output pipes get
  // at most one second; a forced drain expiry reports failure instead of success.
  child.once('exit', () => { drainTimer = setTimeout(() => finish(125), 1000); });
  child.once('close', code => {
    clearTimeout(timer); clearTimeout(drainTimer); clearInterval(lease);
    const fallback = setTimeout(() => finish(125), 1000);
    process.stdout.write('', () => process.stderr.write('', () => { clearTimeout(fallback); finish(code); }));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(message.kind === 'file' ? JSON.stringify(message.body) : undefined);
  timer = setTimeout(() => finish(124), message.timeout);
});
