@echo off
REM ============================================================
REM  Ruqi — One-click GitHub setup
REM ============================================================
REM  This script:
REM    1. Initializes git in the current folder
REM    2. Adds all files
REM    3. Creates one commit
REM    4. FORCE-PUSHES to the GitHub repo (replaces whatever's there)
REM
REM  No clone, no fetch, no pull — purely outbound. This works around
REM  ISP throttling that blocks inbound GitHub traffic.
REM
REM  THIS WILL OVERWRITE the GitHub repo with the local files.
REM      Make sure the local folder has everything you want.
REM ============================================================

echo.
echo ============================================
echo  Ruqi — pushing to GitHub
echo ============================================
echo.

REM Verify we're in the right folder
if not exist "index.html" (
  echo ERROR: index.html not found. Make sure you ran this from the ruqi folder.
  pause
  exit /b 1
)
if not exist "sw.js" (
  echo ERROR: sw.js not found. Make sure you ran this from the ruqi folder.
  pause
  exit /b 1
)

REM Network tweaks for unstable connections
echo Configuring git for unstable networks...
git config --global http.postBuffer 524288000
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999
git config --global http.version HTTP/1.1
echo   done.
echo.

REM Initialize git if not already
if not exist ".git" (
  echo Initializing git repository...
  git init
  git branch -M main
  echo.
)

REM Set/update remote
echo Setting GitHub remote...
git remote remove origin 2>nul
git remote add origin https://github.com/andrewleko19-boop/ruqi.git
echo.

REM Stage and commit
echo Staging files...
git add -A
echo.

REM Check if there's anything to commit
git diff --cached --quiet
if %errorlevel%==0 (
  echo Nothing to commit. Files are already committed.
) else (
  echo Creating commit...
  git commit -m "chore: full release with CI/CD and PWA setup"
  if errorlevel 1 (
    echo.
    echo ERROR: commit failed. You may need to set git identity first:
    echo   git config --global user.name "Your Name"
    echo   git config --global user.email "you@example.com"
    pause
    exit /b 1
  )
)
echo.

REM Force push — overwrites whatever is on GitHub
echo Pushing to GitHub (force)...
echo This sends your local files to GitHub. May take 1-3 minutes.
echo.
git push -u origin main --force

if errorlevel 1 (
  echo.
  echo ============================================
  echo  Push FAILED.
  echo ============================================
  echo  Possible causes:
  echo    1. Network: try again in a moment, or use mobile hotspot.
  echo    2. Auth: GitHub may ask for username/password.
  echo       Use a Personal Access Token as the password:
  echo       https://github.com/settings/tokens
  echo    3. Repo doesn't exist: check it's at
  echo       https://github.com/andrewleko19-boop/ruqi
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  SUCCESS — pushed to GitHub.
echo ============================================
echo.
echo  Next steps:
echo    1. Open https://github.com/andrewleko19-boop/ruqi
echo    2. Verify .github/workflows/ folder is visible
echo    3. Click "Actions" tab — first CI run starts automatically
echo    4. Settings - Pages - Source: GitHub Actions
echo.
pause
