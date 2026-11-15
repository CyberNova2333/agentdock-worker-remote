import { defineConfig } from 'vitepress'
import { guideLinks } from './guide-links.mts'

const guidePages: Record<string, string> = {
  'README.md': 'docs/',
  'walkthroughs/one-real-run.md': 'docs/walkthrough',
  'code-map.md': 'docs/code-map',
  'modules/cloud-oauth-and-relay.md': 'docs/contracts#cloud-oauth-relay',
  'modules/local-approval-and-replay.md': 'docs/contracts#local-approval-replay',
  'modules/container-sandbox-and-file-policy.md': 'docs/contracts#container-sandbox-policy',
  'glossary.md': 'docs/architecture#glossary-index',
  'references/source-evidence.md': 'docs/architecture#evidence-and-boundaries',
  'references/quality-review.md': 'docs/architecture#evidence-and-boundaries',
  'change-log.md': 'docs/architecture#security-adrs-migration',
}

export default defineConfig({
  cleanUrls: true,
  markdown: {
    config: guideLinks(guidePages),
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'AgentDock Bridge 文档',
      description: 'Cloudflare Workers OAuth 2.1 + Windows 受保护连接器 + 只读 Linux Docker 沙箱的个人远程 MCP 桥接网关。',
      themeConfig: {
        siteTitle: 'AgentDock Bridge',
        nav: [
          { text: '首页', link: '/' },
          { text: '起步与部署', link: '/docs/' },
          { text: '契约与边界', link: '/docs/contracts' },
          { text: '原理与导览', link: '/docs/architecture' },
          { text: 'GitHub', link: 'https://github.com/CyberNova2333/agentdock-worker-remote' },
        ],
        sidebar: [
          {
            text: '1. 起步与配置部署',
            items: [
              { text: '项目定位与部署流程', link: '/docs/' },
              { text: '配置矩阵与运维脚本', link: '/docs/configuration' },
              { text: '部署与运行排错 FAQ', link: '/docs/faq' },
            ],
          },
          {
            text: '2. 接口与扩展契约',
            items: [
              { text: 'OAuth、工具、批准与沙箱契约', link: '/docs/contracts' },
            ],
          },
          {
            text: '3. 原理与源码导览',
            items: [
              { text: '架构全景与安全决策', link: '/docs/architecture' },
              { text: '一次请求端到端走查', link: '/docs/walkthrough' },
              { text: '源码目录与测试地图', link: '/docs/code-map' },
            ],
          },
        ],
        outline: { level: [2, 3], label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'AgentDock Bridge Documentation',
      description: 'Personal authenticated remote MCP bridge combining Cloudflare Workers OAuth 2.1, hardened Windows host approval, and read-only Linux Docker sandboxes.',
      themeConfig: {
        siteTitle: 'AgentDock Bridge',
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Getting Started', link: '/en/docs/' },
          { text: 'Contracts', link: '/en/docs/contracts' },
          { text: 'Architecture', link: '/en/docs/architecture' },
          { text: 'GitHub', link: 'https://github.com/CyberNova2333/agentdock-worker-remote' },
        ],
        sidebar: [
          {
            text: '1. Getting Started & Deployment',
            items: [
              { text: 'Overview & Setup Workflow', link: '/en/docs/' },
              { text: 'Configuration & Scripts Matrix', link: '/en/docs/configuration' },
              { text: 'Deployment & Runtime FAQ', link: '/en/docs/faq' },
            ],
          },
          {
            text: '2. Contracts & Boundaries',
            items: [
              { text: 'OAuth, Tools, Approval & Sandbox', link: '/en/docs/contracts' },
            ],
          },
          {
            text: '3. Internals & Code Map',
            items: [
              { text: 'Architecture & Security ADRs', link: '/en/docs/architecture' },
              { text: 'End-to-End Request Walkthrough', link: '/en/docs/walkthrough' },
              { text: 'Source & Test Code Map', link: '/en/docs/code-map' },
            ],
          },
        ],
        outline: { level: [2, 3], label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' },
      },
    },
  },
  themeConfig: {
    search: { provider: 'local' },
  },
})
