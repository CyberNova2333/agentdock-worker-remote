import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

function fakeDocker(executable) {
  const containers = new Map(), calls = [];
  const execFile = () => { throw new Error('Expected the promisified Docker adapter.'); };
  execFile[promisify.custom] = async (file, args) => {
    assert.equal(file, executable);
    assert.deepEqual(args.slice(0, 2), ['--context', 'desktop-linux']);
    const command = args.slice(2);
    calls.push(command);
    switch (command[0]) {
      case 'context': return { stdout: JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///synthetic-docker.sock' } } }]) };
      case 'image':
      case 'ps': return { stdout: '' };
      case 'create': {
        const name = command[command.indexOf('--name') + 1];
        containers.set(name, { name, removed: false, request: null, child: null });
        return { stdout: name };
      }
      case 'rm': {
        assert.equal(command[1], '-f');
        const container = containers.get(command[2]);
        assert.ok(container, 'Only a container created by this fixture may be removed.');
        if (container.request?.cmd === 'synthetic cleanup failure') throw new Error('Synthetic Docker transport failure.');
        container.removed = true;
        queueMicrotask(() => container.child?.finish(137));
        return { stdout: '' };
      }
      default: throw new Error(`Unexpected Docker operation: ${command[0]}`);
    }
  };
  const spawn = (file, args) => {
    assert.equal(file, executable);
    assert.deepEqual(args.slice(0, -1), ['--context', 'desktop-linux', 'start', '--attach', '--interactive']);
    const container = containers.get(args.at(-1));
    assert.ok(container);
    const child = new EventEmitter();
    let ended = false;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.finish = code => {
      if (ended) return;
      ended = true;
      child.stdout.end(); child.stderr.end();
      child.emit('close', code, null);
    };
    child.stdin = new Writable({ write(chunk, encoding, done) {
      const request = JSON.parse(chunk.toString());
      if (request.kind) {
        container.request = request;
        if (request.cmd === 'synthetic cleanup failure') queueMicrotask(() => child.finish(0));
      }
      done();
    } });
    child.kill = () => { child.finish(137); return true; };
    container.child = child;
    return child;
  };
  return { execFile, spawn, calls, containers };
}

test('cleanup failure preserves owned job controls while rejecting new work and cancelled requests', { timeout: 15000 }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-recovery-test-'));
  const workspace = path.join(base, 'workspace'), stateDir = path.join(base, 'state');
  await fs.mkdir(workspace); await fs.mkdir(stateDir);
  const dockerPath = await fs.realpath(process.execPath);
  const docker = fakeDocker(dockerPath);
  const originalExecFile = childProcess.execFile, originalSpawn = childProcess.spawn;
  let runtime;
  t.after(async () => {
    try { await runtime?.close(); }
    finally {
      childProcess.execFile = originalExecFile;
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
      assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
      assert.ok(path.basename(base).startsWith('agentdock-recovery-test-'));
      await fs.rm(base, { recursive: true, force: true });
    }
  });
  // Node runs test files in isolated processes. Replace only the Docker process
  // boundary; import the unchanged runtime so this exercises its real state machine.
  childProcess.execFile = docker.execFile;
  childProcess.spawn = docker.spawn;
  syncBuiltinESMExports();
  const { createSandboxRuntime } = await import('../local/sandbox.mjs');
  runtime = await createSandboxRuntime({ roots: [workspace], stateDir, allowExec: true, sandbox: {
    enabled: true, image: `sha256:${'a'.repeat(64)}`, context: 'desktop-linux', dockerPath,
  } });
  let id = 0;
  const call = async (name, args, clientId = 'owner', signal) => (await runtime.handleRpc({
    jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args },
  }, { authorization: { clientId }, signal })).result;
  const accepted = response => {
    assert.notEqual(response.isError, true, response.content?.[0]?.text);
    return response.structuredContent;
  };
  const rejected = (response, pattern) => {
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, pattern);
  };
  const running = accepted(await call('exec_command', { cmd: 'synthetic background', mode: 'background', timeout_ms: 60000 }));
  assert.equal(running.running, true);
  const failed = accepted(await call('exec_command', { cmd: 'synthetic cleanup failure', timeout_ms: 1000 }));
  assert.equal(failed.cleanup_confirmed, false);
  assert.equal(failed.running, null);

  const args = { command_id: running.command_id };
  const status = accepted(await call('command_status', args));
  assert.equal(status.running, true);
  const failedStatus = accepted(await call('command_status', { command_id: failed.command_id }));
  assert.equal(failedStatus.running, null);
  assert.equal(failedStatus.cleanup_confirmed, false);
  for (const name of ['command_status', 'stop_command']) {
    rejected(await call(name, args, 'other-client'), /not found for this client/);
    rejected(await call(name, args, 'owner', AbortSignal.abort()), /Operation cancelled/);
    rejected(await call(name, { command_id: 'invalid' }), /Invalid command ID/);
  }
  for (const [name, params] of [
    ['exec_command', { cmd: 'must not start' }],
    ['read_file', { path: '/workspace/synthetic.txt' }],
    ['write_file', { path: '/workspace/synthetic.txt', content: 'must not write' }],
  ]) rejected(await call(name, params), /Operation cancelled/);
  assert.equal(docker.calls.filter(args => args[0] === 'create').length, 2);

  const backgroundContainer = [...docker.containers.values()].find(container => container.request?.cmd === 'synthetic background');
  assert.equal(backgroundContainer.removed, false);
  const stopped = accepted(await call('stop_command', args));
  assert.equal(stopped.running, false);
  assert.equal(stopped.cancelled, true);
  assert.equal(stopped.cleanup_confirmed, true);
  assert.equal(backgroundContainer.removed, true);
  assert.equal(accepted(await call('command_status', args)).running, false);
  accepted(await call('stop_command', args));
  assert.equal(docker.calls.filter(args => args[0] === 'rm' && args[2] === backgroundContainer.name).length, 1);
  const failedContainer = [...docker.containers.values()].find(container => container.request?.cmd === 'synthetic cleanup failure');
  assert.equal(docker.calls.filter(args => args[0] === 'rm' && args[2] === failedContainer.name).length, 1);
});
