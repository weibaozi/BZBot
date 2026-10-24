# cortico-bot-mybot

Owner: `index.ts`

myBot 的 bot 包：行为和 corti-soulmate 完全一样，在它的 Persona 页前面加上 myBot 的管理面板（见 [docs/admin-webui.md](../../docs/admin-webui.md)）。corti-soulmate 从同仓库的 `vendor/cortico` 用相对路径导入，所以这个包只能在 myBot 仓库里运行。

| 文件 | 内容 |
|---|---|
| `index.ts` | `BotDefinition`：沿用 corti-soulmate，id 为 `mybot`，在 `onStart` 拿到 Core 供面板读取 |
| `server/pages.ts` | Persona 页：把 corti-soulmate 的页改挂到 `persona:mybot`，我们的面板排在前面，其余转给它 |
| `server/state.ts` | 面板读的数据：长期和短期记忆文件、前缀是否已包含最新内容、当天用量 |
| `shapes.ts` | 面板方法的返回形状，浏览器端只按类型引用 |
| `webui/` | 浏览器端：corti-soulmate 的六个面板加上 总览、记忆分层、即将加入 |
| `scripts/build-webui.mjs` | 用 vendor 里 Cortico 的 esbuild 打包 `webui/client.ts` 到 `dist/` |

## 面板

| 面板 | 方法 | 内容 |
|---|---|---|
| `overview` 总览 | `state`、`reloadPrefix` | 运行状态、当天请求和缓存命中、上下文与冻结前缀、待生效的长期记忆文件、最近事件；「立即生效」重建前缀 |
| `tiers` 记忆分层 | `state` | 短期（会话、memo/active、交接笔记）、长期（文件、token、读写权限、是否已进前缀）、做梦交回的摘要和工作区提交 |
| `roadmap` 即将加入 | — | 还没实现的页面和对应阶段 |

## 命令

```powershell
node scripts/build-webui.mjs          # 改了 webui/ 之后重新打包，刷新页面即可
node ../../vendor/cortico/node_modules/vitest/vitest.mjs run
```

Node 侧和浏览器侧各有一份 tsconfig，用 vendor 里的 TypeScript 检查：`tsconfig.json`、`tsconfig.web.json`。
改了 `index.ts` 或 `server/` 要重启部署。
