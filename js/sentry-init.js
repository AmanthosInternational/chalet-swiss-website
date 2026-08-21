/**
 * Sentry browser telemetry — Chalet Swiss (chalet-swiss.ch)
 *
 * Loaded from the CDN bundle rather than the Loader script: the org lives in
 * Sentry's EU region, and keeping the whole configuration here means sampling
 * rates and privacy settings are reviewable in git instead of hidden behind a
 * dashboard toggle. The bundle is pinned to an exact version and guarded by an
 * SRI hash, so a compromised CDN cannot execute anything on these pages.
 *
 * Both script tags are `defer`, and this file is ordered before the site's own
 * scripts. Deferred scripts run in document order, so Sentry is initialised
 * before app.js/booking.js and catches their errors, without blocking render.
 */
(function () {
  // The bundle is blocked by common ad blockers. Without this guard that turns
  // into a ReferenceError on every such visit — noise in the console of exactly
  // the users we cannot observe anyway.
  if (typeof Sentry === 'undefined') return;

  Sentry.init({
    dsn: 'https://c5f1b0cf21d01775546c75296b8e51d2@o4511372064915456.ingest.de.sentry.io/4511927219257424',
    environment: 'production',

    // No IP addresses, no cookies, no request bodies. Guest data must not leave
    // the browser; the point of this instrumentation is broken code, not people.
    sendDefaultPii: false,

    integrations: [
      Sentry.browserTracingIntegration(),
    ],

    // Core Web Vitals and page load timings. 10% is enough to see trends on a
    // marketing site and keeps well inside the org's event quota.
    tracesSampleRate: 0.1,

    // DELIBERATELY EMPTY — do not add the API hosts here without changing them
    // first. Trace propagation adds `sentry-trace` and `baggage` headers to
    // outgoing requests. Measured 2026-08-17: the booking API answers the CORS
    // preflight with `Access-Control-Allow-Headers: Content-Type, X-API-Key,
    // Authorization`. Neither header is on that list, so the browser would
    // reject the preflight and the availability call would fail — the booking
    // funnel would break to gain a trace. Connecting browser and backend traces
    // requires allowing both headers server-side first.
    tracePropagationTargets: [],

    // Record a replay only when something actually broke: no blanket recording
    // of every visitor, and the material that matters (what the guest did
    // before the booking failed) is still captured. Raise the session rate only
    // together with the cookie banner and the privacy policy.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    // Noise that is not our code and cannot be fixed by us. Left unfiltered,
    // these bury the real errors — the same failure mode that made 559 of 673
    // events in this org a single client disconnect (fixed 2026-08-17).
    ignoreErrors: [
      // Benign browser layout notice, fires on healthy pages.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Browser extensions and injected scripts.
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      // Network hiccups on the visitor's side, not a defect of the site.
      'Failed to fetch',
      'NetworkError when attempting to fetch resource',
      'Load failed',
      // Safari/iOS quirks with no actionable stack.
      'Non-Error promise rejection captured',
    ],

    denyUrls: [
      // Third-party tags: their errors belong to their owners, not to us.
      /googletagmanager\.com/,
      /google-analytics\.com/,
      /gstatic\.com/,
      /extensions\//,
      /^chrome:\/\//,
    ],
  });

  // Which of the four sites an event came from, without relying on the URL.
  Sentry.setTag('site', 'chalet-swiss-website');

  // Replay only pays off on the booking funnel (analysing abandoned bookings),
  // and it is not cheap: the CDN serves replay.min.js uncompressed, 153'207
  // bytes on the wire — measured 2026-08-21, the chunk is not gzipped no matter
  // what Accept-Encoding asks for. It therefore loads on the first interaction
  // with the booking bar, not on every page view. Dropping it out of the bundle
  // takes every page view from 87 KB to 49 KB gzip.
  var replayArmed = false;
  function armReplay() {
    if (replayArmed) return;
    replayArmed = true;
    // The tracing bundle exports a no-op replayIntegration() stub that warns and
    // does nothing. lazyLoadIntegration() hands back an already present export
    // unless it is flagged `_isShim`, and in 10.68.0 only the feedback stub
    // carries that flag — measured 2026-08-21: without the line below the loader
    // returns the stub and replay.min.js is never fetched. Flagging it makes the
    // loader fetch the chunk; the stub stays as the fallback if that fetch fails.
    if (typeof Sentry.replayIntegration === 'function') {
      Sentry.replayIntegration._isShim = true;
    }
    Sentry.lazyLoadIntegration('replayIntegration').then(function (replayIntegration) {
      Sentry.addIntegration(replayIntegration({
        // All three default to true — set explicitly so the privacy posture is
        // stated in the file rather than inherited silently.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }));
    }).catch(function () {
      // Ad blocker or network trouble: replay is skipped, error reporting continues.
    });
  }
  var bookingBar = document.getElementById('bookingBar');
  if (bookingBar) {
    ['focusin', 'pointerdown'].forEach(function (t) {
      bookingBar.addEventListener(t, armReplay, { once: true, passive: true });
    });
  }
})();
