# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Updated Electron to 44.9.1, Biome to 2.6.2, and refreshed AWS SDK, TanStack, Framer Motion, Lucide, Vite and Vitest dependencies and the pnpm lockfile.
- CI test, end-to-end and packaging jobs now run in parallel with quality checks; superseded workflow runs are cancelled, and coverage is collected on Linux while other platforms run tests without coverage.
- Release builds now depend directly on tag validation; removed the separate release verification job and the pull-request dependency review job.

### Security

- Updated transitive dependency overrides for `fast-uri`, `brace-expansion`, `http-cache-semantics` and `undici`, and moved Electron's download tooling to `global-agent` 4 to remove `roarr` and `sprintf-js`.

## [1.1.0] - 2026-10-15

### Added

- macOS in-app update authenticity checks: release zips are verified against an Ed25519 signature (see `src/main/services/update-signature.ts` and `scripts/sign-update.mjs`) that binds version, file name and digest; the compiled-in public key placeholder fails closed while unsigned.
- Terminal output backpressure (`src/main/lib/output-flow.ts`) that pauses SSH/local PTY sources past a high-water mark and resumes once xterm has parsed the backlog, preventing unbounded renderer memory growth.
- Centralized file-type/preview registry (`src/shared/file-types.ts`) shared between the SFTP manager, main-process encoding and `FilePreview`, fixing image preview mismatches.
- Connection history bookkeeping extracted into `src/main/services/ssh/connection-history.ts` with throttled pruning.
- Renderer helper modules: `clipboard.ts`, `entry-names.ts`, `remote-path.ts`, `roving-tabs.ts`, `shortcut-guard.ts`, `snippets.ts`, `terminal-links.ts`, `terminal-search.ts`, `transfers.ts`.
- Additional handler-completeness, migration and component test coverage.

### Changed

- Secrets are now resolved only inside the main process; no IPC channel returns a decrypted secret to the renderer.
- README security/runtime wording updated (asar integrity validation, owner-only database/key files, no password-manager bullet).
- Biome accessibility rules `noStaticElementInteractions` and `useFocusableInteractive` promoted from off to error.
- Vitest configuration migrated from `vitest.config.ts` to `vitest.config.mts`; typechecking now also covers tooling configs.
- pnpm dependency and workspace refresh; CI documentation updated to reflect coverage floors and packaged-build end-to-end runs.
- Hardened a11y for terminal tab strips and modal shortcut handling.

### Fixed

- Clipboard writes now report success only after the write resolves.
- Snippet variable substitution is injection-safe: no RegExp construction from names and no replacement-string interpretation; unmatched placeholders are preserved.
- Remote entry names are validated against traversal, slash and control characters for rename/new-folder.
- Folder Sync transfers are now registered in the renderer transfer queue (progress, completion, cancellation).
- Terminal search decorations and result counts now render; incremental search behaves consistently.
- Home-directory symlink handling in path confinement (`realHome()`).
- Terminal tab keyboard navigation (roving focus) and shortcut suppression while modals are open.

### Security

- Strengthened file path confinement with realpath home-directory resolution.
- Hardened desktop runtime: asar integrity validation at launch, `O_NOFOLLOW` file writes, owner-only database/WAL/SHM and encrypted-key file creation.
- Reinforced IPC payload validation, resource limits, single-instance coordination and locked-keyring non-destructive handling (tests added/updated).

## [1.0.0] - 2026-09-24

### Added

- First implementation of Luna.
