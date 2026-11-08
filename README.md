# Hub

A personal daily workflow hub: Today board, tickets, tasks, learning items, questions, routines and daily notes. Everything is stored as plain markdown files in a folder (the "vault"), so your data stays readable, portable and easy to sync or back up.

Built with [Tauri 2](https://tauri.app), React 19, TypeScript, Vite and Zustand.

## Features

- Three-column Today board with one-way triage (todo / later / dated)
- Tickets with markdown notes and subtasks
- Tasks, learn items and questions with triage and due dates
- Routines: daily or specific days of the week
- Daily view
- Markdown-file vault with live reload when files change on disk
- Themes (default: night)

## Where your data lives

By default the vault is `~/Documents/hub-vault` (your user's Documents folder). You can change it from inside the app. The app only reads and writes inside that folder. App settings (the chosen vault path) are stored in the OS app config directory.

## Install

The easiest way is to download an installer from the [Releases page](https://github.com/jonnochoo/hub/releases). To build it yourself, or run it in development mode, use the steps below with the prerequisites for your OS.

### Prerequisites (all platforms)

- [Node.js](https://nodejs.org) 20 or newer
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`)
- [Rust](https://www.rust-lang.org/tools/install) (stable, installed via `rustup`)
- Git

### Windows

1. Install **Microsoft C++ Build Tools**: from <https://visualstudio.microsoft.com/visual-cpp-build-tools/>, install the *Desktop development with C++* workload.
2. **WebView2** is required. It ships with Windows 10 (recent) and Windows 11, so you most likely already have it. Otherwise get it from <https://developer.microsoft.com/microsoft-edge/webview2/>.
3. Install Rust with `rustup` (<https://rustup.rs>) and choose the default `x86_64-pc-windows-msvc` toolchain.
4. Install Node.js and pnpm, e.g. with winget:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   npm install -g pnpm
   ```

5. Clone and build:

   ```powershell
   git clone <repo-url> hub
   cd hub
   pnpm install
   pnpm tauri build
   ```

6. The installers are written to `src-tauri\target\release\bundle\`:
   - `msi\Hub_0.1.0_x64_en-US.msi`
   - `nsis\Hub_0.1.0_x64-setup.exe`

   Run either one to install Hub. The bare executable is also at `src-tauri\target\release\hub.exe`.

### macOS

1. Install the Xcode Command Line Tools:

   ```bash
   xcode-select --install
   ```

2. Install Rust, Node.js and pnpm (with [Homebrew](https://brew.sh)):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   brew install node pnpm
   ```

   Restart your terminal afterwards so `cargo` is on your `PATH`.

3. Clone and build:

   ```bash
   git clone <repo-url> hub
   cd hub
   pnpm install
   pnpm tauri build
   ```

4. The app is written to `src-tauri/target/release/bundle/`:
   - `macos/Hub.app`
   - `dmg/Hub_0.1.0_<arch>.dmg`

   Open the `.dmg` and drag Hub into **Applications**.

   Because the app is not code-signed or notarized, macOS Gatekeeper may block the first launch. Right-click **Hub.app**, choose **Open**, then confirm. If it says the app is damaged, run `xattr -cr /Applications/Hub.app`.

### Linux (bonus)

Install the Tauri system dependencies for your distro (see <https://tauri.app/start/prerequisites/#linux>), then follow the same `pnpm install` and `pnpm tauri build` steps.

## Development

```bash
pnpm install
pnpm app        # run the desktop app with hot reload (tauri dev)
pnpm dev        # UI only, in the browser at http://localhost:1420
pnpm build      # type-check and build the frontend into dist/
```

`pnpm dev` runs without Tauri and uses a demo vault kept in the browser's `localStorage`, which is handy for UI work. Use `pnpm app` for real file access.

The first Rust build takes several minutes; later builds are incremental.

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on every PR and push to `main`: type-check and UI build, then `clippy` and a compile on Windows, macOS and Linux.
- **Releases** follow [semver](https://semver.org). Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`, which builds installers for Windows (x64), macOS (Apple Silicon and Intel) and Linux, and attaches them to a **draft** GitHub Release for you to review and publish. Tags with a suffix (e.g. `v1.0.0-beta.1`) are marked as pre-releases.

To cut a release from a clean working tree:

```bash
pnpm release patch      # or minor, major, or an explicit version like 1.2.0
git push --follow-tags
```

`pnpm release` bumps the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (plus `Cargo.lock`), commits and tags. The release workflow fails early if the tag doesn't match those files.

## Project layout

```
src/              React frontend
  views/          Today, Tickets, List and Daily views
  components/     Shared UI and modals
  lib/            Markdown parsing, data model, dates, vault access
  store.ts        Zustand state
src-tauri/        Rust backend (vault file access, file watcher) and Tauri config
```

## Troubleshooting

- **`link.exe not found` (Windows):** the C++ Build Tools workload is missing. Install it and reopen your terminal.
- **`cargo: command not found`:** restart your terminal after installing Rust.
- **Blank window on Windows:** install or repair WebView2.
- **Port 1420 in use:** stop whatever else is using it; the dev server port is fixed in `src-tauri/tauri.conf.json` and `vite.config.ts`.
