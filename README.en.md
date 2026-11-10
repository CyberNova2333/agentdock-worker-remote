# AgentDock Bridge 2

[中文](README.md) · [Chinese source guide](repo-docs/README.md)

AgentDock Bridge is a personal MCP gateway for a Windows development workspace you manage. An MCP client authenticates and sends tool requests through a Cloudflare Worker. A protected Windows connector checks permissions and local approval; Linux development containers read project files or run Bash, then return results through the gateway.

It is intended for people who want remote access to their own development environment while retaining exact local approval. The Windows computer, connector and Docker must be online for tools to execute.

## Reading paths

| Goal | Start here | Outcome |
| --- | --- | --- |
| Deploy and start using the gateway | Prerequisites, first installation and daily use below | Configure your gateway and find its trusted management launchers |
| Understand one request | [One real workflow](repo-docs/walkthroughs/one-real-run.md) | Follow authorization, approval, execution and the response |
| Locate a change | [Code map](repo-docs/code-map.md) | Find source responsibilities and relevant checks |
| Check evidence and limits | [Source evidence](repo-docs/references/source-evidence.md) and [repair and acceptance record](SECURITY-FIXES.md) | Distinguish source facts, tests and production acceptance |
| Contribute | [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md) | Follow commit-message, signing and offline check requirements |

## Prerequisites

- Windows x64, Windows PowerShell and .NET Framework for DPAPI credentials and host permission checks.
- Docker Desktop with its Linux container engine. The installer uses the local `desktop-linux` context.
- Trusted Node.js 24+ and pnpm for checkout dependencies, development checks and Wrangler. The installer separately installs and verifies a pinned Node runtime for the host connector.
- Your own Cloudflare account, Wrangler login and a working HTTPS domain. The Worker uses SQLite Durable Objects.
- One project directory explicitly authorized for full container read/write access. The current default is all of `D:\Projects`, mounted at `/workspace`.

Python 3.10+ is also needed for repository hooks or documentation validation. The checkout, protected host runtime and container image are managed separately; the checkout is not the trusted entry point for daily control.

## First configuration and installation

Run these commands from a reviewed checkout for a new installation. Initialization refuses an existing configuration. For an existing installation, use the development and update instructions below.

1. Install development dependencies and create the local deployment configuration:

   ```powershell
   pnpm install --frozen-lockfile
   Copy-Item wrangler.jsonc.example wrangler.jsonc
   .\node_modules\.bin\wrangler.cmd login
   ```

   Edit `wrangler.jsonc` for your target account, Worker name, domain binding and `PUBLIC_ORIGIN`. Replace `https://bridge.example.test` with your real HTTPS address. The template does not contain a specific account or custom-domain route. This local configuration is excluded from version control.

   Keep the local `origin` consistent with the Worker's `PUBLIC_ORIGIN`. The public status probe in `Manage.ps1` and the password window title in `Secrets.ps1` both read the address from `origin` in the local `config.json`.

2. Explicitly use the same public address to initialize encrypted local credentials and build the development image:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Setup.ps1 -Origin https://bridge.example.test -Roots D:\Projects
   docker.exe --context desktop-linux build -f container/Dockerfile -t agentdock-dev:2026-10-28 .
   ```

   `Setup.ps1` only initializes credentials and configuration under `%USERPROFILE%\.agentdock-bridge` by default. Tool execution cannot start yet. Replace the example address and project directory before running it. The state directory and its ancestors must pass owner and write-permission checks.

3. Deploy the Worker and upload this project's connection secrets:

   ```powershell
   .\node_modules\.bin\wrangler.cmd deploy
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Secrets.ps1 -Action Upload
   ```

   Upload sends `BRIDGE_TOKEN` and `OWNER_PASSWORD_HASH` through an in-memory pipe. Keep the local password and DPAPI file out of Git and chat. This step uses Wrangler, the deployment configuration and the login state from the reviewed checkout.

4. Install the protected host runtime, then start it from the private directory:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Install-Hardened.ps1 -Workspace D:\Projects -Image agentdock-dev:2026-10-28
   & (Join-Path $env:USERPROFILE '.agentdock-bridge\Start.cmd')
   ```

   The installer copies the connector and production dependencies, pins the image SHA-256 and generates trusted management launchers. It does not deploy the Worker or create a domain. On first installation it downloads and verifies a pinned official Windows Node distribution. The installer accepts `-Proxy` when needed. After startup, check local status and `/healthz` on your public origin.

