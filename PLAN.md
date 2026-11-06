# PDF Reader for Windows — v1 Plan

## Context
This is a new project (`D:\projects\pdf_reader` is empty). The goal is a Windows desktop PDF reader for **v1** that can:
1. **View** PDFs,
2. **Highlight** text, and
3. **Comment** on highlights with a note.

Editing PDF content, password protection, forms, signing, and printing are **deferred** to a later release.

Decisions already made:
- **Stack:** Tauri v2 + React + TypeScript + PDF.js.
- **Storage:** highlights and notes are saved **inside the PDF** as standard annotations, so Acrobat, Edge and Chrome can see them.

## Architecture

| Concern | Choice |
|---|---|
| Shell | Tauri v2. On Windows 11 it uses the built-in WebView2, and the installer is about 10 MB. |
| UI | React 18 + TypeScript + Vite, with Zustand for state. |
| Rendering | `pdfjs-dist`, using its `PDFViewer` component from `pdfjs-dist/web/pdf_viewer.mjs`. That gives us virtualized pages, the text layer, zoom, links and `PDFFindController` without building them ourselves. |
| Annotation write-back | `pdf-lib`, using low-level dictionaries to write `/Highlight`, `/Text` and `/Popup` annotations with appearance streams. It runs in a Web Worker. |
| Native side (Rust) | A small file layer: read bytes, atomic write (temp file + rename), and handling of the file passed when the app is launched from Explorer. Plugins: `tauri-plugin-dialog` and `tauri-plugin-single-instance`. |

### Annotation model
The app works with three PDF annotation types:
- **Highlight:** `/Subtype /Highlight` with `/QuadPoints`, `/C` (color), `/CA` (opacity), `/Contents` (the note text), `/T` (author) and `/M` (modified date), plus a linked `/Popup`.
- **Sticky note:** `/Subtype /Text` (icon `/Note`) with `/Contents`. This lets you comment at a point on the page, not only on highlighted text.
- **Popup:** a child of the two types above; it is what other readers use to show the note.

In memory, each annotation is `{ id, pageIndex, kind, rects[] | point, color, text, contents, author, created, modified, pdfRef? }`. All coordinates are stored in **PDF user space**. Highlights keep one axis-aligned `[x1, y1, x2, y2]` rect per text line (rotation by multiples of 90 keeps rects axis-aligned); `/QuadPoints` are generated from them on save. Conversion to screen space goes through `viewport.convertToViewportPoint` / `convertToPdfPoint`, which handles zoom and page rotation.

### Avoiding double-drawn annotations (key design point)
PDF.js paints annotation appearances into the page canvas. If the app also draws its own overlay for the same annotations, they would appear twice. To avoid that, on open:
1. A worker loads the file with pdf-lib. It extracts the Highlight, Text and Popup annotations into the store, keeping each one's `pdfRef` so it can be edited or deleted later.
2. If there were any, the worker removes them from `/Annots` and gives PDF.js a "view copy" of the bytes. If there were none (the common case), it gives PDF.js the original bytes and adds no extra work.
3. All other annotation types (links, ink, stamps, forms) stay in the file, and PDF.js renders them as usual.

On save, the original pdf-lib document gets the current set of managed annotations written back: new ones are added, changed ones updated, deleted ones removed. Each one gets an appearance stream (multiply blend) so it looks the same in other viewers.

### Interaction
- **Highlight:** select text in the PDF.js text layer, and a floating toolbar appears with 4–5 colors plus "Highlight + note". The selection's `getClientRects()` are converted per page into PDF-space quads, then rects on the same line are merged.
- **Overlay:** each page div gets a React portal mounted when PDF.js fires `pagerendered`. The overlay sits *under* the text layer with `pointer-events:none`, so text stays selectable. A click with no selection is hit-tested against the highlight quads to select that highlight.
- **Selected highlight:** shows a popover where you can change the color, edit the note, or delete it.
- **Sticky note tool:** toggle it with `N`, then click on the page to place a note icon. Clicking the icon opens the note editor.
- **Annotations sidebar:** lists every highlight and note grouped by page, with a text snippet and the note. Clicking an item scrolls to it.
- **Undo/redo:** Ctrl+Z / Ctrl+Y work on annotation operations, using a command stack in the store.
- **Unsaved changes:** a dirty flag puts `•` in the title bar. Ctrl+S saves, Ctrl+Shift+S is Save As, and closing or opening another file prompts if there are unsaved changes.

