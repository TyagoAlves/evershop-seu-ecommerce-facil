/**
 * Verificação SOMENTE LEITURA dos patches aplicados no node_modules.
 * Não aplica patches, não grava nada e não toca em package.json.
 * Aceita as descrições legadas da Exemplo e as do manifesto gerado, quando existir.
 * Imprime OK/FALHA por item e termina com exit code 1 se houver qualquer FALHA.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'node_modules', '@evershop', 'evershop', 'dist');
const COMPANY_FILE = path.join(ROOT, 'config', 'generated', 'company.json');

const LEGACY = {
  blog: "description: 'Dicas e orientações de hidráulica, elétrica, tintas e manutenção para sua obra em Sua Cidade.'",
  listing: "description: 'Conheça nosso catálogo. Valores e disponibilidade sob consulta.'",
  cart: "description: 'Monte sua lista de materiais e solicite um orçamento pelo WhatsApp na Loja Exemplo.'"
};

let failures = 0;

function report(ok, name, details = []) {
  if (ok) {
    console.log(`[OK] ${name}`);
  } else {
    failures += 1;
    console.log(`[FALHA] ${name}`);
    for (const detail of details) console.log(`        - ${detail}`);
  }
}

async function readText(file) {
  return await readFile(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8');
}

function jsString(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

async function checkText(name, source, expected = [], forbidden = []) {
  const missing = expected.filter((needle) => !source.includes(needle));
  const unwanted = forbidden.filter((needle) => source.includes(needle));
  const details = [
    ...missing.map((n) => `ausente: ${JSON.stringify(n)}`),
    ...unwanted.map((n) => `presente indevidamente: ${JSON.stringify(n)}`)
  ];
  report(details.length === 0, name, details);
}

async function checkFile(name, file, expected = [], forbidden = []) {
  try {
    await checkText(name, await readText(file), expected, forbidden);
  } catch (err) {
    report(false, name, [err.message]);
  }
}

async function checkTextAny(name, source, accepted = [], forbidden = []) {
  const details = [];
  if (!accepted.some((needle) => source.includes(needle))) {
    details.push(
      `ausente uma das descrições aceitas: ${accepted.map((n) => JSON.stringify(n)).join(', ')}`
    );
  }
  for (const needle of forbidden) {
    if (source.includes(needle)) details.push(`presente indevidamente: ${JSON.stringify(needle)}`);
  }
  report(details.length === 0, name, details);
}

async function checkFileAny(name, file, accepted = [], forbidden = []) {
  try {
    await checkTextAny(name, await readText(file), accepted, forbidden);
  } catch (err) {
    report(false, name, [err.message]);
  }
}

async function checkExists(name, file) {
  try {
    await stat(path.join(ROOT, file));
    report(true, name);
  } catch {
    report(false, name, ['arquivo ausente']);
  }
}

async function loadAcceptedDescriptions() {
  const accepted = {
    blog: [LEGACY.blog],
    listing: [LEGACY.listing],
    cart: [LEGACY.cart]
  };
  try {
    const patchDescriptions = JSON.parse(await readFile(COMPANY_FILE, 'utf8'))?.seo?.patchDescriptions ?? {};
    for (const key of ['blog', 'listing', 'cart']) {
      const value = patchDescriptions[key];
      if (typeof value === 'string' && value.trim()) {
        accepted[key].push(`description: ${jsString(value)}`);
      }
    }
    report(true, '[company] manifesto lido');
  } catch (err) {
    if (err.code !== 'ENOENT') report(false, '[company] manifesto legível', [err.message]);
  }
  return accepted;
}

const accepted = await loadAcceptedDescriptions();

// --- traduções ---
for (const name of [
  'account', 'admin', 'blog', 'catalog', 'checkout', 'contact', 'email',
  'general', 'import', 'paypal', 'store', 'webhook', 'zz-loja-exemplo'
]) {
  await checkExists(`[translations] pt/${name}.csv`, `translations/pt/${name}.csv`);
}

// --- patch-windows-seed ---
await checkFile(
  '[windows-seed] seedImages.js',
  'node_modules/@evershop/evershop/dist/bin/seed/seedImages.js',
  ["import { basename, join } from 'path';", 'basename(localFile)'],
  ["localFile.split('/').pop()"]
);
await checkFile(
  '[windows-seed] compileSwc.js',
  'node_modules/@evershop/evershop/dist/bin/lib/watch/compileSwc.js',
  [
    '// PATCH-WINDOWS: compileSwc serializado',
    'const compileQueues = new Map();',
    'function serializeByDist(distPath, task)',
    'async function compileSwcUnlocked(srcPath, distPath)',
    'const relativeSrc = path.relative(cwd, srcPath);'
  ]
);

// --- patch-build-env ---
try {
  const first = (await readText('node_modules/@evershop/evershop/dist/bin/build/index.js'))
    .split(/\r?\n/)[0]
    .trim();
  const ok = first === "import './initEnvBuild.js';";
  report(ok, '[build-env] initEnvBuild movido para o topo', ok ? [] : [`primeira linha: ${first}`]);
} catch (err) {
  report(false, '[build-env] initEnvBuild movido para o topo', [err.message]);
}

// --- patch-image-root-assets ---
await checkFile(
  '[image-root-assets] imageProcessor.js',
  'node_modules/@evershop/evershop/dist/modules/cms/services/imageProcessor.js',
  ['Root-level assets (e.g. `/favicon.svg`', 'src = relativePath;'],
  ['src = normalizedPath;']
);

// --- patch-tailwind-sources ---
for (const target of [
  'node_modules/@evershop/evershop/dist/modules/base/pages/admin/all/tailwind.css',
  'node_modules/@evershop/evershop/dist/modules/base/pages/frontStore/all/tailwind.css'
]) {
  await checkFile(`[tailwind-sources] ${target.split('/').slice(-3).join('/')}`, target, [
    '@source "../../../../../**/*.{js,jsx,ts,tsx}";'
  ]);
}

