# PDF Reader on macOS 26+ — Plan

## Context
PDF Reader is a Windows-only app today (Tauri 2 + Rust + React/PDF.js/pdf-lib; see `PLAN.md`). The goal is
to ship the same app for **macOS 26 (Tahoe) and later**, without:
- **SwiftUI or any Swift/Objective-C source**, and
- **Xcode** (the IDE, Xcode projects, or Xcode-only tools such as `notarytool` / Icon Composer).

Tauri is a good fit for these constraints. On macOS it uses the system **WKWebView**, so the whole UI
(React, PDF.js, pdf-lib, the annotation code) runs unchanged. The native layer is Rust, and the few macOS APIs
we need are reached from Rust through Tauri itself or the `objc2` crates. No Swift is needed anywhere.

## Decision needed: what counts as "Apple toolchain"
Rust has to link against the macOS SDK, and that SDK only comes from Apple: in **Xcode** or in the much
smaller **Command Line Tools (CLT)** package. Licensing and practicality give three options:

| Option | Local Apple tools | Verdict |
|---|---|---|
| **A. Build in CI on a GitHub-hosted macOS runner** | None on your side. The runner image ships Apple's SDK; we only call `cargo`/`npm` | **Recommended** |
| B. Build on a Mac with only the Command Line Tools (`xcode-select --install`) | CLT only (no Xcode IDE, no Swift) | Fine as a local fallback |
| C. Cross-compile from Windows/Linux (`cargo-zigbuild` / osxcross) | None, but needs the SDK copied out of Xcode | **Not recommended.** The SDK licence restricts it to Apple hardware, and linking WebKit this way is fragile |

**Signing and notarization need no Apple tools at all.** `rcodesign` (the `apple-codesign` Rust project) signs
with a Developer ID certificate, submits to Apple's notary service through an App Store Connect API key, and
staples the ticket. It runs on Windows or Linux. This replaces Tauri's built-in signing, which shells out to
Apple's `codesign`.

The rest of this plan assumes **A for builds** (with B for local debugging) and **`rcodesign` for signing**.

## What carries over unchanged
- **UI and core logic:** the frontend, PDF.js viewer, highlights, notes, sidebar, undo/redo and the annotation
  read/write in the worker (`src/**`). The 143 Vitest tests are platform-independent.
- **Saved files:** the PDF format work (`src/pdf/annotIO.ts`). Saved files are identical on both OSes.
- **Rust commands:** `read_file`, `write_file_atomic` (`fs::rename` replaces the target atomically on APFS too) and
  the opener/dialog plugins (pure Rust on desktop via `rfd`/`objc2`).
- **Security policy:** the CSP. It already allows `ipc:`, which is the IPC scheme WKWebView uses.
- **Thumbnails: nothing to build.** Finder already shows the first page of a PDF through Apple's own Quick Look
  thumbnailer, whatever the default app is. A password-protected PDF gets the generic or lock icon, which is the
  behaviour the Windows provider was written to match. The Windows DLL (`src-tauri/thumbnail`) simply stays
  Windows-only.

## What has to change
| Area | Windows today | macOS replacement |
|---|---|---|
| **Opening files** from Finder, *Open With* or a drag onto the Dock icon | path in `argv` (`get_launch_file`) plus `tauri-plugin-single-instance` | macOS delivers **Apple Events** instead: handle `tauri::RunEvent::Opened { urls }`. LaunchServices already keeps one instance, so the single-instance plugin becomes Windows-only. Opens that arrive before the UI is ready must be queued |
| **Menu bar** | none | A real menu (App, File, Edit, View, Window, Help) via Tauri's Rust menu API. **Required:** without an Edit menu, Cmd+C/V/X/A/Z do not work in text fields inside WKWebView |
| **Quit** | window close event → unsaved prompt | Cmd+Q raises `RunEvent::ExitRequested`. It must go through the same "Save changes?" prompt. On macOS closing the last window normally quits this kind of app, so pick one behaviour and make it consistent |
| **Shortcuts** | `Ctrl` (code accepts Ctrl *or* Meta) | Cmd only on macOS (so Control-click keeps its meaning). Find next becomes Cmd+G, About moves to the App menu, and F5/Ctrl+R guards turn into Cmd+R |
| **Unsaved indicator** | `•` in the title | Set the window's *document edited* state (the dot in the red close button) through `objc2-app-kit`. Keep the title as is |
| **Default author** | `%USERNAME%` | The user's full name (`NSFullUserName` via `objc2-foundation`), falling back to `$USER` |
| **About dialog** | parses `Edg/…` (WebView2) | Shows the WebKit version on macOS |
| **Fonts** | `Segoe UI` | `-apple-system, system-ui` first on macOS |
| **Atomic save** | rename over target | Same, plus copy the file mode and **extended attributes** (Finder tags, comments) from the old file to the temp file before renaming, or they are lost. Use the `xattr` crate |
| **Packaging** | NSIS installer, registry hooks | `.app` inside a `.dmg`. Tauri's `app` + `dmg` targets use the system `hdiutil`, which is not an Xcode tool |
| **File association** | Open with + hooks so we never become default | `CFBundleDocumentTypes` for `com.adobe.pdf` with **`LSHandlerRank = Alternate`**: listed in *Open With*, never claims to be the default. That is the same promise as on Windows, and no hooks are needed |
| **Thumbnails** | our COM DLL | Built into macOS (see above) |

