# <img src="resources/lunar.png" align="center" width="48" height="48" /> Lunar

**A modern SSH terminal, local terminal, SFTP file manager, and S3-compatible object storage browser — all in one.**

Lunar is a high-performance, cross-platform desktop application designed to streamline your remote and local workflows. Browse SSH/SFTP servers and S3-compatible object stores side-by-side with your local filesystem, with a powerful terminal (SSH or local shell) just a tab away.

---

## ✨ Key Features

### 💻 Advanced Terminal (SSH & Local)

- **Native Local Shell**: Access your local machine's shell (bash, zsh, powershell) directly within Lunar using `node-pty`.
- **High Performance**: Powered by **xterm.js** with **WebGL rendering** for buttery-smooth scrolling and zero-lag input.
- **Multi-Session Management**: Organize your work with tabs and multi-pane splits (horizontal/vertical).
- **Professional Theming**: Built-in themes including Dracula, Nord, Tokyo Night, Gruvbox, Monokai, and One Dark.
- **Unicode 11 Support**: Robust character rendering for modern CLI tools and emojis.
- **Terminal Search**: Integrated search with match counts and highlight support.
- **Jump Host Support**: Securely connect to remote servers through intermediate gateway hosts (SSH tunneling).
- **Resilient Connectivity**: Automatic reconnection with exponential backoff and configurable retry limits for SSH.

### 📁 Integrated SFTP Browser

- **Dual-Pane Workflow**: Effortlessly transfer files between local and remote systems.
- **Drag & Drop**: Seamlessly move files into the cloud or down to your machine.
- **Queue Management**: Concurrent transfer engine with real-time progress monitoring, cancel confirmation, and abort support.
- **Upload Verification**: Automatic verification of file completion for SFTP transfers.
- **In-App Preview**: Securely preview configuration files without leaving the application.
- **Session Recovery**: Persistent session state across application restarts.

### ☁️ S3-Compatible Object Storage

- **First-Class Provider**: AWS S3 and any S3-compatible service (MinIO, Cloudflare R2, Backblaze B2, Wasabi) sit alongside SFTP.
- **Multipart Uploads**: Large files stream through `@aws-sdk/lib-storage` with live progress and abort support.
- **Bucket Management**: List, create, and delete buckets; pin a default bucket or browse the whole account.
- **Optimized Storage**: Operation timeouts, query caching, and listing truncation alerts for large directories.

### 🛠️ Developer-First Tools

- **Command Palette**: Access every action instantly with `Cmd+K` (macOS) or `Ctrl+K` (Linux/Windows).
- **Connection Manager**: Securely store SSH/SFTP and S3 connections. Organize via folders, tags, and reorderable sections with advanced SSH tunnel (jump host) support.
- **Customizable Sidebar**: Reorderable connection sections with persistent drag-and-drop state.
- **Auto-Update**: Stay current with integrated GitHub-based updates and interactive notifications.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22 or higher)
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

## 🧪 Quality & Testing

Lunar maintains a high bar for code quality with comprehensive testing and automated formatting:

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

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 🔐 Security

If you discover a security vulnerability, please see our [Security Policy](SECURITY.md).

## 📝 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

---

**Author**: [Salvatore Corvaglia](https://github.com/salvatorecorvaglia)
