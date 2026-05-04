# Agent Major Operating Rules

## Dependency install policy

Do not run `pnpm install`, delete `node_modules`, or rebuild the dependency store during normal implementation, review, test, build, or Git sync work.

Why this exists:

- Windows can keep native binaries such as `@next/swc-win32-x64-msvc` and `sharp` locked by Node, Next, Vitest, editors, or prior agent processes.
- Removing `node_modules` while files are locked can leave a partial install and cause `EPERM`, `EIO`, or access denied errors.
- A failed install can make unrelated Phase work look broken and wastes verification time.
- This repository already has `pnpm-lock.yaml`, `.pnpm-store`, and a working `node_modules` state unless the user explicitly says otherwise.

Allowed commands by default:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm materials:validate
pnpm phase17:match
pnpm phase17:replay
pnpm phase17:export
```

Only run dependency installation when all of the following are true:

```text
1. The task explicitly requires adding, removing, or upgrading dependencies.
2. The user explicitly approves the install step in the current conversation.
3. All Node/Next/Vitest/dev-server processes that may lock native binaries have been stopped.
4. The expected package-manager command and rollback plan are stated before running it.
```

If dependency state looks broken, stop and report the exact failure. Prefer asking the user to run the install manually in their own PowerShell session rather than repeatedly attempting installs from an agent environment.
