module.exports = {
  ci: {
    collect: {
      // Spin up `npx serve` on port 8000, run Lighthouse against the landing page.
      startServerCommand: 'npx serve . -l 8000',
      startServerReadyPattern: 'Accepting connections',
      url: ['http://localhost:8000/'],
      // 3 runs, take the median. Reduces variance from shared CI hardware.
      numberOfRuns: 3,
      settings: {
        // Simulate a mid-tier phone — closer to the actual field devices
        // (teachers / school staff on low-to-mid-range Android) than the
        // default desktop preset would be.
        preset: 'mobile',
        // Skip the "is this a 404?" audit since we only test the root URL.
        skipAudits: ['canonical']
      }
    },

    assert: {
      // Budgets are deliberately lenient for v1. Tighten as the app matures.
      // The point right now: catch REGRESSIONS, not enforce perfection.
      assertions: {
        // Performance: anything below 0.85 is a real problem on mobile.
        'categories:performance': ['warn', { minScore: 0.85 }],
        // Accessibility: aim high — easy to fix, cheap to maintain.
        'categories:accessibility': ['warn', { minScore: 0.90 }],
        // Best practices: HTTPS, modern APIs, no console errors.
        'categories:best-practices': ['warn', { minScore: 0.90 }],
        // SEO: meta tags, valid HTML, mobile-friendly.
        'categories:seo': ['warn', { minScore: 0.90 }],

        // Performance leaf metrics — surface the underlying issue when
        // categories:performance fails.
        'first-contentful-paint': ['warn', { maxNumericValue: 2000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 3500 }],
        'total-blocking-time': ['warn', { maxNumericValue: 400 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }]
      }
    },

    upload: {
      // Default: upload to temporary public storage. Reports are accessible
      // from PR comments (if you set up the lhci GitHub App) or as artifacts
      // (always available from the workflow run page).
      target: 'temporary-public-storage'
    }
  }
};
