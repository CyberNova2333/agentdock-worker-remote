import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { cloudflare } from './cloudflare-api.mjs';
import { defaultStateDirectory, proxyCandidates } from '../local/connector.mjs';
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const stateDir = defaultStateDirectory();
const config = JSON.parse(await fs.readFile(path.join(stateDir, 'config.json'), 'utf8'));
const installation = JSON.parse(await fs.readFile(path.join(stateDir, 'installation.json'), 'utf8'));
const acceptance = JSON.parse(await fs.readFile(path.join(root, 'artifacts/acceptance-v2-result.json'), 'utf8'));
const lifecycle = JSON.parse(await fs.readFile(path.join(root, 'artifacts/lifecycle-v2.json'), 'utf8'));
const testOutput = await fs.readFile(path.join(root, 'artifacts/fix-round5/final-tests.txt'), 'utf8');
const passed = Number(testOutput.match(/pass (\d+)/)?.[1]);
const failed = Number(testOutput.match(/fail (\d+)/)?.[1]);
const skipped = Number(testOutput.match(/skipped (\d+)/)?.[1]);
const cancelled = Number(testOutput.match(/cancelled (\d+)/)?.[1]);
if (!acceptance.success || !lifecycle.success || !passed || failed !== 0 || skipped !== 0 || cancelled !== 0) throw new Error('Verification is incomplete');
if (!config.nodeRoot || !/^[a-f0-9]{64}$/.test(config.nodeSha256 || '') || crypto.createHash('sha256').update(await fs.readFile(config.nodePath)).digest('hex') !== config.nodeSha256) throw new Error('Private Node integrity verification failed');
const [account] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/.test(account || '')) throw new Error('Usage: node scripts/record-hardening.mjs <cloudflare-account-id>');
const hostname = new URL(config.origin).hostname;
const [domains, deployments] = await Promise.all([
  cloudflare(`/accounts/${account}/workers/domains`),
  cloudflare(`/accounts/${account}/workers/scripts/agentdock-bridge/deployments`),
]);
if (!domains.some(domain => domain.hostname === hostname && domain.service === 'agentdock-bridge')) throw new Error('Domain binding mismatch');
const proxy = proxyCandidates().find(Boolean);
const health = await new Promise((resolve, reject) => {
  const req = https.get(`${config.origin}/healthz`, { timeout: 15000, agent: proxy ? new HttpsProxyAgent(proxy) : undefined }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { reject(new Error('Invalid health')); } });
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Health timeout')));
});
if (health.status !== 200 || !health.body.connectorOnline) throw new Error('Public connector is offline');
const hashes = {};
async function walk(directory) {
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', '.wrangler', 'artifacts'].includes(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await walk(file);
    else if (item.isFile()) hashes[path.relative(root, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
}
await walk(root);
for (const [relative, hash] of Object.entries(installation.sha256)) {
  const installed = path.join(config.sourceRoot, relative);
  if (crypto.createHash('sha256').update(await fs.readFile(installed)).digest('hex') !== hash) throw new Error('Installed runtime integrity mismatch');
  if (hashes[relative.replaceAll('\\', '/')] !== hash) throw new Error('Installed runtime differs from reviewed source');
}
const installedFiles = new Set(Object.keys(installation.sha256).map(relative => relative.replaceAll('\\', '/')));
for (const relative of Object.keys(hashes)) {
  if ((relative.startsWith('local/') || relative.startsWith('scripts/') || ['package.json', 'pnpm-lock.yaml'].includes(relative)) && !installedFiles.has(relative)) throw new Error('Reviewed runtime file is missing from the installation');
}
const inventory = await exec(config.sandbox.dockerPath, ['--context', config.sandbox.context, 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', '/bin/cat', config.sandbox.image, '/opt/bridge/os-packages.txt', '/opt/bridge/npm-packages.json'], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
await fs.writeFile(path.join(root, 'artifacts/container-packages.txt'), inventory.stdout);
const record = { time: new Date().toISOString(), review: 'fix-round5-2026-10-30', fixedFindings: ['R5-01','R5-02','R5-03'], hardening: ['full consent CSP', 'private-state ancestor trust', 'bounded read-only Docker initialization retries'], accountId: account, worker: 'agentdock-bridge', mcpUrl: `${config.origin}/mcp`, deployment: deployments.deployments?.[0] || deployments[0], health, tests: { passed, failed, skipped, cancelled }, acceptance, lifecycle, runtime: config.sourceRoot, nodeRuntime: {path:config.nodePath,root:config.nodeRoot,sha256:config.nodeSha256}, workspace: config.roots, containerPath: '/workspace', image: config.sandbox.image, localApprovalRequired: true, secretsRotatedThisRound: false, oldOAuthGrantsInvalidated: false, stateDirectory: stateDir, sourceSha256: hashes, limitations: ['Full mounted-project access includes any project-local credentials.', 'Worker remains a trusted intermediary for content and output.', 'Custom Windows file ACLs cause file-tool replacements to be refused; approved shell access is unrestricted within projects.', 'CLIs are installed without copying host login credentials.', 'ChatGPT account connection is not tested.'] };
await fs.writeFile(path.join(root, 'artifacts/hardening-deployment.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ worker: record.worker, health: health.status, tests: record.tests, acceptance: acceptance.success, image: record.image }));
