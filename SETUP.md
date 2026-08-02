# CI/CD Setup

This document covers the **one-time manual steps** to wire up the GitHub Actions workflows. After this, every push runs CI automatically and every push to `main` auto-deploys the whole site (landing page + all four portals).

## 1. Enable GitHub Pages with Actions as the source

GitHub Pages defaults to "Deploy from a branch" but our workflow uses the modern "GitHub Actions" mode.

1. Go to your repo → **Settings** → **Pages** (left sidebar)
2. Under **Build and deployment** → **Source**, choose: **GitHub Actions**
3. Save. (No branch selection needed — the workflow handles it.)

Without this step, the deploy workflow will fail with a confusing `Get Pages site failed` error.

## 2. Run `npm install` once locally and commit `package-lock.json`

The CI workflows use `npm ci` for reproducible installs, which **requires** a committed lockfile.

```bash
# In your repo root
npm install
git add package.json package-lock.json
git commit -m "chore: add CI tooling"
```

## 3. (Optional) Set up Lighthouse CI GitHub App for PR comments

Without this, Lighthouse reports save as workflow artifacts only. With it, scores show up as inline PR comments.

1. Visit https://github.com/apps/lighthouse-ci → **Install**
2. Pick this repo
3. After install, you'll get a token — copy it
4. Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name: `LHCI_GITHUB_APP_TOKEN`
   - Value: (the token)

If you skip this, everything still works — you'll just download reports from the workflow run page instead of seeing them inline on PRs.

## 4. (Recommended) Branch protection on `main`

This is what makes CI actually mean something. Without protection, a force push bypasses every check.

1. Repo → **Settings** → **Branches** → **Add branch protection rule**
2. **Branch name pattern**: `main`
3. Check:
   - ☑ **Require a pull request before merging**
   - ☑ **Require status checks to pass before merging**
     - Add the required check: `Validate HTML / JS / versions`
   - ☑ **Require linear history** (optional but recommended)
4. Save

## 5. Verify the pipeline works

Make a trivial change (e.g., a comment in a page), commit, push to a new branch, open a PR. You should see:

- ✓ **CI** workflow runs and passes (or fails clearly if there's a real issue)
- ✓ **Lighthouse** workflow runs (slower, ~90s)
- After merge → **Deploy** workflow runs and updates the live site

## Local development — run the same checks before pushing

```bash
npm run check          # All validation in one shot
npm run check:js       # JS syntax (all pages + shared/db.js + each role script.js)
npm run check:html     # HTML structure (all five pages)
npm run check:versions # Service Worker cache-version (ruqi-v<number>) sanity
npm run check:manifest # PWA manifest sanity
npm run lighthouse     # Full Lighthouse audit (needs Chrome installed)
```

If `npm run check` passes locally, CI will pass. If it doesn't, fix it locally — saves a roundtrip.

## Troubleshooting

**"Resource not accessible by integration" on deploy**
→ Step 1 wasn't done. Switch Pages source to "GitHub Actions".

**`npm ci` fails with "package-lock.json not found"**
→ Step 2 wasn't done. Run `npm install` locally and commit the lockfile.

**Lighthouse score is wildly different between runs**
→ Normal. CI hardware varies. That's why budgets are lenient and we run 3 times. If it's consistently below threshold, there's a real regression.

**Deploy ran but the site shows old content**
→ Almost always: you forgot to bump `CACHE` in `sw.js` (`ruqi-v1` → `ruqi-v2`, …). The `check:versions` job enforces the format, but it can't know you *meant* to bump it.
→ Hard refresh on the user side: DevTools → Application → Service Workers → Unregister, then reload.
