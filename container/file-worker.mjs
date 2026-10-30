import { createToolRuntime } from '../local/tools.mjs';
import path from 'node:path';

export async function readJsonInput(stream, maximum = 1100000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximum) throw new Error('Request too large');
    chunks.push(buffer);
  }
  // Decode once after assembling bounded bytes: pipe boundaries are not UTF-8
  // character boundaries, and replacement decoding could silently modify files.
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
}

async function main() {
  const request = await readJsonInput(process.stdin);
  const runtime = await createToolRuntime({ roots: ['/workspace'], defaultCwd: '/workspace', stateDir: '/opt/private', sourceRoot: '/opt/bridge', allowExec: false });
  try { process.stdout.write(JSON.stringify(await runtime.handleRpc(request))); }
  finally { await runtime.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch(() => {
  console.error('Invalid or failed isolated file request.');
  process.exitCode = 1;
});