// --- patch-baseui-icons ---
for (const target of [
  'node_modules/@base-ui/react/select/icon/SelectIcon.js',
  'node_modules/@base-ui/react/select/icon/SelectIcon.mjs',
  'node_modules/@base-ui/react/combobox/icon/ComboboxIcon.js',
  'node_modules/@base-ui/react/combobox/icon/ComboboxIcon.mjs',
  'node_modules/@base-ui/react/navigation-menu/icon/NavigationMenuIcon.js',
  'node_modules/@base-ui/react/navigation-menu/icon/NavigationMenuIcon.mjs'
]) {
  await checkFile(`[baseui-icons] ${target.split('/').slice(-3).join('/')}`, target,
    ['children: null'], ["children: '▼'"]);
}

// --- patch-row-templates ---
const rowTplMarkers = {
  patch: ['/* row-templates-patch */', '/* hc-row-templates-patch */'],
  labels: ['/* row-templates-labels-v1 */', '/* hc-row-templates-labels-v1 */'],
  editor: ['/* row-templates-editor-patch */', '/* hc-row-templates-editor-patch */'],
  reorder: ['/* row-templates-editor-reorder-v5 */', '/* hc-row-templates-editor-reorder-v5 */'],
  shell: ['.rowtpl-shell', '.hc-row-templates-shell'],
  label: ['.rowtpl-btn__label', '.hc-row-template__label'],
  css: ['/* row-templates-css-v4 */', '/* hc-row-templates-css-v4 */']
};
async function checkRowTemplates(name, file, mustHaveAnyGroups = [], expected = [], forbidden = []) {
  try {
    const source = await readText(file);
    const details = [];
    for (const group of mustHaveAnyGroups) {
      if (!group.some((needle) => source.includes(needle))) {
        details.push(`ausente uma das descrições aceitas: ${group.map((n) => JSON.stringify(n)).join(', ')}`);
      }
    }
    for (const needle of expected) {
      if (!source.includes(needle)) details.push(`ausente: ${JSON.stringify(needle)}`);
    }
    for (const needle of forbidden) {
      if (source.includes(needle)) details.push(`presente indevidamente: ${JSON.stringify(needle)}`);
    }
    report(details.length === 0, name, details);
  } catch (err) {
    report(false, name, [err.message]);
  }
}
await checkRowTemplates('[row-templates] RowTemplates.js (dist)',
  'node_modules/@evershop/evershop/dist/components/common/form/editor/RowTemplates.js',
  [rowTplMarkers.patch, rowTplMarkers.labels, rowTplMarkers.label],
  ['templateTitles', 'aria-label', 'fill: "#475569"']);
