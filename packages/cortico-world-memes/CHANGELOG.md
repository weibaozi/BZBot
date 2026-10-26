# `definition.ts` / `MemesWorld`

## 0.7.2

- 首页展示当前包全部图片，缩小预览图并保留分类筛选、分组及懒加载。
- 审核入库不再手选分类；标注后依据已有向量候选自动归类，低于检索阈值或索引不可用时保留未分类。save_meme 和未分类图片语义化同样支持自动归类。

## 0.7.1

- 新增 save_meme：白名单用户明确要求学习图片时直接入库，自动标注和向量化，复用重复图片并同步审核队列。

## 0.7.0

- ZIP 导入改为 PNG/JPG/JPEG 图片，不读取 AstrBot 元数据，既有数据保留。
- 新增收集待审核，按本地日期每天最多 20 张，可调整上限；去重图片不占额度。
- 人工通过后自动标注和向量化，失败可重试，拒绝的重复图片不再收集。

## 0.6.1

- Require one meme search before replying when the random reminder fires; choose whether to send an image after reviewing candidates, and reuse candidates already retrieved in the turn.

- Include admitted QQ group context in the proactive meme reminder probability, for both random replies and forced mentions. Ignore archive-only messages; explicit requests remain independent of the random reminder.

- Advance the WebUI asset version so cached 0.6.0 clients load the new settings.

- Add a hot 0–100% proactive search reminder setting, default 50%. Sample once per delivered chat batch and append reminders through the Persona hook without rebuilding the prefix. Explicit image requests remain independent of probability. Requires patch 0011.

- Search results include deployment-scoped `meme:<id>` image references. QQ and console resolve selected images while sending, eliminating the separate `get_meme` model round.
- Reject disabled, deleted or unavailable images before sending text; keep image bytes in the outgoing event history. Update the saved prompt to pass candidate `image` directly to the channel tool. Requires Cortico patch 0010.

## 0.6.0

- Use ModelHub references for embeddings and image-capable caption models; both selections default to empty. Framework `x-options` supplies the filtered choices.
- Remove plugin-owned endpoints, provider selection and credential storage. ModelHub owns protocols and authentication.
- Send caption images as `input_image`, disable thinking and cap output at 1024 tokens per request. Report generation usage through the World host, including responses that fail JSON parsing.
- Fingerprint indexes by model reference and query prefix; incompatible indexes require rebuilding.
- 升级办法：在模型中心建好嵌入模型和能看图的对话模型，在表情包设置里选上，然后「重建全部向量」。图片、分类和语义标签保留；旧插件地址与密钥配置不再使用。

## 0.5.1

- Remove the random `probability` gate, which discarded a round after the model had already chosen to search. The expression preset now states the intended frequency (about one meme per five replies) and leaves the decision to the conversation model; a saved `probability` value is ignored.
- Rewrite the expression preset in Chinese, shorter and focused on natural use.

## 0.5.0

- Rename the package and World to `cortico-world-memes` / `memes`; tools are `search_meme` and `get_meme`.
- Provide a backed-up deployment migration for existing configuration, prompt overrides and image/vector data.

## 0.4.0

- Replace auxiliary query generation and selection with keyword vector retrieval and a final choice in the existing conversation.
- Add an editable meme expression preset: decide whether to use a meme, emit a few keywords through the search tool, then choose a candidate or none using the current context.
- Remove auxiliary model and copied-context settings; retain visual captioning, embedding settings, query caching and existing pack/index data.
- Replace `qqextras_choose_meme` with `qqextras_search_memes(keywords)`. Existing prompt overrides need the new tool flow; retired auxiliary settings are ignored.

## 0.3.1

- Separate embedded panel styles from the upstream full-page layout.
- Group images by category in responsive square thumbnail grids, with overlay selection, category badges and upload tiles.
- Keep action rows horizontal and adapt to panel width, including narrow side panels.

## 0.3.0

- Add management, semantic processing and mode settings tabs, with upload, category editing, batch moves, trash/restore and portable ZIP export.
- Add incremental captions and vectors, progress, cancellation, failed-item retry and protection for concurrent manual edits.
- Use an auxiliary model to generate a retrieval query and choose a candidate; allow abstention, pack selection, probability and bounded reference context.
- Remove QQ-specific delivery instructions. Keep existing package/config/data identifiers for installed deployments; console images use Cortico patch 0003.

## 0.2.0

- Port the AstrBot meme manager's visual styles and category/grid management flow to Cortico.
- Add pack selection, category filtering, text search, lazy image previews and semantic metadata editing.
- Reject stale edits and exclude changed entries from vector search until the index is rebuilt.

## 0.1.0

- Import AstrBot ZIP packs and expose semantic retrieval and QQ image tools.
