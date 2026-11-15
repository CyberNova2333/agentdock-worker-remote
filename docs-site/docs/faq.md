---
title: 部署与运行排错 FAQ
description: 汇总代理在线探测 503、LOCAL_APPROVAL_REQUIRED、ACL 权限拒绝、容器清理停机与 OAuth 刷新失败的定位方法。
---

# 部署与运行排错 FAQ

本页只汇总**已部署或本地运行阶段**的实际报错码与系统级拦截原因；产品定位与选型问题请见仓库首页 README。提交任何诊断日志前，务必剔除密码、Tokens、项目文件路径与命令输出正文。

## 连接器上线与公网 503 问题

### `Status.cmd` 显示本地进程存活，但 `/healthz` 或客户端仍返回 `503`

**原因定位**：`BridgeRelay` 通过 `connectionLiveness` 严格判断 WebSocket 心跳：新建连接前 `10` 秒为首包宽限期，之后必须在 `65` 秒内持续收到 `ping`/`pong` 响应才算 `connectorOnline: true`。若代理网络抖动导致握手成功但心跳超期，或 `BRIDGE_TOKEN` 本地与云端版本不一致，`BridgeRelay` 会拒绝旧连接或返回 `503`。

**处理步骤**：
1. 在受保护目录运行 `Status.cmd` 查看 `connector-status.json` 的 `online` 与 `updatedAt`；
2. 核对系统代理环境变量（`HTTPS_PROXY` / `HTTP_PROXY`）或 Windows 注册表代理是否可直达你的 `PUBLIC_ORIGIN`；
3. 若近期执行过 `Rotate-Secrets.ps1` 或修改过云端 Secret，确认操作中途未失败并重新运行 `Stop.cmd` 与 `Start.cmd`。

### 提示 `A connector is already online or completing its heartbeat` (409)

**原因定位**：`BridgeRelay` 同一时刻仅保留一条已认证设备连接。前一次异常断网尚未超过 `65` 秒心跳超期时，重连会被短暂拒绝 `409`。等待最多 65 秒或用 `Stop.cmd` 干净关闭旧进程后重试即可。

---

## 本机批准与防重放拒绝

### 每次调用工具都返回 `LOCAL_APPROVAL_REQUIRED` 怎么办？

**原因定位**：除 `computer_context`、`command_status`、`stop_command` 外，所有文件读写与命令执行均要求逐次人工放行。此外，批准摘要 `approvalSubject` 绑定了完整的 `origin`、客户端 ID、作用域、方法名与**全部参数**（只排除外层 RPC `id`）。

**常见重试失配点**：
1. 批准在 `Approve.cmd` 写入后超过 **5 分钟（300,000 ms）** 自动失效，须重新发起与审批；
2. 客户端重试时改写了路径、偏移量、文件内容、搜索关键词或 `network: "outbound"` 参数，导致 SHA-256 摘要不匹配并创建新待批记录；
3. 客户端同时积压超过单客户端上限（`8` 条）或全局队列上限（`64` 条），或批准目录条目超过 `1024` 个触发维护停止。

### 收到 `APPROVAL_RECORD_TOO_LARGE` 错误

**原因定位**：`approval-store.mjs` 在创建临时文件前按**紧凑 JSON** 检测完整待批准记录的 UTF-8 字节数（上限 `1,200,000` 字节）。当单次 `write_file`/`edit_file` 内容过大或客户端附带超深元数据导致整包超限时，连接器会在落盘前直接拒绝，避免生成终端界面无法读取的半成品。请拆分写入分块或缩减调用参数后重试。

### 连接中断或超时返回 `504` 后，为何再次重试被拒 `already_attempted`？

**原因定位**：敏感工具在消费 `.approved.json` 后会立即为云端生成的桥接请求 ID 写入 `RequestReceipts`（保存 `24` 小时）。这是刻意设计：超过 `110` 秒的 `504` 超时或断线**不能证明容器内操作未发生**，连接器拒绝重放同 ID 请求以防止文件或命令二次执行。请先通过只读工具或 `command_status` 确认现状，如需再次运行须由客户端发起新的 RPC 请求并重新批准。

---

## Windows 宿主 ACL 与 Docker 沙箱异常

### 启动或安装时被 `Assert-PrivateState` / `Assert-WriteProtectedPath` 拒绝

**原因定位**：`State-Safety.ps1` 不仅校验 `%USERPROFILE%\.agentdock-bridge` 与 `%USERPROFILE%\.agentdock-toolchains` 本身，还会沿目录树**向上校验每一个祖先目录**的所有者与写入/修改 DACL（同时拒绝符号链接、目录联接与多硬链接 `nlink !== 1`）。任何非当前用户、`SYSTEM`、`Administrators` 或受信任安装器的额外授权规则都会立即中止执行。

**典型诱因**：曾经遇到过某些沙箱环境自动向用户目录下的这两个控制文件夹附加只读/执行 ACE（例如额外账号条目）触发拦截；按提示用管理员或所有者身份核查目录与父目录 ACL、移除非预期主体后再试。

### 为什么 `edit_file` 或 `write_file(overwrite=true)` 提示拒绝修改某个文件？

**原因定位**：Linux 容器内原子 `rename` 覆盖 Windows bind mount 上的文件时，可能导致目标文件原先显式配置的 NTFS ACL 丢失。宿主机在触发替换前会通过 `local/windows-acl.mjs` 检查目标路径的父链与安全描述符，一旦检测到受保护 ACL、非规范 ACL、显式非继承权限或所有者非当前用户，即拒绝从远端覆盖，请改在 Windows 本机编辑器中修改该文件。

### 工具报错 `cleanup_confirmed: false` 或连接器拒绝所有新请求

**原因定位**：某个容器运行完毕或被取消后，宿主执行 `docker rm -f <name>` 返回了除 `No such container/object` 以外的错误（例如 Docker Desktop 守护进程断连或卡死）。连接器立即置 `closed = true` 封锁所有新文件与命令工具，防止孤儿容器积累或状态继续恶化。

**恢复做法**：
1. 属主客户端仍可调用 `command_status` 或 `stop_command` 查询并收尾自己名下的其他活跃任务；
2. 人工在 Windows 本机检查 `docker ps -a` 与 Docker Desktop 状态，确认残留容器已清理；
3. 运行 `Stop.cmd` 后重新运行 `Start.cmd`（启动阶段会再次调用 `queryDockerState` 按安装标签清场）。

---

## OAuth 授权与跨平台测试问题

### 刷新会话时报 `Refresh credential reuse detected`

**原因定位**：`AuthStore` 对每个刷新令牌实施严格单次轮换与复用检测。一旦一个已经消费过（`spent`）的旧刷新令牌再次被提交，或通过轮换密码脚本切换了 `OWNER_PASSWORD_HASH` 代次（`owner-v2-*`），整个授权族的访问与刷新令牌会被立刻吊销。请在 MCP 客户端断开重连，重新通过 `Password.cmd` 登录授权。

### 在 Linux 或 macOS 上执行 `pnpm test` 为什么显示部分测试 skipped？

**原因定位**：在当前跨平台测试中（如 Linux 开发环境运行 101 项用例时有 86 项通过、15 项 skipped），依赖 Windows DPAPI (`Secrets.ps1`)、NTFS DACL (`windows-acl.test.mjs`)、PowerShell 安装检验 (`management-safety.test.mjs`) 以及需显式开启 `AGENTDOCK_DOCKER_TEST` 才能运行的真实容器回归（`sandbox.test.mjs` / `unicode-policy.test.mjs`）会根据宿主能力自动跳过，这是预期行为。
