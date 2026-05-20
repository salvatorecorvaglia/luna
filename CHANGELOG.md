# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-05-20

### Added

- **Testing**: Added comprehensive unit test suites for rate-limiting, credential store backends, and IPC request validation.
- **Design Tokens**: Added design-token enforcement tests to ensure consistent UI styling.

### Improved

- **Security & Validation**: Hardened error handling and input validation across SSH, IPC, credential, and database services.
- **Rate Limiting**: Implemented session bucket eviction cap and clock skew protection.
- **S3 Storage**: Added retryable classification to S3 errors and implemented strict limit enforcement during listing operations.
- **UI Design System**: Standardized UI design tokens, semantic colors, and z-index management (using Z layers) across components like `CommandPalette` and `ConnectionForm`.
- **UI Layout & Components**:
  - Reordered settings sections and aligned danger zone controls.
  - Modularized Sidebar by extracting parts to a dedicated folder.
  - Replaced toast notifications with inline status feedback in connection settings and form.
  - Modernized layout using Tailwind size utilities and unified error handling via shared toast helpers.

## [0.7.4] - 2026-05-19

### Fixed

- **Security & Path Validation**: Secured `readFile` operations by using the `O_NOFOLLOW` flag to prevent symlink traversal attacks outside the sandbox jail.
- **Transfer Stability**: Prevented potential transfer race conditions in the file/storage queues.
- **Settings Management**: Resolved an issue by allowing null settings values in database storage configurations.

### Improved

- **Error Handling & Stability**: Replaced generic errors with a structured custom `LunarError` class across core services and optimized connection name validation for better main process stability.
- **S3 & Storage Integration**: Centralized S3 client configuration, improved transfer queue error handling, and corrected related linter warnings.
- **UI State Persistence**: Refactored the UI store to exclude the `activeView` from persistent storage, ensuring state is cleanly reset on app startup.
- **Connection Logic**: Modularized connection validation routines.

## [0.7.3] - 2026-05-18

### Added

- **Connection Management**: Added functionality to rename connection groups in the sidebar.

### Improved

- **Connection Management**: Replaced the S3 endpoint string with structured protocol, host, and port fields in the connection form to improve input validation and consistency.

## [0.7.2] - 2026-05-18

### Improved

- **SSH & Security**: Removed strict home-directory confinement from private key path validation and file operations. This allows users to import and use SSH private keys located anywhere on the system (e.g. in `/etc` or custom directories) while maintaining strong absolute path validation.

## [0.7.1] - 2026-05-18

### Added

- **Security & Validation**: Enforced byte-based length validation for secrets and rate-limited timestamps.

### Improved

- **Code Organization & Refactoring**:
  - Abstracted terminal session management into a custom `useTerminalSession` hook and extracted the terminal search bar component.
  - Extracted connection form state logic into a custom `useConnectionFormState` hook and split S3/SFTP field components.
  - Moved terminal sanitization to a dedicated module and expanded unit/integration test coverage.
- **Database Optimization**: Replaced wildcard `SELECT *` statements with explicit column projections for all connection queries to improve efficiency and type safety.
- **Performance & Bundling**: Optimized bundle size and startup time with Vite manualChunks and lazy-loaded components/overlays (reducing initial chunk size from ~1.7 MB to ~250 kB).
- **Formatting**: Refactored the entire codebase for consistent formatting using Prettier.

## [0.7.0] - 2026-05-16

### Added

- **Infrastructure**: Implemented a database migration framework and runtime configuration for SSH and S3 connection settings.
- **Security**: Added secure host key verification store with TOFU (Trust On First Use) support and IPC payload size validation.
- **UX**: Added transfer cancel confirmation, terminal search match counts, and S3 listing truncation alerts.

### Improved

- **Security & Validation**: Enforced strict input validation for database updates and added a jump host validation utility.
- **Stability**: Enhanced transfer stability with session closing states, race-condition guards for file operations, and verification of upload completion.
- **State Management**: Refined filter state management across the application.
- **Updates**: Added a manual download link to the update error toast action.

## [0.6.3] - 2026-05-14

### Improved

