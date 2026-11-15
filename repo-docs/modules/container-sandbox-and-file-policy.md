# 容器沙箱与文件安全策略

本地批准通过并登记账本后，连接器并不会直接在 Windows 宿主执行终端命令或直接由主进程读写项目文件，而是通过 Docker 上下文（默认 `desktop-linux`）把单次任务送入只读根文件系统、受限能力、可按次断网的 Linux 开发容器执行。这套机制与[本地精确批准与防重放账本](local-approval-and-replay.md)衔接：前者决定“哪组精确参数可以运行”，本模块决定“运行时能碰到哪些路径、设备和内核权限”。

## 沙箱准入与只读初始化检查

[沙箱运行时](../../local/sandbox.mjs)的 `createSandboxRuntime` 在启动阶段强制核对执行前置条件：

1. **单一挂载与路径隔离**：必须启用沙箱且仅配置一个绝对工作区根目录（映射为容器内 `/workspace`），`stateDir`、`sourceRoot` 与 `dockerPath`（要求 `nlink === 1`）都严禁位于工作区内部，且当前 Docker 上下文的守护进程地址必须为本地管道或套接字（`npipe://` 或 `unix:///`）。
2. **镜像摘要固定**：镜像字段必须匹配完整的 `sha256:<64位十六进制>` 摘要，运行时显式传参 `--pull never`，禁止启动按浮动标签解析的未校验镜像。
3. **只读探针超时重试与旧容器清理**：启动时通过[只读 Docker 查询策略](../../local/docker-query.mjs)的 `queryDockerState` 检查上下文、镜像摘要与带当前安装标签 `cbnv.agentdock.install=<hash>` 的残留容器（每步 30 秒时限，超时最多重试一次）。清理陈旧容器时不使用该重试策略；若无法确认残留容器已被移除，沙箱拒绝启动。

## 一次性的容器参数与租约看门狗

每次执行命令或文件操作时，`launch` 都会生成随机容器名 `agentdock-<uuid>`，先后执行 `docker create` 与 `docker start --attach --interactive`。拆成两步可以保证若请求在创建阶段被取消，后续不会发起 `start`。[容器镜像定义](../../container/Dockerfile)基于固定摘要的 `node:24-trixie-slim`，预置只读 `/opt/bridge` 目录以及 Node、Python、Go、Rust、Java 21、GCC/CMake 与 Git/ripgrep 等开发工具。

实际运行时由宿主侧通过 `--read-only`、`--cap-drop ALL --cap-add SETUID --cap-add SETGID`、`--security-opt no-new-privileges=true`、`--pids-limit 256`、`--memory 2g`、`--memory-swap 2g`、`--cpus 2`、`--log-driver none`、`--restart no` 与只绑定单工作区挂载来约束内核权限，并仅挂载 `/tmp` 与 `/home/developer` 两个 `512m` 的内存临时文件系统。默认使用 `--network none` 完全断网；仅当本地配置启用出网且本次请求在批准参数中显式携带 `network: "outbound"` 时才切换为 `bridge` 网络。

容器内 PID 1 是[命令监督入口](../../container/runner.mjs)，通过标准输入接收单行任务头（上限 `1,100,000` 字节）并验证主机心跳租约：宿主每 `5` 秒写入 `{"type":"lease"}`，监督进程超过 `20` 秒未收到租约或标准输入关闭即以退出码 125 退出。子进程统一降权为 UID/GID `1000`，继承精简环境变量（不含宿主凭证）：

- **命令任务**：运行 `/bin/bash --noprofile --norc -c <cmd>`，工作目录必须规范化落在 `/workspace` 下，输出受请求参数 `max_output_bytes`（默认 `65536`、上限 `131072`）截断保护，子进程退出后若后代仍占着输出管道最多等待 `1` 秒即报失败退出（125）。
- **文件任务**：运行 `/usr/local/bin/node /opt/bridge/container/file-worker.mjs`，即[隔离文件运行器](../../container/file-worker.mjs)以严格 UTF-8 解码读取标准输入，并在 `allowExec: false` 条件下初始化[文件工具协议与策略执行器](../../local/tools.mjs)。文件工具内部无法启动子命令，单次调用操作预算为 `15` 秒，与容器进程上限（命令最多 `4` 并发、文件最多 `4` 并发）共同防止长期占用。

## 路径解析、原子替换与 Windows ACL 守卫

文件操作既受容器挂载边界约束，又在容器内由[文件安全策略](../../local/file-safety.mjs)逐层验证真实路径与文件身份，阻止工作区内符号链接或硬链接越界或竞争篡改：

