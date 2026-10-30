# AgentDock Bridge：源码阅读指南

MCP 客户端通过云端网关请求读取文件或运行命令，Windows 受保护连接器先校验请求，再等待本机对精确参数批准，最后交给 Linux 容器执行。云端授权、本机批准和执行结果是三个不同阶段；理解它们的交接，才能判断一个请求为什么被拒绝、有没有开始执行，以及应该从哪里修改。

本指南采用 Lite 包加代码地图，沿着一个敏感 MCP 工具请求从本机待批准到一次执行展开。源码基线为 `8e4afdd2e62ff6f6e2fd58cada0a2b75a50abcc8`；2026-10-31 的文档整理不改变应用逻辑，也不重新部署服务。

## 阅读路径

| 读者目标 | 从这里开始 | 读完后获得什么 |
| --- | --- | --- |
| 第一次理解行为 | [沿一次真实操作走到底](walkthroughs/one-real-run.md) | 看懂输入、阶段交接、输出和失败边界 |
| 已了解行为，准备改代码 | [按职责寻找改动入口](code-map.md) | 找到范围内实现、测试和未覆盖区域 |
| 审核证据 | [核对源码调查与验收边界](references/source-evidence.md) | 区分源码事实、测试断言和特定版本的验收快照 |
| 检查讲解是否足够 | [查看读者模拟与剩余风险](references/quality-review.md) | 判断哪些结论需要补充验证 |
| 查看同步历史 | [查看指南变更](change-log.md) | 确认同步基线和本轮范围 |

## 运行与验证

Node.js 24+，依赖按锁文件安装。以下是开发检查入口，不启动或替换现有连接器：

```sh
npm ci
npm run check
npm test
```

实际连接器通过私有安装目录的可信入口管理，默认位置为 `%USERPROFILE%\.agentdock-bridge`。Docker 集成验证需显式配置 `AGENTDOCK_DOCKER_TEST` 和测试镜像；安装、迁移与日常管理见[根说明中的使用步骤](../README.md#日常使用)。

本指南不逐项展开 OAuth 所有事务、Windows 安装与凭据轮换、全部文件 ACL 分支和容器生命周期。首次部署和日常操作从[项目使用说明](../README.md)进入；修改源码前先通过[代码地图](code-map.md)寻找责任与测试。

源码、已安装运行副本和固定 Docker 镜像分别更新。指南的结构校验不能证明三者已经同步；已完成的业务回归、运行文件核验、域名和云端部署检查统一记录在[修复与验证快照](../SECURITY-FIXES.md)。快照只说明所列版本在所列时间通过验证，本轮文档整理不会把它变成新的生产验收。

## 文档站

文档站采用 VitePress 默认主题，依赖与业务项目分开安装。默认输出 `docs-site/.vitepress/dist/`；独立核验可在构建命令后加 `-- --outDir <仓库外绝对目录>`。指南正文只维护 `repo-docs/`，站点通过 include 读取；网页中的仓库源码链接显示为精确文件路径，不复制源码或本机资源。

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:dev -- --host 127.0.0.1
npm --prefix docs-site run docs:build
```

原始 Markdown 保留可核对的源码链接；独立网页把指南之外的仓库链接显示为精确文件路径。站点只发布指南，源码和本机资源不会随文档打包。

## 许可

项目采用 GNU General Public License v3.0，SPDX 标识为 `GPL-3.0-only`。使用、修改和分发条件见[完整许可文本](../LICENSE)。

证据状态：除特别标注外，本页基于当前源码已确认。
