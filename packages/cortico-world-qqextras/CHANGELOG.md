# `definition.ts` / `QqextrasWorld`

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
