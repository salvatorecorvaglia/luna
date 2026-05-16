# Contributing to Lunar 🌑

Thank you for your interest in contributing to Lunar! We're excited to see what you'll bring to this modern SSH terminal, SFTP file manager, and S3-compatible object storage browser.

## 🌈 Ways to Contribute

### Bug Reports 🐛

If you encounter a bug, please check the [existing issues](https://github.com/salvatorecorvaglia/lunar/issues) to see if it's already been reported. If not, open a new issue and include:

- A clear, descriptive title.
- Steps to reproduce the bug.
- Your OS version and any relevant environment details.
- Logs from `electron-log` if available (open from **Settings → Open Log File**).

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
   - Format your code: `npm run format`
   - Lint your code: `npm run lint`
5. **Commit**: Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat(terminal): add support for custom font ligatures`, `fix(sftp): resolve drag-and-drop ghosting issue`, or `feat(s3): paginate prefix deletion`).
6. **Submit**: Push to your fork and open a Pull Request to the `main` branch.

## 🛠️ Local Development

### Prerequisites

- Node.js ≥ 22.0.0
- npm

### Setup

```bash
git clone https://github.com/salvatorecorvaglia/lunar.git
cd lunar
npm install
```

### Useful Scripts

| Script                  | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `npm run dev`           | Start Electron with HMR for the renderer            |
| `npm run build`         | Build the application for production (no packaging) |
| `npm run preview`       | Preview the production build locally                |
| `npm test`              | Run all tests using Vitest                          |
| `npm run test:watch`    | Run tests in watch mode                             |
| `npm run test:coverage` | Run tests with coverage report                      |
| `npm run typecheck`     | Run TypeScript type checking (main + renderer)      |
| `npm run lint`          | Run ESLint                                          |
| `npm run format`        | Format code with Prettier                           |

## 🏛️ Project Architecture

Lunar is an Electron application built with `electron-vite`:

- **Main Process** (`src/main/`): system-level operations, SSH/SFTP logic, S3 client lifecycle, database management, and migration framework.
- **Renderer Process** (`src/renderer/`): React application providing the user interface.
- **Preload Scripts** (`src/preload/`): exposes the typed `window.api` bridge to the renderer.
- **Shared Modules** (`src/shared/`): types and constants shared between processes.

### Storage Providers

Remote backends live behind a single `StorageProvider` interface (`src/main/services/storage/types.ts`). Each session id is registered with the `storageRegistry`, and the transfer queue + `storage:*` IPC handlers dispatch through that registry — so the SFTP and S3 code paths share the same queue, progress events, and renderer UI.

- **SFTP** (`src/main/services/sftp-manager.ts`) — wrapped by `sftpStorageProvider` and registered on `ssh:connect`.
- **S3** (`src/main/services/s3/s3-provider.ts`) — uses `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`. Registered on `s3:connect`. Path convention: `/` lists buckets, `/bucket/key/...` for objects/prefixes.

When adding a new provider, implement `StorageProvider`, add a `*-connect` IPC handler that calls `storageRegistry.register`, and surface it in `ConnectionForm` via the provider toggle. The renderer stays untouched.

#### Tests around the abstraction

- `src/main/services/storage/__tests__/registry.test.ts` — round-trip register/get, `require()` failure mode, kind discrimination across sessions.
- `src/main/services/__tests__/transfer-queue.test.ts` — mocks `storage/registry` with a stub provider; covers dedupe, saturation, cancel, abort drain, re-entrancy, `cancelAll`, and live concurrency adjustment.
- `src/main/services/s3/__tests__/s3-paths.test.ts` — round-trips for the `/`, `/bucket`, `/bucket/key/...` path convention.
- `src/main/services/__tests__/database.test.ts` — asserts migration `008_provider_columns` rebuilds the table and preserves existing SFTP rows.

### Key Principles

- **Process Isolation**: All sensitive operations (SSH, SFTP, S3, credentials, database) run in the main process. The renderer communicates exclusively through typed IPC via the preload bridge.
- **Credential Security**: SSH passwords/passphrases and S3 access keys are encrypted with a local AES-256-GCM key, never stored in plain text. S3 secrets are persisted as a JSON blob (`{accessKeyId, secretAccessKey, sessionToken?}`) inside the same encrypted column.
- **Host Key Verification**: Trust-on-first-use (TOFU) with a secure host key verification store — new host keys trigger a dialog for explicit user confirmation; changed keys show a clear warning to prevent MITM attacks.
- **Input & Payload Validation**: Strict validation for all IPC arguments, including path traversal guards and payload size limits.

### Testing S3 Locally

The fastest way to exercise the S3 provider end-to-end is with a local MinIO container:

```bash
docker run -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"
```

In Lunar, create an S3 connection with:

- Endpoint: `http://localhost:9000`
- Region: `us-east-1`
- Force path-style URLs: **on** (required for MinIO)
- Access Key / Secret: the MinIO defaults (`minioadmin` / `minioadmin`)
- Default bucket: optional

## 📜 Code of Conduct

Please maintain a respectful and professional tone in all communications.

---

Happy coding! 🌑