## Phases

### Phase 1: Make the codebase platform-aware (Windows behaviour unchanged)
1. **Split config.** Move Windows-only bundle settings (NSIS, hooks, `resources` DLL, `webviewInstallMode`)
   from `tauri.conf.json` into `src-tauri/tauri.windows.conf.json`. Add `src-tauri/tauri.macos.conf.json` with:
   - `bundle.targets: ["app", "dmg"]`
   - `bundle.macOS.minimumSystemVersion: "26.0"`
   - `hardenedRuntime: true`
   - the PDF association with `rank: "Alternate"`
2. **Gate the thumbnail build.** In `src-tauri/build.rs`, only build the thumbnail DLL when
   `CARGO_CFG_TARGET_OS == "windows"`.
3. **Gate Windows-only Rust.** In `src-tauri/Cargo.toml`, make `tauri-plugin-single-instance` a Windows/Linux-only
   dependency. Put `cfg(target_os = …)` around the plugin registration and `get_launch_file`.
4. **Update packaging tests.** `tests/packaging.test.ts` must read the merged per-platform configs. Add checks that
   the macOS config has `minimumSystemVersion` ≥ 26, `rank: Alternate`, and no Windows resources.
5. **Verify Windows is unaffected:** the full Windows test suite, a release build, and the release smoke test.

### Phase 2: macOS runtime integration (Rust, no Swift)
1. **File opening.** Handle `RunEvent::Opened { urls }` in `src-tauri/src/lib.rs`: take the file URLs, convert
   them to paths and emit the existing `open-file` event. Opens that arrive before the webview is listening go into
   a queue drained by a `take_pending_opens` command, replacing `get_launch_file` on macOS.
2. **Menu.** Build it in `src-tauri/src/menu.rs`:
   - **App:** About, Settings… (Cmd+,), Quit.
   - **File:** Open… (Cmd+O), Open Recent, Save (Cmd+S), Save As… (Cmd+Shift+S), Close Window (Cmd+W).
   - **Edit:** the standard predefined items.
   - **View:** Zoom in/out/actual size, Find (Cmd+F), Find Next (Cmd+G), Annotations sidebar.
   - **Window**, and **Help**.

   Menu clicks emit events that the frontend's existing actions handle.
3. **Quit guard.** On `RunEvent::ExitRequested`, prevent the exit, ask the frontend to run `ensureCanLeave()`, and
   exit when it confirms. Reuse the Windows close-guard logic.
4. **Document-edited dot.** A small command calling `NSWindow.setDocumentEdited:` via `objc2-app-kit`, driven by the
   existing `dirty` flag. Optionally add `setRepresentedFilename:` for the title-bar proxy icon.
5. **Author and save details.** `get_username` returns the full name. `atomic_write` copies the mode and xattrs.
   Add Rust tests for both (`#[cfg(target_os = "macos")]`).

### Phase 3: Frontend adjustments for WebKit
1. **Platform detection.** One helper (`navigator.platform`/`userAgentData`, or a Rust `platform()` command) used by:
   - the shortcut handler (Cmd vs Ctrl),
   - the production key guards,
   - the About dialog,
   - the font stack.
2. **Hand shortcuts to the menu.** Let menu accelerators own Cmd+O/S/F/G/Z on macOS, so a shortcut doesn't fire
   twice (once from the menu, once from the keydown handler).
3. **WebKit-specific checks**, all expected to work on Safari 26 but needing confirmation:
   - module workers and PDF.js wasm;
   - `mix-blend-mode` over the canvas;
   - `color-mix()` and `:not(a, b *)`;
   - `Range.getClientRects()` on the text layer (highlight geometry);
   - selection behaviour when pressing on blank page areas (the Chromium-specific fix in `SelectionToolbar.tsx`);
   - Ctrl+wheel arrives as the trackpad pinch gesture on macOS (confirm zoom feels right).

### Phase 4: Packaging, signing, notarization
1. **Target.** macOS 26 is the last release that supports Intel Macs, so build a **universal** binary
   (`--target universal-apple-darwin`) for 26.x. Revisit Apple-silicon-only once the minimum moves past 26.
