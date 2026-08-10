// tests/helpers/load-classic.mjs
//
// Loads a classic (non-ESM) browser script into a throwaway `window` object so
// Node can test it.
//
// Ruqi's shared scripts (import-parser.js, qr.js) are deliberately classic
// scripts wrapped in an IIFE that assigns to `window.*` — they are loaded with a
// plain <script> tag by pages that also run without a bundler. Converting them
// to ES modules just to make them testable would change how every page loads
// them, so instead the test harness supplies the one global they expect.
//
// The script body is evaluated with `new Function`, which runs it in global
// scope with `window` bound to the object we hand back. Anything the script
// touches lazily (document, fetch, ExcelJS) is only reached inside functions,
// so it is never evaluated at load time.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {string} relPath  Path to the script, relative to the repo root.
 * @param {object} [globals] Extra globals to expose (e.g. a fake `document`).
 * @returns {object} The populated `window` object.
 */
export function loadClassicScript(relPath, globals = {}) {
  const src = readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
  const window = { ...globals };
  const names = ['window', ...Object.keys(globals)];
  const values = [window, ...Object.keys(globals).map((k) => globals[k])];
  new Function(...names, src)(...values);
  return window;
}

/** Convenience: load shared/import-parser.js and return its public API. */
export function loadImportParser() {
  const win = loadClassicScript('shared/import-parser.js');
  if (!win.RUQI_ImportParser) {
    throw new Error('shared/import-parser.js did not define window.RUQI_ImportParser');
  }
  return win.RUQI_ImportParser;
}