The MCP endpoint is `/mcp` under `PUBLIC_ORIGIN`. Add it to your client, review its callback and requested permissions, then authorize through the gateway with the password displayed by the local `Password.cmd`.

## Daily use

Use the launchers generated by the installer inside `%USERPROFILE%\.agentdock-bridge`:

| Launcher | Purpose |
| --- | --- |
| `Start.cmd` | Manually start the connector and supervisor |
| `Status.cmd` | Inspect local processes, connection status and the public probe |
| `Stop.cmd` | Stop the connector and clean up this installation's development containers |
| `Password.cmd` | Display the connection password in a local dialog |
| `Approve.cmd` | Inspect and approve exact pending requests |

File reads, listings, searches, writes, edits, deletions and commands require local approval. When the first request returns `LOCAL_APPROVAL_REQUIRED`, run the trusted `Approve.cmd`, review the complete arguments, enter the displayed `APPROVE <number>`, then retry identical tool parameters from the client. Approval binds the client, permissions, all arguments and network option; it lasts five minutes and is consumed once. Changed requests need new approval, and oversized requests are explicitly rejected.

Environment inspection and control of existing tasks are exempt from local approval while retaining permission checks. Only the owning client can control a task. Use `command_status` for background status and `stop_command` to stop a task. Connector restarts do not restore old tasks.

When container cleanup cannot be confirmed, the connector refuses new commands and file operations while allowing clients to inspect and stop their own existing tasks. `cleanup_confirmed: false` means removal remains unconfirmed and Docker needs a local check. A stop request does not automatically retry failed removal; container time limits and the trusted `Stop.cmd` remain recovery paths.

## Container development environment

The complete authorized project directory is mounted read/write at `/workspace`. File tools accept `/workspace/...` and can translate corresponding Windows absolute paths. Commands run Linux Bash and cannot directly execute Windows `.exe` files or Windows PowerShell.

| Category | Tools in the image |
| --- | --- |
| JavaScript | Node.js 24, npm, pnpm, TypeScript |
| General languages | Python 3, pip/venv/pipx, Go, Rust/Cargo, Java 21/Maven |
| Build tools | GCC/G++, make, CMake, Ninja, pkg-config, GDB |
| Platform CLIs | GitHub CLI (`gh`), Wrangler |
| General tools | Git/Git LFS, SSH client, curl/wget, jq, ripgrep, fd-find, rsync, SQLite, archive tools |

An image tag identifies a build; installed configuration pins a specific SHA-256 and does not follow tag changes automatically. Package inventories are stored at `/opt/bridge/os-packages.txt` and `/opt/bridge/npm-packages.json` inside the image. CLIs are installed without copying or baking in host login tokens. Authenticated platform operations require separately configured credentials with suitable permissions inside the container.

File operations always have no network. Commands default to `network: none`. Request `network: outbound` explicitly and approve it locally when needed. Outbound mode permits access to the internet and reachable LAN services; it provides neither a domain allowlist nor injected authentication credentials. Containers publish no inbound ports.

Each execution uses a separate container. Development child processes run as UID/GID 1000; the image is read-only and HOME and temporary directories use bounded tmpfs. Project artifacts persist in the mount, while temporary HOME configuration disappears with the container. Each container is limited to 2 CPUs, 2 GiB memory and 256 processes, with up to 4 commands and 4 file operations in parallel. Synchronous commands can run for at most 60 seconds; background tasks for at most one hour.

