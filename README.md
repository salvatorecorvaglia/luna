# Lunar 🌙

**A modern SSH terminal, local terminal, SFTP file manager, and S3-compatible object storage browser.**

Lunar is a high-performance, cross-platform desktop application designed to streamline your remote and local workflows. Browse SSH/SFTP servers and S3-compatible object stores side-by-side with your local filesystem, with a powerful terminal (SSH or local shell) just a tab away.

---

## 📋 Table of Contents

- [Features](#-features)
  - [SSH & Local Terminals](#1-ssh--local-terminals)
  - [SFTP File Manager](#2-sftp-file-manager)
  - [S3-Compatible Object Storage Browser](#3-s3-compatible-object-storage-browser)
  - [Security & Credentials Management](#4-security--credentials-management)
  - [Connection Migration & Portability](#5-connection-migration--portability)
  - [Command Palette & Global Shortcuts](#6-command-palette--global-shortcuts)
  - [Session Recovery](#7-session-recovery)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development Scripts](#development-scripts)
- [Project Architecture](#-project-architecture)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)

---

## ✨ Features

### 1. SSH & Local Terminals
* **Tabbed Interface & Splits**: Manage multiple terminal sessions with rich tabs, horizontal/vertical split panes, session layout management, and dynamic resizing.
* **xterm.js Integration**: Fully featured terminal emulation powered by `xterm.js` and `node-pty`.
* **Hardware Acceleration**: High-performance rendering with Canvas and WebGL addons.
* **Terminal Search**: Built-in search bar for traversing terminal scrollback buffers.
* **Dynamic Theme Sync**: Terminal theme colors are automatically built and applied as CSS variables to the rest of the application shell.
* **Database-Synced Settings**: Key terminal settings (theme, font size, and scrollback limit) are synchronized directly to a local SQLite database to prevent local storage/preference drift.
* **Connection Stability & Guards**: Robust error handling on bastion connection tunnels and SFTP streams, coupled with connection identity guards to prevent callbacks on disconnected or replaced sessions.
* **Advanced SSH Config & Tunneling**: Database-backed configuration support for SSH keepalives alongside local, remote, and dynamic SSH port forwarding (tunneling).

### 2. SFTP File Manager
* **Dual-Pane File Explorer**: Modern layout for navigating remote directories side-by-side or alongside terminals.
* **Transfer Queue**: Active upload and download tracking with real-time transfer progress indicator.
* **File Previews & Inline Editing**: Quick preview panel for supported file formats, complete with inline editing and save support for both local terminal shells and remote storage providers (SFTP/S3).
* **Robust Fallback**: Graceful handling of SSH-level disruptions with session-level fallback handling.
* **Keyboard Navigation & Accessibility**: Full keyboard navigation (Arrow keys, Space to toggle selection, Enter to open, Escape to clear) with complete ARIA compliance and screen reader support (e.g. `aria-activedescendant`).

### 3. S3-Compatible Object Storage Browser
* **Universal S3 Support**: Browser compatible with Amazon S3 and all S3-compatible storage endpoints (MinIO, Cloudflare R2, DigitalOcean Spaces, etc.).
* **OOM & Truncation Safety**: Built-in limit safety that caps single prefix queries to prevent application crashes on directories/buckets with millions of keys, prompting you to drill into sub-prefixes instead.
* **Bucket & Object Management**: Seamlessly browse buckets, traverse key prefixes, upload files, and download objects.
* **Presigned URL Generation**: Dedicated generation dialog for S3 presigned URLs supporting custom expiration parameters.

### 4. Security & Credentials Management
* **OS Keychain Integration**: Credentials are securely saved to the OS-level credential store (via `keytar`/native API), with auto-detection that prompts a warning toast when falling back to plaintext storage (e.g. Linux machines missing `libsecret`).
* **Tamper Detection**: Cryptographic integrity validation on startup ensures that corrupted or manually altered credential rows are immediately isolated and reported to prevent credential hijack/leak.
* **Host Key Verification**: Interactive fingerprint verification alerts on connecting to a new host to prevent man-in-the-middle attacks.

### 5. Connection Migration & Portability
* **Third-Party Migrator**: Directly import connection profiles from other terminal and transfer utilities: **MobaXterm** (`.mxtsessions` / `.mxtpro`), **PuTTY** Registry exports (`.reg`), and **WinSCP** config files (`.ini`).
* **SSH Config Importer**: Built-in parser and importer to easily load standard SSH host configurations (e.g. from `~/.ssh/config` or custom configs).
* **Backup & Restore**: Export your configured connections securely to JSON and import them back at any time.

### 6. Command Palette & Global Shortcuts
* **Mouse-Free Navigation**: Trigger the unified command palette anywhere using `Cmd+K` (or `Ctrl+K`).
* **Instant Shortcuts Help**: Tap `?` (when not focusing input elements) to view the global shortcut mappings.
* **Sidebar Toggle**: Collapse the navigation sidebar using `Cmd+B` to maximize workspace real estate.

### 7. Session Recovery
* **Crash-Resilient Stateful Shell**: In-flight SSH shell connection, local shell, and SFTP directory structures are tracked in the main process, allowing session state recovery after manual restarts or reload actions (`Cmd+R`).
* **Interactive Reconnection**: Lost shell or SFTP sessions automatically trigger a recovery overlay with a "Reconnect" button, attempting to re-establish connections gracefully.

---

## 🛠 Tech Stack

Lunar is built on a modern, robust, and lightning-fast developer stack:

* **Framework**: [Electron](https://www.electronjs.org/) (Main, Preload, and Renderer structure)
* **Build Tooling**: [electron-vite](https://electron-vite.org/)
* **Frontend Library**: [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + [Framer Motion](https://www.framer.com/motion/)
* **State Management**: [Zustand](https://zustand-demo.pmnd.rs/) (Client UI, connection, and terminal states)
* **Data Fetching**: [@tanstack/react-query](https://tanstack.com/query/latest) (Caching remote file hierarchies and lists)
* **Terminal Engine**: [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty)
* **Database**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (Local database storage)
* **Object Storage**: AWS SDK v3 (`@aws-sdk/client-s3`)
* **Linter & Formatter**: [Biome](https://biomejs.dev/) (Unified, high-performance linting and formatting)

---

## 🚀 Getting Started

### Prerequisites

* **Node.js** (v22 recommended)
* **pnpm** (v11 recommended)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/salvatorecorvaglia/lunar.git
   cd lunar
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```
   *Note: This will automatically build native modules (like `better-sqlite3` and `node-pty`) via `electron-builder install-app-deps` in the postinstall script.*

3. **Start the application in development mode**:
   ```bash
   pnpm dev
   ```

### Development Scripts

The following scripts are available in the project:

| Script | Command | Description |
|---|---|---|
| `pnpm dev` | `electron-vite dev --noSandbox` | Starts the app with hot-reloading and logs |
| `pnpm build` | `electron-vite build` | Compiles code for production distribution |
| `pnpm preview` | `electron-vite preview` | Previews the compiled production build |
| `pnpm lint` | `biome check src/` | Checks code formatting, linting, and imports using Biome |
| `pnpm format` | `biome check --write src/` | Automatically formats, fixes, and organizes imports using Biome |
| `pnpm typecheck` | `pnpm typecheck:node && pnpm typecheck:web` | Full Node and Web TypeScript type checks |
| `pnpm test` | `vitest run` | Runs unit and integration tests |
| `pnpm test:watch` | `vitest` | Runs unit and integration tests in watch mode |
| `pnpm test:coverage`| `vitest run --coverage` | Evaluates test code coverage |

---

## 📂 Project Architecture

```
src/
├── main/       # Electron main process (IPC controllers, SSH connection manager, database setup)
├── preload/    # Preload scripts (securely bridging node logic/APIs to the renderer window)
├── renderer/   # React frontend source files (pages, UI layout, components, global state stores)
│   └── src/    # React codebase roots (components, themes, hooks, services, state management)
├── shared/     # Unified TypeScript types, constants, schemas, and schemas common to main/renderer
└── test/       # Test suites, mocking utilities, and Vitest configuration presets
```

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 🔐 Security

If you discover a security vulnerability, please see our [Security Policy](SECURITY.md).

## 📝 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

**Author**: [Salvatore Corvaglia](https://github.com/salvatorecorvaglia)
