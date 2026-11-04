import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webkit } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(path.join(dir, 'cards.html')).href;

const targets = [
  ['#card-01-cover', '01-cover.png'],
  ['#card-02-dilemma', '02-dilemma.png'],
  ['#card-03-reflection', '03-reflection.png'],
  ['#card-04-action', '04-action.png'],
  ['#card-01-cover-dark', '01-cover-dark.png'],
];

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1400 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.goto(htmlUrl, { waitUntil: 'load' });

for (const [selector, filename] of targets) {
  const locator = page.locator(selector);
  const outPath = path.join(dir, filename);
  await locator.screenshot({ path: outPath, type: 'png' });
  console.log(`Rendered ${filename}`);
}

await browser.close();
