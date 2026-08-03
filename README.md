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
*   **Custom Themes:** Dynamically maps terminal color palettes directly onto the React application UI for unified styling.

### 🔌 SSH Port Forwarding & Tunnel Manager
*   **Full Tunneling Support:** Configure and manage Local, Remote, and Dynamic (SOCKS5 proxy) SSH tunnels.
*   **Live Status Monitoring:** Monitor active tunnels, port bindings, and forwarding status directly from the interactive Status Bar.

### 📁 SFTP File Manager & Folder Sync
*   **Folder Synchronization:** Perform directional or bidirectional directory synchronization between local and remote paths with conflict detection.
*   **Visual File Operations:** Drag-and-drop file transfers, directory creation, deletion, and renaming over remote SSH channels.
*   **Enhanced Inline File Editor:** Open, view, search, word-wrap, live-tail, and edit local or remote files (code, config scripts, logs) directly inside `FilePreview`.
*   **Enhanced Accessibility:** Fully optimized keyboard navigation (e.g., Space to toggle multi-row selection) and standard-compliant ARIA attributes.
*   **Safety Guards:** Protective recursion depth limits and warning thresholds to prevent accidental bulk deletions.

### 🪣 S3 Object Storage Browser
*   **Multi-Provider Support:** Seamlessly connect to AWS S3 and any S3-compatible APIs (MinIO, Cloudflare R2, Backblaze B2, etc.).
*   **Pagination & Safety Limits:** Intelligently paginates massive buckets, offering user alerts to prevent application hangs or memory limits.
*   **Presigned URLs:** Generate temporary access URLs for object sharing with customizable expiration times.

### 🔒 Enterprise-Grade Security & Credential Tools
*   **Built-in Password Manager:** Generate strong passwords with configurable complexity and securely manage stored credentials.
*   **OS-Protected Credentials:** Integrates with system keychains (Keychain Services on macOS, Credential Manager on Windows, Gnome Keyring/libsecret on Linux) to prevent credential leakage.
*   **Tamper Protection:** Actively audits and alerts the operator of corrupted or unauthorized credential modifications on disk.
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

Compile and package the application for your current operating system:
```bash
pnpm run build
```
Production installers are outputted into the `dist/` directory.

### Linting & Formatting

We use **Biome** for fast formatting, linting, and quality checks:
```bash
# Check code style and run lint checks
pnpm run lint

# Automatically fix format issues and safe lints
pnpm run format
```

### Running Tests

We use **Vitest** for unit and component testing:
```bash
# Run tests once
pnpm run test

# Run tests in watch mode (interactive)
pnpm run test:watch

# Run tests with HTML coverage reports
pnpm run test:coverage
```

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