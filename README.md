# Lunar

**A modern SSH terminal, local terminal, SFTP file manager, and S3-compatible object storage browser**

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

## ⚙️ Configuration Settings

Lunar is highly configurable through the application settings. Below are the available keys, their types, default values, and safe boundaries:

| Setting Key                | Type      | Default Value                                  | Description / Range                                                                    |
| -------------------------- | --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `terminal.fontFamily`      | `string`  | `"JetBrains Mono, Menlo, Consolas, monospace"` | The font family used inside terminal windows.                                          |
| `terminal.fontSize`        | `number`  | `14`                                           | Font size in pixels. Range: `8` to `72` px.                                            |
| `terminal.theme`           | `string`  | `"dracula"`                                    | Active terminal color palette theme.                                                   |
| `terminal.scrollback`      | `number`  | `10000`                                        | Lines of scrollback buffer history. Range: `1,000` to `1,000,000`.                     |
| `transfer.concurrency`     | `number`  | `3`                                            | Max concurrent files transferred in parallel. Range: `1` to `10`.                      |
| `ssh.autoReconnect`        | `boolean` | `true`                                         | Enable automatic reconnection upon sudden disconnects.                                 |
| `ssh.keepAliveInterval`    | `number`  | `10000`                                        | Interval in ms to send SSH keepalive packets. Range: `0` to `600,000` ms (0 disables). |
| `ssh.maxReconnectAttempts` | `number`  | `5`                                            | Maximum number of reconnect retries before bailing. Range: `0` to `100`.               |
| `ssh.readyTimeout`         | `number`  | `30000`                                        | Maximum time in ms to wait for the SSH handshake. Range: `1,000` to `600,000` ms.      |
| `ui.applyTerminalTheme`    | `boolean` | `true`                                         | Sync the overall application UI theme with the active terminal theme.                  |

---

## 🛡️ Resource & Safety Limits

To guarantee stability, protect against remote server abuse/DoS, and prevent memory exhaustion, Lunar enforces the following resource boundaries:

- **Storage Rate Limiting**: All metadata storage operations (`list`, `stat`, `mkdir`, `delete`, `rename`, `readFile`) are throttled per active session using a token-bucket rate limiter.
  - _Capacity_: `30` tokens.
  - _Refill Rate_: `10` tokens per second.
  - _Memory Safety_: Maximum of `1024` tracked session buckets; least-recently-created buckets are evicted to prevent leaks.
  - _Clock Skew Guard_: Automatic reset logic if the system clock jumps backward.
- **File Previews**: Hard cap of `50 MB` (`MAX_PREVIEW_BYTES`). Lunar refuses to read/preview any files larger than this size to avoid rendering freezes.
- **SSH Connectivity**: Handshake timeout is capped at `60` seconds to avoid stranding connection pools.
- **Transfer Queue Boundaries**: Capped at `1,000` queued transfers. Active/in-flight transfers are capped at `10` max concurrency.
- **S3 Bucket Listing**: Capped at a maximum of `50,000` entries returned from a single S3 list operation to avoid Out-Of-Memory (OOM) situations on massive folders/buckets. Shows a warning banner if truncated.

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
