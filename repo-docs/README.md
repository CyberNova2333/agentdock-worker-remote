# AgentDock Bridge：源码阅读指南

云端认证网关把工具请求交给 Windows 受保护连接器，再由本机对精确参数批准，交给 Linux 容器访问工程文件或运行 Bash。批准边界和执行结果需要分别理解。当前没有独立 LICENSE 文件，项目整体分发许可尚未确认，不能以依赖许可代替。

本指南采用 Lite 包加代码地图，聚焦 **一个敏感 MCP 工具请求从本机待批准到一次执行**。不逐项覆盖 OAuth 所有事务、Windows 安装/凭据轮换、全部文件 ACL 分支和容器生命周期；没有重新验收线上网关、Docker 镜像或已安装副本。

## 阅读路径

| 读者目标 | 从这里开始 | 读完后获得什么 |
| --- | --- | --- |
| 第一次理解行为 | [沿一次真实操作走到底](walkthroughs/one-real-run.md) | 看懂输入、阶段交接、输出和失败边界 |
| 已了解行为，准备改代码 | [按职责寻找改动入口](code-map.md) | 找到范围内实现、测试和未覆盖区域 |
| 审核证据 | [核对两遍源码调查](references/source-evidence.md) | 区分源码事实、测试意图与未跑验证 |
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

这里给出的业务命令来自现有源码或脚本。指南的结构校验不证明业务或线上验收通过；实际执行结果与范围以[修复验收记录](../SECURITY-FIXES.md)为准。

## 文档站

文档站采用 VitePress 默认主题，依赖与业务项目分开安装。默认输出 `docs-site/.vitepress/dist/`；独立核验可在构建命令后加 `-- --outDir <仓库外绝对目录>`。指南正文只维护 `repo-docs/`，站点通过 include 读取；网页中的仓库源码链接显示为精确文件路径，不复制源码或本机资源。

```sh
npm --prefix docs-site ci
npm --prefix docs-site run docs:dev -- --host 127.0.0.1
npm --prefix docs-site run docs:build
```

独立网页构建会把文档目录之外的仓库链接显示为精确文件路径，避免产生失效跳转；原始 Markdown 仍保留可核对的源码链接。站点只发布指南，源码和本机资源不会随文档打包。

证据状态：除特别标注外，本页基于当前源码已确认。
