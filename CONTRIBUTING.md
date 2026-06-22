# Contributing to Lunar 🌙

Thank you for your interest in contributing to **Lunar**! Lunar is a modern SSH terminal, local terminal, SFTP file manager, and S3-compatible object storage browser.

We welcome all kinds of contributions, whether it's reporting bugs, suggesting new features, improving documentation, or writing code.

---

## 📋 Table of Contents

- [Getting Started](#-getting-started)
- [Development Guidelines](#-development-guidelines)
  - [Folder Structure](#folder-structure)
  - [Scripts](#scripts)
- [Code Quality & Standards](#-code-quality--standards)
  - [Linting & Formatting](#linting--formatting)
  - [Type-Checking](#type-checking)
  - [Testing](#testing)
- [Submitting a Pull Request](#-submitting-a-pull-request)
- [Security Vulnerabilities](#-security-vulnerabilities)

---

## 🚀 Getting Started

### Prerequisites

To set up the development environment, make sure you have the following installed:
- **Node.js** (v22 is recommended, matching the CI environment)
- **npm** (comes packaged with Node.js)

### Setting Up the Project

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/lunar.git
   cd lunar
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
   *Note: On post-install, this runs `electron-builder install-app-deps` to set up native node dependencies like `better-sqlite3` and `node-pty`.*

---

## 💻 Development Guidelines

### Folder Structure

The application follows the standard `electron-vite` project layout under the `src` directory:

```
src/
├── main/       # Electron main process (IPC handlers, SSH/PTY logic, database setup)
├── preload/    # Electron preload scripts (securely exposing main process APIs to renderer)
├── renderer/   # React frontend source files (pages, components, styles, state management)
│   └── src/    # Main React source directory
├── shared/     # Shared TS types, constants, and utilities used by main & renderer
└── test/       # Test setup files and configuration
```

### Scripts

Use the following npm scripts during development:

- **Run in development mode**:
  ```bash
  npm run dev
  ```
  Runs the Electron app with hot-reloading and development logs.
- **Build for production**:
  ```bash
  npm run build
  ```
  Compiles the TypeScript/React code and bundles the Electron app for production.
- **Preview build**:
  ```bash
  npm run preview
  ```

---

## 🛠 Code Quality & Standards

To keep the codebase maintainable and clean, we enforce linting, formatting, type-checking, and tests.

### Linting & Formatting

We use **Biome** for unified, high-performance linting, formatting, and import sorting.

- **Check lint & format issues**:
  ```bash
  npm run lint
  ```
- **Automatically format and fix code issues**:
  ```bash
  npm run format
  ```

### Type-Checking

The project uses TypeScript across the main (Node) and renderer (Web) processes. Always verify type correctness before pushing:

- **Type-check everything**:
  ```bash
  npm run typecheck
  ```
- **Type-check Node (main/preload) process**:
  ```bash
  npm run typecheck:node
  ```
- **Type-check Web (renderer) process**:
  ```bash
  npm run typecheck:web
  ```

### Testing

We use **Vitest** for running unit and integration tests.

- **Run tests once**:
  ```bash
  npm run test
  ```
- **Run tests in watch mode**:
  ```bash
  npm run test:watch
  ```
- **Check test coverage**:
  ```bash
  npm run test:coverage
  ```
  *Note: Please make sure coverage thresholds (lines, functions, branches, statements) are maintained or improved when adding new tests.*

---

## 📥 Submitting a Pull Request

1. **Create a branch** for your work from `develop` or `main` (usually `feature/feature-name` or `bugfix/bug-name`).
2. **Write clean code** and adhere to the project's formatting and quality standards.
3. **Write/update tests** to cover your changes where applicable.
4. **Run all checks** locally before pushing:
   ```bash
   npm run format
   ```
   ```bash
   npm run lint
   ```
   ```bash
   npm run typecheck
   ```
   ```bash
   npm run test
   ```
5. **Commit your changes** with descriptive commit messages.
6. **Submit a Pull Request** (PR) to the upstream repository.
7. Fill out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE/PULL_REQUEST_TEMPLATE.md) completely, referencing any related issue (e.g. `Fixes #123`).

---

Happy coding! 🌙
