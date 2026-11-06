import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const pkg = JSON.parse(read('package.json')) as { version: string };
const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
  productName: string;
  version: string;
  identifier: string;
  app: { security: { csp: string | null; devCsp: string | null } };
  bundle: {
    targets: string[];
    icon: string[];
    fileAssociations: { ext: string[]; name: string; mimeType: string; role: string }[];
    resources?: Record<string, string>;
    windows: { webviewInstallMode: { type: string }; nsis: { installMode: string; installerHooks?: string } };
  };
};
const cargo = read('src-tauri/Cargo.toml');
const hooks = read('src-tauri/installer-hooks.nsh');
const comRs = read('src-tauri/thumbnail/src/com.rs');
const buildRs = read('src-tauri/build.rs');

describe('versions', () => {
  it('package.json, tauri.conf.json and Cargo.toml agree (the About dialog and installer use them)', () => {
    const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
    expect(conf.version).toBe(pkg.version);
    expect(cargoVersion).toBe(pkg.version);
  });

  it('is a proper semantic version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('bundle', () => {
  it('does not use an identifier ending in .app (a macOS bundle extension)', () => {
    expect(conf.identifier).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    expect(conf.identifier.endsWith('.app')).toBe(false);
  });

  it('builds a per-user NSIS installer that needs no administrator rights', () => {
    expect(conf.bundle.targets).toEqual(['nsis']);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  it('adds the app to "Open with" for PDF files', () => {
    const assoc = conf.bundle.fileAssociations.find((a) => a.ext.includes('pdf'));
    expect(assoc).toBeDefined();
    expect(assoc!.mimeType).toBe('application/pdf');
  });

  it('uses a specific ProgID for the file type, not a generic name that other apps might share', () => {
    const name = conf.bundle.fileAssociations.find((a) => a.ext.includes('pdf'))!.name;
    expect(name).toMatch(/^[A-Za-z0-9]+(\.[A-Za-z0-9]+)+$/);
  });

  it('installs the WebView2 runtime on demand if it is missing', () => {
    expect(conf.bundle.windows.webviewInstallMode.type).toBe('downloadBootstrapper');
  });

  it('ships an .ico for the executable and installer', () => {
    expect(conf.bundle.icon).toContain('icons/icon.ico');
  });
});

describe('content security policy', () => {
  const csp = conf.app.security.csp ?? '';
  const directive = (name: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(name + ' '));

  it('is set for release builds (the app opens untrusted files)', () => {
    expect(conf.app.security.csp).toBeTruthy();
  });

  it('allows no eval and no remote scripts', () => {
    const script = directive('script-src')!;
    expect(script).toBeDefined();
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toMatch(/https?:/);
  });

  it('allows the WebAssembly decoders PDF.js uses, but only that', () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'");
  });

  it('blocks plugins and remote content by default', () => {
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(csp).not.toMatch(/\*/);
  });

  it('lets the annotation worker and PDF.js worker start', () => {
    expect(directive('worker-src')).toContain("'self'");
  });

  it('stays off in dev, where the Vite server needs inline scripts and a websocket', () => {
    expect(conf.app.security.devCsp).toBeNull();
  });
});

describe('release profile', () => {
  it('optimises for size', () => {
    expect(cargo).toMatch(/\[profile\.release\][\s\S]*lto\s*=\s*true/);
    expect(cargo).toMatch(/strip\s*=\s*true/);
  });
});

// Tauri's generated installer makes the app the class default for .pdf and its uninstaller restores
// from a backup value. The hooks undo the first and keep the second safe; this pins that behaviour.
describe('installer hooks (the app must not take over as the default PDF app)', () => {
  const progId = conf.bundle.fileAssociations.find((a) => a.ext.includes('pdf'))!.name;

  it('are wired into the NSIS bundle', () => {
    expect(conf.bundle.windows.nsis.installerHooks).toBe('installer-hooks.nsh');
  });

  it('use the same ProgID as the file association', () => {
    expect(hooks).toContain(`${progId}_backup`);
    expect(hooks).toContain(`"${progId}"`);
  });

  it('restore the previous class default after installing, and register under Open with', () => {
    const post = /!macro NSIS_HOOK_POSTINSTALL([\s\S]*?)!macroend/.exec(hooks)![1];
    expect(post).toMatch(/ReadRegStr \$0 SHCTX "Software\\Classes\\\.pdf" ".*_backup"/);
    expect(post).toContain('OpenWithProgids');
  });

  it('protect another app\'s default when uninstalling', () => {
    expect(hooks).toMatch(/!macro NSIS_HOOK_PREUNINSTALL/);
    expect(hooks).toMatch(/!macro NSIS_HOOK_POSTUNINSTALL/);
  });
});

describe('Explorer thumbnails (first page of a PDF as its icon)', () => {
  /** "{8E1CF62A-63CC-...}" built from the u128 literal in the Rust source. */
  const rustClsid = (() => {
    const hex = /GUID::from_u128\(0x([0-9A-Fa-f_]+)\)/.exec(comRs)![1].replace(/_/g, '').toUpperCase();
    return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
  })();

  it('registers the same CLSID that the DLL implements (a mismatch would silently disable thumbnails)', () => {
    const defined = /!define PDF_THUMB_CLSID "(\{[0-9A-F-]+\})"/.exec(hooks)![1];
    expect(defined).toBe(rustClsid);
  });

  it('bundles the provider DLL into the installer', () => {
    expect(Object.values(conf.bundle.resources ?? {})).toContain('pdf_reader_thumbnail.dll');
  });

  it('builds that DLL as part of the normal build', () => {
    expect(buildRs).toContain('pdf_reader_thumbnail.dll');
    expect(buildRs).toContain('--target-dir'); // its own target dir: sharing ours would deadlock on cargo's lock
  });

  it('points the registration at the installed DLL', () => {
    expect(hooks).toContain('InprocServer32');
    expect(hooks).toContain('$INSTDIR\\pdf_reader_thumbnail.dll');
    expect(hooks).toContain('"ThreadingModel" "Both"');
  });

  it('registers for the .pdf type only when no other thumbnail handler exists', () => {
    expect(hooks).toMatch(/ReadRegStr \$1 HKCR "\.pdf\\ShellEx\\\$\{SHELL_THUMB_HANDLER\}" ""\s+\$\{If\} \$1 == ""/);
  });

  it('on uninstall removes the .pdf registration only if it is ours', () => {
    expect(hooks).toMatch(/\$\{If\} \$1 == "\$\{PDF_THUMB_CLSID\}"/);
  });

  it('uses the standard shell thumbnail-handler key', () => {
    expect(hooks).toContain('{E357FCCD-A995-4576-B01F-234630154E96}');
  });

  it('tells Explorer to refresh, and frees the DLL so it can be replaced or deleted', () => {
    expect(hooks).toContain('SHChangeNotify');
    expect(hooks).toContain('PDFREADER_RELEASE_THUMBNAIL_DLL');
  });
});
