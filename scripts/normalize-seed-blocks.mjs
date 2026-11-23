/** Garante `size: 1` nos blocos de description dos JSONs de seed do tema. */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const dir = path.resolve('themes/loja-exemplo/seed');
const files = ['categories.json', 'collections.json', 'products.json', 'pages.json', 'blog.json'];

for (const name of files) {
  const file = path.join(dir, name);
  const data = JSON.parse(await readFile(file, 'utf8'));
  let changed = false;

  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.columns) && value.size === undefined) {
      value.size = 1;
      changed = true;
    }
    Object.values(value).forEach(walk);
  };

  walk(data);
  if (changed) {
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`Blocos normalizados: ${name}`);
  }
}