- **Security Hardening**: Enhanced credential validation, SSH key scrubbing, process environment cleanup, and safer file handling.
- **Storage Management**: Refined storage provider registration/unregistration lifecycle and improved SFTP session active state detection.

## [0.6.2] - 2026-05-13

### Added

- **Connection Management**: Introduced a visibility toggle to allow hiding specific sessions from the sidebar for a cleaner workspace.

### Improved

- **Import Infrastructure**: Enhanced MobaXterm import logic with improved jump host detection, bogus record filtering, and support for inline configuration.
- **Security & Stability**: Hardened SSH key parsing validation and implemented database maintenance routines to automatically clean up legacy or invalid connection records.

### Changed

- **Architecture**: Decoupled jump host management into standalone connections to provide greater flexibility in complex network environments.
- **State Management**: Refined UI store persistence to exclude transient hidden connection states.

### Fixed

- **Importer Reliability**: Corrected folder naming conventions during connection imports and resolved font/UI configuration line parsing issues.

## [0.6.1] - 2026-05-13

### Added

- **Infrastructure**: Introduced a centralized IPC registration wrapper to standardize handler lifecycle and error propagation.
- **File Management**: Added a new file preview component for the storage browser.
- **Testing**: Expanded integration test suite for the connection flow and refactored IPC handlers to async for better testability.

### Changed

- **Storage Architecture**: Migrated SFTP and S3 state management to a unified `storage-store` and transitioned to transfer-based IPC handlers.
- **Security & Validation**: Hardened shell IPC operations with strict path safety enforcement and updated Content Security Policies (CSP).
- **Optimization**: Implemented S3 list limits and improved validation logic for storage providers.

## [0.6.0] - 2026-05-13

### Added

- **SSH Infrastructure**: Implemented manual SSH tunnel support (jump hosts), enabling secure connections to remote servers through intermediate gateway hosts.
- **Connection Management**: Enhanced the connection form with a dedicated "Advanced" section for configuring jump host parameters, including authentication and port settings.

### Changed

- **CI/CD Maintenance**: Proactively updated GitHub Action workflows to prepare for the Visual Studio 2026 runner migration.

## [0.5.6] - 2026-05-12

### Added

- **Navigation UX**: Reordered the main view switcher tabs (Local, Terminal, SFTP) and updated global keyboard shortcuts to align with the new layout for a more intuitive workflow.

### Changed

- **Branding**: Updated the application tagline to "Your place in one calm workspace" across documentation and settings.

### Fixed

- **SSH & SFTP Stability**: Implemented session cleanup on SSH reconnection and coalesced concurrent SFTP subsystem requests to prevent connection leaks.
- **Transfer Reliability**: Resolved potential duplicate transfers by implementing synchronous reservation of deduplication keys.
- **Test Infrastructure**: Added shell mocks to the SSH manager test helpers to improve test isolation and reliability.

## [0.5.5] - 2026-05-12

### Added

- **Security**: Implemented credential tamper notifications to detect unauthorized modifications to stored connection data.
- **SFTP Infrastructure**: Introduced dedicated IPC support for SFTP operations to improve process isolation and reliability.

### Changed

- **Performance Optimization**: Extracted and centralized the storage rate limiter to ensure consistent throughput across S3 and SFTP providers.

## [0.5.4] - 2026-05-11

### Added

- **Import Support**: Added support for importing connections from MobaXterm, PuTTY, and WinSCP files.
- **SSH Security**: Implemented cipher validation against Node.js crypto support to ensure connection compatibility.

### Fixed

- **SSH Stability**: Refined the SSH connection handshake settlement logic to prevent race conditions during initialization.

## [0.5.3] - 2026-05-11

### Added

- **Error Handling**: Standardized error handling across the application with structured error codes for better diagnostic clarity.
- **Security**: Hardened the Electron security posture by refining IPC validation and resource isolation.

### Changed

- **Performance Optimization**: Optimized terminal IPC throughput and session recovery logic to improve rendering responsiveness.
- **Reliability Hardening**: Improved transfer queue deduplication logic and logger resilience under heavy load.
- **UI/UX Refinements**: Unified focus management across all dialogs and modals for better keyboard navigation.

## [0.5.2] - 2026-05-11

