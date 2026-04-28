# Contributing to Lunar 🌑

Thank you for your interest in contributing to Lunar! We're excited to see what you'll bring to this modern SSH terminal and SFTP file manager.

## 🌈 Ways to Contribute

### Bug Reports 🐛

If you encounter a bug, please check the [existing issues](https://github.com/salvatorecorvaglia/lunar/issues) to see if it's already been reported. If not, open a new issue and include:

- A clear, descriptive title.
- Steps to reproduce the bug.
- Your OS version and any relevant environment details.
- Logs from `electron-log` if available.

### Feature Requests 💡

Have an idea for a new feature?

- Check the [issues](https://github.com/salvatorecorvaglia/lunar/issues) for similar proposals.
- Open a new issue with the "enhancement" label and describe your vision.

### Pull Requests 🚀

1. **Fork** the repository and create your feature branch from `main`.
2. **Install dependencies**: `npm install`.
3. **Develop**: Use `npm run dev` to start the application with hot-module replacement.
4. **Quality Checks**:
   - Run tests: `npm test`
   - Check types: `npm run typecheck`
   - Lint your code: `npm run lint`
   - Format your code: `npm run format`
5. **Commit**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat(terminal): add support for custom font ligatures` or `fix(sftp): resolve drag-and-drop ghosting issue`).
6. **Submit**: Push to your fork and open a Pull Request to the `main` branch.

## 🛠️ Local Development

### Prerequisites

- Node.js ≥ 18.0.0
- npm

### Setup

```bash
git clone https://github.com/salvatorecorvaglia/lunar.git
cd lunar
npm install
```

### Useful Scripts

- `npm run dev`: Start Electron with HMR for the renderer.
- `npm run build`: Build the application for production (no packaging).
- `npm run dist`: Package the application for the current platform.
- `npm run test`: Run all tests using Vitest.
- `npm run typecheck`: Run TypeScript type checking for both main and renderer processes.
- `npm run lint`: Run ESLint.
- `npm run format`: Format code with Prettier.

## 🏛️ Project Architecture

Lunar is an Electron application built with `electron-vite`:

- **Main Process**: Located in `src/main/`, handles system-level operations, SSH/SFTP logic, and database management.
- **Renderer Process**: Located in `src/renderer/`, a React application that provides the user interface.
- **Preload Scripts**: Located in `src/preload/`, exposes secure APIs from the main process to the renderer.

## 📜 Code of Conduct

Please maintain a respectful and professional tone in all communications.

---

Happy coding! 🌑
