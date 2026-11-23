/**
 * Compila o tema ativo antes do build do EverShop.
 *
 * O webpack do EverShop lê `themes/<tema>/dist/pages`, não `src/pages`. O `tsc`
 * gera os `.js`, mas NÃO copia os `.css`; sem esta etapa, alterações em
 * `theme.css` ou novos componentes (ex.: a página de login) ficam invisíveis
 * no build de produção.
 *
 * Erros de tipo são apenas avisos: os aliases `@components` são resolvidos pelo
 * webpack, não pelo TypeScript, e a emissão dos `.js` é o que importa aqui.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const theme = 'loja-exemplo';
const themeRoot = path.join(root, 'themes', theme);
const config = path.join(themeRoot, 'tsconfig.json');
const srcAll = path.join(themeRoot, 'src', 'pages', 'all');
const distAll = path.join(themeRoot, 'dist', 'pages', 'all');
const distBase = path.join(themeRoot, 'dist', 'pages', 'all', 'Base.js');
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

console.log('[compile-theme] Compilando componentes do tema...');
const result = spawnSync(
  process.execPath,
  [tscBin, '-p', config, '--noEmitOnError', 'false'],
  { encoding: 'utf8' }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) {
  console.warn('[compile-theme] tsc reportou erros de tipo; emissão JS concluída.');
}

if (!existsSync(distBase)) {
  throw new Error('[compile-theme] Falha ao emitir dist/pages/all/Base.js');
}

if (existsSync(srcAll)) {
  mkdirSync(distAll, { recursive: true });
  for (const file of readdirSync(srcAll)) {
    if (file.endsWith('.css')) {
      copyFileSync(path.join(srcAll, file), path.join(distAll, file));
    }
  }
  console.log('[compile-theme] CSS sincronizado em dist/pages/all.');
}
