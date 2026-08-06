// tools/check-db-imports.mjs
//
// Verifies that every named import from shared/db.js across portal scripts
// has a matching export in db.js.
//
// Why this matters: ES modules resolve imports at link time, before any code
// runs. A named import that db.js doesn't export causes a SyntaxError / link
// failure that breaks the entire portal — window.RUQI_DB never gets set and
// every page function silently fails. This check caught exactly that failure
// when a bad merge reverted db.js while keeping newer portal scripts.
//
// Exit codes: 0 = all imports satisfied, 1 = one or more imports are missing

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'shared', 'db.js');

// --- Parse db.js exported names ---

let dbSrc;
try {
  dbSrc = readFileSync(DB_PATH, 'utf8');
} catch (err) {
  console.error(`${RED}✗ Could not read shared/db.js: ${err.message}${RESET}`);
  process.exit(1);
}

const exported = new Set();

// export { localName as exportedName, plain, ... }
for (const m of dbSrc.matchAll(/^export\s*\{([^}]+)\}/mg)) {
  for (const spec of m[1].split(',')) {
    const parts = spec.trim().split(/\s+as\s+/);
    const name = parts.at(-1).trim();
    if (name) exported.add(name);
  }
}

// export const / let / var / function / class / async function name
for (const m of dbSrc.matchAll(/^export\s+(?:const|let|var|function\*?|class|async\s+function\*?)\s+(\w+)/mg)) {
  exported.add(m[1]);
}

// --- Scan portal scripts for imports from shared/db.js ---

const SCRIPTS = [
  'school/script.js',
  'teacher/script.js',
  'directorate/script.js',
  'ministry/script.js',
  'admin/script.js',
  'parent/script.js',
  'verify.js',
];

// Matches both '../shared/db.js' (portal subfolders) and './shared/db.js' (root)
// [^}]+ naturally spans newlines so multi-line imports work too.
const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*shared\/db\.js['"]/g;

let errors   = 0;
const checked = [];

for (const rel of SCRIPTS) {
  let src;
  try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }

  const matches = [...src.matchAll(IMPORT_RE)];
  if (matches.length === 0) continue;

  checked.push(rel);
  for (const m of matches) {
    for (const spec of m[1].split(',')) {
      // "supabase as _sb"  →  the imported (external) name is the first token
      const imported = spec.trim().split(/\s+as\s+/)[0].trim();
      if (!imported) continue;
      if (!exported.has(imported)) {
        console.error(`${RED}✗  ${rel}: imports '${imported}' — db.js has no matching export${RESET}`);
        errors++;
      }
    }
  }
}

if (errors === 0) {
  const list = checked.length ? checked.join(', ') : '(none found)';
  console.log(`${GREEN}✓ All db.js named imports are satisfied (checked: ${list})${RESET}`);
} else {
  console.error(`\n${RED}${errors} missing export(s). Ensure db.js exports every name before merging.${RESET}`);
  process.exit(1);
}
