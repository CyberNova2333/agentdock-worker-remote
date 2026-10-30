import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { defaultStateDirectory, proxyCandidates } from '../local/connector.mjs';
const exec = promisify(execFile);
const stateDir = defaultStateDirectory();
const config = JSON.parse(await fs.readFile(path.join(stateDir, 'config.json'), 'utf8'));
const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const manage = action => exec(shell, ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(config.sourceRoot, 'scripts', 'Manage.ps1'), '-Action', action, '-StateDir', stateDir], { timeout: 30000, windowsHide: true });
const proxy = proxyCandidates().find(Boolean);
export function health() {
  return new Promise((resolve, reject) => {
    const req = https.get(`${config.origin}/healthz`, { timeout: 8000, agent: proxy ? new HttpsProxyAgent(proxy) : undefined }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; if (text.length > 4096) req.destroy(); });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch { reject(new Error('Invalid health response')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Health timeout'))); req.on('error', reject);
  });
}
async function waitHealth(wanted) {
  // Startup may perform three read-only Docker queries, each with one bounded
  // retry. Allow their full budget; shutdown remains deliberately short.
  const deadline = Date.now() + (wanted === 200 ? 210000 : 35000);
  do {
    try { const current = await health(); if (current.status === wanted) return current; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  throw new Error('Public health did not reach the expected state');
}
const record = { time: new Date().toISOString(), success: false };
try {
  await manage('Stop');
  record.stopped = await waitHealth(503);
  const local = JSON.parse(await fs.readFile(path.join(stateDir, 'connector-status.json'), 'utf8'));
  if (local.online !== false) throw new Error('Local stop not confirmed');
  await manage('Start');
  record.restarted = await waitHealth(200);
  record.success = true;
  console.log('PASS graceful stop -> public 503 -> restart -> public 200');
} finally {
  if (!record.success) await manage('Start').catch(() => {});
  await fs.writeFile(new URL('../artifacts/lifecycle-v2.json', import.meta.url), JSON.stringify(record, null, 2));
}
