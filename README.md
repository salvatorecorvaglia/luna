# Lunar 🌙

> **A modern SSH terminal and intuitive SFTP file manager built for modern developers.**

Lunar is a high-performance, cross-platform desktop application designed to streamline your remote server workflows. Combining a powerful terminal with an intuitive dual-pane SFTP browser, Lunar offers a seamless bridge between your local environment and remote infrastructure.

---

## ✨ Key Features

### 💻 Advanced SSH Terminal

- **High Performance**: Powered by **xterm.js** with **WebGL rendering** for buttery-smooth scrolling and zero-lag input.
- **Multi-Session Management**: Organize your work with tabs and multi-pane splits (horizontal/vertical).
- **Theming**: Built-in professional themes including Dracula, Nord, Tokyo Night, Gruvbox, Monokai, and more.
- **Resilient**: Automatic reconnection with exponential backoff and configurable retry limits.

### 📁 Integrated SFTP Browser

- **Dual-Pane Workflow**: Effortlessly transfer files between local and remote systems.
- **Drag & Drop**: Seamlessly move files into the cloud or down to your machine.
- **Queue Management**: Concurrent transfer engine with real-time progress monitoring.
- **Secure**: Integrated preview for configuration files without leaving the app.

### 🛠️ Developer-First Tools

- **Command Palette**: Access every action instantly with `Cmd+K` (macOS) or `Ctrl+K` (Linux/Windows).
- **Connection Manager**: Securely store connections with password or SSH key auth. Organize via folders and color-coded tags.
- **Auto-Update**: Stay current with integrated GitHub-based updates, featuring real-time download progress and interactive toast notifications.

### 🔒 Security

- **Credential Protection**: Passwords and passphrases are encrypted with a local AES-256-GCM key — never stored in plain text.
- **Host Key Verification**: Trust-on-first-use (TOFU) with an explicit dialog for new hosts and a clear warning when host keys change, protecting against man-in-the-middle attacks.
- **Sandboxed Renderer**: The renderer process communicates with the main process exclusively through a typed IPC bridge; no direct filesystem or network access.
- **Input Validation**: All IPC arguments are validated — path traversal guards, startup command sanitization, settings key whitelisting, and bounded integer checks.

---

## 🚀 Getting Started

### Download

You can find the latest binaries for **macOS, Windows, and Linux** in the [Releases](https://github.com/salvatorecorvaglia/lunar/releases) section.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/salvatorecorvaglia/lunar.git
cd lunar

# Install dependencies
npm install
```

### Development

```bash
# Start the application with HMR
npm run dev
```

---

## 🧪 Quality

### Testing & Linting

```bash
npm test               # Execute Vitest suite
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
npm run typecheck      # Run TypeScript compiler checks
npm run lint           # Static analysis with ESLint
npm run format         # Format code with Prettier
```

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started.

## 🔐 Security

If you discover a security vulnerability, please see our [Security Policy](SECURITY.md) for responsible disclosure instructions.

## 📝 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

## 👤 Author

**Salvatore Corvaglia**

- GitHub: [@salvatorecorvaglia](https://github.com/salvatorecorvaglia)
