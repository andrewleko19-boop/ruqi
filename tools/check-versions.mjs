// tools/check-versions.mjs
//
// Validates the Service Worker cache version in sw.js.
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
// Exit codes: 0 = valid, 1 = missing or malformed cache version

import { readFileSync } from 'node:fs';

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
