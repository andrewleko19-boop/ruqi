// tools/check-versions.mjs
//
// Validates two pinned version tokens:
//   1. the Service Worker cache version in sw.js
//   2. the Supabase CLI version used by the deploy workflows
//
// Reason: the SW caches the app shell (root + teacher + shared/db.js). If the
// cache key in sw.js doesn't change between releases, the Service Worker keeps
// serving stale cached files — including a stale shell — and returning users
// get the OLD app for days. Bumping `CACHE` on every deploy is what purges old
// caches on activate.
//
// Unlike a single-file app, Ruqi has no single APP_VERSION constant to keep in
// lockstep — the only version token is `const CACHE = 'ruqi-vN'` in sw.js. So
// this check just enforces that the token exists and follows the expected
// `ruqi-v<number>` shape (a malformed key is the actual failure mode we hit).
//
// For the CLI pin: `version: latest` makes every deploy fetch whatever Supabase
// released most recently, so a breaking CLI release stops deployments with no
// change in this repo — an expensive failure to diagnose because the code is
// fine. The workflows therefore pin an explicit version, and this check enforces
// that they stay pinned AND agree with each other (a migrations run and a
// functions run on different CLI builds is a silent source of drift).
//
// Exit codes: 0 = valid, 1 = missing or malformed version token

import { readFileSync, readdirSync } from 'node:fs';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`${RED}✗ Could not read ${path}: ${err.message}${RESET}`);
    process.exit(1);
  }
}

const swJs = readText('sw.js');

// Parse: const CACHE = 'ruqi-v1';   (single OR double quotes, any whitespace)
const match = swJs.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
if (!match) {
  console.error(`${RED}✗ CACHE constant not found in sw.js${RESET}`);
  console.error(`  Expected a line like: const CACHE = 'ruqi-v1';`);
  process.exit(1);
}

const cache = match[1];
if (!/^ruqi-v\d+$/.test(cache)) {
  console.error(`${RED}✗ CACHE = '${cache}' does not match the expected pattern${RESET}`);
  console.error(`  Use 'ruqi-v<number>' (e.g. ruqi-v2) and bump it on every deploy,`);
  console.error(`  otherwise the Service Worker won't invalidate its cache and`);
  console.error(`  returning users will see the old app indefinitely.`);
  process.exit(1);
}

console.log(`${GREEN}✓ Service Worker cache version OK: ${cache}${RESET}`);

// ---------------------------------------------------------------------------
// Supabase CLI pin in the deploy workflows
// ---------------------------------------------------------------------------

const WORKFLOW_DIR = '.github/workflows';

// Returns [{ file, line, version }] for every supabase/setup-cli step found.
// The `version:` key is looked up in the lines following the `uses:` line,
// stopping at the next list item so a later step's key is never misread.
function findSetupCliPins() {
  const pins = [];
  for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const path = `${WORKFLOW_DIR}/${file}`;
    const lines = readText(path).split('\n');
    lines.forEach((line, i) => {
      if (!/^\s*-?\s*uses:\s*supabase\/setup-cli@/.test(line)) return;
      const usesIndent = line.search(/\S/);
      let version = null;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!next.trim() || /^\s*#/.test(next)) continue;
        // A new list item at or above the `uses:` indent ends this step.
        if (next.search(/\S/) <= usesIndent && /^\s*-\s/.test(next)) break;
        const m = next.match(/^\s*version:\s*['"]?([^'"#\s]+)/);
        if (m) { version = m[1]; break; }
      }
      pins.push({ file: path, line: i + 1, version });
    });
  }
  return pins;
}

const pins = findSetupCliPins();

if (pins.length === 0) {
  console.error(`${RED}✗ No supabase/setup-cli step found under ${WORKFLOW_DIR}${RESET}`);
  console.error(`  The deploy workflows are expected to install the Supabase CLI.`);
  console.error(`  If a workflow was intentionally removed, update this check too.`);
  process.exit(1);
}

const unpinned = pins.filter((p) => p.version === null || /^(latest|beta)$/.test(p.version));
if (unpinned.length) {
  console.error(`${RED}✗ Supabase CLI version is not pinned${RESET}`);
  for (const p of unpinned) {
    console.error(`  ${p.file}:${p.line} → version: ${p.version ?? '(missing)'}`);
  }
  console.error(`  Use an explicit version (e.g. version: 2.113.0). With 'latest'`);
  console.error(`  a breaking Supabase CLI release halts deploys even though nothing`);
  console.error(`  in this repo changed, and the cause is not visible in the diff.`);
  process.exit(1);
}

const distinct = [...new Set(pins.map((p) => p.version))];
if (distinct.length > 1) {
  console.error(`${RED}✗ Supabase CLI version differs between workflows: ${distinct.join(', ')}${RESET}`);
  for (const p of pins) console.error(`  ${p.file}:${p.line} → version: ${p.version}`);
  console.error(`  Pin every workflow to the same version so migrations and functions`);
  console.error(`  are always deployed by the same CLI build.`);
  process.exit(1);
}

console.log(`${GREEN}✓ Supabase CLI pinned consistently: ${distinct[0]} (${pins.length} workflow steps)${RESET}`);
