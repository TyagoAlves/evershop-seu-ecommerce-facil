/**
 * Sincroniza `src/` -> `dist/` de todas as extensões locais.
 * O loader do EverShop 2.4 exige `dist` fora de development e lê
 * SDL/resolvers de `<dist>/graphql/types/**`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = path.join(root, 'extensions');
const COPY_EXTENSIONS = new Set(['.js', '.json', '.graphql']);

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    if (statSync(source).isDirectory()) {
      copyDir(source, target);
    } else if (COPY_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      copyFileSync(source, target);
    }
  }
}

const names = [];
for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const src = path.join(extensionsDir, entry.name, 'src');
  if (!existsSync(src)) continue;
  copyDir(src, path.join(extensionsDir, entry.name, 'dist'));
  names.push(entry.name);
}

console.log(`[compile-extension] Sincronizado: ${names.join(', ') || 'nenhuma extensão'}.`);
