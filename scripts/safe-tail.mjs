// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of AgentDock Bridge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
// Wrangler tail events contain request headers. This filter only prints metadata;
// raw events remain inside the pipe and are never written to disk or the chat.
let buffer = '';
let collecting = false;
let partial = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  partial += chunk;
  const lines = partial.split('\n');
  partial = lines.pop();
  for (const line of lines) {
    if (!collecting && !line.trim().startsWith('{')) continue;
    collecting = true;
    buffer += line + '\n';
    try {
      const value = JSON.parse(buffer);
      let pathname;
      try { pathname = new URL(value.event?.request?.url || 'https://none.invalid').pathname; } catch {}
      console.log(JSON.stringify({ time: value.eventTimestamp, outcome: value.outcome, path: pathname, status: value.event?.response?.status,
        exceptions: value.exceptions?.map(exception => ({ name: exception.name })) }));
      buffer = ''; collecting = false;
    } catch { if (buffer.length > 5 * 1024 * 1024) { buffer = ''; collecting = false; } }
  }
});