## Project layout
```
pdf_reader/
  package.json, vite.config.ts, tsconfig.json
  src-tauri/
    tauri.conf.json        # bundle (NSIS/MSI), .pdf fileAssociations, icons
    src/main.rs            # plugins + commands
    src/commands.rs        # read_file, write_file_atomic, get_launch_file
  src/
    main.tsx, App.tsx       # layout: toolbar, sidebar, viewer
    viewer/
      pdfjs.ts              # pdfjs-dist setup + worker URL
      PdfViewer.tsx         # wraps PDFViewer/EventBus/LinkService/FindController
      Toolbar.tsx           # open, page nav, zoom, find, tool toggles
      FindBar.tsx
    annotations/
      model.ts              # types
      store.ts              # Zustand: annotations, selection, dirty, undo stack
      PageOverlay.tsx       # per-page highlight/note rendering (portal)
      SelectionToolbar.tsx
      NotePopover.tsx
      AnnotationsSidebar.tsx
      geometry.ts           # selection rects -> quads, merge, hit-test
    pdf/
      annotWorker.ts        # pdf-lib worker: extract/strip on open, write on save
      annotIO.ts            # pure functions used by the worker (testable)
      appearance.ts         # appearance-stream builders
    services/
      files.ts              # Tauri invoke wrappers, dialogs, recent files
  tests/                    # vitest unit + fixture PDFs
```

## Milestones
1. **Scaffold:** `npm create tauri-app` (React-TS template), Tauri v2, ESLint/Prettier, Vitest. Get `npm run tauri dev` showing a window.
2. **Viewer:**
   - Open a file from the dialog, by drag and drop, from the recent files list, or from Explorer ("Open with" / launch argument via single-instance).
   - Continuous scroll, zoom (fit width, fit page, %, Ctrl+wheel), page number input, keyboard navigation, working links, Ctrl+F find.
   - Password-protected PDFs can be *viewed* through PDF.js's `onPassword` prompt, but saving annotations is disabled for them in v1.
3. **Highlights:** selection toolbar, quad conversion, page overlay, select / recolor / delete, undo and redo.
4. **Notes:** note on a highlight (popover editor), sticky-note tool, annotations sidebar.
5. **Persistence:**
   - Extract and strip on open; write back with appearance streams on save.
   - Save and Save As use an atomic write; the unsaved-changes prompt is in place.
   - Default author name comes from the Windows username and can be changed in a small settings dialog.
6. **Packaging:**
   - `npm run tauri build` produces an NSIS installer with the `.pdf` file association (optional, not forced as the default app).
   - App icon, WebView2 bootstrapper set to `downloadBootstrapper`, and a version number in the About dialog.

## Persistence: what was built (milestone 5)
- **Save strategy:** every save rebuilds the file from the bytes as originally opened (the baseline), removes the annotations the app manages, and writes the current set, so repeated saves never stack up. Removed annotations, their popups and their appearance streams are deleted from the file, not just unlinked.
- **What counts as ours:** `/Highlight`, and `/Text` notes. Everything else (links, underlines, form fields, stamps...) is left untouched. So are annotations the app can't read, and **any annotation that others reply to (`/IRT`)**: recreating it under a new object number would orphan its replies, so comment threads stay exactly as the file has them (they remain visible, but aren't editable here).
- **Safety net:** before the file on disk is replaced, the generated bytes are re-opened with PDF.js and checked (page count, annotations present). The write itself goes to a temporary file in the same folder, is flushed, then renamed over the target.
- **Read-only documents:** encrypted PDFs, and files pdf-lib cannot parse, open for viewing with annotating switched off and a banner explaining why.
- **Identity:** annotation ids are stored in `/NM`, so they survive save and reopen. Text for highlights read from a file is recovered from the page text under their rectangles.
- **Verification done:** round-trip tests (PDF.js and pdf-lib), PDFium rendering and pypdf parsing of saved files, and Microsoft Edge's built-in viewer. `INTEROP_OUT=<dir> npx vitest run tests/interop-export.test.ts` writes sample files for checking in other readers.

## Out of scope for v1
Editing page content, password-protecting or encrypting files, form filling, digital signatures, ink/shape/text-box annotations, OCR, printing, multiple documents in tabs, and auto-update.

## Prerequisites
Node 20+, the Rust stable toolchain (rustup), and the MSVC Build Tools with the "Desktop development with C++" workload. WebView2 already ships with Windows 11.

## Verification
- **Unit tests (Vitest)** on `geometry.ts`: quad merging, rotation (0/90/180/270), and hit-testing.
- **Round-trip tests on `annotIO.ts`**: create a highlight and a sticky note, save, then reload with both pdf-lib and pdf.js `page.getAnnotations()`. Check the subtype, QuadPoints, color, Contents and Popup linkage.
- **Fixture corpus:**
  - a multi-column paper and a rotated page
  - a 500+ page document (checks scroll and memory)
  - a scanned PDF with no text layer (highlighting should be unavailable, with a clear message)
  - a PDF that already has Acrobat highlights (they should load, be editable, and keep their changes after saving)
  - an encrypted PDF (it should open for viewing, with save disabled)
- **Interop check (manual):** open files saved by the app in **Microsoft Edge**, **Adobe Acrobat Reader** and **Chrome**. Highlights should appear in the right color and position, and notes should show as comments.
- **End-to-end smoke test (manual):** install the NSIS build, double-click a PDF in Explorer, highlight, add a note, Ctrl+S, close, reopen, and confirm everything is still there.
