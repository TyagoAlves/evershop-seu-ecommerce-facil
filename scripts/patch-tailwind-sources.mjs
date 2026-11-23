/**
 * Corrige a detecção de classes Tailwind v4 no Windows.
 *
 * O EverShop injeta `@source` com caminhos absolutos (`C:/...`) via
 * `InjectTailwindSources`. No Windows esses caminhos não são reconhecidos pelo
 * scanner do Tailwind e as utilities do core (`flex-col`, `w-full`, etc.) não
 * entram no CSS compilado — formulários do admin ficam sem largura e quebrados.
 *
 * A solução é declarar o source com caminho relativo dentro do próprio CSS do
 * core. Cinco níveis acima de `dist/modules/base/pages/<area>/all/` é a raiz
 * `dist/`, onde vivem todos os componentes TypeScript/JavaScript do EverShop.
 * O patch é idempotente e reaplicado no postinstall.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = '@source "../../../../../**/*.{js,jsx,ts,tsx}";';
const targets = [
  'node_modules/@evershop/evershop/dist/modules/base/pages/admin/all/tailwind.css',
  'node_modules/@evershop/evershop/dist/modules/base/pages/frontStore/all/tailwind.css'
];

for (const target of targets) {
  const file = path.resolve(process.cwd(), target);
  const css = readFileSync(file, 'utf8');

  if (css.includes(SOURCE)) {
    console.log(`[tailwind-sources] já aplicado: ${target}`);
    continue;
  }

  writeFileSync(file, `${SOURCE}\n${css}`);
  console.log(`[tailwind-sources] patch aplicado: ${target}`);
}
