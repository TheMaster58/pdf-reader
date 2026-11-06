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
| Edit existing text | **Edit text** or `E`, then click a line of text and retype it (the tool stays on for the next line; `Esc` or the button turns it off). Select an edit and choose **Revert to original** (or `Ctrl+Z`) to undo it |
| Sign | **Sign** places your newest saved signature (or opens the dialog the first time); click the page to put it down. The **▾** next to it lists saved signatures and initials and has **Add signature...** / **Add initials...**. In the dialog, draw it, import a picture of it, or type it. Click an empty signature box in a form to drop it inside, fitted. Drag to move, drag a corner to resize, `Delete` removes it |
| Text box | `T` or **Text**, then click the page (or drag to size it) and type. Click a box to select it, drag to move, drag the handles to resize, `Enter` or double-click to type again, arrow keys to nudge (`Shift` for bigger steps). The bar above the box sets font, size, colour, alignment, background and outline. `Esc` finishes; an empty box is dropped |
| Edit or delete | Click a highlight or note. `Delete` removes it, `Ctrl+Z` / `Ctrl+Y` undo and redo |
| List everything | **Annotations** button: jump to any highlight or note |
| Save | `Ctrl+S` (into the same file), `Ctrl+Shift+S` (a copy) |
| Print | **Print** button or `Ctrl+P`: choose all pages, the current page or a range such as `1-3, 7, 10-`, then the system print dialog opens |
| Find / zoom | `Ctrl+F`, `Ctrl+wheel`, `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Page layout | **View** menu: single page or two pages, continuous or one at a time, and *Show cover page in two-page view* (page 1 on its own, then 2-3, 4-5...). Remembered for next time |
| Turn pages | **‹** / **›** buttons beside the page box. In the one-page-at-a-time layouts: `PageUp` / `PageDown`, arrow keys, `Space` / `Shift+Space`, or scroll past the end of a page (they scroll first if the page is zoomed in) |
| About | `F1` |

Password-protected PDFs can be read but not annotated yet.

In the two-page layouts "Fit page" and "Fit width" are sized from the current page, so a pair of differently
shaped pages (say a portrait page next to a landscape one) can be wider than the window: zoom out to see both.

**Editing existing text** works by covering a line, not by changing the PDF's own text. Clicking a line makes a
text box over it in the closest standard font (sans-serif, serif or monospace, bold and italic), the same size,
the same colour (read from the page), on a fill the colour of the page behind it. **The original text is still
in the file underneath**, so other programs can still find and copy it. It is not a redaction: never use it to
hide sensitive information. A longer replacement widens the box (to the page edge) instead of wrapping, but
nothing is re-flowed around it, so a long replacement can run into its neighbours. Only upright text can be
edited (not slanted or sideways text, and not scanned pages, which have no text). Fonts are matched, not
reproduced: expect small differences in letter shapes. In the app, Find still matches the old text.

**Signatures** are *visual* signatures, like Acrobat's Fill & Sign: your drawing is placed on the page, but it is
not a digital certificate signature and does not prove who signed. A drawn signature is stored as vector strokes
(sharp at any size, and when printed); a typed name or an imported picture is stored as a small PNG with a
transparent background. They are saved in the PDF as standard stamp annotations, so other readers show them.
Saved signatures are kept on this computer only, in the app's own local storage (never uploaded) and not
encrypted; remove them one at a time from the Sign menu, or all at once under **Settings**. If a PDF already
carries a digital signature, saving into it would make that signature invalid, so the app asks first and offers
to save a copy instead. Pen pressure is not used: strokes have a constant width.

**Text boxes** are saved as standard PDF text-box annotations, so other readers show them (and Acrobat can
edit them). They use the PDF standard fonts, offered as sans-serif, serif and monospace, which cover Western
European text: any other character is saved as `?` (the format bar warns you). Boxes made by other tools are
taken over for editing only when they are plain text boxes in one of those fonts; callouts, rich text, other
fonts and rotated boxes are left exactly as they are. While you type, a long unbroken word that fits a line
exactly can wrap one character differently than in the saved file, because the browser rounds glyph widths to
whole pixels.

**Printing** includes your highlights and notes, even before you have saved them (untick *Print highlights
and notes* to leave them out); nothing is written to the file. Pages are sent to the printer as images, at
Draft (150 dpi), Standard (200 dpi) or High (300 dpi), so printed text is not vector. Pages are prepared
in memory before the system dialog opens, so for very long documents print a range.

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
