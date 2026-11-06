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

  it('the detector itself catches the bad pattern (even behind a comment)', () => {
    expect(globalBoxSizingRules('* {\n  box-sizing: border-box;\n}')).toEqual(['*']);
    expect(globalBoxSizingRules('/* reset */\n*, *::before { box-sizing: border-box; }')).toEqual([
      '*, *::before',
    ]);
    expect(globalBoxSizingRules('.toolbar { box-sizing: border-box; }')).toEqual([]);
  });
});
