/**
 * Accessibility scan of the live site with axe-core.
 *
 * CommonJS on purpose: the workflow installs Playwright and @axe-core/playwright into
 * $RUNNER_TEMP rather than into this repo (no package.json, no lockfile, no node_modules
 * here) and reaches them via NODE_PATH — which ESM ignores but require() honours.
 *
 * Usage:  node axe.cjs <url> [<url> ...]
 * Exit 1 only for serious/critical violations; everything else lands in the job summary,
 * so a minor issue stays visible without blocking the run.
 */
const fs = require('fs');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const BLOCKING = new Set(['serious', 'critical']);

// Tall enough to hold a whole landing page. At the Playwright default of 720px most of
// the page sits below the fold, and axe reports substituted, blended colours for those
// elements instead of the real ones. Measured 21.08.2026 on /solothurn/: the search
// button was reported as 1.37:1 while really being white on #8B6914, i.e. 5.09:1.
const VIEWPORT = { width: 1280, height: 2400 };

// Fade-ins run for 0.6s. Scanning before they finish measures half-transparent elements
// and reports the blended intermediate colours as failures. Same measurement as above.
const SETTLE_MS = 1500;

function summary(line) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, line + '\n');
  console.log(line);
}

/**
 * A page whose stylesheet failed to load looks catastrophically broken to axe: every
 * element falls back to browser defaults and the run reports dozens of contrast errors
 * that say nothing about the real site. That happened on 20.08.2026, when the scan ran
 * while GitHub Pages was still deploying and reported 141 violations on a page that is
 * in fact clean. Better to fail loudly with the real reason than to bury it.
 */
async function stylesheetLoaded(page) {
  return page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.cssRules && sheet.cssRules.length > 0) return true;
      } catch (e) {
        // Cross-origin sheet (fonts): counts as loaded, we just cannot read it.
        if (sheet.href) return true;
      }
    }
    return false;
  });
}

(async () => {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('Keine URL uebergeben.');
    process.exit(2);
  }

  const browser = await chromium.launch();
  let blocking = 0;
  summary('## Barrierefreiheit (axe-core)');

  for (const url of urls) {
    // A fresh context per URL, not one shared across all of them: consent state lives in
    // localStorage, so with a shared context the cookie banner only ever appears on the
    // first page and stays unscanned everywhere else. Every page is checked as a first
    // visit sees it. A context, not browser.newPage(): @axe-core/playwright refuses a
    // page that hangs directly off the browser ("Please use browser.newContext()").
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(SETTLE_MS);

      if (!(await stylesheetLoaded(page))) {
        summary('- ' + url + ': **kein Stylesheet geladen** — die Seite wurde ungestylt ausgeliefert, ' +
                'der Scan waere nicht aussagekraeftig. Meist ein noch laufendes Pages-Deploy.');
        blocking += 1;
        continue;
      }

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      if (violations.length === 0) {
        summary('- ' + url + ': keine Verstoesse');
        continue;
      }

      const hard = violations.filter((v) => BLOCKING.has(v.impact));
      blocking += hard.length;
      summary('- ' + url + ': ' + violations.length + ' Regel(n) verletzt, davon ' + hard.length + ' blockierend');
      for (const v of violations) {
        summary('  - **' + v.impact + '** `' + v.id + '` - ' + v.help + ' (' + v.nodes.length + 'x)');
        // The selector and the measured colours, so a red run can be acted on without
        // reproducing the scan by hand first.
        for (const n of v.nodes.slice(0, 5)) {
          const d = (n.any && n.any[0] && n.any[0].data) || {};
          const farben = d.contrastRatio
            ? ' — ' + d.fgColor + ' auf ' + d.bgColor + ' = ' + d.contrastRatio + ' (noetig ' + d.expectedContrastRatio + ')'
            : '';
          summary('    - `' + String(n.target) + '`' + farben);
        }
        if (v.nodes.length > 5) summary('    - ... und ' + (v.nodes.length - 5) + ' weitere');
      }
    } catch (err) {
      summary('- ' + url + ': Pruefung fehlgeschlagen - ' + err.message);
      blocking += 1;
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();
  if (blocking > 0) {
    summary('\n**' + blocking + ' blockierende Befund(e).**');
    process.exit(1);
  }
  summary('\nKeine blockierenden Befunde.');
})();
