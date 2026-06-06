#!/usr/bin/env bash
# apply-sentry.sh — adds Sentry error tracking to NSAMS
#
# NSAMS is multi-page (a landing page + four portals), so this inserts the
# Sentry SDK loader + config into the <head> of EVERY page. Each portal gets
# its own initialization; they all report to the same project.
#
# What this does:
#   1. Inserts a Sentry SDK loader + init block before </head> on each page
#   2. Adds a README section about Sentry
#   3. Runs `npm run check` to verify nothing broke
#
# Before you run it: set your own DSN below (or edit the pages afterwards).
# The DSN is public-by-design — it only allows POSTING events to your project.
#
# NOTE on CSP: the NSAMS pages don't ship a Content-Security-Policy <meta> tag.
# If you add one later, remember to allow:
#   script-src  https://browser.sentry-cdn.com
#   connect-src https://*.sentry.io https://*.ingest.de.sentry.io

set -e

# ── Configure me ─────────────────────────────────────────────────────────────
SENTRY_DSN="YOUR_SENTRY_DSN"   # e.g. https://<key>@<org>.ingest.de.sentry.io/<project>
SENTRY_SDK="https://browser.sentry-cdn.com/8.45.0/bundle.min.js"
# ─────────────────────────────────────────────────────────────────────────────

PAGES=(index.html school/index.html directorate/index.html ministry/index.html teacher/index.html)

echo
echo "============================================"
echo " NSAMS — installing Sentry"
echo "============================================"
echo

if [ ! -f "index.html" ] || [ ! -f "sw.js" ]; then
  echo "ERROR: Run this from the nsams folder."
  exit 1
fi

if [ "$SENTRY_DSN" = "YOUR_SENTRY_DSN" ]; then
  echo "⚠️  SENTRY_DSN is still the placeholder. Edit this script and set your DSN,"
  echo "    or replace it in the pages after running. Continuing anyway."
  echo
fi

# Build the snippet once, substituting the DSN + SDK URL.
build_snippet() {
  cat <<SENTRY_EOF

<!--
  ════════════════════════════════════════════════════════════════════════════
   SENTRY ERROR TRACKING
  ════════════════════════════════════════════════════════════════════════════
   Loads Sentry's browser SDK from CDN and initializes it for this portal.
   PII handling: the beforeSend hook scrubs emails and auth tokens before
   sending. Stack traces and device info are kept.
   The DSN is public-by-design — it only allows POSTING events to your project.
-->
<script src="${SENTRY_SDK}" crossorigin="anonymous" defer></script>
<script>
  (function waitForSentry(attempts) {
    if (typeof Sentry !== 'undefined' && Sentry.init) { initSentry(); return; }
    if (attempts > 50) { console.warn('[Sentry] SDK failed to load; error tracking disabled.'); return; }
    setTimeout(function () { waitForSentry(attempts + 1); }, 100);
  })(0);

  function initSentry() {
    Sentry.init({
      dsn: '${SENTRY_DSN}',
      release: typeof window.NSAMS_VERSION !== 'undefined' ? window.NSAMS_VERSION : 'unknown',
      environment: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'development' : 'production',
      sampleRate: 1.0,
      tracesSampleRate: 0,
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'Non-Error promise rejection captured',
        'Network request failed',
        'Failed to fetch',
        'Load failed',
        'AbortError',
      ],
      beforeSend: function (event) {
        try {
          if (event.request && event.request.url && event.request.url.indexOf('localhost') !== -1) return null;
          if (event.request && event.request.url) {
            event.request.url = event.request.url
              .replace(/([?&#])access_token=[^&]*/g, '\$1access_token=[REDACTED]')
              .replace(/([?&#])refresh_token=[^&]*/g, '\$1refresh_token=[REDACTED]');
          }
          var emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
          if (event.message) event.message = event.message.replace(emailRegex, '[EMAIL]');
          if (event.exception && event.exception.values) {
            event.exception.values.forEach(function (ex) {
              if (ex.value) ex.value = ex.value.replace(emailRegex, '[EMAIL]');
            });
          }
          return event;
        } catch (err) {
          console.warn('[Sentry] beforeSend hook failed:', err);
          return event;
        }
      },
    });
    window.__SENTRY_INITIALIZED__ = true;
  }
</script>
<!-- ══════════════════════════════════════════════════════════════════════ -->
SENTRY_EOF
}

echo "[1/2] Inserting Sentry block into each page..."
for page in "${PAGES[@]}"; do
  if [ ! -f "$page" ]; then
    echo "    - $page not found, skipping."
    continue
  fi
  if grep -q "SENTRY ERROR TRACKING" "$page"; then
    echo "    - $page already has Sentry, skipping."
    continue
  fi
  if ! grep -q "</head>" "$page"; then
    echo "    - $page has no </head>, skipping (insert manually)."
    continue
  fi

  build_snippet > /tmp/nsams-sentry-snippet.html

  # Insert the snippet right before the first </head>.
  awk '
    /<\/head>/ && !inserted {
      while ((getline line < "/tmp/nsams-sentry-snippet.html") > 0) print line
      close("/tmp/nsams-sentry-snippet.html")
      inserted = 1
    }
    { print }
  ' "$page" > "$page.new" && mv "$page.new" "$page"

  rm -f /tmp/nsams-sentry-snippet.html
  echo "    + $page"
done
echo "    done."

# Update README with a Sentry section (before the License heading).
echo "[2/2] Adding Sentry section to README..."
if grep -q "## 📊 Error tracking" README.md 2>/dev/null; then
  echo "    README already documents Sentry — skipping."
elif grep -q "^## 📄 License" README.md 2>/dev/null; then
  awk '
    /^## 📄 License/ && !inserted {
      print "## 📊 Error tracking"
      print ""
      print "Production errors are tracked via [Sentry](https://sentry.io). The SDK loads from CDN on every portal, scrubs PII (emails, auth tokens) before sending, and runs at 100% sample rate."
      print ""
      print "If you fork this repo, set your own DSN (search for \"Sentry.init\" in the pages, or re-run \`apply-sentry.sh\`). The DSN is safe to commit — it is public-by-design."
      print ""
      inserted = 1
    }
    { print }
  ' README.md > README.md.new && mv README.md.new README.md
  echo "    done."
else
  echo "    WARN: License heading not found in README; skipping README update."
fi

echo
echo "Running checks to verify nothing broke..."
echo
npm run check
echo

echo "============================================"
echo " ✓ Sentry installed across all pages."
echo "============================================"
echo
echo " Now commit and push:"
echo "   git add -A"
echo "   git commit -m 'feat(observability): add Sentry error tracking'"
echo "   git push origin main"
echo