- **编码与目录边界校验**：[文件工具定义](../../local/tools.mjs)包含 `computer_context`、`list_directory`、`read_file`、`write_file`、`edit_file`、`delete_file` 与 `search_files`。字符串参数均检查合法 UTF-16 编码（`isWellFormed()`，拒绝孤立代理项与 `\0`），路径检查拦截 Windows 设备名（如 `con`/`nul`/`com1`）、UNC 路径与 NTFS 备用流（`:`）。`search_files` 固定以 `128` 目录、`5000` 条目、`2000` 文件、`16 MiB` 读取量与 `5` 秒作为上限，默认跳过 `.git`、`node_modules` 与 `.wrangler`。
- **只读稳定与单次原子发布**：`createFilePolicy` 沿路径逐级 `lstat` 拒绝符号链接、目录联接与多硬链接（`nlink` 不为 1），读取后核对 `dev:ino:size:mtimeMs:ctimeMs` 是否漂移；写入新建文件先以 `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW` 写入同目录临时文件、刷盘后再执行硬链接原子创建，避免竞争覆盖。同一容器路径的写/改/删操作按队列串行化（`fileLocks`）。
- **Windows 自定义 ACL 替换拦截**：由于 Linux 容器内对挂载文件执行原子 `rename` 可能会丢弃宿主预先设置的显式 NTFS 访问控制列表（DACL），宿主机在执行 `edit_file` 或 `write_file(overwrite=true)` 前，会先通过[Windows 替换守卫](../../local/windows-acl.mjs)调用系统 PowerShell 只读检查宿主目标文件及其父链权限。若检测到显式非继承权限规则、受保护 ACL 或所有者非当前用户，直接拒绝通过工具替换，提示改用本地编辑器处理。

## 清理失败停机与任务控制保留

任务结束或收到取消信号后，`sandbox.mjs` 的 `cleanup` 会以本地生成的随机容器名执行 `docker rm -f`。若守护进程返回 `No such container/object` 以外的错误，系统判定清理未获确认：`job.cleanupConfirmed` 保持 `false`，同时把运行时标记为全局关闭（`closed` 置为 `true`），阻断后续所有新的文件操作和 `exec_command`。

在 `closed` 为 `true` 期间，`command_status`、`get_command` 与 `stop_command` 仍位于关闭拦截之前执行，并继续校验 `job.ownerClient === authorization.clientId` 与取消信号：客户端仍可查询与停止自己发起的其余活跃任务，未确认清理的任务则在快照中持续上报 `cleanup_confirmed` 为 `false` 与 `running` 为 `null`，避免向调用方虚报安全退出。

以下为发往 `runner.mjs` 的文件工具隔离输入示例（命令与文件内容均做中性化展示）：

```json
{
  "kind": "file",
  "timeout": 30000,
  "body": {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": { "path": "/workspace/README.md", "offset": 0, "max_bytes": 4096 }
    }
  }
}
```

典型沙箱与文件边界条件如下表所示：

| 操作情形 | 沙箱与策略行为 | 验证依据 |
| --- | --- | --- |
| 工作区内存在指向工作区外或别的目录的符号链接 / 多硬链接 | `lstat` 与 `nlink` 核查命中并拒绝访问 | [文件加固测试](../../test/file-hardening.test.mjs) |
| 对带自定义显式 NTFS ACL 的文件调用 `edit_file` | Windows 宿主前置守卫拒绝，保留原始 DACL | [Windows ACL 测试](../../test/windows-acl.test.mjs) |
| 参数含孤立 UTF-16 代理项，或读取非 UTF-8 二进制文件 | 入口与 `TextDecoder('utf-8', { fatal: true })` 拒绝，不静默替换字节 | [Unicode 策略测试](../../test/unicode-policy.test.mjs) |
| 某容器 `docker rm -f` 失败后，同一客户端调用 `exec_command` 与 `stop_command` | 新操作被拒绝，属主对已有任务的查询与停止仍可正常完成 | [故障恢复测试](../../test/sandbox-recovery.test.mjs) |

## 定向验证入口

可在无真实 Docker 守护进程的环境中先验证文件策略、Unicode、工具预算与故障控制状态机：

```sh
node --test test/sandbox-recovery.test.mjs test/file-hardening.test.mjs test/tools.test.mjs test/unicode-policy.test.mjs test/container-input.test.mjs
```

如需运行真实容器端到端回归，须在装有目标开发镜像的 Docker 环境显式设置 `AGENTDOCK_DOCKER_TEST` 后运行 [真实 Docker 回归](../../test/sandbox.test.mjs)。其余目录与脚本位置见[代码地图](../code-map.md)，完整请求串联见[一次真实操作的阶段交接](../walkthroughs/one-real-run.md)。

证据状态：除特别标注外，本页基于当前源码已确认。
