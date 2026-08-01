// tools/check-js-syntax.mjs
//
// Syntax-checks every piece of JavaScript NSAMS ships:
//   1. Each standalone module — shared/db.js and every <role>/script.js
//   2. Every inline <script> block in the HTML pages (root + role folders),
//      skipping external src= references.
// Each candidate is run through `node --check` (parse, don't execute).
//
// Why this matters: a typo in shared/db.js silently breaks ALL four role
// portals at parse time; a typo in one role's script.js breaks that portal.
// Catching pure-syntax errors in CI saves the "deployed, white screen,
// frantic git revert" cycle.
//
// We deliberately use Node's parser (modern, permissive) rather than a lint
// tool. The goal is "is this parseable JavaScript?", not style. `node --check`
// validates `import`/`export` syntax fine and never resolves the imports, so
// the esm.sh / CDN imports in shared/db.js are a non-issue.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Standalone JS modules the app loads directly.
const JS_FILES = [
  'shared/db.js',
  'shared/import-parser.js',
  'shared/sw-register.js',
  'school/script.js',
  'directorate/script.js',
  'directorate/school.js',
  'ministry/script.js',
  'teacher/script.js',
  'parent/script.js',
  'admin/script.js',
  'verify.js',
];

// HTML pages that might carry inline <script> blocks.
const HTML_FILES = [
  'index.html',
  'verify.html',
  'school/index.html',
  'directorate/index.html',
  'directorate/school.html',
  'ministry/index.html',
  'teacher/index.html',
  'parent/index.html',
  'admin/index.html',
];

// Match <script>...</script> blocks but skip ones with src="..." (external).
// The (?![^>]*\bsrc=) negative lookahead handles `<script src="...">` and
// `<script type="..." src="...">` alike.
const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

const tmp = join(tmpdir(), `nsams-syntax-check-${process.pid}`);
mkdirSync(tmp, { recursive: true });

let checked = 0;
let failed = 0;
let fileIdx = 0;

function checkSource(body, label) {
  // An empty / whitespace-only block has no syntax to check.
  if (!body.trim()) return;
  const file = join(tmp, `chunk-${fileIdx++}.mjs`);
  writeFileSync(file, body);
  checked++;
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    console.log(`${GREEN}✓${RESET} ${label} ${DIM}— ${body.length.toLocaleString()} chars${RESET}`);
  } catch (err) {
    failed++;
    console.error(`${RED}✗ ${label} — syntax error:${RESET}`);
    console.error(err.stderr?.toString() || err.message);
  }
}

// 1. Standalone modules.
for (const path of JS_FILES) {
  if (!existsSync(path)) {
    console.error(`${RED}✗ Expected JS file missing: ${path}${RESET}`);
    failed++;
    continue;
  }
  checkSource(readFileSync(path, 'utf8'), path);
}

// 2. Inline scripts inside the HTML pages.
for (const path of HTML_FILES) {
  if (!existsSync(path)) continue; // not every page is required to exist
  const html = readFileSync(path, 'utf8');
  let m;
  let n = 0;
  while ((m = scriptRegex.exec(html)) !== null) {
    const startLine = html.slice(0, m.index).split('\n').length;
    checkSource(m[1], `${path} inline script #${++n} (~line ${startLine})`);
  }
}

// Clean up temp files even if checks failed.
rmSync(tmp, { recursive: true, force: true });

if (checked === 0) {
  console.error(`${RED}✗ No JavaScript found to check — did the file layout change?${RESET}`);
  process.exit(1);
}

if (failed > 0) {
  console.error(`\n${RED}${failed} JavaScript chunk(s) failed syntax check${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}All ${checked} JavaScript chunk(s) parse cleanly${RESET}`);
