# Printing and Text Editing — Plan

## Context
`PLAN.md` (v1) lists both **printing** and **editing page content** as out of scope. This plan adds them:

1. **Print**: print the open PDF, including the highlights, notes and any text the user added, from a Print button and Ctrl+P.
2. **Edit text**: change text in the document. This is split into two parts because "edit text" can mean two things (see the decision below).
3. **Single and double page views**: show one page at a time or two side by side, with or without continuous scrolling, like Acrobat's *Page Display* options (Part 4).
4. **Signatures**: draw a signature once, save it, and place it on any page with a click, like Acrobat Reader's *Fill & Sign* (Part 5).

All of these have to fit the architecture that already exists, so the points below drive most of the design:

- **PDF.js shows a stripped copy.** On open, `extractAnnotations` (`src/pdf/annotIO.ts`) lifts highlights and notes out of the file and hands PDF.js a copy without them. The app draws them itself in `src/annotations/PageOverlay.tsx`. So the viewer's own document **does not contain the user's current annotations**, and printing it directly would drop them.
- **Saving rebuilds from a baseline.** `saveCurrent` (`src/annotations/persist.ts`) re-creates the file from the bytes as opened plus the current annotation list (`writeAnnotationsAsync`), checks the result with PDF.js, then writes atomically. Anything new that gets saved should go through the same path.
- **Undo/redo is a command stack** (`src/annotations/history.ts`, `store.ts`). New annotation kinds must work with it.
- **Encrypted or unparsable files are read-only** (`annotationBlock`). They can be printed, but not edited.
- **CSP** (`src-tauri/tauri.conf.json`) already allows `blob:` images, which printing needs.
- **The viewer is PDF.js's `PDFViewer`** (`src/viewer/controller.ts`), which already supports `scrollMode` and `spreadMode`. The app currently never changes them (continuous, one page per row), so page views are mostly UI and keyboard work plus checking that overlays behave.
- **Overlays are per page.** `attachHost` creates one overlay host per page div, and hit testing finds the page with `closest('.page')` (`interaction.ts`). Both work no matter where PDF.js lays the pages out, which is why two-page views should not need geometry changes.
- **Small preferences live in `localStorage`** (author, recent files; `src/services/files.ts`). Page-view mode and saved signatures follow that pattern.

## Decision needed: what does "edit text" mean?

| Meaning | What the user does | Difficulty |
|---|---|---|
| **A. Add / edit text boxes** | Click the page, type new text, move and resize it, change font size and colour, edit it again later | Moderate. Fits the existing annotation model |
| **B. Change the document's existing text** | Click a word that is already in the PDF and retype it | Hard. PDF text is positioned glyphs inside content streams, fonts are usually subsets, and there is no "paragraph" to re-flow |

**Recommendation:** build **A first** (Part 2 below), then **B as a cover-and-replace edit** (Part 3) and treat true in-place rewriting as an optional later spike. If you only wanted A, stop after Part 2. This plan assumes that order; tell me if you meant something else and I will adjust it.

---

## Part 1 — Printing

### Approach
Render the pages to images in a hidden print area inside the app window, then call the browser print function, so the system print dialog (printer choice, copies, page range, duplex) does the rest. This is how PDF.js's own print service works, and it needs no new native code.

Why not just call `window.print()` on the page? It would print the app's toolbar and the single visible page. A dedicated print area, shown only under `@media print`, avoids that.

### What gets printed
1. **Source bytes.**
   - Normal documents: `writeAnnotationsAsync(baseline, annotations)`, the same bytes a save would produce. This means unsaved highlights, notes and text boxes print exactly as they would look after saving, and no file on disk is touched.
   - Read-only documents (`annotationBlock` set): print the already-loaded PDF.js document, which still has its own annotations.
2. Open those bytes in a **separate** PDF.js document (as `verifyGenerated` does), so annotation appearance streams are drawn by PDF.js (`annotationMode: ENABLE`) and the on-screen document is left alone.
3. Render each page to a canvas at the chosen quality, convert it to a Blob, and put an `<img src="blob:...">` in `#print-root`.
4. Call `window.print()`; on `afterprint`, remove the images and revoke the object URLs; destroy the temporary document.

### Print dialog (small app dialog before the system one)
- **Pages:** all / current page / range (`1-3, 7, 10-`).
- **Include annotations:** on by default. Off prints the original document only.
- **Quality:** Standard (200 dpi) / High (300 dpi) / Draft (150 dpi). Remembered in settings.
- Progress bar while pages render, with Cancel. Pages render one at a time to bound memory.
- The system dialog's own copies, printer and duplex options are used as they are.

### Details that need care
- **Ctrl+P must be intercepted.** Otherwise WebView2 opens its default print preview of the app UI. Add it to `useKeyboardShortcuts` in `src/App.tsx`; the toolbar button and the shortcut call the same action.
- **Page size and orientation.** Use `@page { margin: 0 }` and a CSS named page per orientation (`page: portrait` / `page: landscape`) so mixed-orientation documents print correctly (`tests/fixtures/landscape-first.pdf` covers this). Each image is fitted to the sheet with `object-fit: contain`.
- **Rotated pages** (`tests/fixtures/rotated.pdf`): render with the page's own rotation so the result is upright.
- **Large documents.** A 500-page file at 200 dpi is too much to hold as decoded images. Render in batches, store as compressed Blobs rather than canvases, and release canvases immediately. Warn above a threshold (for example 200 pages) and suggest a page range.
- **Text quality.** Output is raster, so printed text is not vector. 200–300 dpi is fine for normal documents; document the limit in the README.
- **Dark mode.** `#print-root` and its images must ignore `prefers-color-scheme`.
- **CSS test.** `tests/styles.test.ts` guards global selectors that affect PDF.js; the print CSS must stay scoped (`#print-root`, `.app` under `@media print`) and be covered there.

### Status: built (Part 1 steps 2–6), with one check still to do by hand
Implemented in `src/print/` plus small changes to `Toolbar.tsx`, `App.tsx`, `persist.ts` (`getBaseline`), `controller.ts` (`pdfDocument`), `styles.css` and `README.md`. Tests: `print-range`, `print-layout`, `print-pipeline`, and print rules in `styles.test.ts`.

