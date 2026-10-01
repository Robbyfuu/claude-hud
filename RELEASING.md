# Releasing

This project ships as a Claude Code plugin. Bun runs `src/` directly, so there is no compiled output to ship.

## Release Checklist

1) Update release versions:
   - `.claude-plugin/plugin.json` (Claude Code's update/cache key)
   - `package.json`
   - `bun.lock` (refresh with `bun install`)
   - `CHANGELOG.md`

   Keep `.claude-plugin/plugin.json` and `package.json` on the same version. The marketplace manifest is distribution metadata for this repo; the plugin update version comes from `plugin.json`.
2) Verify:
   ```bash
   bun install --frozen-lockfile
   bun run typecheck
   bun test
   bun run test:coverage
   ```
3) Verify plugin package contents:
   - `package.json` points to `src/index.ts`
   - `.claude-plugin/plugin.json` includes the release version
4) Commit and tag:
   - `git tag vX.Y.Z`
5) Publish:
   - Push tag
   - Create GitHub release with notes from `CHANGELOG.md`