### Added

- **SSH Support**: Expanded the connection form file picker to include additional SSH key extensions like `.ppk`, `.pem`, and `.key`.

### Changed

- **Terminal Stability**: Refined terminal initialization by wrapping it in a microtask to eliminate potential race conditions during component mounting.
- **Project Structure**: Organized repository templates by moving pull request templates into a dedicated subdirectory.

## [0.5.1] - 2026-05-11

### Added

- **Storage Improvements**: Implemented SSH key caching and directory invalidation logic for faster storage navigation.
- **UI/UX Refinements**: Added sidebar snapping and a new reusable `ContextMenu` component.
- **Security & Validation**: Introduced private key validation and improved SSH host-key auditing.

### Changed

- **Performance Optimization**: Enhanced virtual list rendering for large file directories and storage providers.
- **Reliability Hardening**: Improved transfer queue error classification and progress finalization logic.
- **Process Management**: Strengthened security for local terminal PTY spawning and sanitized credential storage.

### Fixed

- **Terminal Stability**: Resolved crashes during terminal resizing and initialization by wrapping `fitAddon` calls in error handlers.
- **Code Quality**: Suppressed explicit `any` lint warnings in terminal logic and improved IPC error logging.

## [0.5.0] - 2026-05-10

### Added

- **S3 & SFTP Infrastructure**: Major refactor of storage providers and connection logic to improve reliability and testability.
- **Enhanced Testing**: Significant expansion of unit and integration test coverage for IPC handlers, renderer hooks, and host key management.

### Changed

- **Terminal Stability**: Implemented debounced resizing for the terminal to prevent redundant SSH session calls and improve performance.
- **SSH Security**: Modularized pending host key management and improved session closure logic to resolve potential race conditions.
- **UI/UX Refinements**: Refined command palette shortcut handling to prevent accidental triggers while focus is in form inputs.

## [0.4.0] - 2026-05-09

### Added

- **Local Terminal Support**: Native local shell integration (bash, zsh, powershell) using `node-pty`, allowing users to manage local and remote workflows in one place.
- **IPC Logging**: Implemented a robust renderer-to-main IPC logging system for improved debugging and monitoring.

### Changed

- **Infrastructure Hardening**: Introduced structured error handling and a centralized IPC handler for consistent cross-process error propagation.
- **Terminal Optimization**: Reduced minimum terminal tab width to 90px to improve tab density and visibility.
- **Process Management**: Refactored `node-pty` integration to use ESM and sanitized the local terminal process environment.

## [0.3.5] - 2026-05-09

### Added

- **UI/UX Refinements**: Implemented drag-and-drop reordering for connections in the sidebar with state persistence.
- **Documentation**: Added helpful tooltips to S3 connection fields to guide users through configuration.

### Changed

- **Internationalization**: Completed a full audit and removal of Italian localization from comments and source code to standardize on English.

### Fixed

- **Code Quality**: Resolved linting errors and improved type safety in the settings panel by removing `any` types.

## [0.3.4] - 2026-05-09

### Added

- **Storage Improvements**: Implemented S3 operation timeouts and optimized storage query caching for better performance.
- **UI/UX Refinements**: Added reorderable sidebar sections with persistence, drag-and-drop state for sidebar connections, and a close button to the command palette.
- **Error Handling**: Introduced toast notifications for directory listing failures to provide better user feedback.

### Changed

- **Navigation Enhancements**: Settings panel now closes on overlay click, and the redundant "Add Tab" button was removed from the terminal view to streamline the UI.

### Fixed

- **UI Stability**: Resolved z-index conflicts in the settings panel and ensured consistent `cursor-pointer` styles for interactive elements.

## [0.3.3] - 2026-05-08

### Added

- **Contribution Standards**: Introduced comprehensive issue and pull request templates to streamline community contributions.

### Changed

- **UI/UX Refinements**: Eliminated terminal view transitions and tab reorder animations to ensure an instantaneous and fluid user experience.
- **Sidebar Improvements**: Enhanced the connection context menu to hide the "Show Session" action when disconnected.
- **CI/CD Hardening**: Refined the documentation deployment workflow to prevent accidental builds for untagged versions.

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
