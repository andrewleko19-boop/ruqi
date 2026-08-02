#!/usr/bin/env bash
# ============================================================
#  Ruqi — One-click GitHub setup (Git Bash version)
# ============================================================
#  This script:
#    1. Initializes git in the current folder
#    2. Adds all files
#    3. Creates one commit
#    4. FORCE-PUSHES to the GitHub repo (replaces whatever's there)
#
#  No clone, no fetch, no pull — purely outbound. This works around
#  ISP throttling that blocks inbound GitHub traffic.
#
#  ⚠️  THIS WILL OVERWRITE the GitHub repo with the local files.
#      Make sure the local folder has everything you want.
# ============================================================

set -e  # exit on first error

echo
echo "============================================"
echo " Ruqi — pushing to GitHub"
echo "============================================"
echo

# Verify we're in the right folder
if [ ! -f "index.html" ] || [ ! -f "sw.js" ]; then
  echo "ERROR: index.html or sw.js not found."
  echo "Run this script from the ruqi folder."
  exit 1
fi

# Network tweaks for unstable connections
echo "Configuring git for unstable networks..."
git config --global http.postBuffer 524288000
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999
git config --global http.version HTTP/1.1
echo "  done."
echo

# Initialize git if not already
if [ ! -d ".git" ]; then
  echo "Initializing git repository..."
  git init
  git branch -M main
  echo
fi

# Set/update remote
echo "Setting GitHub remote..."
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/andrewleko19-boop/ruqi.git
echo

# Stage and commit
echo "Staging files..."
git add -A
echo

if git diff --cached --quiet; then
  echo "Nothing to commit. Files are already committed."
else
  echo "Creating commit..."
  if ! git commit -m "chore: full release with CI/CD and PWA setup"; then
    echo
    echo "ERROR: commit failed. Set your git identity first:"
    echo "  git config --global user.name \"Your Name\""
    echo "  git config --global user.email \"you@example.com\""
    exit 1
  fi
fi
echo

# Force push
echo "Pushing to GitHub (force)..."
echo "This sends your local files to GitHub. May take 1-3 minutes."
echo

if ! git push -u origin main --force; then
  echo
  echo "============================================"
  echo " Push FAILED."
  echo "============================================"
  echo " Possible causes:"
  echo "   1. Network: try again, or use mobile hotspot."
  echo "   2. Auth: use a Personal Access Token as password:"
  echo "      https://github.com/settings/tokens"
  echo "   3. Repo doesn't exist:"
  echo "      https://github.com/andrewleko19-boop/ruqi"
  exit 1
fi

echo
echo "============================================"
echo " SUCCESS — pushed to GitHub."
echo "============================================"
echo
echo " Next steps:"
echo "   1. Open https://github.com/andrewleko19-boop/ruqi"
echo "   2. Verify .github/workflows/ folder is visible"
echo "   3. Click 'Actions' tab — first CI run starts automatically"
echo "   4. Settings → Pages → Source: GitHub Actions"
echo
