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

function summary(line) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, line + '\n');
  console.log(line);
}

(async () => {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('Keine URL uebergeben.');
    process.exit(2);
  }

  const browser = await chromium.launch();
  // A context, not browser.newPage(): @axe-core/playwright refuses a page that hangs
  // directly off the browser ("Please use browser.newContext()"). Measured, not guessed.
  const context = await browser.newContext();
  let blocking = 0;
  summary('## Barrierefreiheit (axe-core)');

  for (const url of urls) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
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
      }
    } catch (err) {
      summary('- ' + url + ': Pruefung fehlgeschlagen - ' + err.message);
      blocking += 1;
    } finally {
      await page.close();
    }
  }

  await browser.close();
  if (blocking > 0) {
    summary('\n**' + blocking + ' blockierende Befund(e).**');
    process.exit(1);
  }
  summary('\nKeine blockierenden Befunde.');
})();
