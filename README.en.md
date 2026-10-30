# AgentDock Bridge 2

[中文完整说明](README.md) · [Chinese source guide](repo-docs/README.md)

A personal MCP gateway: a Cloudflare Worker handles OAuth and relay traffic, a protected Windows connector owns local approvals and container lifecycle, and Linux containers operate on the configured workspace.

## Use and boundaries

The default trusted management launchers live under `%USERPROFILE%/.agentdock-bridge`. Sensitive reads, searches, mutations and commands initially return `LOCAL_APPROVAL_REQUIRED`. Review the exact request with the trusted `Approve.cmd`, approve locally, then retry identical tool parameters. Approval binds the client, permissions, arguments and network option; it lasts five minutes and is consumed once. Compact JSON records are checked against the same final-byte limit before writing and when reading; oversized requests are rejected explicitly, without discarding metadata from the approved content. Environment inspection and control of existing tasks have explicit approval exemptions while still checking identity and permissions.

The fifth-round fixes dated 2026-10-30 preserve the connection password and OAuth authorization generation. Moving from the old `%LOCALAPPDATA%/AgentDockBridge` location requires stopping the old connector, migrating protected credentials and configuration, and installing the new runtime. Pending local approval requests must be submitted again. State-directory checks cover ownership and writable ancestors; neither state nor runtime belongs inside the workspace or below an untrusted parent.

Files use `/workspace/...`; commands run Linux Bash. File tools have no network; commands default to `network: "none"`. Explicit outbound network access is part of approval. The workspace mount is writable and may contain secrets. The cloud relay is trusted and can inspect or modify inputs and outputs; this is not end-to-end encrypted or client-signed execution.

The installed connector and pinned image are separate from the checkout. Do not treat checkout launchers as immutable trusted control programs. Docker must be available; background tasks do not survive connector restarts. A timeout can leave partial effects and must not cause automatic write retries.

## Development checks

Copy `wrangler.jsonc.example` to local `wrangler.jsonc` and configure your deployment. The local file is excluded from version control.

Requires Node.js 24+:

```sh
npm ci
npm run check
npm test
```

Docker checks require an explicitly enabled test environment and chosen image. See the Chinese README for installation, image building, host ACL restrictions and operational details. Documentation validation does not establish runtime or deployment acceptance; consult [the repair and validation record](SECURITY-FIXES.md). Historical audits are not evidence of current acceptance.

## License

No standalone `LICENSE` file is present in this checkout. Dependency licenses do not establish a license for the project as a whole; confirm distribution terms with the owner.

## Documentation site

The [Chinese source guide](repo-docs/README.md) follows one implemented workflow, then links to a code map and evidence audit. It does not claim complete architecture coverage.

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:dev -- --host 127.0.0.1
npm --prefix docs-site run docs:build
```

The documentation site uses the default VitePress theme, with dependencies installed separately from the application. Output defaults to `docs-site/.vitepress/dist/`; append `-- --outDir <external-absolute-directory>` for an isolated build. Markdown remains in `repo-docs/` and is included by the site. Repository source links are shown as exact paths; source files and local resources are not published.

For behavior-changing edits and repository questions, follow the `repo-docs` Sync gate in [the Agent rules](AGENTS.md); update stale guide pages and record meaningful changes.
