# Contributing to Luna 🌙

Thank you for your interest in contributing to **Luna**! We welcome contributions, bug reports, feature requests, and security improvements from the community.

---

## 🛠️ Local Development Setup

To contribute code, you will need to set up a local development environment.

### Prerequisites

*   **Node.js:** Ensure you have Node.js version `22.x` or higher installed.
*   **pnpm:** We use `pnpm` (version `11.x`) to manage our workspace dependencies. Do not use `npm` or `yarn`.
*   **Native Modules Build Dependencies:** Luna uses native modules (such as `node-pty` and `better-sqlite3`). You may need basic build tools installed on your operating system (e.g., Xcode Command Line Tools on macOS, Build Tools on Windows, or `build-essential` on Linux).

### Setting Up the Repository

1.  **Fork and Clone:** Fork Luna to your own GitHub account, then clone it locally:
    ```bash
    git clone https://github.com/your-username/luna.git
    cd luna
    ```

2.  **Install Dependencies:** Run the following command to download and install all workspace packages and prepare native binaries:
    ```bash
    pnpm install
    ```

3.  **Run Development Server:** Run the dev task, which boots up Vite and launches Electron with live hot-reloading for both the main and renderer processes:
    ```bash
    pnpm run dev
    ```

---

## 📐 Development Guidelines

To keep Luna's codebase clean and maintainable, please follow these guidelines when writing code:

### Tech Stack Standards
*   **Frontend UI:** We use **React 19** and **Tailwind CSS v4** (using `@tailwindcss/vite` configuration). Ensure your styles leverage utility classes and follow the design guidelines.
*   **State Management:** Global UI state and session properties are managed with **Zustand**. Keep state structures simple and slice-based.
*   **Data Fetching:** For remote state, use **TanStack Query** (React Query) to leverage clean caching and status state.
*   **Database & Persistence:** SQLite database migrations are located under `src/main/services/db/migrations/`. When introducing schema updates (such as new tables or columns), add a new versioned migration file and register it in `src/main/services/db/migrations/index.ts`.
*   **Security:** Avoid writing credentials (like private keys or passwords) directly to disk or settings database. Use standard platform credential storage interfaces provided under `window.api.credentials` to protect them.

### Code Style & Formatting

We use **Biome** to format and lint the repository.

Before submitting a Pull Request, verify that your code adheres to the style rules:

```bash
# Run Biome code quality checks
pnpm run lint

# Auto-format and resolve safe lint issues
pnpm run format
```

Additionally, make sure there are no TypeScript compiler errors:
```bash
# Run typechecking across both node and web processes
pnpm run typecheck
```

---

## 🧪 Testing Guidelines

Any new features, components, or service refactors must be accompanied by comprehensive tests. We use **Vitest** for unit and component verification.

*   Tests for main process utilities are located in `src/test/` or next to their respective service files.
*   Tests for frontend React components/hooks are located next to the component they test (e.g., `Foo.test.tsx`).
*   Ensure that tests clean up after themselves (e.g., mock cleaning, temporary file deletion).

### Test Commands

```bash
# Run the test suite once
pnpm run test

# Run tests in watch mode during development
pnpm run test:watch

# Check test coverage report
pnpm run test:coverage

# Run Playwright end-to-end tests against the built Electron app
pnpm run test:e2e
```

---

## 💾 Git & Commit Style

We encourage the use of **Conventional Commits** to keep our changelog and release workflows automated:

Format your commit messages as:
```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

### Allowed Types:
*   `feat`: A new feature
*   `fix`: A bug fix
*   `docs`: Documentation changes
*   `style`: Changes that do not affect the meaning of the code (formatting, white-space, etc.)
*   `refactor`: A code change that neither fixes a bug nor adds a feature
*   `test`: Adding missing tests or correcting existing tests
*   `chore`: Changes to the build process or auxiliary tools/libraries

### Example:
`feat(terminal): add vertical split pane layout support`

---

## 🚀 Pull Request Checklist

When you are ready to submit a Pull Request, please ensure the following:

1.  Your branch is up-to-date with `main`.
2.  All dependencies are correctly managed via `pnpm`.
3.  All code checks pass cleanly (`pnpm run lint` and `pnpm run typecheck`).
4.  All existing and new tests pass successfully (`pnpm run test`).
5.  Your commit messages follow the conventional style.

Once submitted, the GitHub Actions CI pipeline will run build checks on macOS, Windows, and Linux to verify the build output.

---

Happy coding! 🌙