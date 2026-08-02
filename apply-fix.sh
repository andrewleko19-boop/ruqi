#!/usr/bin/env bash
# apply-fix.sh — re-applies Ruqi's canonical CI configuration
#
# Run this from the ruqi folder. It rewrites the CI-related files to their
# known-good state and re-verifies, which is handy after a messy merge or when
# bringing an old copy of the repo back in line. It will:
#   1. Rewrite package.json
#   2. Rewrite .github/workflows/ci.yml
#   3. Rewrite .github/workflows/deploy.yml
#   4. Reinstall deps and regenerate package-lock.json
#   5. Run `npm run check` to verify everything passes
#
# It is idempotent — running it twice produces the same result. It does NOT
# touch the app itself (the portals, sw.js, manifest.json, shared/db.js).

set -e  # exit on first error

echo
echo "============================================"
echo " Ruqi — applying canonical CI config"
echo "============================================"
echo

# Verify we're in the right folder
if [ ! -f "index.html" ] || [ ! -f "sw.js" ]; then
  echo "ERROR: Run this from the ruqi folder."
  exit 1
fi

mkdir -p .github/workflows tools

# 1. package.json
echo "[1/5] Updating package.json..."
cat > package.json <<'PKG_EOF'
{
  "name": "ruqi",
  "version": "1.0.0",
  "private": true,
  "description": "Offline-first multi-page PWA for national school-attendance tracking (school / directorate / ministry / teacher). CI tooling lives here; the app itself is the static HTML/JS in each role folder.",
  "scripts": {
    "check": "npm run check:js && npm run check:html && npm run check:versions && npm run check:manifest",
    "check:js": "node tools/check-js-syntax.mjs",
    "check:html": "html-validate index.html school/index.html directorate/index.html ministry/index.html teacher/index.html",
    "check:versions": "node tools/check-versions.mjs",
    "check:manifest": "node tools/check-manifest.mjs",
    "serve": "npx serve . -l 8000",
    "lighthouse": "lhci autorun"
  },
  "devDependencies": {
    "@lhci/cli": "^0.13.0",
    "html-validate": "^8.18.0"
  },
  "engines": {
    "node": ">=20"
  }
}
PKG_EOF
echo "    done."

# 2. ci.yml
echo "[2/5] Updating .github/workflows/ci.yml..."
cat > .github/workflows/ci.yml <<'CI_EOF'
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    name: Validate HTML / JS / versions
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dev tooling
        run: npm ci --no-audit --no-fund

      - name: JS syntax check (all pages + modules)
        run: node tools/check-js-syntax.mjs

      - name: HTML validation (all pages)
        run: npm run check:html

      - name: Cache-version check
        run: node tools/check-versions.mjs

      - name: Manifest sanity
        run: node tools/check-manifest.mjs
CI_EOF
echo "    done."

# 3. deploy.yml
echo "[3/5] Updating .github/workflows/deploy.yml..."
cat > .github/workflows/deploy.yml <<'DEPLOY_EOF'
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  validate:
    name: Re-validate before deploy
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci --no-audit --no-fund
      - run: node tools/check-js-syntax.mjs
      - run: npm run check:html
      - run: node tools/check-versions.mjs
      - run: node tools/check-manifest.mjs

  deploy:
    name: Deploy to GitHub Pages
    needs: validate
    runs-on: ubuntu-latest
    timeout-minutes: 5
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v4
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
DEPLOY_EOF
echo "    done."

# 4. clean install (regenerate lockfile)
echo "[4/5] Reinstalling deps + regenerating package-lock.json..."
echo "    (this takes 1-2 minutes)"
rm -rf node_modules
rm -f package-lock.json
npm install --no-audit --no-fund 2>&1 | tail -3

# 5. verify
echo
echo "[5/5] Running checks to verify..."
echo
npm run check
echo

echo "============================================"
echo " ✓ All checks pass — ready to commit & push"
echo "============================================"
echo
echo "Run these to push:"
echo "  git add -A"
echo "  git commit -m 'chore(ci): refresh pipeline config'"
echo "  git push origin main"
echo
