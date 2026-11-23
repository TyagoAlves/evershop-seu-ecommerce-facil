/**
 * Ajustes pontuais de textos que o EverShop 2.4.0 mantém fixos em inglês nos
 * controladores de rota do blog (não passam por `_()`/dicionário). Idempotente,
 * reaplicado no `postinstall` para sobreviver a um `npm install`.
 */
import { readFile, readdir, writeFile } from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = new URL(
  '../node_modules/@evershop/evershop/dist/modules/blog/pages/frontStore/',
  import.meta.url
);

const files = [
  'blogHome/index.js',
  'blogCategoryView/index.js',
  'blogTagView/index.js',
  'blogPostView/index.js'
];

// Descrições injetadas no core: vêm do manifesto da empresa quando ele existir.
// Os valores abaixo preservam exatamente a saída atual da Loja Exemplo.
const companyFile = new URL('../config/generated/company.json', import.meta.url);
const fallbackDescriptions = {
  blog: 'Dicas e orientações de hidráulica, elétrica, tintas e manutenção para sua obra em Sua Cidade.',
  listing: 'Catálogo de materiais de construção: hidráulica, elétrica, tintas, ferragens e ferramentas em Sua Cidade. Valores sob consulta.',
  cart: 'Monte sua lista de materiais e solicite um orçamento pelo WhatsApp na Loja Exemplo.'
};

function jsString(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

async function loadDescriptions() {
  try {
    const patchDescriptions = JSON.parse(await readFile(companyFile, 'utf8'))?.seo?.patchDescriptions ?? {};
    const pick = (key) =>
      typeof patchDescriptions[key] === 'string' && patchDescriptions[key].trim()
        ? patchDescriptions[key]
        : fallbackDescriptions[key];
    return { blog: pick('blog'), listing: pick('listing'), cart: pick('cart') };
  } catch {
    return { ...fallbackDescriptions };
  }
}

const descriptions = await loadDescriptions();

const replacements = [
  ["{ title: 'Home', url: localizeUrl('/') }", "{ title: 'Início', url: localizeUrl('/') }"],
  ["description: 'Latest posts'", `description: ${jsString(descriptions.blog)}`],
  ['`Posts tagged ${tag.name}`', '`Publicações sobre ${tag.name}`']
];

let total = 0;

for (const name of files) {
  const file = new URL(name, base);
  let source = await readFile(file, 'utf8');
  let changed = false;

  for (const [from, to] of replacements) {
    if (source.includes(from)) {
      source = source.replaceAll(from, to);
      changed = true;
      total += 1;
    }
  }

  if (changed) {
    await writeFile(file, source, 'utf8');
    console.log(`Patch pt-BR aplicado em ${name}`);
  } else {
    console.log(`Patch pt-BR já aplicado em ${name}`);
  }
}

// Metadados de listagem/carrinho: o core reusa o título como descrição.
const metaPatches = [
  [
    'catalog/pages/frontStore/productListing/index.js',
    "description: translate('All products')",
    `description: ${jsString(descriptions.listing)}`
  ],
  [
    'checkout/pages/frontStore/cart/index.js',
    "description: translate('Shopping cart')",
    `description: ${jsString(descriptions.cart)}`
  ]
];

for (const [name, from, to] of metaPatches) {
  const file = new URL(
    `../node_modules/@evershop/evershop/dist/modules/${name}`,
    import.meta.url
  );
  let source = await readFile(file, 'utf8');
  if (source.includes(from)) {
    source = source.replace(from, to);
    await writeFile(file, source, 'utf8');
    total += 1;
    console.log(`Patch pt-BR aplicado em ${name}`);
  } else {
    console.log(`Patch pt-BR já aplicado em ${name}`);
  }
}

// Títulos das abas do admin: vêm das rotas do core e não passam pelo `_()`,
// então o dicionário de tradução não alcança esse texto.
const adminTitles = {
  Dashboard: 'Painel',
  Products: 'Produtos',
  'Create a new product': 'Criar um novo produto',
  Categories: 'Categorias',
  'Create a new category': 'Criar uma nova categoria',
  Collections: 'Coleções',
  'Create a new collection': 'Criar uma nova coleção',
  Attributes: 'Atributos',
  'Create a new attribute': 'Criar um novo atributo',
  'Blog posts': 'Publicações do blog',
  'Create a new blog post': 'Criar nova publicação',
  'Blog categories': 'Categorias do blog',
  'Create a new blog category': 'Criar nova categoria do blog',
  'Blog tags': 'Tags do blog',
  'Create a new blog tag': 'Criar nova tag do blog',
  'Blog comments': 'Comentários do blog',
  Orders: 'Pedidos',
  Customers: 'Clientes',
  Coupons: 'Cupons',
  'Create a new coupon': 'Criar um novo cupom',
  'Landing Pages': 'Páginas de destino',
  'Create a new landing page': 'Criar uma nova página de destino',
  'Cms pages': 'Páginas CMS',
  'Create a new cms page': 'Criar uma nova página CMS',
  Widgets: 'Widgets',
  'Create a new widget': 'Criar um novo widget',
  'Contact messages': 'Mensagens de contato',
  'Page builder': 'Construtor de páginas',
  'Store Setting': 'Configuração da loja',
  'System Setting': 'Configurações do sistema',
  'Customer Setting': 'Configurações de clientes',
  'Payment Setting': 'Configurações de pagamento',
  'Shipping Setting': 'Configurações de envio',
  'Shipping Providers': 'Transportadoras',
  'Tax Setting': 'Configurações de impostos',
  'Admin Login': 'Login do administrador',
  Import: 'Importação',
  'New import': 'Nova importação',
  Webhooks: 'Webhooks',
  'Create a new webhook': 'Criar um novo webhook'
};

async function* adminIndexFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* adminIndexFiles(full);
    } else if (entry.name === 'index.js' && full.includes(`${path.sep}pages${path.sep}admin${path.sep}`)) {
      yield full;
    }
  }
}

const modulesDir = fileURLToPath(new URL('../node_modules/@evershop/evershop/dist/modules/', import.meta.url));
let titleCount = 0;
for await (const file of adminIndexFiles(modulesDir)) {
  let source = await readFile(file, 'utf8');
  let changed = false;
  for (const [from, to] of Object.entries(adminTitles)) {
    if (from === to) continue;
    const needle = `title: '${from}'`;
    if (source.includes(needle)) {
      source = source.replaceAll(needle, `title: '${to}'`);
      changed = true;
      titleCount += 1;
    }
  }
  if (changed) await writeFile(file, source, 'utf8');
}

console.log(`Títulos do admin traduzidos: ${titleCount}`);
console.log(`Substituições pt-BR: ${total}`);
