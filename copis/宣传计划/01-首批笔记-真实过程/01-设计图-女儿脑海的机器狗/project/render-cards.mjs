import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webkit } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(dir, '../images');
const htmlUrl = pathToFileURL(path.join(dir, 'cards.html')).href;

const targets = [
  ['#card-01-cover', '01-cover.png', '01-封面.png'],
  ['#card-02-full-sketch', '02-full-sketch.png', '02-手绘图全貌.png'],
  ['#card-03-dog-detail', '03-dog-detail.png', '03-机器狗细节.png'],
  ['#card-04-girl-detail', '04-girl-detail.png', '04-操控台细节.png'],
  ['#card-05-action', '05-action.png', '05-周末开工悬念.png'],
  ['#card-01-cover-dark', '01-cover-dark.png', '01-封面-黑底备选.png'],
];

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1600 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.goto(htmlUrl, { waitUntil: 'load' });

for (const [selector, filename, cnFilename] of targets) {
  const locator = page.locator(selector);
  const outPath = path.join(imagesDir, filename);
  const cnOutPath = path.join(imagesDir, cnFilename);
  await locator.screenshot({ path: outPath, type: 'png' });
  await locator.screenshot({ path: cnOutPath, type: 'png' });
  console.log(`Rendered ${filename} -> ${cnFilename}`);
}

await browser.close();
console.log('Note 2 cards successfully rendered!');
