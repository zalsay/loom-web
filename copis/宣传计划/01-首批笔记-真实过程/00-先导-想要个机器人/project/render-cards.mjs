import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webkit } from 'playwright';

const dir = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(dir, '../images');
const htmlUrl = pathToFileURL(path.join(dir, 'cards.html')).href;

const targets = [
  ['#card-01-cover', '01-cover.png', '01-封面.png'],
  ['#card-01-cover-sketch', '01-cover-sketch.png', '01-封面-带手绘小狗.png'],
  ['#card-02-sketch', '02-sketch.png', '02-女儿手绘设计图.png'],
  ['#card-03-dilemma', '03-dilemma.png', '03-两难.png'],
  ['#card-04-reflection', '04-reflection.png', '04-反思.png'],
  ['#card-05-action', '05-action.png', '05-行动留悬念.png'],
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
console.log('All cards successfully rendered!');
