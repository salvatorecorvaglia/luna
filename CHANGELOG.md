# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-06

### Added

- Landing page documentation and theme showcase components.
- PII redaction for IPC events to enhance privacy.
- Comprehensive test suite for IPC handlers and event emissions.

### Changed

- Hardened security for credential storage, file path validation, and IPC data transmission.
- Improved UX with toast throttling, loading indicators, and robust terminal focus restoration.
- Optimized performance through batching of transfer progress updates and memoization of expensive components.
- Enhanced service stability with improved SFTP stream management and transfer queue cleanup.
- Enforced strict typing for IPC handlers and elevated `no-explicit-any` linting to an error level.

### Fixed

- Resolved circular dependency between SFTP manager and transfer queue.
- Improved database migration error handling for smoother updates.

## [0.1.0] - 2026-05-05

### Added

- Official Lunar branding and logo assets across the application UI.
- Platform-specific keyboard shortcuts for improved navigation and accessibility.
- Collapsible "Recent Connections" section in the sidebar for better workspace management.
- Folder suggestion dropdown and tagging support in the Connection Form.
- Connection export/import functionality and host key verification dialogs.
- Tab-based terminal view and improved SSH connection stability.
- App update notifications and automated release pipelines via GitHub Actions.
- Cross-platform builds for macOS, Windows, and Linux.

### Changed

- UI now automatically synchronizes with active terminal themes for a cohesive look.
- Replaced Electron safeStorage with local AES-256-GCM encryption for credential storage.
- Strengthened SSH security with algorithm allowlisting and centralized error mapping.
- Improved window title bar styling and behavior across all platforms.
- Enhanced SFTP session management with automatic timeout and cleanup logic.

### Fixed

- Resolved window dragging interference caused by modal containers.
- Fixed multiple IPC handler registration for window minimization.
- Improved updater error messages and logging for unsigned builds.

### Removed

- Solarized Dark theme and legacy distribution scripts.
- "Quick connect" functionality from sidebar and welcome view.

## [0.0.1] - 2026-04-25

### Added

- First implementation of Lunar.