await checkRowTemplates('[row-templates] RowTemplates.tsx (src)',
  'node_modules/@evershop/evershop/src/components/common/form/editor/RowTemplates.tsx',
  [rowTplMarkers.patch, rowTplMarkers.labels, rowTplMarkers.label],
  ['templateTitles: Record<string, string>', 'fill="#475569"']);
await checkRowTemplates('[row-templates] Editor.js (dist)',
  'node_modules/@evershop/evershop/dist/components/common/form/Editor.js',
  [rowTplMarkers.editor, rowTplMarkers.reorder, rowTplMarkers.shell]);
await checkRowTemplates('[row-templates] Editor.tsx (src)',
  'node_modules/@evershop/evershop/src/components/common/form/Editor.tsx',
  [rowTplMarkers.editor, rowTplMarkers.reorder, rowTplMarkers.shell]);
await checkRowTemplates('[row-templates] shadcn.css',
  'node_modules/@evershop/evershop/dist/modules/base/pages/admin/all/shadcn.css',
  [rowTplMarkers.css, rowTplMarkers.label],
  [],
  ['/* hc-row-templates-css */', '/* hc-row-templates-css-v2 */', '/* hc-row-templates-css-v3 */']);

// --- patch-ptbr-core ---
const blogBase = 'node_modules/@evershop/evershop/dist/modules/blog/pages/frontStore';
for (const name of [
  'blogHome/index.js', 'blogCategoryView/index.js',
  'blogTagView/index.js', 'blogPostView/index.js'
]) {
  await checkFile(`[ptbr-core] blog/${name}`, path.join(blogBase, name),
    ["{ title: 'Início', url: localizeUrl('/') }"],
    ["{ title: 'Home', url: localizeUrl('/') }"]);
}
await checkFileAny('[ptbr-core] blogHome meta', path.join(blogBase, 'blogHome/index.js'),
  accepted.blog, ["description: 'Latest posts'"]);
await checkFile('[ptbr-core] blogTagView meta', path.join(blogBase, 'blogTagView/index.js'),
  ['`Publicações sobre ${tag.name}`'], ['`Posts tagged ${tag.name}`']);
await checkFileAny('[ptbr-core] productListing meta',
  'node_modules/@evershop/evershop/dist/modules/catalog/pages/frontStore/productListing/index.js',
  accepted.listing, ["description: translate('All products')"]);
await checkFileAny('[ptbr-core] cart meta',
  'node_modules/@evershop/evershop/dist/modules/checkout/pages/frontStore/cart/index.js',
  accepted.cart, ["description: translate('Shopping cart')"]);

async function collectAdminIndexes() {
  const parts = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (
        entry.name === 'index.js' &&
        full.includes(`${path.sep}pages${path.sep}admin${path.sep}`)
      ) {
        try { parts.push(await readFile(full, 'utf8')); } catch { /* ignora */ }
      }
    }
  }
  await walk(path.join(DIST, 'modules'));
  return parts.join('\n');
}

await checkText(
  '[ptbr-core] títulos do admin',
  await collectAdminIndexes(),
  ["title: 'Painel'", "title: 'Produtos'", "title: 'Categorias'",
   "title: 'Configuração da loja'", "title: 'Login do administrador'", "title: 'Webhooks'"],
  ["title: 'Dashboard'", "title: 'Products'", "title: 'Admin Login'"]
);

console.log(failures === 0 ? '\nRESULTADO: OK' : `\nRESULTADO: ${failures} FALHA(S)`);
process.exitCode = failures === 0 ? 0 : 1;
