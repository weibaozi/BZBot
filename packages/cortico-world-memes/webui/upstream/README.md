# `ui.css` / `manage.css`

Copied from anka-afk/astrbot_plugin_meme_manager at commit 88b8a1ba12a8969cab70b31e6cdc258f61620fcd:

- `pages/app/shared/ui.css` → `ui.css`
- `pages/app/a_manage/style.css` → `manage.css`

MIT copyright notice is retained in LICENSE. The management page layout and interaction flow are adapted in ../client.ts to Cortico panel APIs. Styles are isolated in a ShadowRoot; :root is mapped to :host when mounted. ../port.css supplies layout adjustments for the embedded panel. AstrBot's page SDK, cloud storage and resource marketplace are not loaded.
