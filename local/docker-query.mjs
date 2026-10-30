// Initialization queries are read-only. Retrying them cannot repeat a command
// or file mutation; all create/start/remove operations keep their own policy.
export async function queryDockerState(run, args) {
  const readOnly = (args[0] === 'context' && args[1] === 'inspect') ||
    (args[0] === 'image' && args[1] === 'inspect') || args[0] === 'ps';
  if (!readOnly) throw new Error('Only read-only Docker initialization queries may be retried.');
  try { return await run(args, 30000); }
  catch (error) {
    if (error.code !== 'ETIMEDOUT' && !(error.killed && error.signal === 'SIGTERM')) throw error;
    return run(args, 30000);
  }
}
