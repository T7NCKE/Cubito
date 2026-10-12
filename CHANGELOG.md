# Changelog

All notable changes to Cubito are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-10-12

### Fixed

- Comparing a litter right after a fan-out no longer shows a "no base ref" error for children the graph hasn't caught up with yet: they fall back to the parent's branch or stay pending until they appear. That message no longer exposes internal ids or paths.
- Long changed lines in the diff and compare panels stay aligned with their line numbers and scroll horizontally instead of wrapping under the gutter.
- A node label that would land on another node's cube is hidden instead of covering it.

## [0.1.3] - 2026-10-09

### Fixed

- Fan-out children are named `fanout-<id>` instead of the Spanish `camada-<id>`; branch names no longer depend on the UI language. Existing `camada-*` worktrees keep working.
- The in-scene terminal header reads "agent" in the English UI.
- Node labels in the compare view sit below their cubes instead of overlapping them when the camera frames the litter up close.

## [0.1.2] - 2026-10-06

### Changed

- Failures from the engine, git, `gh` and `glab` show a lead line in the active language plus the original technical message underneath, instead of raw English text.

### Fixed

- The diff and compare rails show a load failure instead of claiming there are no changes.
- A failed worktree graph sync shows a notice in the HUD, which clears on the next successful sync.
- The command palette's spawn entry reads "crear worktree" in Spanish.

## [0.1.1] - 2026-10-05

### Added

- English and Spanish UI. English is the default; a browser set to Spanish opens in Spanish, and the command palette (`Cmd/Ctrl+K`) switches language, remembered per browser.
- Agent attention notifications are worded in the active language.

### Fixed

- Count-based labels pluralize correctly (no more "1 agentes activos").
- The agent selector in the spawn and fan-out forms shows a localized "none".
- The diff view's review button is no longer covered by the keyboard bar on short windows.
- The demo-mode banner no longer repeats "demo mode".
- Spanish copy uses one register (voseo) throughout.

### Security

- `.env` and `.env.*` are excluded from the Docker build context, so local tokens cannot end up in an image layer.

## [0.1.0] - 2026-10-01

First public release: a spatial frontend over ORCA's headless engine, published as the multi-arch image `ghcr.io/tincke10/cubito` (amd64, arm64) plus a macOS install from source.

### Added

- 3D worktree graph with lineage edges, camera heights (general, island, focus, compare), picking and keyboard navigation.
- Spawn a worktree from any node, with or without a starting agent and prompt; trust is pre-marked for Claude Code, Codex, Cursor and Copilot so agents land on their prompt.
- Fan-out: one prompt across N children with per-child failure reasons, and gates and questions answered from the scene.
- Compare view with winner selection, headless merge into the parent and opt-in parent working-tree sync.
- Diff view (`d`) with a file rail, line panel, rename awareness, and stage, commit and push; PR/MR creation through `gh` and `glab`.
- Live system graph (`x`) of routers, endpoints, services and databases for Express, Fastify, NestJS and Hono, with uncommitted diffs painted on as agents write.
- In-scene terminals: multiple PTYs per worktree, the agent's own terminal first.
- Delete worktree (two-step confirmation), quick-open (`o`) and edit with `Cmd/Ctrl+S`.
- Per-repo setup command so new worktrees get their dependencies; the parent re-runs it after a merge that touches manifests.
- Agent attention notifications (HUD toast and browser Notification) and an automations scheduler (`orca automations`).
- Credentials sealed with AES-256-GCM via `CUBITO_SECRET_KEY` or `CUBITO_SECRET_KEY_FILE`, with Keychain on macOS.
- Docker: non-root container, `claude setup-token` login, opt-in permission bypass (`CUBITO_AGENT_BYPASS`), git identity, `gh` and `glab` in the image, seeded demo repo, `.env.example`.
- Pairing persists across reloads (per tab) and shows a demo-mode banner when absent.
- Release pipeline: `v*` tags publish the image to GHCR and create a GitHub release.

### Security

- The published port binds `127.0.0.1` only.
- Egress audited: no contact with Orca cloud services, no analytics, no updater; `glab` answers offline when unconfigured, the push gateway is not started, and Claude Code's auto-updater is disabled in the image.

[Unreleased]: https://github.com/tincke10/Cubito/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/tincke10/Cubito/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/tincke10/Cubito/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/tincke10/Cubito/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/tincke10/Cubito/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/tincke10/Cubito/releases/tag/v0.1.0
