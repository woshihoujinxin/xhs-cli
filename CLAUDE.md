# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`xhs-cli` — a pure CLI tool for Xiaohongshu (小红书) creators. It drives the **creator backend** (`creator.xiaohongshu.com`) via **local Chrome automation** (puppeteer-core + system Chrome; no bundled browser). Capabilities: multi-account login, creator metrics, published-note listing (`recent`), single-note detail, local publish archive (`posted`), and image-post form-filling (`post`).

It is **not** an agent or MCP server. Subcommands in `src/cli/cliRouter.ts` call `impl*` functions in `src/toolset/`; external agents are expected to import those same `impl*` functions and pass in a `ResolvedSession`. `AGENTS.md` is the authoritative integration contract — keep it in sync when the surface changes.

## Commands

| Task | Command |
|------|---------|
| Build (`tsc` → `dist/`) | `npm run build` |
| Build tests (`tsc -p tsconfig.test.json` → `dist-test/`) | `npm run build:test` |
| Full test (build + build:test + run) | `npm test` |
| Run a single test file | `npm run build:test && node --test dist-test/parseArgs.test.js` |
| Run a single test by name | `node --test --test-name-pattern '<pattern>' dist-test/<file>.test.js` |
| Run the CLI after build | `node dist/cli/index.js help` (or `npm run dev`) |
| Deploy the landing site (unrelated to CLI) | `npm run deploy` (needs `.env.deploy`) |

There is **no lint/format step** configured — do not invent one. Tests use the **Node built-in runner** (`node:test` + `node:assert`), not Jest/Vitest. Tests import compiled JS from `dist/` / `dist-test/`, so building first is mandatory; the full `npm test` pipeline is `find dist-test -name '*.test.js' -print0 | xargs -0 node --test` (needs bash; this project runs under bash on Windows).

## Module system & TypeScript

- **ESM only** (`"type": "module"`, `target`/`module` `ES2022`, `strict`). TS source uses **`.js` specifiers in local imports** even though the source is `.ts` — required so emitted `dist/` resolves under Node ESM. Always write `import ... from './foo.js'`.
- `rootDir` is `src/` for the main build and `tests/` for the test build (separate `outDir`s). Never cross-import between them.

## Architecture

### Session & account model — spans `config.ts`, `sessionResolve.ts`, `accountRegistry.ts`

All runtime data lives under `~/.config/xhs-cli/.cache/` (overridable with `XHS_CLI_HOME` — this is how tests isolate state):

```
.cache/
├── accounts/
│   ├── registry.json            # { currentAccount, accounts: { slug: {...} } }
│   └── <slug>/browser-data/     # per-account Chrome userDataDir (cookies/session)
├── published/                   # local JSON archive read by `xhs posted`
└── notes/, cookies/, sandbox/   # caches
```

`resolveSession(explicitAccount?)` is the entry point every business command uses. Resolution order: explicit `--account` → `registry.json` `currentAccount`; throws if no accounts exist or no current account is set. Returns a `ResolvedSession` = `{ account, browserUserDataDir, cachePathPrefix: 'accounts/<slug>/' }`. The `cachePathPrefix` namespaces cache files per account via `prefixedCacheFilename()` so accounts never overwrite each other.

### Layering

`cli/index.ts` (entry) → `cli/cliRouter.ts` (subcommand dispatch + usage validation) → `toolset/index.ts` (`impl*` thin wrappers) → `toolset/<feature>.ts` (business logic) → `browser/index.ts` (puppeteer-core) + `utils/cache.ts`.

`cli/parseArgs.ts` is intentionally dependency-free so it is unit-testable in isolation. `cliRouter` uses a custom `CliError` + `die()` pattern for usage errors (caught and `exit(1)`'d without stack noise). Removed legacy subcommands (`drafts`, `published`) are rejected in `cliRouter` with migration messages — keep those guards when refactoring dispatch.

### Browser layer — `browser/index.ts`

`launchBrowser()` finds system Chrome (or `CHROME_PATH`), launches with a per-account `userDataDir`, and — **critically** — falls back to **attaching to an already-running browser via CDP** (port 9222, else the `DevToolsActivePort` file in the userDataDir) when the profile is locked. This is why `xhs home` (which spawns a detached Chrome with `--remote-debugging-port=9222` bound to `127.0.0.1`) leaves a reusable instance that later `metrics`/`recent`/`post` commands attach to instead of failing with "profile in use". Preserve this reuse path when touching browser code. `withLoggedInPage(cb, browserUserDataDir?)` is the standard wrapper: launch headless → navigate to `/new/home` → throw on login redirect → run `cb(page)` → close.

### Caching — `utils/cache.ts`

JSON files shaped `{ data, cachedAt }`. Every path goes through `resolveUnderCacheDir()` which **rejects `../` traversal**. Writes use `0o600`. TTLs are constants in `config.ts`. When you change a cached payload shape, bump the in-code `CACHE_VERSION` literal (e.g. `get_metrics.ts`) so old cache auto-invalidates — never ask users to clear cache manually.

### Post flow — `toolset/post.ts`

`post` consumes only the `--title`, `--content`/`--content-file`, and `--image` paths of the current invocation (no queue, no drafts). Validation (`postValidate.ts`): title ≤ 20 chars, content 10–1000 chars, 1–18 images that must exist and be readable.

By default it **only fills the form and leaves the browser window open** for human confirmation. `--publish` triggers an automatic click via **screen coordinates** (`XHS_PUBLISH_X`/`XHS_PUBLISH_Y`, default 934/983) converted to viewport coords at runtime. This is deliberately env-tunable because the XHS publish button's screen position is fragile to UI/layout changes.

### Long-text flow — `toolset/postLongText.ts` (CLI: `xhs longtext`)

A parallel to `post` for the **article** entrypoint (`?from=menu&target=article`): you supply only `--title` + `--content`/`--content-file` (markdown, no local images). With `--publish`, it fills the article editor → clicks the footer **「下一步」** button (XHS then auto-renders the body into images) → waits for conversion → clicks **「发布」** on the regular publish page. Button clicks use the same **selector+label-first, screen-coordinate fallback** strategy as `post`'s publish, with two extra env knobs: `XHS_LONGTEXT_NEXT_X`/`XHS_LONGTEXT_NEXT_Y` (the 下一步 button) and `XHS_LONGTEXT_CONVERT_MS` (conversion wait, default 20000). Validation is `validateArticleParams` in `postValidate.ts` (lenient content limits vs. the 1000-char image-note cap).

## Release / publish

- npm package name is `@easyasstudio/xhs-cli`; `bin` is `xhs`.
- Tag push (`v*`) triggers `.github/workflows/tag-publish.yml`: gated on the `NPM_TOKEN` secret, runs tests, publishes with provenance, then verifies via `npm view`.
- `postpublish` runs `git checkout README.md` because **the npm-shipped README is rewritten during publish** (the `landing/` site rewrites it). Expect the working-tree README to be restored after publish.

## `landing/` is a separate project

`landing/` is a marketing site with its own `CLAUDE.md` / `AGENTS.md` / `GUIDE.md`. Deploy via `scripts/deploy.mjs` (Docker build → registry push → SSH pull+run). It is independent of the CLI in `src/`.

## Testing conventions

Tests set `XHS_CLI_HOME` to a temp dir via `tests/helpers/isolatedHome.ts`. Because `APP_HOME` in `config.ts` is captured **at module load**, any test touching the registry/config must call `installIsolatedHome()` (in a `before` hook or before importing business modules) or it will clobber the real `~/.config/xhs-cli`.
