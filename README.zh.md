# dsh-proxy-settings

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）**设置页**加一个「网络代理」分区：
开关出站 HTTP(S) 代理、填写代理地址与 `NO_PROXY`，保存后对当前进程**立即生效**，同时写入
`$DSH_HOME/.env`，下次启动继续生效。

![设置卡片里的代理开关、指向网络的箭头，以及它写入的 .env 文件](docs/preview.svg)

这是一个独立的第三方插件，不属于 DSH，也不由 DeepSeek 提供。它用的是 DSH 已经自带的代理库
（`@deepseek-ai/dsh-http-proxy`），只在上面补了设置界面这一层。

## 它做什么

- 在**设置 → 网络代理**里提供一个开关、代理地址、`NO_PROXY` 三项。
- **立即生效**：保存在启动器已装的那层代理之上再叠一层策略，当前进程里的模型请求与工具请求
  无需重启即改走新路由。
- **真的关掉**：关闭时在启动器的代理层之上叠一个直连层，而不是只撤掉自己那层，所以在你再次
  打开之前流量确实走直连。
- **持久化**：四个代理名原子写入 `$DSH_HOME/.env`，首次改动留一份 `.env.bak`；文件里其余每一行
  都按字节保留。
- **如实显示**：分区会显示当前生效的层、代理库自己解析出的示例路由，以及代理库给出的诊断。

## 安装

需要 DSH 0.2.0 或更新版本（插件声明了 `engines.dsh`）。

**在界面里装** —— **设置 → 插件 → 添加插件**，填 `dsh-proxy-settings`。它会装进当前 profile 并被选中。

**在会话里装** —— 让 agent 安装 `dsh-proxy-settings` 这个 bundle，或调用 `plugin_manager`：
`action: "install_bundle"`，`target: "dsh-proxy-settings"`。

**从源码装（开发用）** —— `plugin_manager` 的 `install_bundle` 把本仓库的绝对目录作为 `target`。
profile 会用 `link:` 依赖该目录，改动在重载后生效。

安装后新开一个会话（或刷新页面），在设置里应能看到**网络代理**。若没有，去**设置 → 插件**看安装或
激活是否报错。

## 使用

1. 打开「启用 HTTP(S) 代理」。
2. 填地址，例如 `http://127.0.0.1:7890`。只接受 `http://` 与 `https://`；DSH 自带的代理层不支持
   SOCKS，这里会直接说明，而不是写一个会被忽略的值。
3. 可选填 `NO_PROXY`。无论写什么，本机地址永远直连。
4. 点「保存并立即生效」。之后分区会显示当前切换层、`https://example.com/` 的实际路由，以及配置
   写到了哪里。

想撤销：把开关关掉再保存，`.env` 里的代理行会被移除，进程立即改回直连。

## 它在你机器上改了什么

| 路径 | 行为 |
|---|---|
| `$DSH_HOME/.env` | 只读写 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`（任意大小写）。注释与无关行原样保留；写入是原子的（临时文件 + rename），且不带 BOM。 |
| `$DSH_HOME/.env.bak` | 首次写入前的一份副本。只创建一次，不覆盖。 |
| 运行中的进程 | 在启动器已有代理层之上再叠一层；卸载插件时两层一起撤掉。 |

`$DSH_HOME` 优先用 `@deepseek-ai/dsh-home-paths` 解析；运行时不提供时按同一规则（`$DSH_HOME`，
否则 `~/.dsh`）兜底。

## 工作原理

插件在启动器的代理策略之上持有两层：

1. 激活时**接管**进程环境里已有的策略，这样之后点「关闭」才能盖住它。
2. **开启**时用你配置的代理名调用 `installProxyFromEnvironment`；**关闭**时用空环境调用，它会解析成
   直连策略并在外层代理之上装一个直连 agent。
3. 卸载时先撤掉自己这层，再撤掉接管层，把进程还给启动器。

宿主进程里的 `fetch` 走 undici 的全局 dispatcher，所以切换无需重启。进程之外的工作（包括 DSH 为
生成代码使用的 worker 线程）不继承该策略——这是代理库的设计，不是本插件的缺口。

浏览器半侧是一个普通脚本，只注册一个 `settings.section` 插槽和它的中英文字典，所以文案跟随界面语言。

## 安全须知

- 路由挂在回环地址的 Web 服务器上。它会拒绝 `Origin` 与 `Host` 不一致的请求、拒绝
  `Sec-Fetch-Site: cross-site`，并要求 `POST` 使用 JSON，因此别的站点无法切换你的代理。本机进程本来
  就能直接改 `.env`，这不是针对它的边界。
- 代理地址可以带凭据（`http://user:pass@host:port`）。DSH 会按原样明文写进 `.env`，分区里也会显示
  出来供你编辑。请用不需要凭据的代理，或接受这一取舍。
- 你让 DSH 走的代理能看到并改动 DSH 经它发出的一切。只指向你信任的端点。
- 漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 兼容性

| | |
|---|---|
| DSH | `>=0.2.0`（`engines.dsh`）。插件依赖的行、插槽与代理库在该版本线内存在。 |
| Node.js | `>=22.12.0`（`engines.node`）。 |
| 宿主平台 | Windows、macOS、Linux。代码是纯 Node；集成测试在能找到真实 `@deepseek-ai/dsh-http-proxy` 的环境里运行。 |
| 语言 | 英文与中文（`locale/en.json`、`locale/zh.json`，以及客户端字典）。 |

## 开发

```sh
npm test          # 单元 + 集成测试（node --test）
npm run preflight # 发布前自检：占位符、打包、清单规则
```

集成测试会优先使用真实的代理库：把 `DSH_PROXY_SETTINGS_PROXY_LIB` 指向它的 `lib/index.js`，或把
`DSH_HOME` 指向带有该库的 Harness home。找不到时这些用例跳过，其余照常运行。

本插件没有构建步骤：`lib/client.js` 是手写的普通脚本，消费平台提供的 `react` 种子模块；宿主半侧是
普通 ESM。

发布流程见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

## 卸载

在**设置 → 插件**里移除本 bundle。`.env` 里的代理配置会保留，DSH 继续用你配好的代理；若想一并清掉，
先在分区里关掉代理再移除插件，或手动删除 `.env` 里那四行代理名。

## 许可证

[MIT](LICENSE)
