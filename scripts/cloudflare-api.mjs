// Use Wrangler's existing OAuth login locally. Never print its token or HTTP headers.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function cloudflare(pathname, options = {}) {
  const file = path.join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml');
  const text = await fs.readFile(file, 'utf8');
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('Wrangler OAuth login not found');
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(data.errors)}`);
  return data.result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const resource = process.argv[2];
  if (!resource?.startsWith('/')) throw new Error('Pass a Cloudflare API resource path');
  console.log(JSON.stringify(await cloudflare(resource), null, 2));
}
