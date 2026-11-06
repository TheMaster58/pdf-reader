import { describe, expect, it } from 'vitest';
import { addRecent, fileNameOf, isPdfPath, pathKey } from '../src/services/files';

describe('fileNameOf', () => {
  it('handles forward slashes', () => {
    expect(fileNameOf('C:/docs/report.pdf')).toBe('report.pdf');
  });
  it('handles Windows backslashes', () => {
    const p = ['C:', 'docs', 'report.pdf'].join(String.fromCharCode(92));
    expect(fileNameOf(p)).toBe('report.pdf');
  });
  it('returns a bare name unchanged', () => {
    expect(fileNameOf('a.pdf')).toBe('a.pdf');
  });
});

describe('isPdfPath', () => {
  it('is case-insensitive', () => {
    expect(isPdfPath('X.PDF')).toBe(true);
    expect(isPdfPath('x.txt')).toBe(false);
  });
});

describe('addRecent', () => {
  it('puts the newest first', () => {
    expect(addRecent(['b.pdf', 'c.pdf'], 'a.pdf')).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  });
  it('moves an existing entry to the front without duplicating it (case-insensitive)', () => {
    expect(addRecent(['a.pdf', 'B.pdf'], 'b.PDF')).toEqual(['b.PDF', 'a.pdf']);
  });
  it('treats forward and back slashes as the same file', () => {
    const back = ['D:', 'docs', 'a.pdf'].join(String.fromCharCode(92));
    expect(addRecent([back, 'x.pdf'], 'd:/docs/A.PDF')).toEqual(['d:/docs/A.PDF', 'x.pdf']);
  });
  it('caps the list length', () => {
    expect(addRecent(['b', 'c', 'd'], 'a', 3)).toEqual(['a', 'b', 'c']);
  });
});

describe('pathKey', () => {
  it('normalises case and slash style', () => {
    expect(pathKey(['C:', 'Docs', 'A.pdf'].join(String.fromCharCode(92)))).toBe('c:/docs/a.pdf');
  });
});
