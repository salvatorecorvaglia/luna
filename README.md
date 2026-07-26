# Lunar 🌙

**Cross-platform remote & local workflow workstation**

**Lunar** is a high-performance, cross-platform desktop application designed to streamline your remote and local workflows. Browse SSH/SFTP servers and S3-compatible object stores side-by-side with your local filesystem, with a powerful terminal (SSH or local shell) just a tab away.

---

## ✨ Key Features

### 🖥️ High-Performance Terminals
*   **Hardware Acceleration:** Powered by [xterm.js](https://xtermjs.org/) using WebGL and Canvas renderers for low-latency rendering.
*   **Advanced Layouts:** Supports vertical and horizontal split panes, dynamic resizing, and layout preservation.
*   **Local & Remote Shells:** Launch local shells (`node-pty`) alongside long-lived remote SSH sessions.
*   **Session Recovery:** Long-lived session management in the main process preserves scrollback buffers, cursor states, and tab setups through renderer reloads or window refreshes (e.g., `Cmd+R`).
*   **Custom Themes:** Dynamically maps terminal color palettes directly onto the React application UI for unified styling.

### 📁 SFTP File Manager
*   **Visual File Operations:** Drag-and-drop file transfers, directory creation, deletion, and renaming over remote SSH channels.
*   **Inline File Editor:** Open, view, and edit local or remote files (like code files, config scripts, logs) directly inside the integrated `FilePreview` panel.
*   **Enhanced Accessibility:** Fully optimized keyboard navigation (e.g., Space to toggle multi-row selection) and standard-compliant ARIA attributes.
*   **Safety Guards:** Protective recursion depth limits and warning thresholds to prevent accidental bulk deletions.

### 🪣 S3 Object Storage Browser
*   **Multi-Provider Support:** Seamlessly connect to AWS S3 and any S3-compatible APIs (MinIO, Cloudflare R2, Backblaze B2, etc.).
*   **Pagination & Safety Limits:** Intelligently paginates massive buckets, offering user alerts to prevent application hangs or memory limits.
*   **Presigned URLs:** Generate temporary access URLs for object sharing with customizable expiration times.

### 🔒 Enterprise-Grade Security
*   **OS-Protected Credentials:** Integrates with system keychains (Keychain Services on macOS, Credential Manager on Windows, Gnome Keyring/libsecret on Linux) to prevent credential leakage.
*   **Tamper Protection:** Actively audits and alerts the operator of corrupted or unauthorized credential modifications on disk.
*   **Clear Visibility:** Alerts the user immediately via toast notifications if the workspace falls back to unencrypted plaintext or memory-only keys due to missing OS libraries.

### 📥 One-Click Importers
*   **SSH Config Parser:** Import connection configurations directly from your system SSH config file (`~/.ssh/config`).
*   **WinSCP Importer:** Auto-import WinSCP profiles, including parsing of registry exports (`.reg` files) and SSH jump host configurations.
*   **MobaXterm & PuTTY Importers:** Auto-import session profiles from MobaXterm (`.mxtsessions` / `.mxtpro`) and PuTTY registry exports (`.reg`).

---

## 🛠️ Technology Stack

Lunar is built on a modern JavaScript/TypeScript stack:
*   **Shell:** [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
*   **Frontend UI:** [React 18](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/) (using `@tailwindcss/vite`), [Zustand](https://github.com/pmndrs/zustand) for state management, [Framer Motion](https://www.framer.com/motion/) for micro-animations, [Sonner](https://github.com/emilkowalski/sonner) for toasts, and [Lucide Icons](https://lucide.dev/).
*   **Data Fetching:** [TanStack Query (React Query)](https://tanstack.com/query/latest)
*   **Formatting/Linting:** [Biome](https://biomejs.dev/)
*   **Testing:** [Vitest](https://vitest.dev/) with JSDOM

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
    git clone https://github.com/salvatorecorvaglia/lunar.git
    cd lunar
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

## 🔐 Security

If you discover a security vulnerability, please see our [Security Policy](SECURITY.md).

## 📝 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

**Author**: [Salvatore Corvaglia](https://github.com/salvatorecorvaglia)