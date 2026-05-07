# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-05-07

### Added

- **Modular Components**: Refactored the connection form into modular components for better maintainability and extensibility.

### Changed

- **Security & Infrastructure**: Updated minimum Node.js version to 22 and refined the security support policy.
- **Improved Stability**: Enhanced connection import security, path validation logic, and general system stability.
- **UI/UX Refinements**: Implemented IPC error unwrapping for cleaner and more descriptive UI notifications.

## [0.3.1] - 2026-05-07

### Added

- **Terminal Enhancements**: Unicode 11 support, canvas rendering fallback, robust clipboard handling, and native keyboard shortcuts.
- **UI/UX Refinements**: Improved breadcrumb masks, real-time terminal status updates, and custom input stepper controls.
- **Accessibility**: Enhanced connection status visibility and UI consistency across all views.

### Changed

- Replaced blocking terminal paste toasts with non-blocking notifications.

### Fixed

- Resolved GitHub Pages synchronization issues during releases.

## [0.3.0] - 2026-05-07

### Added

- **S3 Object Storage**: Full integration for AWS S3 and S3-compatible providers (Minio, R2, etc.).
- **Bucket Management**: Support for listing, creating, and deleting buckets.
- **File Operations**: Multipart upload, streaming downloads, and file previews for S3 objects.
- **Security Monitoring**: Credential security warnings and plaintext key detection.
- **Accessibility**: Keyboard-navigable UI across the entire application.

### Changed

- Optimized Command Palette performance and refined S3 connection form.
- Enhanced SFTP filename sanitization and SSH session stability.
- Updated CI/CD workflows to use Node 24 and automated GitHub Pages deployment.

### Fixed

- Resolved S3 session token expiration and key encoding issues.
- Fixed recursive prefix deletion for S3 storage.

## [0.2.3] - 2026-05-06

### Changed

- Updated version across the application and documentation.

## [0.2.2] - 2026-05-06

### Changed

- Improved release workflow to ensure atomic version updates and stable landing page deployments.

## [0.2.1] - 2026-05-06

### Added

- Disconnect functionality for active SFTP sessions.
- Categorized sidebar connections.

### Changed

- Optimized SFTP connection management and file selection logic.
- Streamlined connection form by removing the "Startup Command" field.
- Refined UI styling for Command Palette and Connection Form.

### Fixed

- Resolved Electron auto-updater signature verification failures on Windows.
- Fixed clipped focus rings and window minimize handler duplication issues.
- Restored test suite integrity after codebase refactoring.

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