2. **App icon.** Make a macOS-specific `icon.icns` on Apple's icon grid: a full-bleed rounded-square body about 824 px
   in a 1024 px canvas. macOS 26 puts icons that don't follow the shape inside a grey rounded square.
   - Generate it with the existing `scripts/make-icon.ps1` approach plus `npx tauri icon` (`.icns` output).
   - Icon Composer `.icon` files need Xcode, so they are out.
3. **Entitlements and sandbox.** No App Sandbox (not App Store) and no special entitlements:
   - Hardened Runtime is on, as notarization requires.
   - WKWebView runs JIT and wasm in WebKit's own processes, so `allow-jit` should not be needed.
4. **Signing and notarization.** Use `rcodesign`, with:
   - a Developer ID Application certificate (`.p12`),
   - an App Store Connect API key (`.p8`),
   - both stored as CI secrets.

   Sign the `.app` (hardened runtime, timestamp), sign the `.dmg`, then run `rcodesign notary-submit --staple`.
   - **Needs** an Apple Developer Program membership (USD 99/year).
   - **Without it,** the app can only be ad-hoc signed. On macOS 15 and later, users must then go to
     *System Settings > Privacy & Security > Open Anyway* the first time. That is acceptable for testing, not for
     distribution.

### Phase 5: CI (GitHub Actions)
Add `.github/workflows/macos.yml` on a `macos-26` (or `macos-latest`) runner:
1. Install the Node and Rust targets `aarch64-apple-darwin` and `x86_64-apple-darwin`.
2. Run `npm ci`, `npm test`, `npm run lint`, and `cargo test` (app crate).
3. Run `npm run tauri build -- --target universal-apple-darwin`.
4. Upload the unsigned `.app`/`.dmg` as an artifact.

A separate job (Linux runner works) downloads the artifact and runs the `rcodesign` signing and notarization
with secrets. Keep the existing Windows build as a parallel job, so every change is checked on both OSes.

### Phase 6: Verification on a real Mac running macOS 26
CI proves the build. It cannot click through the UI: `tauri-driver` has no macOS (WKWebView) support, and the
WebView2 debug-port approach used for Windows testing doesn't exist on WebKit. So:
1. **Automated.** Unit tests (Vitest + Rust) run on the macOS runner. Add a Playwright **WebKit** smoke test of the
   frontend served by Vite with Tauri's IPC mocked (`@tauri-apps/api/mocks`). It covers rendering, find, highlight,
   notes and the sidebar in the same engine family as WKWebView.
2. **Manual QA checklist** on a Mac with macOS 26 (own hardware, or a rented cloud Mac):
   - **Install and launch:** install from the DMG; Gatekeeper accepts it (notarized); launch from Launchpad,
     Spotlight and the Dock.
   - **Opening:** double-click a PDF, *Open With*, drag onto the Dock icon, and open while already running (one
     window/instance). Confirm *Open With* does **not** change the default app.
   - **Editing:** highlight, note, sticky note, undo/redo, Cmd+C/V in the note field, save, Save As.
   - **Leaving:** the unsaved prompt on Cmd+W and on Cmd+Q; the document-edited dot.
   - **Interop with Preview.app:** our highlights and notes show in Preview. Highlights made in Preview load,
     can be edited, and survive a save. This is the macOS counterpart of the Edge/Acrobat check.
   - **Finder:** Quick Look thumbnails of annotated files; a password-protected PDF shows no preview and opens
     read-only after the password.
   - **Saving details:** Finder tags survive a save (xattrs); files on iCloud Drive save correctly.
   - **Appearance:** light/dark mode follows the system; the icon looks native in the Dock and Finder.

## Risks
| Risk | Mitigation |
|---|---|
| Quick Look already draws its own PDF thumbnails, so there's nothing to control there | It's the right behaviour, and nothing ships. If a custom look were ever wanted, a Quick Look extension can be written in Rust (`objc2`), but it adds a sandboxed `.appex`. Not planned |
| WebKit differences in text selection and highlight geometry | Phase 3 checks plus the Playwright WebKit smoke test. The Rust/PDF format side is unaffected |
| Full-file rewrite through pdf-lib under iCloud Drive / file coordination | Atomic rename is what other apps do. Test on iCloud Drive (Phase 6). Consider `NSFileCoordinator` later if conflicts appear |
| No Developer ID ⇒ Gatekeeper friction | Budget for the Apple Developer Program before any public release |
| CI runner image changes (macOS 26 images, Xcode/SDK versions) | Pin the runner label. Tauri needs only the SDK, not a specific Xcode |
| Case-insensitive path keys in the recent list (`pathKey` lowercases) | Fine on default APFS. Case-sensitive volumes could merge two distinct recents, which is cosmetic |

## Out of scope (for this port)
Mac App Store distribution (needs the sandbox and security-scoped bookmarks), iOS/iPadOS, Quick Look
preview/thumbnail extensions, printing, Touch Bar, auto-update (same as Windows: deferred).
