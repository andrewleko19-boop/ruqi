// tools/check-manifest.mjs
//
// Validates manifest.json against the minimum set of fields needed for:
//   - PWA installability on Android Chrome
//   - Splash screen on Android Lollipop+ (uses background_color + icon)
//   - iOS standalone display (uses display + name)
//
// What we check:
//   1. manifest.json parses as JSON
//   2. Required fields exist: name, short_name, start_url, display, icons[]
//   3. icons[] DECLARES both a 192px and a 512px PNG (Android requirement)
//   4. background_color and theme_color are valid hex (#RGB / #RRGGBB / #RRGGBBAA)
//
// What we DON'T check:
//   - That the icon files actually exist on disk. Icon art is added to icons/
//     separately, and the manifest paths are relative ("./icons/..."). Verifying
//     the declarations (not the bytes) keeps CI green while art is in progress;
//     Lighthouse covers real on-disk icon presence.

import { readFileSync } from 'node:fs';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const errors = [];
const warnings = [];

let raw, mf;
try {
  raw = readFileSync('manifest.json', 'utf8');
} catch (err) {
  console.error(`${RED}✗ Could not read manifest.json: ${err.message}${RESET}`);
  process.exit(1);
}

try {
  mf = JSON.parse(raw);
} catch (err) {
  console.error(`${RED}✗ manifest.json is not valid JSON: ${err.message}${RESET}`);
  process.exit(1);
}

// Required fields for PWA installability.
const REQUIRED = ['name', 'short_name', 'start_url', 'display', 'icons'];
for (const field of REQUIRED) {
  if (mf[field] === undefined || mf[field] === '' || (Array.isArray(mf[field]) && mf[field].length === 0)) {
    errors.push(`Missing or empty required field: ${field}`);
  }
}

// Display must be one of the standard values, otherwise Android falls back to browser.
if (mf.display && !['fullscreen', 'standalone', 'minimal-ui', 'browser'].includes(mf.display)) {
  errors.push(`Invalid display value: "${mf.display}" — must be one of fullscreen|standalone|minimal-ui|browser`);
}

// Icons: need 192 AND 512 minimum for Android Chrome to consider the PWA installable.
if (Array.isArray(mf.icons)) {
  const sizes = new Set();
  for (const icon of mf.icons) {
    if (!icon.sizes || !icon.src) {
      errors.push(`icons[] entry missing required src/sizes: ${JSON.stringify(icon)}`);
      continue;
    }
    // sizes can be "192x192" or "192x192 256x256" — split on whitespace.
    for (const size of icon.sizes.split(/\s+/)) {
      sizes.add(size);
    }
  }
  for (const required of ['192x192', '512x512']) {
    if (!sizes.has(required)) {
      errors.push(`icons[] missing required size: ${required}`);
    }
  }
}

// Hex color validation — applies to background_color and theme_color.
const hexRe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
for (const field of ['background_color', 'theme_color']) {
  if (mf[field] !== undefined && !hexRe.test(mf[field])) {
    errors.push(`${field} is not a valid hex color: "${mf[field]}"`);
  }
}

// Warnings: nice-to-haves that don't fail the build.
if (!mf.background_color) {
  warnings.push(`background_color is unset — Android splash will be white, causing a flash before your dark splash loads`);
}
if (!mf.theme_color) {
  warnings.push(`theme_color is unset — status bar won't match your app's color`);
}
if (!mf.description) {
  warnings.push(`description is unset — improves install prompt UX`);
}

// Report.
for (const w of warnings) console.warn(`${YELLOW}⚠ ${w}${RESET}`);

if (errors.length > 0) {
  for (const e of errors) console.error(`${RED}✗ ${e}${RESET}`);
  process.exit(1);
}

console.log(`${GREEN}✓ manifest.json is valid (${mf.icons.length} icon entries, display=${mf.display})${RESET}`);
