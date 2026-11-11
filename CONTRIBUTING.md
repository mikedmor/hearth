# Contributing to Hearth

Thanks for helping. Bug reports, ideas, documentation fixes and code are all welcome.

Hearth is before 1.0, but installs are real homes' start pages: changes keep existing data folders working, and Hearth upgrades an older `hearth.json` by itself when it starts.

## Ways to help

- **Report a bug or suggest an idea** in [GitHub issues](https://github.com/mikedmor/hearth/issues). Include what you did, what you expected and what happened, plus relevant lines from `docker logs hearth`. Never include real keys, passwords, addresses or names.
- **Teach Hearth an app** in [`src/shared/catalog.ts`](src/shared/catalog.ts): its name, logo, category, usual ports and how to recognise it, and ready-made widgets if you can. Keep it factual and test it against the real app. The icon tests check every icon it names exists.
- **Improve the guides** in [`guides/`](guides/README.md). If something confused you, it will confuse others.

Security problems go through [private reporting](SECURITY.md#reporting-a-vulnerability), not public issues.

## Development setup

You need **Node.js 24 or newer**.

```sh
git clone https://github.com/mikedmor/hearth.git && cd hearth
npm install
npm run dev          # server on :8082, and the page with hot reload on http://localhost:5173
```

The setup code for the admin password is in the terminal. Local data lives in `data/`, which git ignores; delete it to start fresh. `cp .env.example .env` for optional settings.

### Commands

| Command                 | What it does                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`           | Server (tsx watch) and page (Vite) together                                          |
| `npm test`              | All tests (Vitest)                                                                   |
| `npm run check`         | Lint, typecheck and tests: what must pass before a pull request                     |
| `npm run format`        | Format and organise imports (Biome)                                                  |
| `npm run build`         | Production build: `dist/web`, the bundled `dist/server/index.js` and the icon library |
| `npm start`             | Run the production build on http://localhost:8082                                    |
| `npm run import:heimdall -- <app.sqlite>` | Import Heimdall's apps (add `--write` to apply)                  |
| `npm run deploy:nas`    | Build and restart Hearth's own container on a server over SSH (`HEARTH_DEPLOY_HOST` in `.env`); ships the committed HEAD, or with `-- --working-tree` exactly what a commit would hold |

### Repository layout

```
src/shared/       Used by both sides: the config schema, themes, widget documents, the formula
                  language, the app catalog, calendars, and what the API sends
src/server/       Hono API: sign-in, permissions, status checks, the widget runtime, AI,
                  discovery, icons, calendars (ICS, CalDAV, Google), the live socket
src/web/          React, Vite and Tailwind page
scripts/          Development, the icon library build, the Heimdall import, deploying over SSH
config/           The example config a new install starts from
public-site/      The static site Google sign-in needs, published to GitHub Pages
guides/           User documentation
docker/           The compose file
```

## Conventions

- **Made-up data only** in tests, fixtures, examples, issues and screenshots: `192.168.1.x`, `nas.home`, "Alex", "Sam".
- **Nothing private on the page for visitors.** Passwords, keys and tokens stay on the server.
- **No new outbound network calls** unless they go through the network guard (`src/server/net.ts`), are opt-in, and are documented in the guide for the feature.
- **Plain words in the interface:** say what something does, in the household's terms. Errors say what to do next.
- **Keep scripts cross-platform:** Node scripts over shell scripts.
- Read [SECURITY.md](SECURITY.md) before changing sign-in, sessions, secrets or the network guard.

## Pull requests

- One change per pull request, with tests for new behaviour. `npm run check` must pass.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- User-facing changes get a line in [CHANGELOG.md](CHANGELOG.md) under **Unreleased**, and an update to the matching guide.

## Releases

Versions follow [Semantic Versioning](https://semver.org/).

1. `npm version 1.2.0 --no-git-tag-version`
2. Move the `[Unreleased]` notes in [CHANGELOG.md](CHANGELOG.md) under `## [1.2.0] - YYYY-MM-DD`.
3. Commit (`chore(release): 1.2.0`) and push, then push the tag: `git tag v1.2.0 && git push origin v1.2.0`.

The Release workflow checks that the tag matches `package.json` and has a changelog entry, runs `npm run check`, publishes `ghcr.io/mikedmor/hearth` for amd64 and arm64 (tagged `1.2.0`, `1.2`, `1` and `latest`), and creates the GitHub release from the changelog. Hearth's update check reads that release.

## License

By contributing, you agree your work is licensed under the project's [AGPL-3.0 license](LICENSE).
