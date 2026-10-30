import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './request-policy.mjs';

export const APPROVAL_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const REQUEST_FILE = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.request\.json$/;
export const MAX_RECORD_BYTES = 1200000;
export const MAX_APPROVED_RECORD_BYTES = 512;
export class ApprovalRecordTooLargeError extends Error {
  constructor() {
    super('Request exceeds the local approval size limit. Reduce the request arguments or metadata.');
    this.code = 'APPROVAL_RECORD_TOO_LARGE';
  }
}
export async function readJson(file, maximum = MAX_RECORD_BYTES) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Invalid local approval record.');
  const content = await fs.readFile(file, 'utf8');
  if (Buffer.byteLength(content) > maximum) throw new Error('Approval record is too large.');
  return JSON.parse(content);
}
export function validRequest(record, expectedId, now) {
  try {
    return record?.id === expectedId && APPROVAL_ID.test(record.id) && Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.expiresAt) && record.expiresAt > now && record.createdAt <= now && record.expiresAt - record.createdAt === 300000 && record.hash === digest(record.request);
  } catch { return false; }
}
export async function atomicJson(file, value, maximum = MAX_RECORD_BYTES) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RECORD_BYTES) throw new Error('Invalid approval record size limit.');
  // Measure the bytes we will publish, before creating even a temporary file.
  // Indentation can amplify deeply nested metadata far beyond its wire size.
  const content = JSON.stringify(value);
  if (typeof content !== 'string') throw new Error('Invalid local approval record.');
  if (Buffer.byteLength(content) > maximum) throw new ApprovalRecordTooLargeError();
  const temporary = path.join(path.dirname(file), `.approval-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content); await handle.sync(); await handle.close(); handle = null;
    // Publishing is atomic and cannot replace an existing approval.
    await fs.link(temporary, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}
export async function removeRequest(directory, id) {
  if (!APPROVAL_ID.test(id)) throw new Error('Invalid approval ID.');
  for (const suffix of ['request.json', 'approved.json']) await fs.unlink(path.join(directory, `${id}.${suffix}`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
