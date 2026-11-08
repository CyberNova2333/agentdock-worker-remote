---
layout: home
repoGuideSource: "repo-docs/README.md"

hero:
  name: AgentDock Bridge
  text: 远程受控 MCP 连接器与容器执行沙盒
  tagline: MCP 客户端经云端网关发起敏感调用，Windows 连接器多级核验与本机审批，受控容器隔离执行。
  actions:
    - theme: brand
      text: 开启文档阅读
      link: /walkthroughs/one-real-run
    - theme: alt
      text: 架构代码地图
      link: /code-map
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/CyberNova2333/agentdock-worker-remote

features:
  - title: 三阶段严密授权
    details: 将云端授权校验、本机显式交互批准与 Linux 容器执行严格拆为三个独立阶段，彻底杜绝越权与静默调用。
  - title: 敏感参数精密拦截
    details: 针对文件读写、环境探测与 Shell 命令执行等敏感 MCP 工具调用，精准解析入参并在本机弹窗等待确认。
  - title: 容器化隔离防护
    details: 真实执行载荷被限定在专用 Linux 容器沙盒中，运行产物与宿主机环境实现物理隔离与安全回收。
---

## 这是什么

**AgentDock Bridge** 是一套跨越云端与本机的受保护 MCP（Model Context Protocol）连接器基础设施。

当大模型或 MCP 客户端需要访问本地文件、运行构建脚本或操作命令行时，AgentDock Bridge 充当了最关键的安全网关：
1. **云端验证**：核验请求来源与身份签名；
2. **本地裁决**：由 Windows 保护层拦截参数，向维护者展示清晰的人类可读审批；
3. **安全执行**：经批准后在受限容器内执行，并将结果结构化回传。

## 怎么用 / 快速上手

### 1. 安装与初始化

Node.js 24+ 环境下安装依赖：

```bash
# 安装依赖
npm ci

# 启动本地安全连接器测试
npm test
```

### 2. 桥接服务连接配置

在 MCP 配置文件（如 `claude_desktop_config.json` 或 `mcp_config.json`）中接入网关：

```json
{
  "mcpServers": {
    "agentdock-bridge": {
      "command": "node",
      "args": ["dist/index.js", "--gateway", "https://gateway.example.com"]
    }
  }
}
```

## 分层阅读与快速跳转

::: tip 按读者角色快速检索
- **初次接触 / 快速上手**：从[一条真实主流程](/walkthroughs/one-real-run)开始，追踪一次 MCP 敏感工具请求从发起、本机拦截、批准到容器执行的完整生命周期。
- **架构设计 / 模块定位**：从[代码地图](/code-map)进入，查阅云端接线、IPC 通信、Windows 连接器与 Linux 沙盒交互边界。
- **审计复核 / 核心贡献**：从[源码证据](/references/source-evidence)核对安全断言与执行证据，查阅[阅读质量审计](/references/quality-review)了解边界与防护前提。
:::

---

## 完整项目指南概览

<!--@include: ../repo-docs/README.md-->