Verified in headless Edge (the same Chromium engine as WebView2):
- Rendering a page with the print intent draws the highlight in its exact colour and the note icon; the same page with annotations switched off is pure white. Letter at 200 dpi gives 1700×2200 pixels. Cancel works. Rotated and mixed-orientation fixtures report the right orientation.
- The print stylesheet, run against a replica of the print area, produces one sheet per page with the right orientation, and fits pages of other shapes (A4 on Letter, a very wide page) inside the sheet, centred, with the correct aspect ratio.

**Not yet verified: the real `window.print()` call inside the Tauri window** (the spike in step 1). It could not be automated here because the system print dialog needs a person. Check by hand: open a PDF in `npm run tauri dev`, press Ctrl+P, Print..., and confirm the Windows print dialog appears with the right page count (try *Microsoft Print to PDF*). If it doesn't, use the fallback in the Risks table.

Differences from the plan as first written:
- **Page sizing uses percentages, not `vw`/`vh`.** Chromium resolves `vh` once from the first page, so a landscape page in a portrait document overflowed onto an extra sheet (7 sheets for 5 pages in the test). Percentages follow each page's own box.
- **Print state has its own small store** (`printStore.ts`) instead of growing `viewer/store.ts`.
- **Quality is remembered by the print dialog itself** (`printSettings.ts`) instead of being a field in the Settings dialog.
- **Tests check the Print flag, not rendering, in Node.** PDF.js's data API does not filter by print intent (only drawing does), so `print-pipeline.test.ts` pins down what decides what prints (the Print flag and an appearance on everything the app writes); the drawing itself was checked in the browser as above.

### Files
| File | Change |
|---|---|
| `src/print/printRange.ts` (new) | Parse and validate page-range strings. Pure, unit-tested |
| `src/print/renderPages.ts` (new) | Render pages of a PDF.js document to Blobs at a given dpi; cancellable, batched |
| `src/print/printDocument.ts` (new) | Orchestration: build the bytes, render, mount `#print-root`, call `window.print()`, clean up |
| `src/print/PrintDialog.tsx` (new) | Options dialog and progress |
| `src/print/PrintRoot.tsx` (new) | The hidden print area |
| `src/viewer/Toolbar.tsx` | **Print** button (disabled with no document, or while printing) |
| `src/App.tsx` | Ctrl+P shortcut, mount the dialog and print root |
| `src/viewer/store.ts` | `printOpen`, `printing` and progress state |
| `src/viewer/SettingsDialog.tsx` | Default print quality |
| `src/styles.css` | `@media print` and `@page` rules |
| `README.md` | Shortcut table and the raster-output note |

### Steps
1. **Spike (first, small):** confirm `window.print()` inside the Tauri 2 WebView2 window opens the print dialog, that `@page` named pages and `size` are honoured, and that a hidden-then-shown `#print-root` prints correctly. If it does not, fall back to calling Tauri's webview print API from Rust (`WebviewWindow::print`), which keeps the same front-end rendering.
2. `printRange.ts` with tests.
3. `renderPages.ts` and the print root, printing a plain document with no annotations.
4. Print from generated bytes so annotations appear; compare to a saved copy opened in Edge.
5. Dialog, progress, cancel, settings, shortcut, toolbar button.
6. Large-document and mixed-orientation checks; README.

### Verification
- **Unit tests:** `printRange` (single, ranges, open-ended, overlapping, out-of-range, garbage input); a test that print CSS is scoped.
- **Round trip:** generate the print bytes for a document with highlights, a note and (after Part 2) a text box, open them in PDF.js and assert the annotations are present.
- **Manual:**
  - Print to *Microsoft Print to PDF* and compare against the on-screen view: highlights keep their colour and position, notes show their icon, nothing from the app UI appears.
  - Mixed orientation, a rotated page, a page range, a 100+ page file (watch memory), and an encrypted file (prints, no annotations added).
  - Print with unsaved changes: the file on disk must be unchanged afterwards.

---

## Part 2 — Text boxes (add and edit text)

### Status: built (steps 1–6), with interop still to check by hand
Implemented in `src/annotations/` (`TextBox.tsx`, `boxGeometry.ts`, `textBoxActions.ts`, `textBoxKeys.ts`, plus changes to `model.ts`, `store.ts`, `interaction.ts`, `PageOverlay.tsx`, `SelectionToolbar.tsx`, `list.ts`, `AnnotationsSidebar.tsx`), `src/text/` (`fontMetrics.ts`, `textLayout.ts`), and `src/pdf/` (`annotIO.ts`, `appearance.ts`). Tests: `textLayout`, `boxGeometry`, `textbox-io` (PDF round trips) and `textbox-store`, plus a guard in `styles.test.ts`.

Checked in headless Edge against the real UI (about 100 checks, all passing at the end):
- **The editor, the saved file and PDF.js agree.** Browser text widths match the PDF font metrics to 0.02%. Text saved in the file sits on the same baseline as the editor shows (within 0.5pt) for all three fonts, rendered by PDF.js from the saved bytes. The editor wraps to the same number of lines as the layout in 53 of 54 cases (the exception is below).
- **Rotated pages (0, 90, 180, 270).** The box lands where you click, the text is upright on screen, and PDF.js draws it upright and inside the box from the saved file.
- **Interaction.** Click or drag with the Text tool; typing grows the box and is one undo step; move and resize (a drag is one undo step, boxes stay on the page, a minimum size); click a selected box to type, double-click, `Enter`; arrow-key nudging; the format bar (font, size, colour, alignment, background, outline, delete); the next box takes the last look; Escape and clicking elsewhere.
- **PDF layer** (unit tests): every property round-trips; repeated saves do not duplicate; removing a box leaves no trace in the file; callouts, rich text, replies, other fonts, rotated boxes and boxes on rotated pages written by other tools are left untouched.

