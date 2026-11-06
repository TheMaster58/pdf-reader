import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');

/** Selectors of rules that set box-sizing on everything (`*`, html, body, #root, :root). */
function globalBoxSizingRules(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /box-sizing/.test(body))
    .map(([, selector]) => selector.trim())
    .filter((selector) =>
      selector.split(',').some((part) => /^(\*|html|body|#root|:root)$/.test(part.trim())),
    );
}

// PDF.js sizes its text layer assuming content-box (a .page has a 9px border). A global border-box
// rule shrinks the canvas relative to the text layer, so selections and highlights drift off the
// real text in proportion to their distance from the top-left corner.
describe('stylesheet', () => {
  it('has no global box-sizing rule that would reach PDF.js pages', () => {
    expect(globalBoxSizingRules(css)).toEqual([]);
  });

  it('keeps border-box scoped away from the PDF container', () => {
    expect(css).toMatch(/:not\(\.pdf-container, \.pdf-container \*\)/);
  });

  // Printing swaps the whole window for the hidden print area. Both halves must stay in place or
  // the app's toolbar would print, or the pages would never show.
  describe('print rules', () => {
    const printBlock = (() => {
      const start = css.indexOf('@media print');
      if (start < 0) return '';
      let depth = 0;
      for (let i = css.indexOf('{', start); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
      }
      return css.slice(start);
    })();

    it('keeps the print area hidden on screen', () => {
      const outside = css.replace(printBlock, '');
      expect(outside).toMatch(/#print-root\s*\{\s*display:\s*none/);
    });

    it('hides everything but the print area when printing, and shows the print area', () => {
      expect(printBlock).toMatch(
        /body\s*>\s*:not\(#print-root\)\s*\{\s*display:\s*none\s*!important/,
      );
      expect(printBlock).toMatch(/#print-root\s*\{\s*display:\s*block/);
    });

    it('prints on a white page whatever the colour scheme', () => {
      expect(printBlock).toMatch(/background:\s*#fff/);
    });

    it('has a page box for each orientation, with no margins', () => {
      expect(printBlock).toMatch(/@page pr-portrait\s*\{[^}]*size:\s*portrait[^}]*margin:\s*0/);
      expect(printBlock).toMatch(/@page pr-landscape\s*\{[^}]*size:\s*landscape[^}]*margin:\s*0/);
      expect(printBlock).toMatch(/\.pr-page\.portrait\s*\{\s*page:\s*pr-portrait/);
      expect(printBlock).toMatch(/\.pr-page\.landscape\s*\{\s*page:\s*pr-landscape/);
    });

    it('sizes pages with percentages, not vw/vh (those follow the first page and break mixed orientations)', () => {
      const pageRules = [...printBlock.matchAll(/\.pr-page[^{]*\{([^}]*)\}/g)]
        .map((m) => m[1])
        .join('\n');
      expect(pageRules).toMatch(/width:\s*100%/);
      expect(pageRules).toMatch(/height:\s*100%/);
      expect(printBlock).not.toMatch(/\b\d+(\.\d+)?v[wh]\b/);
    });

    it('does not add global selectors that would leak into the screen layout', () => {
      expect(css.replace(printBlock, '')).not.toMatch(/\.pr-page/);
    });
  });

  // In the one-page-at-a-time layouts PDF.js sizes "Fit page" without the border it draws above and
  // below each page, so the vertical border and margin must go or a fitted page gets a scrollbar.
  it('removes the vertical page border and margin in paged layouts (so Fit page really fits)', () => {
    const rule = /\.pdf-container\.paged-layout \.pdfViewer \.page\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/margin-top:\s*0/);
    expect(rule![1]).toMatch(/margin-bottom:\s*0/);
    expect(rule![1]).toMatch(/border-top-width:\s*0/);
    expect(rule![1]).toMatch(/border-bottom-width:\s*0/);
    // Only the vertical sides: the side borders carry the page shadow.
    expect(rule![1]).not.toMatch(/border-(left|right)/);
  });

  // Text boxes size their text in container units (cqw) against the overlay layer, so a font of N
  // points is exactly N/page-width of the overlay's width. Without a container the units would fall
  // back to the window and the text would be the wrong size.
  it('makes the overlay layer a size container for text boxes', () => {
    const rule = /\.hl-host\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/container-type:\s*inline-size/);
  });

  it('the detector itself catches the bad pattern (even behind a comment)', () => {
    expect(globalBoxSizingRules('* {\n  box-sizing: border-box;\n}')).toEqual(['*']);
    expect(globalBoxSizingRules('/* reset */\n*, *::before { box-sizing: border-box; }')).toEqual([
      '*, *::before',
    ]);
    expect(globalBoxSizingRules('.toolbar { box-sizing: border-box; }')).toEqual([]);
  });
});
