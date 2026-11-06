# PDF Reader

A small Windows desktop PDF reader. View PDFs, highlight text, and attach notes. Highlights and notes
are saved **inside the PDF** as standard annotations, so Edge, Acrobat and other readers show them too.

Built with Tauri 2 (Rust + WebView2), React, TypeScript, PDF.js and pdf-lib. See `PLAN.md` for the design.

## Using it

| | |
|---|---|
| Open a file | **Open**, `Ctrl+O`, drag a PDF onto the window, or right-click a PDF > *Open with* |
| Highlight | Select text, pick a colour. **+ Note** adds a comment at the same time |
| Sticky note | `N`, then click the page |
| Edit or delete | Click a highlight or note. `Delete` removes it, `Ctrl+Z` / `Ctrl+Y` undo and redo |
| List everything | **Annotations** button: jump to any highlight or note |
| Save | `Ctrl+S` (into the same file), `Ctrl+Shift+S` (a copy) |
| Find / zoom | `Ctrl+F`, `Ctrl+wheel`, `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| About | `F1` |

Password-protected PDFs can be read but not annotated yet.

## Developing

Needs Node 20+, the Rust stable toolchain, and the Visual Studio C++ Build Tools. WebView2 ships with Windows 11.

```
npm install
npm run tauri dev        # run the app with hot reload
npm test                 # unit tests (TypeScript)
cargo test               # unit tests (Rust), run inside src-tauri/
npm run lint
```

## Building the installer

```
npm run tauri build
```

Produces `src-tauri/target/release/bundle/nsis/PDF Reader_<version>_x64-setup.exe`.

- **Per-user install**: no administrator prompt; it installs under `%LOCALAPPDATA%`.
- **Open with**: the app is registered for `.pdf` files and listed under *Open with*. It does **not**
  become the default app: the generated installer would normally overwrite the `.pdf` class default,
  so `src-tauri/installer-hooks.nsh` undoes that and makes the uninstaller put things back exactly
  as they were. Choosing the default stays with the user (Windows Settings > Apps > Default apps).
- **Thumbnails**: Explorer shows the first page of a PDF as its icon (medium and larger icon views),
  like it does for images. Password-protected PDFs can't be previewed and keep the normal icon.
  This is a small native shell extension, `src-tauri/thumbnail` (it renders with the PDF engine built
  into Windows, so nothing extra ships). `src-tauri/build.rs` compiles it as part of the normal build and
  the installer registers it: for PDFs whose default app is this one, and for all PDFs when no other
  thumbnail handler exists. It never replaces another app's handler. `cargo test` inside
  `src-tauri/thumbnail` tests the renderer, including the password-protected and corrupt cases.
- **Not code-signed**: Windows SmartScreen will warn on first run until the installer is signed.
- **WebView2**: installed on demand if missing (Windows 11 already has it).

To release a new version, change `version` in `package.json`, `src-tauri/Cargo.toml` and
`src-tauri/tauri.conf.json` (a test checks they match).

## Regenerating assets

```
powershell -NoProfile -File scripts/make-icon.ps1 ; npx tauri icon app-icon.png   # app icon, all sizes
node scripts/make-fixtures.mjs                                                  # tests/fixtures/*.pdf
```

`INTEROP_OUT=<dir> npx vitest run tests/interop-export.test.ts` writes annotated sample files for
checking in other PDF readers.

## Troubleshooting the build

**`failed to bundle project: timeout: global`** while downloading NSIS. Tauri's built-in downloader
can time out even when the network is fine. Fetch the two files yourself, check them against the
SHA-1 values pinned inside Tauri, and put them where Tauri looks (`%LOCALAPPDATA%\tauri`):

| File | SHA-1 |
|---|---|
| `https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip` | `DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E` |
| `https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll` | `75197FEE3C6A814FE035788D1C34EAD39349B860` |

Extract the zip into `%LOCALAPPDATA%\tauri` and rename the `nsis-3.13` folder to `NSIS`; copy the dll to
`NSIS\Plugins\x86-unicode\additional\`. (The versions above are for Tauri CLI 2.12; a newer CLI may pin others.)

**Thumbnails don't appear after installing.** Open a folder in *Medium icons* (or larger) view and press
F5. If Explorer still shows the old icon it is using a cached one: run *Disk Cleanup* and tick
*Thumbnails*, or sign out and in.

**Installing a new version while Explorer has the thumbnail DLL loaded.** The installer ends Explorer's
thumbnail host process first (Windows restarts it on demand), so the file can be replaced.