## Security boundaries

- Full project access includes `.env` files, private keys, tokens and other project-local secrets. Treat project code, file contents and model or tool output as untrusted input that may carry prompt injection.
- Containers do not mount the host user directory, gateway state, installed runtime, Docker socket or host CLI login configuration. The host connector runs from a protected installation, verifies its pinned Node digest and path permissions at startup, and clears Node preload and TLS override variables.
- Cloudflare and the Worker are trusted intermediaries that can observe and change tool inputs and outputs. Local approval binds exact requests but does not provide end-to-end encryption or client-signed proof of execution.
- OAuth permissions and local approval are checked separately. Authorization transactions commit atomically; reuse of an old refresh credential revokes its token family. Revocation cannot roll back work already started.
- File tools reject links, check file identity and Unicode, enforce traversal and output budgets, and use atomic replacement. Expected-content hashes protect against edits based on stale content. These checks do not form a complete filesystem transaction against arbitrary concurrent local writers.
- File tools refuse to replace files with protected or explicit custom Windows ACLs, preserving their contents and permissions. Approved Bash commands still have full project write access and may change files and permissions.
- Disconnects, cancellations and timeouts may leave partial effects. The request ledger prevents re-execution of the same bridge request; this must not cause automatic write retries. Private-directory ACLs protect approval records; connection credentials are additionally encrypted with Windows DPAPI.

See the [source guide](repo-docs/README.md) for implementation paths and the [security repair record](SECURITY-FIXES.md) for fixes and historical acceptance.

## Development and updates

Run in a trusted development environment:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm test
```

Docker integration checks must be explicitly enabled with a chosen, already built image. The following command runs the complete test entry points serially:

```powershell
$env:AGENTDOCK_DOCKER_TEST='1'
$env:AGENTDOCK_TEST_IMAGE='agentdock-dev:2026-10-28'
node --test --test-concurrency=1 test/*.test.mjs cloud/*.test.mjs
.\node_modules\.bin\wrangler.cmd deploy --dry-run
```

To update the host connector, stop the old installation through its trusted launcher, review the checkout, rerun `Install-Hardened.ps1` and start through the newly generated trusted launcher. Container code or tool changes also require rebuilding and testing the image and pinning its new ID. Checkout changes do not automatically replace the runtime. Deploy cloud updates separately with the local deployment configuration.

Migrating an old `%LOCALAPPDATA%\AgentDockBridge` installation requires stopping its connector and handling protected credentials, configuration and the new runtime; copying launchers alone is insufficient. Submit pending approval requests again after migration. The repository has no general automatic migration entry point. Credential rotation uses the reviewed `scripts/Rotate-Secrets.ps1`; stop the connector first and run it from a checkout with Wrangler development dependencies and the correct deployment configuration. Clients must authorize again after rotation.

Follow [Contributing](CONTRIBUTING.md) for commit titles, bodies and signatures. Keep real configuration, credentials, build output and local audit evidence out of version control.

## Documentation and verification

The [Chinese source guide](repo-docs/README.md) is a Lite guide with a code map, focused on approval and execution of one sensitive tool request. Source, tests, the protected runtime and cloud deployment need separate verification. Documentation validation or a site build does not establish business or production acceptance. See the [repair and acceptance record](SECURITY-FIXES.md) for validation dates, source revisions and scope.

The documentation site uses the default VitePress theme. Content lives only in `repo-docs/` and is included by the site:

```powershell
pnpm --dir docs-site install --frozen-lockfile
pnpm --dir docs-site run docs:dev -- --host 127.0.0.1
pnpm --dir docs-site run docs:build
```

Default output is `docs-site/.vitepress/dist/`; append `-- --outDir <external-absolute-directory>` to the build command for an isolated output. The standalone site shows repository source links as exact paths and does not publish source or local resources with its pages.

## License

This project is open source under the [GNU General Public License, version 3](LICENSE), identified as `GPL-3.0-only`. Dependencies retain their respective licenses.