Findings that changed the design:
- **Wrapping uses unkerned widths.** PDF viewers draw `Tj` text without kerning, so measuring with kern pairs (pdf-lib's own `widthOfTextAtSize` does) would measure narrower than what is drawn. Widths are summed per glyph from `@pdf-lib/standard-fonts` (now a direct dependency) and checked against pdf-lib in a test.
- **Text is sized in `cqw`, not from PDF.js's scale variable.** PDF.js rounds a page's width down to whole device pixels but leaves `--total-scale-factor` unrounded, so text sized from the variable was 0.5% larger than the box around it. The overlay layer is now a size container, and a length of N points is N/page-width of its width.
- **The box and its clipping area are separate elements**, so the resize handles on the edge are not clipped away with overflowing text.
- **Empty boxes needed three rules, not one.** Deleting an empty box on blur made it impossible to pick a font before typing (the click on the font menu blurred the editor and removed the box). Now: Escape on an empty box abandons it with no trace in the undo history or the "unsaved" state; blur only ends typing; and an empty box is dropped when it is deselected (otherwise an invisible empty box would be saved).
- **The release of a drag read stale state.** A fast flick could end the drag before React had re-rendered, so the release was treated as a click and started typing. The live rectangle is now also kept in a ref.
- **`+` / `-` / Outline read the box as it is now**, not as of the last render, so quick successive clicks compound.
- **Page layout interaction.** The new `Tool` value and the `.text-box` zone are excluded from the old document-level click handling, which would otherwise deselect or clear the text selection.

Differences from the plan as first written:
- The text is `contents` and the colour is `color` (as for the other kinds) rather than a separate `text` field, which already means "the highlighted text" on highlights.
- Boxes grow to fit their text but never shrink on their own; the user resizes.
- Non-Latin text uses option 1 (replace with `?` and warn). Embedding a Unicode font is still possible later and is isolated to the appearance builder.

**Known limitation:** while typing, a single word longer than the box that fits a line *exactly* in a monospaced font can wrap one character differently than in the saved file, because the browser rounds glyph advances to whole pixels. The saved file is always laid out by the exact font widths.

**Interop (step 7), partly done.** `INTEROP_OUT=<dir> npx vitest run tests/interop-export.test.ts` now also writes `textboxes.pdf` (every font, alignment, a fill and outline, wrapped and multi-line text, accents and symbols) and `textboxes-rotated.pdf` (a box on pages rotated 0, 90, 180 and 270). Rendered by Edge's built-in viewer (PDFium, a different engine from PDF.js, and the one Chrome uses), everything looks right: fonts, alignment, fill and outline, wrapping, blank lines, `€ é ï “ ” ½`, and the boxes on the 0°, 90° and 180° pages read upright. **Still to do by hand:** open those files in Adobe Acrobat Reader and confirm the boxes look the same and can be edited there, and print one (Part 1).

### Model
A third annotation kind, saved as a standard **`/FreeText`** annotation so Edge, Acrobat and others show it.

```ts
interface TextBoxAnnotation {
  id: string;
  kind: 'textbox';
  pageIndex: number;
  rect: PdfRect;                 // PDF user space, like highlight rects
  text: string;                  // may contain line breaks
  fontFamily: 'Helvetica' | 'Times' | 'Courier';
  fontSize: number;              // PDF points
  color: string;                 // text colour, hex
  align: 'left' | 'center' | 'right';
  fill: string | null;           // optional background colour
  border: boolean;
  author: string; created: string; modified: string;
}
```
Added to the `Annotation` union in `src/annotations/model.ts`; `createTextBox` next to `createNote`.

### Interaction
- **Tool:** `T` key and a **Text** toolbar button (same pattern as the note tool: `Tool = 'select' | 'note' | 'text'`). Click-drag on a page draws a box; a plain click creates a default-size one.
- **Editing in place:** the box opens an inline editor in the overlay (a `textarea` styled to match font, size and colour). Esc or a click elsewhere commits. Double-click an existing box to edit it again.
- **Move and resize:** selecting a box shows handles; dragging updates `rect`. Arrow keys nudge.
- **Format bar:** appears with a selected box: font family, size, colour, alignment, fill, border.
- **Delete / undo / redo / sidebar:** reuse the existing paths. Typing is coalesced into one undo step (`updateAnnotation(..., { coalesce: true })` already exists). The sidebar (`list.ts`, `AnnotationsSidebar.tsx`) lists text boxes by page with a snippet.
- **Hit testing and geometry:** extend `hitTestAnnotation` (`interaction.ts`) and reuse the PDF-space ⇄ page-fraction helpers in `geometry.ts`, so zoom and page rotation work as they do for highlights.
- **Overlay layer:** render text boxes in the existing UI layer (`hl-host`), above the page. Unlike highlights they must be interactive and must **not** use the blend layer.

### Saving and loading (`src/pdf/annotIO.ts`, `appearance.ts`)
- **Write:** a `/FreeText` dictionary with `/Rect`, `/Contents`, `/DA` (font, size, colour), `/Q` (alignment), `/C` (fill), `/BS` and `/NM` (our id), plus a **generated appearance stream** (`/AP /N`) that wraps and draws the text. Use the standard-14 fonts via pdf-lib so no font file is embedded.
- **One wrapping routine** shared by the editor, the overlay and the appearance stream, using the font's real metrics (`widthOfTextAtSize`), so what you see is what prints and what other readers show.
- **Read:** extend `isManaged` to include `/FreeText` that this app can represent faithfully. Leave anything else (callouts `/CL`, rich text `/RC`, replies `/IRT`, unknown fonts) **untouched**, exactly as is done for threaded comments today; PDF.js keeps rendering those.
- **Strip for the viewer:** managed text boxes are removed from the view copy so they are not drawn twice, same as highlights.
- **Safety check:** `verifyGenerated` (`persist.ts`) also counts `FreeText` annotations.

### Open question: characters outside Latin-1
Standard-14 fonts only cover WinAnsi (Western European). Options for other scripts:
1. **Restrict:** warn and replace unsupported characters. Simple, but surprising.
2. **Embed a Unicode font** (a subset of Noto Sans, via `@pdf-lib/fontkit`) when text needs it. Correct and portable, but adds ~100–300 KB to the bundle and some code.

Default: start with option 1 plus a visible warning, and add option 2 if non-Latin text is needed (it is an isolated change inside the appearance builder).

### Files
`src/annotations/model.ts`, `history.ts` (no change expected), `store.ts` (tool type), `interaction.ts`, `list.ts`, `AnnotationsSidebar.tsx`, `PageOverlay.tsx`, new `TextBoxEditor.tsx` and `TextFormatBar.tsx`, `src/pdf/annotIO.ts`, `appearance.ts`, `src/viewer/Toolbar.tsx`, `src/App.tsx` (shortcut), `src/styles.css`, `README.md`.

### Steps
1. Model + store + history support, with unit tests (like `annotations-store.test.ts`).
2. Text wrapping/measurement module, with tests.
3. Appearance stream + write + read in `annotIO.ts`; round-trip tests (pdf-lib and PDF.js), like `annotIO.test.ts`.
4. Overlay rendering and the create tool.
5. Inline editing, move/resize, format bar.
6. Sidebar, shortcuts, hit testing, unsaved-changes behaviour.
7. Interop: open saved files in Edge, Acrobat Reader and Chrome (`INTEROP_OUT=<dir> npx vitest run tests/interop-export.test.ts`), and print them (Part 1).

### Verification
- **Unit:** store/undo for the new kind; wrapping at various widths and fonts; coordinate conversion at 0/90/180/270 rotation (extend `geometry.test.ts`).
- **Round trip:** create → save → reopen yields identical text, rect, font, colour; a second save does not duplicate; foreign FreeText with `/CL` or `/RC` survives untouched (see `tests/helpers/foreignPdf.ts`).
- **Manual interop:** the box looks the same, in the same place, in Edge, Acrobat and Chrome; the text is selectable there.

---

## Part 3 — Change existing text

PDF text is not stored as editable paragraphs, so this is delivered in two levels, shipped separately.

### Status of 3a: built, with Acrobat still to check by hand. 3b (true in-place rewrite): not started, see below
Implemented in `src/pdf/` (`textRuns.ts`, `pagePixels.ts`), `src/viewer/` (`pageText.ts`, `EditNoticeDialog.tsx`), `src/annotations/` (`replaceText.ts`, `EditHints.tsx`, `editMode.ts`, and changes to `model.ts`, `store.ts`, `textBoxActions.ts`, `boxGeometry.ts`, `TextBox.tsx`, `SelectionToolbar.tsx`), and `src/text/` (bold and italic). Tests: `text-runs`, `replace-text`, `font-styles`.

Checked in headless Edge against the real UI (70 checks, all passing at the end):
- **Finding and picking text.** Hovering outlines the line; a click picks it up, including a line drawn as two pieces, a bold heading, text on a tinted background, and upright text on a page turned 90°. Sideways text is refused with a clear message.
- **Matching the look.** Font (sans / serif / mono, bold, italic), size, text colour and background are read from the PDF and the rendered page: a dark blue came back as `#1A3399` (the file's exact 0.1/0.2/0.6), a red as `#CC1A1A`, a yellow as `#FFF4A0`.
- **Placement.** The new text starts at the old left edge and sits on the old baseline (111.88pt vs 112 in the editor; 112.00 vs 112 in the saved file drawn by PDF.js; 300.00 vs 300.00 on the turned page).
- **The saved file.** The old text is gone from view, the erased line has no ink at all, **only the edited lines change** (every other pixel of the page is identical), and **reverting restores the page pixel for pixel**. The cover over a yellow background is indistinguishable from the yellow around it.
- **Behaviour.** Typing a longer line widens the box instead of wrapping; deleting text never shrinks the cover; an edit that changed nothing disappears (Escape, clicking another line, or clicking away) with no undo history and no "unsaved" mark; erasing a line is kept; the first use shows the "covered, not removed" explanation once; a permanent note appears in the format bar; Revert and undo work after reopening the file.
- **Interop.** Edge's built-in viewer (PDFium) draws `edited-text.pdf` (new in the interop export) correctly: bold heading, serif, bold mono, red italic, a seamless yellow cover, an erased line, and untouched lines unchanged.

Findings that changed the design:
- **Bold and italic had to be added to text boxes first** (all twelve combinations of family, bold and italic: metrics, wrapping, the saved font, reading it back, and B / I buttons), or a replaced bold heading would come out regular. Names are matched by the standard AcroForm resource names (`HeBo`, `TiIt`, `CoBO`...), and a made-up `Helv-Bold` is still not ours. Object prototype names (`constructor`...) are explicitly not fonts.
- **PDF.js already knows bold and italic** for each font (`commonObjs`), plus a serif / monospace hint, so no font-name guessing is needed for the common case; the name only refines the family.
- **A line is the unit, not an item.** PDF.js splits text into pieces wherever the producer did; pieces on one baseline in the same font and size with only a word space between are joined, and duplicates drawn on top of each other (faux bold) are dropped.
- **Only text that is upright as displayed is editable.** The test uses displayed directions, not the file's, so upright text on a turned page works, and text drawn sideways in the file (as `rotated.pdf` does) is correctly refused.
- **A replacement widens instead of wrapping.** Wrapping would push the box down over the next line and hide it. The widening is skipped when the user sets the size, and never shrinks the cover.
- **An unchanged edit is pointless**, but an *emptied* one is not (it erases the line). One rule (`isPointlessTextBox`) decides this everywhere: Escape, deselecting, and moving on to another line, including the case where the next click switches editing without any blur.
- **A replaced line's font must not become the next new text box's look.** Style changes on an edited line are not remembered.
- **The first draft of the rotated test was wrong, not the code:** text in `rotated.pdf` is drawn in the file's own orientation, so it only reads upright on the unturned page; a test document with text turned to match each page is used instead.

**Known limits** (also in the README): the original text stays in the file, and Find still matches it; a long replacement can run into its neighbours; only upright standard-font-like text is matched, so letter shapes differ a little; characters outside Western European text are saved as `?` (the format bar warns); scanned pages have no text to edit.

**Still to do by hand:** open `edited-text.pdf` (from the interop export) in Adobe Acrobat Reader and confirm the edits look the same and can be edited there; print one (Part 1).

**3b (true in-place rewrite)** has not been started and the go / no-go test below still applies. 3a's findings make the case for it weaker than expected: PDF.js tells us exactly which font a line uses and where, but the hard part of 3b (subset fonts that lack the new letters, composite fonts, producers that position each word separately) is unchanged, and 3a already gives a visually exact result with a perfect undo. Recommendation: do not build 3b unless removing the old text from the file (real redaction) becomes a requirement, and then treat it as its own project.

### 3a. Cover-and-replace (build this)
The user switches to **Edit text** mode, clicks a line or word of existing text, and retypes it.

1. **Find the text run.** `page.getTextContent()` (already used in `src/pdf/textExtract.ts`) gives each text item with position, size and font name. The click picks the item under the cursor and the editor appears over it.
2. **Match the look.** Take font size from the item's transform, and map the font name to the closest standard family (sans / serif / mono, bold and italic from the name). Take the text colour from the rendered page pixels and the background colour from the pixels around the text; both can be overridden in the format bar.
3. **Commit.** The edit is stored as a `TextBoxAnnotation` with an opaque fill that covers the original run, plus a marker (`replaces: { rect, originalText }`, saved in a private key such as `/PDFReaderEdit`). It uses the same editor, undo, save and print paths as Part 2.
4. **Revert.** The marker lets the user restore the original text: removing the annotation uncovers it.

**Limits to state in the UI and README:**
- The original text is still in the file under the cover. Copy/paste, search and screen readers in other tools can still reach it. This is **not redaction** and must never be described as removing sensitive text.
- Replacing text with a different length does not re-flow the paragraph around it; a long replacement can overlap its neighbours.
- Scanned (image-only) pages have no text runs, so Edit text is unavailable there, with a clear message (same handling as highlighting).

### 3b. True in-place rewrite (optional spike, decide after 3a)
Rewrite the text-showing operators (`Tj` / `TJ`) in the page content stream so the old text is really gone.

- Feasible only for **simple fonts whose encoding already contains every needed character**. Most real documents use subset fonts that lack the new letters, and composite (CID) fonts need glyph lookups, so a fallback to 3a is always required.
- Needs a content-stream tokenizer on top of pdf-lib, careful handling of `Tf`/`Td`/`Tm` state, and tests against a corpus of PDFs from different producers (Word, LaTeX, Chrome, InDesign).
- **Go / no-go for the spike:** if it cannot safely handle at least the common Word/Chrome/LaTeX outputs with no visible shifts, drop it and keep 3a.

### Files (3a)
`src/pdf/textRuns.ts` (new: pick and describe a run, font mapping, pure and tested), `src/annotations/model.ts` (optional `replaces` field), `annotIO.ts` (read/write the marker), `interaction.ts`, `TextBoxEditor.tsx`, `Toolbar.tsx` (Edit text toggle), `src/pdf/pagePixels.ts` (new: colour sampling), `README.md`.

### Verification (3a)
- **Unit:** font-name mapping, run picking, colour sampling on fixture pages.
- **Round trip:** edit → save → reopen → revert restores the page exactly; foreign files unaffected.
- **Manual:** the edited page looks right in Edge, Acrobat and Chrome and when printed; confirm the "not a redaction" notice is shown the first time.

---

## Part 4 — Single and double page views

### Status: built (steps 1–5)
Implemented in `src/viewer/` (`viewMode.ts`, `pageNav.ts`, `viewPrefs.ts`, `ViewMenu.tsx`, plus changes to `controller.ts`, `store.ts`, `actions.ts`, `Toolbar.tsx`) with `README.md` and `styles.css`. Unit tests: `viewMode.test.ts`, `pageNav.test.ts`, and a guard in `styles.test.ts`.

The spike and the behaviour checks ran in headless Edge against the real controller, overlay and toolbar, on a 5-page (odd) document, the 30-page `sample.pdf`, and `rotated.pdf` (125 checks, all of them below passing except the one limitation listed):
- **Pairing is as predicted.** `ODD` gives 1-2, 3-4, 5; `EVEN` (cover) gives 1, 2-3, 4-5. All six layout/cover combinations show the right first screen and step through the right pairs, forward and back, including the lone last page.
- **Overlays need no changes.** Highlights line up to within 0.1px on every page in every layout. Clicking a highlight selects the right one, a sticky note lands on the right page, and a text selection running from the left page into the right page gives one highlight per page.
- **Jumps work in every layout.** Sidebar jumps and find bring the right page into view; switching layout keeps your page on screen; a newly opened document comes up in the chosen layout.
- **Toolbar wiring works**: View menu items, the cover checkbox (disabled for one-page layouts), previous/next buttons, and their disabled states at the ends.
- **Keys and wheel** turn pages in the one-page-at-a-time layouts only when the page can't scroll further; a page zoomed in scrolls first; a touchpad's trailing momentum doesn't turn extra pages or scroll the new page; continuous layouts are left to normal scrolling.

Findings that changed the design:
- **PDF.js resets the layout whenever a document is set**, so the layout is applied in the `pagesinit` handler (before the zoom), not once at start-up.
- **"Fit page" was ~14px too tall in one-page layouts**, because PDF.js leaves out the 9px border it draws above and below each page. That gave a pointless scrollbar and stopped the keys and wheel from ever reaching "the end of the page". The vertical border and margin are removed in these layouts (side borders and shadow stay), and the edge check allows 8px of slack.
- **`PDFViewer.nextPage()` / `previousPage()` already move by a pair**, so no pairing arithmetic is needed to turn pages; `spreadPages` is only used to enable/disable the buttons.
- **The page box shows PDF.js's current page** (either page of a pair) rather than always the first of the pair; it is simpler and never wrong.
- **Wheel gestures must start at the page edge** to turn a page, which stops a touchpad's momentum from flipping several pages.

**Known limitation:** PDF.js sizes "Fit page" / "Fit width" for a two-page layout from the *current page alone*, so a pair of differently shaped pages (a portrait page beside a landscape one) can be wider than the window. Zooming out shows both. Fixing it means a custom fit calculation; left for later because it only affects documents with mixed page sizes.

### What the user gets
A **View** menu in the toolbar, modelled on Acrobat's *Page Display*:

| Option | PDF.js setting |
|---|---|
| **Single page** — one page at a time, no scrolling into the next | `scrollMode = PAGE`, `spreadMode = NONE` |
| **Single page, continuous** (today's behaviour, stays the default) | `scrollMode = VERTICAL`, `spreadMode = NONE` |
| **Two pages** — a pair side by side, one pair at a time | `scrollMode = PAGE`, `spreadMode = ODD` |
| **Two pages, continuous** | `scrollMode = VERTICAL`, `spreadMode = ODD` |
| **Show cover page in two-page view** (checkbox) — page 1 stands alone, then 2–3, 4–5… | `spreadMode = EVEN` instead of `ODD` |

(PDF.js's `ODD` pairs pages 1–2, 3–4; `EVEN` leaves page 1 alone. Confirm the exact behaviour in the first step.)

The choice is remembered between sessions (and applies to every document), the same way the zoom level is.

### Behaviour to build
- **Controller:** `setViewMode(mode, cover)` in `ViewerController` sets `viewer.scrollMode` and `viewer.spreadMode`, then re-applies the current zoom so *Fit page* and *Fit width* recalculate for the new layout (in a two-page view, *Fit page* means "fit the pair"). The mode is applied in the `pagesinit` handler, next to the zoom, so new documents open in it.
- **Navigation in page-at-a-time modes.** PDF.js's `PDFViewer` does not handle keys or wheel flipping itself, so add:
  - Previous / next buttons beside the page box in the toolbar (`Toolbar.tsx`), and `PageUp` / `PageDown`, `←` / `→` and `Space` / `Shift+Space` when the page isn't zoomed past the window edge. In a two-page view these move by one pair.
  - Mouse wheel and touchpad flip to the next or previous page only when the view is already scrolled to its edge, with a short cooldown so one flick turns one page.
  - `Home` / `End` keep working (`App.tsx`).
- **Page box** shows the current page; in a two-page view the controller reports the first page of the visible pair, and the total stays `/ N`.
- **Sidebar jump, links, find results:** all go through `scrollPageIntoView`, which respects the mode. Check each one lands on the right page.
- **Overlays and tools in two-page views:** highlights, notes, text boxes and signatures draw into each page's own overlay host, and pointer events find their page with `.page`. A text selection that runs from the left page into the right page must produce one highlight per page, as multi-page selections already do (`highlightsFromCapture`).
- **Window resize:** the existing `ResizeObserver` in the controller already re-fits presets; make sure it also re-fits in page-at-a-time modes.
- **Printing is unaffected.** The print path (Part 1) renders pages itself and never uses the viewer's layout.

### Files
| File | Change |
|---|---|
| `src/viewer/controller.ts` | `setViewMode`, apply on `pagesinit`, previous/next helpers, edge-aware wheel flipping |
| `src/viewer/store.ts` | `viewMode` and `coverPage` state, loaded from storage |
| `src/services/files.ts` | Load/save the view preference (same pattern as the author and recent files) |
| `src/viewer/ViewMenu.tsx` (new) | The View dropdown (reuse the `menu` styles used by *Recent*) |
| `src/viewer/Toolbar.tsx` | View menu, previous/next buttons |
| `src/App.tsx` | Keyboard shortcuts for page flipping (not while typing in a field) |
| `src/styles.css` | Spread spacing and any overlay offsets |
| `README.md` | Shortcut table and view options |

### Steps
1. **Spike:** switch `scrollMode` / `spreadMode` in the running app on the existing fixtures (including `landscape-first.pdf` and `rotated.pdf`). Record what `ODD` / `EVEN` do, whether overlays still line up, and how *Fit page* behaves.
2. Controller + store + persistence + View menu.
3. Navigation: buttons, keys, edge-aware wheel flipping.
4. Verify highlights, notes, find, sidebar jumps and links in every mode; fix any overlay or hit-test problems found.
5. README and shortcut table.

### Verification
- **Unit:** the pure parts: mapping a view option (+ cover flag) to the two PDF.js settings; the "which pair does page N belong to" and next/previous-page arithmetic for ODD and EVEN; the stored preference round trip with bad or missing values.
- **Manual, in each of the four modes (and with the cover option):** open `sample.pdf`, a rotated page, and a landscape-first file; make a highlight that crosses from the left to the right page; place a note on each side; zoom and resize the window; use find; click a sidebar item; confirm everything is in the right place and the page box is correct on the first and last pages (odd page counts leave a lone last page).

---

## Part 5 — Signatures (Acrobat *Fill & Sign* style)

### Status: built (steps 1–9), with Acrobat still to check by hand
Implemented in `src/signature/` (`strokes.ts`, `placement.ts`, `savedSignatures.ts`, `signatureStore.ts`, `pngData.ts`, `imageTools.ts`, `imageImport.ts`, `DrawPad.tsx`, `SignatureDialog.tsx`, `SignMenu.tsx`, `SignatureArt.tsx`), `src/annotations/` (`SignatureView.tsx`, `SignatureHints.tsx`, `useBoxGesture.ts`, and changes to `model.ts`, `store.ts`, `interaction.ts`, `PageOverlay.tsx`, `SelectionToolbar.tsx`, `boxGeometry.ts`), `src/pdf/` (`annotIO.ts`, `appearance.ts`, `signatureFields.ts`) and `src/viewer/` (`SignedDialog.tsx`, `SettingsDialog.tsx`, `Toolbar.tsx`). Tests: `strokes`, `signature-io`, `signature-support`, `signature-placement`, `signature-store`, `save-signed`.

Checked in headless Edge against the real UI (104 checks, all passing at the end):
- **Dialog and pad.** Drawing with pointer events, tap makes a dot, Undo and Clear, ink colour and pen width, the drawing is cropped to its ink; typed initials and an imported picture become small transparent PNGs (a blank picture and a non-picture file are refused with clear messages).
- **Placing.** A faint copy follows the pointer at the right size and centred; over an empty signature field the field is highlighted and the signature is fitted inside it, with its shape, leaving 3pt round; this also works on a rotated page and in a two-page layout; the size is right at 200% zoom.
- **Editing.** Drag (one undo step), corner resize with the shape locked and a 24pt minimum, stops at the page edge, Delete button and undo.
- **Saved file against the screen.** The saved file rendered by PDF.js puts the signature within a fraction of a pixel of where and how big the overlay shows it (page 1 and the rotated page 3); a picture signature's transparent corner stays white (the soft mask works); reopening the file brings every signature back, identical and editable.
- **Interop.** Edge's built-in viewer (PDFium) draws `signatures.pdf` (new in the interop export) correctly: crisp strokes, see-through pictures, initials, upright on pages rotated 0°, 90° and 180°.

Findings that changed the design:
- **A removed signature left its picture in the file.** The embedded image object is referenced only by the signature's appearance, so deleting the annotation orphaned it. Removing an annotation this app wrote now also deletes the images (and their masks) and fonts its appearance uses. This is limited to our own annotations, because the fonts of an adopted foreign text box may be shared with the document's forms. It also stops each save from leaving a tiny orphaned font behind for text boxes.
- **One odd entry could stop a whole file from opening.** pdf-lib's `lookupMaybe` *throws* when an object is of another kind, so a stamp with a nonsense data entry, or any annotation with a malformed `/AP`, made extraction fail. All lookups in `annotIO.ts` now go through a helper that never throws, and tests cover damaged stamps.
- **Saved signatures are untrusted input.** They come back from local storage, and signature data comes back from PDF files. Everything is validated (strokes: finite coordinates, size limits; pictures: must really be small PNGs; colour and width ranges) and a bad entry is dropped without hiding the others.
- **Empty signature fields are found by pdf-lib in the worker, not PDF.js.** PDF.js's annotation data cannot tell a signed field from an empty one; reading `/FT`, `/V` (also inherited from parent fields), the hidden flags and the size can.
- **Shared gesture code.** Moving and resizing was extracted from the text box into `useBoxGesture` and is used by both; the text box was re-tested in the browser afterwards.
- **Signature rectangles must be derived from what is displayed.** On a page turned 90° or 270° the box in the file has its width and height swapped; the app always does this, and the interop sample now does too (a first version of the sample did not, and drew a squeezed signature).

Differences from the plan as first written:
- **The Sign button is a split button.** The main part places your newest saved signature at once (or opens the dialog the first time); the arrow opens the menu. This keeps "with one saved signature, Sign places it straight away" while still reaching the list.
- **No pen pressure.** Strokes have a constant width. Variable width needs filled outlines instead of a stroked path; left out for now.
- **The Type tab is included** (three script styles, three ink colours); fonts that are missing fall back to the system cursive font.
- **Field detection** lives in `annotIO.ts`'s extraction (see above) rather than a PDF.js-based `signatureFields.ts` in the viewer.

**Still to do by hand:** open `signatures.pdf` (from the interop export) in Adobe Acrobat Reader to confirm the signatures look the same and can be selected; try drawing with a touch screen or pen if you have one (the pad uses pointer events with `touch-action: none`, but this was only tested with a mouse); print one (Part 1).

### What "signature" means here
This is a **visual signature**: the user's drawn (or typed or imported) signature is placed on the page, like Acrobat Reader's *Fill & Sign*. It is **not** a certificate-based digital signature; it proves nothing cryptographically. The UI says so once in the signature dialog, in plain words.

### How it works for the user (mirrors Acrobat)
1. **Sign** button in the toolbar opens a small menu: the user's saved signatures and initials, plus **Add signature…** and **Add initials…**.
2. **Add signature** opens a dialog with tabs:
   - **Draw** (required): a drawing area in the dialog. The user signs with mouse, touch or pen. Choices of ink colour (black, blue, red) and line width, a **Clear** button, and a **Save signature** checkbox (on by default).
   - **Image** (small): choose a PNG/JPG of a signature; a white background is made transparent.
   - **Type** (optional stretch): the name rendered in a few script-style fonts, converted to an image on Apply.
3. **Apply** closes the dialog and the signature **sticks to the pointer** as a faint preview. A single **click on the page places it**. (If the user chose a signature from the saved list instead, they skip steps 2 and go straight to this.)
4. A placed signature can be **dragged** to move it, **resized** from its corner handles with the aspect ratio locked, and **deleted** (Delete key or a small toolbar above it). Esc cancels placement.
5. **Click to place a saved one**: once a signature is saved, signing again is just *Sign → pick it → click*. With only one saved signature, *Sign* places it straight away. Saved signatures can be removed from the menu.
6. **Signature fields.** If the PDF has an empty signature field (a form signature box), then in sign mode hovering over it highlights it, and **clicking it drops the signature fitted inside that field**. Elsewhere on the page, a click places it at its default size where the pointer is.

Initials work the same way, with their own saved list and a smaller default size.

### Model
A fourth annotation kind, so it reuses the whole existing pipeline (undo, save, sidebar, printing):

```ts
interface SignatureAnnotation {
  id: string;
  kind: 'signature';
  pageIndex: number;
  rect: PdfRect;                 // PDF user space; aspect ratio locked on resize
  variant: 'signature' | 'initials';
  artwork:
    | { type: 'strokes'; strokes: [number, number][][]; color: string; width: number; box: [number, number] }
    | { type: 'image'; pngDataUrl: string };
  author: string; created: string; modified: string;
}
```
Drawn signatures are kept as **vector strokes** (lists of points), not pixels, so they stay sharp at any size or zoom and print crisply. Typed names and imported pictures are stored as a PNG with transparency.

The `Tool` type gains a placement state, for example `{ kind: 'sign', artworkId }`, alongside `'select' | 'note' | 'text'`.

### Saved signatures
- Stored on the user's machine, **not** in any PDF, in `localStorage` (same mechanism as the author name and recent files), as the stroke data or a small downscaled PNG. Images are capped (for example 600 px wide) to keep the store small.
- A few entries per kind, each deletable. Nothing is uploaded.
- The signature is personal data. The settings dialog gets a **Remove all saved signatures** button, and the README says where they are stored.

### Drawing area
A canvas component with pointer events (`pointerdown/move/up`, `setPointerCapture`). Points are smoothed with quadratic curves between midpoints; pen pressure scales width when the device reports it. Strokes are normalised to a bounding box on Apply so the placed signature has no empty margin. It must work with mouse, touch and stylus, with `touch-action: none` on the canvas so touch drawing does not scroll the page.

### Saving into the PDF (`annotIO.ts`, `appearance.ts`)
- **Write:** a `/Stamp` annotation with `/Rect`, `/NM` (our id), `/T`, `/M`, a name such as `/Name /PDFReaderSignature`, and an **appearance stream**. Strokes become path operators (`m`, `c`/`l`, `S`) with the stroke colour and line width; images are embedded as an image XObject with a soft mask for transparency (`embedPng` in pdf-lib).
- **Read back:** `isManaged` takes over only `/Stamp` annotations carrying our name plus a private key (for example `/PDFReaderArt`) that holds the stroke data, so a reopened file can still be moved, resized and deleted. Stamps from other tools, and ours without the key, are left untouched and still render through PDF.js.
- **Strip for the viewer:** managed signatures are removed from the view copy (drawn by the overlay while the document is open), as for highlights.
- **Verification on save:** `verifyGenerated` counts `Stamp` annotations too.
- **Existing digital signatures:** a save rewrites the whole file, which **invalidates any certificate signature already in the document**. Detect signed files (a `/Sig` field with `/ByteRange`) and show a clear warning before the first save, offering *Save a copy* instead. This is a gap in saving today as well; fix it here because adding a visual signature makes it far more likely to be hit.

### Printing
Signatures are part of the bytes built for printing (Part 1), so they print with no extra work. Check that stroke width stays correct at 300 dpi.

### Files
| File | Change |
|---|---|
| `src/annotations/model.ts` | `SignatureAnnotation`, `createSignature`, artwork types |
| `src/annotations/store.ts` | `Tool` gains the sign placement state |
| `src/annotations/interaction.ts` | Placement click, signature-field detection and snapping, hit testing |
| `src/annotations/PageOverlay.tsx` | Draw signatures (SVG paths or an `<img>`), move/resize handles, placement preview |
| `src/signature/DrawPad.tsx` (new) | The drawing canvas |
| `src/signature/SignatureDialog.tsx` (new) | Draw / Image / Type tabs |
| `src/signature/SignMenu.tsx` (new) | Toolbar menu of saved signatures and initials |
| `src/signature/strokes.ts` (new) | Smoothing, normalising and scaling strokes. Pure, tested |
| `src/signature/savedSignatures.ts` (new) | Load, save, delete in storage, with size caps |
| `src/pdf/signatureFields.ts` (new) | Find empty `/Sig` widgets and their rects via `page.getAnnotations()` |
| `src/pdf/annotIO.ts`, `appearance.ts` | Write and read `/Stamp` signatures; detect already-signed files |
| `src/viewer/Toolbar.tsx`, `SettingsDialog.tsx`, `App.tsx` | Sign button, remove-all button, Esc to cancel |
| `README.md` | Sign usage and the "visual signature only" note |

### Steps
1. Model, store, undo, and strokes helpers with tests.
2. Appearance stream, write and read; round-trip tests with pdf-lib and PDF.js (strokes and image).
3. Saved-signature storage.
4. Draw pad and dialog (Draw tab first).
5. Sign menu, placement with the pointer preview, move and resize.
6. Signature-field detection and snapping.
7. Image tab; then Type tab if time allows.
8. Signed-file warning on save.
9. Interop and print checks.

### Verification
- **Unit:** stroke smoothing and normalising (empty, single-point and very long strokes); scaling keeps aspect ratio; saved-signature storage with corrupt data and the size cap; signature-field detection on a fixture with a `/Sig` widget (add one to `scripts/make-fixtures.mjs`).
- **Round trip:** place → save → reopen → move and resize → save again leaves exactly one signature, still editable; a foreign `/Stamp` survives untouched; a pre-signed fixture triggers the warning.
- **Manual:** signatures look the same in Edge, Acrobat Reader and Chrome; draw with mouse and with touch/pen if available; place with 125%, 200% zoom and on a rotated page; use it in a two-page view (Part 4); print to *Microsoft Print to PDF*.

---

## Milestones
1. **Print spike + range parsing** (Part 1, steps 1–2)
2. **Print end-to-end** (Part 1, steps 3–6) — shippable on its own
3. **Page views spike and implementation** (Part 4) — independent of the rest, can ship early
4. **Text boxes: model, wrapping, save/load** (Part 2, steps 1–3)
5. **Text boxes: UI** (Part 2, steps 4–6)
6. **Signatures: model, save/load, saved-signature storage** (Part 5, steps 1–3)
7. **Signatures: draw, place, move/resize, signature fields, signed-file warning** (Part 5, steps 4–8)
8. **Interop + printing of text boxes and signatures** (Part 2 step 7, Part 5 step 9)
9. **Edit existing text, cover-and-replace** (Part 3a)
10. **Optional: in-place rewrite spike** (Part 3b)

Printing comes first because it is independent, valuable alone, and its "print the bytes a save would produce" design lets every later annotation kind print correctly with no extra work. Page views come next because they are small and touch only the viewer. Signatures follow text boxes because they reuse the same overlay editing (selection, move, resize, handles), so that code is written once.

## Out of scope
Re-flowing paragraphs, editing images or vector graphics, form-field creation, redaction, OCR (editing scanned pages), rich text inside text boxes (mixed fonts and sizes in one box), true vector printing, and printing password-protected files with annotations added.

Also out of scope for signatures: **certificate-based digital signatures** (signing with a key and certificate, validating signatures, timestamping), requesting signatures from other people, and syncing saved signatures between devices. Right-to-left page binding and a book-style two-page view with page-turn animation are out of scope for page views.

## Risks
| Risk | Mitigation |
|---|---|
| `window.print()` behaves differently inside Tauri/WebView2 | The spike comes first; fallback is Tauri's native webview print call with the same front-end |
| Printing large documents uses too much memory | Sequential rendering, Blob storage, batch release, warning above a threshold |
| Text box looks different in other readers | One shared wrapping routine; interop checks in Edge, Acrobat and Chrome before shipping |
| Users read Part 3a as redaction | Visible notice, README wording, no "delete text" language |
| Foreign FreeText annotations get mangled | Only take over the ones we can represent; leave the rest untouched, with fixtures to prove it |
| Two-page views misplace overlays or hit tests | Spike first; overlays and hit tests are per page already, and every tool is checked in every mode before shipping |
| Wheel/touchpad flipping feels wrong (skips pages or sticks) | Edge-aware flipping with a cooldown, tuned on a real touchpad; previous/next buttons and keys always work as a fallback |
| Users assume a placed signature is legally or cryptographically binding | A plain "visual signature only" notice in the signature dialog and the README |
| Saved signatures are personal data in local storage | Stored locally only, deletable one by one or all at once, never uploaded, documented in the README |
| Saving a document that already has a digital signature breaks it | Detect it and warn before saving; offer *Save a copy* |
| Drawing is poor on touch or pen devices | `touch-action: none`, pointer capture, pressure support; tested on a real touch/pen device if one is available |
