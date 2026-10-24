# cortico-provider-chatgpt (`index.ts`, `server/auth.ts`, `server/client.ts`)

通过官方 Sign in with ChatGPT 为 myBot 注册独立智能体，使用授权账号的 ChatGPT 套餐或点数。
QQ、人设、工具执行和记忆继续由 myBot 管理。此扩展不读取 ChatGPT 历史聊天或记忆。

## 安装与登录

1. 在包目录运行 `corepack pnpm install`、`corepack pnpm run build:webui`。
2. 在 Cortico 扩展页以本包绝对路径安装，重启以加载扩展。
3. 新建供应商，选择 ChatGPT、填写端点名称并保存。
4. 点击 Continue with ChatGPT，再打开授权链接；在运行 myBot 的电脑上完成登录和额度授权。
5. 获取账号模型、选择模型、保存；需要切换时再设为当前供应商。

每个供应商端点保存一份账号/工作区注册。增加其他账号时新建另一个端点。
回调只监听 `127.0.0.1`，随机端口，10 分钟后失效。远程打开管理页时须在 myBot 主机上打开授权链接。
凭据位于该端点数据目录的 `chatgpt-auth/`，Windows 使用当前用户 SID 的专用 ACL，Unix 使用 0700/0600。
访问令牌临期刷新，刷新通过文件锁跨进程串行化。退出尝试撤销远程会话，清除本地令牌并报告撤销结果。
注册 ID 和主机 ID 保留，以便重新登录；令牌不会返回浏览器或写入日志。

## 模型与限制

模型列表来自账号自己的 `/v1/models`。列表不是所有请求一定成功的保证；权限和额度以请求结果为准。
推理强度填写所选模型支持的原生名称；留空使用模型默认值，`none` 请求不思考（模型须支持）。
温度和服务端输出上限不发送；界面的本地上下文上限不能扩大模型实际容量。
本地 function/custom 工具按 namespace 发送，响应通过 Cortico 原生流式传输和工具执行流程处理。
文本与图片可用；图片需在端点启用且模型支持。此扩展不接 OpenAI 托管搜索、生图、电脑操作、音视频或文件上传 API。
其他 World 提供的工具仍可由本地函数调用执行。

参考：[官方登录流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、
[模型与请求](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、
[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、
[账号和额度](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。

## 验证

`corepack pnpm run typecheck` 与 `corepack pnpm test`。
测试使用临时目录、本地端口、真实 JWT 签名和 PKCE 校验，模型端返回可控的 SSE 响应；不访问外部网络或真实部署。
