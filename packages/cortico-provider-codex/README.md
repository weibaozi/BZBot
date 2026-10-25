# Codex OAuth (`index.ts`, `server/auth.ts`, `server/client.ts`)

独立的 Codex 供应商，使用 `chatgpt.com/backend-api/codex`。现有 ChatGPT 套餐供应商继续保留，两者不共享凭据。
协议参考 [AstrBot Codex OAuth 插件](https://github.com/RhoninSeiei/astrbot_plugin_codex_oauth_plug)，以 TypeScript 实现浏览器回调和模型中心接口。

在模型中心新增 **Codex OAuth** 供应商，保存后点「登录 Codex」。浏览器打开授权页，登录后自动返回本机 `localhost:1455/auth/callback`。
必须在运行 myBot 的电脑上完成；1455 被其他登录流程占用时先结束该流程，再点登录。不通过 QQ 发送授权码，也不读取用户 Codex CLI 的凭据。
PKCE、state、nonce、JWT 签名和 audience 均校验；授权 10 分钟过期。授权文件在该供应商的 `codex-auth/` 中，以本机用户权限保护。
刷新加跨进程文件锁，避免令牌轮换冲突；令牌不传给 WebUI，不写入日志。退出仅删除这份本地授权。

对话页添加对话模型；生图页添加图片模型，随后在生图插件中选择该模型引用。候选目录不是账号权限证明。
对话模型行的「模型设置」包含思考强度和上下文窗口；生图模型不使用这组对话参数。
每个生图模型的「模型设置 → 对应的文本模型」从同一供应商已启用的对话模型中选择，保存模型引用；实际请求解析为该对话模型 ID。未选择时沿用原供应商主控配置或默认主控模型。停用或删除所选对话模型后会明确报错，需重新选择。
生图页的模型 ID 是请求给图片工具的模型名称。服务端是否采用该名称无法仅凭请求确认。
生图结果必须有 completed 回执和可解码图片；部分预览、拒绝、空结果不会伪装成功，不会自动改走收费 API。

Codex 后端属于兼容集成，接口与权限可能变化。官方 ChatGPT 套餐 API 当前不支持图片生成，不能用其令牌替代此授权。
支持文生图、图生图和普通对话/图片理解。参考图使用 input_image 数据 URL；带参考图时使用 edit 动作。一次最多 8 张、合计 20 MB，支持 PNG/JPEG/WebP。不提供音频。

验证：包内运行 `node ../../vendor/cortico/node_modules/vitest/vitest.mjs run`，以及两个 tsconfig 的 `tsc --noEmit`。
测试使用隔离目录、真实本地 OAuth 服务和签名令牌，不接真实账号。
