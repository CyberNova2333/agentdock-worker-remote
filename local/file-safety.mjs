import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class FilePolicyError extends Error {}
const deny = message => { throw new FilePolicyError(message); };
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
export function beneath(candidate, root) {
  const relative = path.relative(normalized(root), normalized(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
const identity = info => `${info.dev}:${info.ino}`;
const version = info => `${identity(info)}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
function regular(info) {
  if (!info.isFile()) deny('Expected a regular file.');
  if (info.nlink !== 1) deny('Files with multiple hard links are not exposed.');
}

// This is defense in depth inside the container's mount boundary, not an OS
// sandbox. A hostile process with namespace write access can race string APIs.
export async function createFilePolicy(config, checkpoint) {
  const roots = [...new Set(await Promise.all(config.roots.map(p => fs.realpath(p))))];
  for (const root of roots) if (!(await fs.stat(root)).isDirectory()) throw new Error('Approved roots must be directories.');
  const protectedPaths = [...new Set([config.stateDir, config.sourceRoot || path.resolve(import.meta.dirname, '..'), ...(config.protectedPaths || [])].map(p => path.resolve(p)))];
  for (let i = 0; i < protectedPaths.length; i++) protectedPaths[i] = await fs.realpath(protectedPaths[i]).catch(error => error.code === 'ENOENT' ? protectedPaths[i] : Promise.reject(error));
  for (const root of roots) {
    if (protectedPaths.some(protectedPath => beneath(root, protectedPath) || beneath(protectedPath, root))) throw new Error('Approved work roots must be separate from private state and trusted runtime directories.');
  }
  const defaultCwd = await fs.realpath(config.defaultCwd || roots[0]);
  function permitted(file) {
    if (protectedPaths.some(protectedPath => beneath(file, protectedPath))) deny('The private connector state and trusted runtime paths are not exposed.');
    if (!roots.some(root => beneath(file, root))) deny('Path is outside approved file roots.');
  }
  permitted(defaultCwd);

  async function resolve(input, { create = false, directory = false } = {}) {
    checkpoint();
    if (input !== undefined && (typeof input !== 'string' || !input.isWellFormed())) deny('Invalid Unicode file path.');
    const requested = path.resolve(defaultCwd, input ?? '.');
    permitted(requested);
    const root = roots.filter(value => beneath(requested, value)).sort((a, b) => b.length - a.length)[0];
    const components = path.relative(root, requested).split(path.sep).filter(Boolean);
    let cursor = root;
    for (let index = 0; index < components.length; index++) {
      checkpoint();
      cursor = path.join(cursor, components[index]);
      let info;
      try { info = await fs.lstat(cursor); }
      catch (error) { if (create && index === components.length - 1 && error.code === 'ENOENT') break; throw error; }
      if (info.isSymbolicLink()) deny('Symbolic links and junctions are not exposed; target may be outside approved roots.');
      if (index !== components.length - 1 && !info.isDirectory()) deny('Expected a directory.');
      if (info.isFile() && info.nlink !== 1) deny('Files with multiple hard links are not exposed.');
    }
    const actual = await fs.realpath(requested).catch(async error => {
      if (!create || error.code !== 'ENOENT') throw error;
      return path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
    });
    permitted(actual);
    if (normalized(actual) !== normalized(requested)) deny('Path changed or uses a filesystem alias.');
    if (directory && !(await fs.lstat(actual)).isDirectory()) deny('Expected a directory.');
    checkpoint();
    return actual;
  }

  async function openRead(file) {
    file = await resolve(file);
    const before = await fs.lstat(file);
    regular(before);
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      regular(info);
      await resolve(file);
      const current = await fs.lstat(file);
      regular(current);
      if (identity(info) !== identity(before) || identity(info) !== identity(current)) deny('File identity changed while opening. Retry after the local writer finishes.');
      checkpoint();
      return { handle, info };
    } catch (error) { await handle.close(); throw error; }
  }

  async function readSmall(file, maximum = 1024 * 1024, onRead = () => {}) {
    const { handle, info } = await openRead(file);
    try {
      if (info.size > maximum) deny('File exceeds the edit/search byte limit.');
      const content = Buffer.alloc(info.size);
      let bytes = 0;
      while (bytes < content.length) {
        checkpoint();
        const { bytesRead } = await handle.read(content, bytes, Math.min(65536, content.length - bytes), bytes);
        if (!bytesRead) break;
        bytes += bytesRead;
        onRead(bytesRead);
      }
      if (bytes !== content.length) deny('File changed during read. Retry after the local writer finishes.');
      await assertReadStable(file, handle, info);
      checkpoint();
      return { content, info };
    } finally { await handle.close(); }
  }

  async function assertReadStable(file, handle, prior) {
    checkpoint();
    const opened = await handle.stat();
    regular(opened);
    await resolve(file);
    const current = await fs.lstat(file);
    regular(current);
    if (version(opened) !== version(prior) || version(current) !== version(prior)) deny('File changed during read. Retry after the local writer finishes.');
    checkpoint();
  }

  async function assertVersion(file, prior) {
    const resolved = await resolve(file, { create: prior === null });
    const current = await fs.lstat(resolved).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (current) regular(current);
    if (prior === null ? current !== null : current === null || version(prior) !== version(current)) deny('File changed before commit. Read it again.');
  }

  async function atomicWrite(file, content, { overwrite = false, prior = null } = {}) {
    if (typeof content !== 'string' || !content.isWellFormed()) deny('Invalid Unicode file content.');
    file = await resolve(file, { create: true });
    const temporary = path.join(path.dirname(file), `.agentdock-write-${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      const created = await handle.stat();
      const bytes = Buffer.from(content, 'utf8');
      for (let offset = 0; offset < bytes.length;) {
        checkpoint();
        const { bytesWritten } = await handle.write(bytes, offset, Math.min(65536, bytes.length - offset), offset);
        if (!bytesWritten) throw new Error('Unable to finish temporary file.');
        offset += bytesWritten;
      }
      // Keep ordinary permission bits on replacement, but never carry setuid,
      // setgid or sticky bits from a project file into a new inode.
      if (prior !== null && process.platform !== 'win32') await handle.chmod(prior.mode & 0o777);
      await handle.sync();
      await handle.close(); handle = null;
      await resolve(temporary);
      if (identity(await fs.lstat(temporary)) !== identity(created)) deny('Temporary file identity changed.');
      if (overwrite) await assertVersion(file, prior);
      else await resolve(file, { create: true });
      checkpoint();
      if (overwrite) await fs.rename(temporary, file);
      else {
        // link is an atomic create-if-absent; unlike rename it cannot overwrite
        // a destination created by another process after our check.
        await fs.link(temporary, file);
        await fs.unlink(temporary);
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }
  return { roots, defaultCwd, protectedPaths, permitted, resolve, openRead, readSmall, assertReadStable, assertVersion, atomicWrite };
}
