import { createHash } from 'node:crypto';

const toolScopes = new Map([
  ...['computer_context', 'list_directory', 'read_file', 'search_files'].map(name => [name, ['computer:read']]),
  ...['write_file', 'edit_file', 'delete_file'].map(name => [name, ['computer:read', 'computer:write']]),
  ...['exec_command', 'command_status', 'stop_command'].map(name => [name, ['computer:read', 'computer:execute']]),
]);
const basicMethods = new Set(['initialize', 'ping', 'tools/list', 'notifications/initialized', 'notifications/cancelled']);
const allowedScopes = new Set(['computer:read', 'computer:write', 'computer:execute', 'offline_access']);
export const APPROVAL_EXEMPT_TOOLS = new Set(['computer_context', 'command_status', 'stop_command']);
export const requiresApproval = body => body?.method === 'tools/call' && !APPROVAL_EXEMPT_TOOLS.has(body.params?.name);

function boundedJson(value) {
  const pending = [{ value, depth: 0 }];
  let inspected = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++inspected > 20000 || item.depth > 32) throw new Error('Request structure exceeds the local budget.');
    if (item.value && typeof item.value === 'object') for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
  }
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

export function validateRequestEnvelope(message, now = Date.now()) {
  if (!message || message.type !== 'request' || typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(message.id)) throw new Error('Invalid request envelope.');
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.deadline) || message.issuedAt > now + 5000 || message.deadline <= now || message.deadline - message.issuedAt > 110000 || message.deadline <= message.issuedAt || now - message.issuedAt > 110000) throw new Error('Expired or invalid request deadline.');
  const auth = message.authorization;
  if (!auth || auth.userId !== 'owner' || typeof auth.clientId !== 'string' || !auth.clientId || auth.clientId.length > 2048 || !Array.isArray(auth.scope) || auth.scope.length > 4 || auth.scope.some(scope => !allowedScopes.has(scope))) throw new Error('Missing or invalid client authorization.');
  const body = message.body;
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.method.length > 100 || ('id' in body && body.id !== null && typeof body.id !== 'string' && !(typeof body.id === 'number' && Number.isFinite(body.id)))) throw new Error('Invalid JSON-RPC request.');
  if (typeof body.id === 'string' && body.id.length > 256) throw new Error('Invalid JSON-RPC request ID.');
  if ('params' in body && (!body.params || typeof body.params !== 'object' || Array.isArray(body.params))) throw new Error('Invalid JSON-RPC parameters.');
  boundedJson(body);
  const required = body.method === 'tools/call' ? toolScopes.get(body.params?.name) : basicMethods.has(body.method) ? ['computer:read'] : undefined;
  if (!required || !required.every(scope => auth.scope.includes(scope))) throw new Error('Tool or scope is not permitted by the local policy.');
  return { body: structuredClone(body), authorization: { userId: auth.userId, clientId: auth.clientId, scope: [...new Set(auth.scope)].sort() } };
}

export function approvalSubject(origin, body, authorization) {
  return { origin, authorization, method: body.method, params: body.params ?? {} };
}
