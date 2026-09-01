# Luna 🌙

**Cross-platform remote & local workflow workstation**

**Luna** is a high-performance, cross-platform desktop application designed to streamline your remote and local workflows. Browse SSH/SFTP servers and S3-compatible object stores side-by-side with your local filesystem, with a powerful terminal (SSH or local shell) just a tab away.

---

## ✨ Key Features

### 🖥️ High-Performance Terminals
*   **Hardware Acceleration:** Powered by [xterm.js](https://xtermjs.org/) using WebGL and Canvas renderers for low-latency rendering.
*   **Advanced Layouts & Presets:** Supports vertical and horizontal split panes, dynamic resizing, and saving/restoring workspace layout presets.
*   **Broadcast Input & Output Filtering:** Broadcast commands to multiple active terminal tabs simultaneously and filter live terminal logs using text or regex filters.
*   **Automation & Snippet Vault:** Store reusable command snippets in a searchable Snippet Vault and record automated terminal keypress sequences with the Macro Recorder.
*   **Session Audit & Shell History:** Index command history for fast search and export detailed session audit logs in JSON, HTML, or plain text formats.
*   **Built-in CLI Reference:** Access interactive, searchable CLI command reference documentation directly inside the terminal workstation.
*   **Session Recovery:** Long-lived session management in the main process preserves scrollback buffers, cursor states, and tab setups through renderer reloads or window refreshes (e.g., `Cmd+R`).
*   **Reliable Reconnection:** Automatically re-establishes dropped SSH sessions according to your `ssh.autoReconnect` preference, with clear status feedback if a manual reconnect attempt fails.
*   **Custom Themes:** Dynamically maps terminal color palettes directly onto the React application UI for unified styling.

### 🔌 SSH Port Forwarding & Tunnel Manager
*   **Full Tunneling Support:** Configure and manage Local, Remote, and Dynamic (SOCKS5 proxy) SSH tunnels.
*   **Live Status Monitoring:** Monitor active tunnels, port bindings, and forwarding status directly from the interactive Status Bar.
*   **Explicit Public Binds:** A bind is certified as loopback by address, never by hostname, so a doctored `/etc/hosts` entry cannot turn a local forward into a publicly reachable one without the opt-in.

### 📁 SFTP File Manager & Folder Sync
*   **Folder Synchronization:** Perform directional or bidirectional directory synchronization between local and remote paths with conflict detection.
*   **Visual File Operations:** Drag-and-drop file transfers, directory creation, deletion, and renaming over remote SSH channels.
*   **Enhanced Inline File Editor:** Open, view, search, word-wrap, live-tail, and edit local or remote files (code, config scripts, logs) directly inside `FilePreview`.
*   **Enhanced Accessibility:** Fully optimized keyboard navigation (e.g., Space to toggle multi-row selection) and standard-compliant ARIA attributes. Split-pane and sidebar handles are focusable `separator`s that resize with the arrow keys, and transfer progress is exposed as a labelled `progressbar`.
*   **Safety Guards:** Protective recursion depth limits and warning thresholds to prevent accidental bulk deletions.
*   **Corruption-Safe Downloads:** Downloads write to a temporary file and are atomically renamed into place, preventing partial or corrupted files if a transfer is interrupted.

### 🪣 S3 Object Storage Browser
*   **Multi-Provider Support:** Seamlessly connect to AWS S3 and any S3-compatible APIs (MinIO, Cloudflare R2, Backblaze B2, etc.).
*   **Pagination & Safety Limits:** Intelligently paginates massive buckets, offering user alerts to prevent application hangs or memory limits.
*   **Presigned URLs:** Generate temporary access URLs for object sharing with customizable expiration times.

### 🔒 Enterprise-Grade Security & Credential Tools
*   **IPC Payload Validation:** Enforces strict payload validation and input sanitization across all main-process IPC service handlers to protect internal services.
*   **IPC Resource Limits:** Rate limiters and session caps on S3, SSH, and credential IPC channels bound resource usage from a chatty or compromised renderer, and a single-instance lock prevents concurrent processes from racing database or credential writes.
*   **Built-in Password Manager:** Generate strong passwords with configurable complexity and securely manage stored credentials, with optional 1Password and Bitwarden CLI lookups on macOS, Windows, and Linux.
*   **OS-Protected Credentials:** Integrates with system keychains (Keychain Services on macOS, Credential Manager on Windows, Gnome Keyring/libsecret on Linux) to prevent credential leakage. On Linux the backend actually in use is inspected: a `basic_text` keyring encrypts with a hardcoded key and is reported as unprotected rather than counted as OS-backed.
*   **Non-Destructive Key Handling:** A locked or access-denied keyring is a hard, recoverable error — Luna reports a `locked` state, leaves the encrypted master key byte-for-byte intact instead of regenerating it, and asks you to unlock and restart. Credential rows that cannot be decrypted are retained for re-entry, never deleted.
*   **Tamper Protection:** Actively audits and alerts the operator of corrupted or unauthorized credential modifications on disk.
*   **Hardened Desktop Runtime:** Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and `--inspect`, and the app loads only from the asar; top-level navigation is allowlisted to the bundled renderer; the database (with its WAL/SHM siblings) and the encrypted key file are created owner-only; and file writes open with `O_NOFOLLOW` so the path cannot be swapped for a symlink after validation.
*   **No Third-Party Assets At Runtime:** Inter and JetBrains Mono ship inside the app as `woff2` subsets, so both Content-Security-Policy definitions are `'self'`-only and no launch makes a CDN request.
*   **Clear Visibility:** Alerts the user immediately via toast notifications if the workspace falls back to unencrypted plaintext or memory-only keys due to missing OS libraries.

### 📥 One-Click Importers
*   **SSH Config Parser:** Import connection configurations directly from your system SSH config file (`~/.ssh/config`).
*   **WinSCP Importer:** Auto-import WinSCP profiles, including parsing of registry exports (`.reg` files).
*   **MobaXterm & PuTTY Importers:** Auto-import session profiles from MobaXterm (`.mxtsessions` / `.mxtpro`) and PuTTY registry exports (`.reg`).

---

## 🚀 Getting Started

### Prerequisites

*   **Node.js:** `>= 22.0.0`
*   **pnpm:** `>= 11.6.0` (Workspace support enabled)
*   **Compiler Tools (for native node-pty compilation):**
    *   **macOS:** Xcode Command Line Tools (`xcode-select --install`)
    *   **Windows:** Visual Studio Build Tools / desktop development packages
    *   **Linux:** `build-essential`, `python3`, `libsecret-1-dev` (for secure credentials)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/salvatorecorvaglia/luna.git
    cd luna
    ```

2.  Install dependencies:
    ```bash
    pnpm install
    ```

### Development Workflow

Start the Electron builder dev server with live hot-reloading:
```bash
pnpm run dev
```

### Build & Package

Compile the app — main, preload and renderer bundles are written to `out/`:
```bash
pnpm run build
```

Produce an installer for your current operating system:
```bash
pnpm run package
```
Installers are written to the `dist/` directory.

To get an unpacked application directory without building an installer — useful for inspecting
what actually ships inside the asar — use:
```bash
pnpm run package:dir
```

### Linting & Formatting

We use **Biome** for fast formatting, linting, and quality checks:
```bash
# Check code style and run lint checks
pnpm run lint

# Automatically fix format issues and safe lints
pnpm run format
```

### Running Tests

We use **Vitest** for unit and component testing (organized under the top-level `tests/` directory: `tests/main/`, `tests/renderer/`, `tests/unit/`, and `tests/e2e/`).

Shared test helpers live in `src/test/`: `fake-api.ts` exposes `installFakeApi()`, a fully-stubbed `LunaAPI` that registers its own cleanup — use it rather than stubbing the `window.api` global. `fake-xterm.ts` and `setup.ts` cover the terminal and jsdom polyfills.

Coverage thresholds in `vitest.config.ts` are a hard gate: a change that drops coverage below the floor fails the build.

```bash
# Run tests once
pnpm run test

# Run tests in watch mode (interactive)
pnpm run test:watch

# Run tests with HTML coverage reports
pnpm run test:coverage

# Run Playwright end-to-end tests against the built application
pnpm run test:e2e
```

---

## 💻 Platform-Specific Installation Notes

### macOS

Since pre-built release binaries may not be notarized with an Apple Developer certificate, macOS Gatekeeper may block the app or display a warning saying **`"Luna" is damaged and can't be opened`** (*`"Luna" è danneggiato e non può essere aperto`*).

> [!IMPORTANT]
> **Automatic updates do not work on macOS for unsigned builds.** Squirrel.Mac validates an
> application's code signature before swapping in a downloaded update, and an unsigned app has
> none — so Luna can detect and download an update but cannot apply it. Update by downloading the
> new release manually. Auto-update on Windows and Linux is unaffected.

To resolve this and allow Luna to open:

1. **Remove Quarantine Attribute** (Recommended):
   Open Terminal and run:
   ```bash
   xattr -cr /Applications/Luna.app
   ```
   *(If the app is in your Downloads folder, use `xattr -cr ~/Downloads/Luna.app` instead).*

2. **Alternative (First Launch via Finder)**:
   - Locate `Luna.app` in `Finder`.
   - Right-click (or Control-click) the application icon and choose **Open**.
   - Click **Open** in the confirmation dialog.

### Windows
If Windows SmartScreen blocks execution of unsigned binaries, click **More info** and then choose **Run anyway**.

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📜 Changelog

Detailed release history and version changes can be found in [CHANGELOG.md](CHANGELOG.md).

## 🔐 Security

If you discover a security vulnerability, please see our [Security Policy](SECURITY.md).

## 📝 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

**Author**: [Salvatore Corvaglia](https://github.com/salvatorecorvaglia)