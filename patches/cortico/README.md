# Cortico 补丁

`scripts/m0-setup.ps1` 在把 `vendor/cortico` 切到锁定的 commit 之后，按文件名顺序打上这里的补丁；已经打过的会跳过。规则见根目录 `AGENTS.md` 第 1 条。

| 补丁 | 基于 | 改了什么 | 上游状态 |
|---|---|---|---|
| `0001-provider-model-picker.patch` | `e3b214e` | 端点编辑页的选模型流程：填好地址和 key 后自动获取模型列表；列表可搜索、点一行即选中（显示上下文长度和是否支持图片）；没选模型时「测试连接」直接提示，不发请求。服务端：草稿还没选模型时也能获取模型列表（以前会报"模型名不能为空"，导致无法从列表里选模型）。界面文案改齐 11 种语言，补了测试。 | 未提交；提 PR 前先给用户过目 |

## 重新导出补丁

```powershell
git -C vendor/cortico diff -- src tests > patches/cortico/0001-provider-model-picker.patch
```
