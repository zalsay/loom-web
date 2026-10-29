import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.join(root,'web');
async function files(directory){const entries=await readdir(directory,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):path.join(directory,entry.name)))).flat();}
const all=[...await files(path.join(web,'js')),...await files(path.join(web,'scene')),...await files(path.join(root,'scripts'))];
for(const file of all)if(/\.(m?js)$/.test(file))execFileSync(process.execPath,['--check',file]);
for(const file of await files(web)){
  if(!/\.(html|js|css)$/.test(file)||file.includes(`${path.sep}vendor${path.sep}`))continue;
  const content=await readFile(file,'utf8');
  const expressions=file.endsWith('.html')?[/\b(?:src|href)="(\.\.?\/[^"?#]+)(?:[?#][^"]*)?"/g]:file.endsWith('.js')?[/\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g]:[];
  for(const expression of expressions)for(const match of content.matchAll(expression))await access(path.resolve(path.dirname(file),match[1]));
}
for(const module of ['three.module.js','three.core.js','addons/controls/OrbitControls.js','addons/renderers/SVGRenderer.js','addons/renderers/Projector.js','addons/modifiers/TessellateModifier.js','THREE-LICENSE.txt'])await access(path.join(web,'vendor',module));
console.log(`Validated ${all.length} source files and local resource references.`);
