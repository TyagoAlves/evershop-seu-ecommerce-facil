/**
 * Remove o "▼" solto que o Base UI injeta dentro dos ícones de Select/Combobox.
 *
 * O Base UI define `children: '▼'` como fallback nos seus componentes de
 * ícone. Quando o EverShop passa um `<ChevronDown />` do Lucide via `render`,
 * esse fallback é mesclado como filho do SVG, gerando `<svg><path/>▼</svg>`:
 * a seta aparece duplicada/quebrada no admin e na loja.
 *
 * O patch troca o fallback por `null`; quando a aplicação fornece o próprio
 * children (ex.: NavigationMenuIndicator), ele continua prevalecendo.
 * Idempotente e reaplicado no postinstall.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const targets = [
  'node_modules/@base-ui/react/select/icon/SelectIcon.js',
  'node_modules/@base-ui/react/select/icon/SelectIcon.mjs',
  'node_modules/@base-ui/react/combobox/icon/ComboboxIcon.js',
  'node_modules/@base-ui/react/combobox/icon/ComboboxIcon.mjs',
  'node_modules/@base-ui/react/navigation-menu/icon/NavigationMenuIcon.js',
  'node_modules/@base-ui/react/navigation-menu/icon/NavigationMenuIcon.mjs'
];

for (const target of targets) {
  const file = path.resolve(process.cwd(), target);
  const original = readFileSync(file, 'utf8');
  const patched = original.replaceAll("children: '▼'", 'children: null');

  if (patched === original) {
    console.log(`[baseui-icons] já aplicado: ${target}`);
    continue;
  }

  writeFileSync(file, patched);
  console.log(`[baseui-icons] patch aplicado: ${target}`);
}
