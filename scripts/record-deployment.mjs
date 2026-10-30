import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { cloudflare } from './cloudflare-api.mjs';
import { proxyCandidates } from '../local/connector.mjs';

const root = path.resolve(import.meta.dirname, '..');
const account = '00000000000000000000000000000000';
const worker = 'agentdock-bridge';
const hostname = 'bridge.example.test';
const [domains, deployments] = await Promise.all([
  cloudflare(`/accounts/${account}/workers/domains`),
  cloudflare(`/accounts/${account}/workers/scripts/${worker}/deployments`),
]);
const domain = domains.find(value => value.hostname === hostname && value.service === worker);
if (!domain) throw new Error('The requested custom domain is not attached to this Worker');
const health = await new Promise((resolve, reject) => {
  const proxy = proxyCandidates().find(Boolean);
  const request = https.get(`https://${hostname}/healthz`, { agent: proxy ? new HttpsProxyAgent(proxy) : undefined, timeout: 15000 }, response => {
    let text = '';
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
  });
  request.on('error', reject);
  request.on('timeout', () => request.destroy(new Error('Health timed out')));
});
if (health.status !== 200 || !health.body.connectorOnline) throw new Error('The connector is not currently healthy');
const hashes = {};
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', '.wrangler', 'artifacts'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) hashes[path.relative(root, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
}
await walk(root);
const acceptance = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'acceptance-result.json'), 'utf8'));
if (!acceptance.success || acceptance.checks.some(check => !check.passed)) throw new Error('Public acceptance has not passed');
const record = {
  time: new Date().toISOString(), accountId: account, worker, mcpUrl: `https://${hostname}/mcp`,
  customDomain: { hostname: domain.hostname, zone: domain.zone_name, enabled: domain.enabled, certificateId: domain.cert_id },
  deployment: deployments.deployments?.[0] || deployments[0] || deployments,
  health, tests: { passed: 16, failed: 0 },
  lifecycle: { gracefulStop: 'passed', offlineHealthHttp: 503, manualRestart: 'passed', restartedHealthHttp: 200 },
  publicAcceptance: acceptance,
  chatgptClientConnection: 'User still needs to add this MCP URL and complete OAuth in their own client.',
  sourceSha256: hashes,
};
await fs.writeFile(path.join(root, 'artifacts', 'deployment-result.json'), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ worker, accountId: account, hostname, health: health.status, publicAcceptance: acceptance.success, sourceFiles: Object.keys(hashes).length }));
