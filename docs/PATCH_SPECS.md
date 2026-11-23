# Especificações de patch prontas para aplicação (Fase 0)

Este arquivo consolida o código exato produzido pelos agentes de análise. Agentes com permissão de escrita devem aplicá-lo nos arquivos do seu dono, conforme `AGENT_CONTRACT.md`.

---

## 1. `themes/loja-exemplo/src/components/frontStore/site.ts`

```ts
import { COMPANY } from './generated/company.js';

/** Export mantido por compatibilidade; número vem do manifesto ativo. */
export const WHATSAPP_NUMBER = COMPANY.whatsapp.number;

const LEGACY_QUOTE_DEFAULT_MESSAGE =
  'Olá! Gostaria de informações sobre produtos e preços.';
const LEGACY_QUOTE_PRODUCT_MESSAGE = (productName: string): string =>
  `Olá! Gostaria de consultar preço e disponibilidade de ${productName}.`;
const LEGACY_DESCRIPTION =
  'Na Loja Exemplo você encontra materiais de construção, hidráulica, elétrica, tintas, ferragens e ferramentas em Sua Cidade, UF. Atendimento próximo e os menores preços.';
const LEGACY_ADDRESS =
  'Rua Exemplo, 123 — Centro, Sua Cidade – UF, CEP 00000-000';
const LEGACY_MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Loja%20Exemplo%2C%20Rua%20Exemplo%20123%2C%20Cidade%20Exemplo%2C%20UF';

function waHref(text: string, source?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  return source
    ? `${base}&utm_source=${encodeURIComponent(source)}&utm_medium=whatsapp`
    : base;
}

export function quoteHref(productName?: string): string {
  return waHref(
    productName
      ? LEGACY_QUOTE_PRODUCT_MESSAGE(productName)
      : LEGACY_QUOTE_DEFAULT_MESSAGE
  );
}

export interface WaLinkParams {
  source: string;
  productName?: string;
  categoryName?: string;
  itemCount?: number;
}

export function waLink({
  source,
  productName,
  categoryName,
  itemCount
}: WaLinkParams): string {
  const parts: string[] = [];
  if (COMPANY.whatsapp.defaultMessage) parts.push(COMPANY.whatsapp.defaultMessage);
  if (productName) parts.push(`Produto: ${productName}.`);
  if (categoryName) parts.push(`Categoria: ${categoryName}.`);
  if (typeof itemCount === 'number') parts.push(`Itens: ${itemCount}.`);
  parts.push(`(Origem: ${source})`);
  return waHref(parts.join(' '), source);
}

export const SITE = {
  name: COMPANY.name,
  tagline: COMPANY.tagline,
  description: LEGACY_DESCRIPTION,
  phone: COMPANY.phone.display,
  phoneHref: `tel:${COMPANY.phone.e164}`,
  whatsapp: COMPANY.whatsapp.display,
  whatsappHref: quoteHref(),
  address: LEGACY_ADDRESS,
  addressFull: LEGACY_ADDRESS,
  addressShort: COMPANY.address.short,
  hours: COMPANY.hours,
  facebook: COMPANY.facebook,
  mapsUrl: LEGACY_MAPS_URL
};

export const NAV = COMPANY.nav.map((item) => ({
  label: item.label,
  href: item.href
}));
```

---

## 2. `extensions/loja-exemplo-home/src/bootstrap.js`

Substituir a leitura atual de `widgets.json` (linhas ~18-20) por:

```js
const GENERATED_WIDGETS_PATH = path.join(
  extensionRoot,
  'generated',
  'widgets.json'
);
const FALLBACK_WIDGETS_PATH = path.join(extensionRoot, 'widgets.json');
const widgetsPath = fs.existsSync(GENERATED_WIDGETS_PATH)
  ? GENERATED_WIDGETS_PATH
  : FALLBACK_WIDGETS_PATH;
const widgets = JSON.parse(fs.readFileSync(widgetsPath, 'utf8'));
```

---

## 3. `scripts/seed-homepage-widgets.mjs`

- Importar `existsSync, readFileSync` de `node:fs` e `createHash` de `node:crypto`.
- Após o bloco `UUIDS`, adicionar:

```js
const LEGACY_SLUG = 'loja-exemplo';
const SLUG = process.env.COMPANY_SLUG || LEGACY_SLUG;
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function uuidv5(name) {
  const bytes = Buffer.concat([
    Buffer.from(UUID_NS.replace(/-/g, ''), 'hex'),
    Buffer.from(name, 'utf8')
  ]);
  const digest = createHash('sha1').update(bytes).digest().subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const instanceUuid = (type) =>
  SLUG === LEGACY_SLUG ? UUIDS[type].instance : uuidv5(`${SLUG}:${type}:instance`);

const placementUuid = (type, area = 'content') =>
  SLUG === LEGACY_SLUG
    ? type === 'hc_menu'
      ? MENU_AREAS.find((target) => target.area === area).uuid
      : UUIDS[type].placement
    : uuidv5(`${SLUG}:${type}:${area}:placement`);
```

- Trocar a leitura de `widgets.json` pelo par `extensions/loja-exemplo-home/generated/widgets.json` com fallback.
- No loop final, usar `instanceUuid(widget.type)` e `placementUuid(...)`.
- `THEME` deve vir de `config/generated/company.json` quando existir, com fallback `'loja-exemplo'`.
- Remoção de `DEMO_MENU_UUID` somente quando `SLUG === LEGACY_SLUG`.
- Manter `ON CONFLICT (uuid) DO NOTHING`, áreas e `sortOrder` intactos.

---

## 4. `scripts/patch-ptbr-core.mjs`

Não alterar as três descriptions agora (regra 6). Em vez disso, ler `config/generated/company.json` e usar `seo.patchDescriptions.blog/listing/cart` quando presentes; na ausência, manter exatamente as strings atuais:

- blog: `Dicas e orientações de hidráulica, elétrica, tintas e manutenção para sua obra em Sua Cidade.`
- listing: `Catálogo de materiais de construção: hidráulica, elétrica, tintas, ferragens e ferramentas em Sua Cidade. Valores sob consulta.`
- cart: `Monte sua lista de materiais e solicite um orçamento pelo WhatsApp na Loja Exemplo.`

`scripts/patch-verify.mjs`: verificação SOMENTE LEITURA dos marcadores dos 7 patches, aceitando strings legadas ou as do manifesto; exit 1 se houver FALHA.

---

## 5. `themes/loja-exemplo/src/pages/all/theme.css`

Substituir o `:root` atual (linhas 18-42) por aliases com os valores atuais como fallback:

```css
:root {
  --hc-brand-50: var(--color-brand-50, #eef4ff);
  --hc-brand-100: var(--color-brand-100, #dbe7ff);
  --hc-brand-200: var(--color-brand-200, #bfd3ff);
  --hc-brand-300: var(--color-brand-300, #93b5ff);
  --hc-brand-400: var(--color-brand-400, #5f8dff);
  --hc-brand-500: var(--color-brand-500, #3a6bff);
  --hc-brand-600: var(--color-brand-600, #116dff);
  --hc-brand-700: var(--color-brand-700, #0b52d6);
  --hc-brand-800: var(--color-brand-800, #0f42a8);
  --hc-brand-900: var(--color-brand-900, #123a84);
  --hc-brand-950: var(--color-brand-950, #0c1f4d);

  --hc-primary: var(--hc-brand-600);
  --hc-primary-hover: var(--hc-brand-700);
  --hc-primary-50: var(--hc-brand-50);
  --hc-primary-100: var(--hc-brand-100);
  --hc-primary-200: var(--hc-brand-200);
  --hc-primary-300: var(--hc-brand-300);
  --hc-primary-400: var(--hc-brand-400);
  --hc-dark: var(--hc-brand-950);
  --hc-dark-deep: #070f24;
  --hc-login-dark: #07152f;
  --hc-white: #ffffff;
  --hc-ink: #0f172a;
  --hc-body: #334155;
  --hc-body-soft: #475569;
  --hc-muted: #64748b;
  --hc-muted-light: #94a3b8;
  --hc-light-text: #cbd5e1;
  --hc-surface-soft: #f8fafc;
  --hc-surface-muted: #f1f5f9;
  --hc-border: #e2e8f0;
  --hc-success: #15803d;
  --hc-success-hover: #166534;
  --hc-success-text-hover: #0f6b32;
  --hc-danger: #dc2626;
  --hc-radius-control: 0.75rem;
  --hc-radius-sm: 0.5rem;
  --hc-radius-md: 0.875rem;
  --hc-radius-card: 1rem;
  --hc-radius-lg: 1.25rem;
  --hc-radius-pill: 999px;
  --hc-container-max: 1280px;
  --hc-container-pad: 1.25rem;
  --hc-container-pad-lg: 2rem;
  --hc-section-pad: 4.5rem;

  --radius: var(--hc-radius-control);
  --background: var(--hc-white);
  --foreground: var(--hc-ink);
  --card: var(--hc-white);
  --card-foreground: var(--hc-ink);
  --popover: var(--hc-white);
  --popover-foreground: var(--hc-ink);
  --primary: var(--hc-primary);
  --primary-foreground: var(--hc-white);
  --secondary: var(--hc-surface-muted);
  --secondary-foreground: var(--hc-ink);
  --muted: var(--hc-surface-soft);
  --muted-foreground: var(--hc-muted);
  --accent: var(--hc-primary-50);
  --accent-foreground: var(--hc-primary-hover);
  --destructive: var(--hc-danger);
  --border: var(--hc-border);
  --divider: var(--hc-border);
  --input: var(--hc-border);
  --ring: var(--hc-brand-500);
  --chart-1: var(--hc-primary);
  --chart-2: var(--hc-primary-400);
  --chart-3: var(--hc-brand-800);
}
```

Mapa de substituição no restante do arquivo (manter literais somente no `@theme` linhas 2-12):

`#eef4ff→var(--hc-primary-50)`, `#dbe7ff→var(--hc-primary-100)`, `#bfd3ff→var(--hc-primary-200)`, `#93b5ff→var(--hc-primary-300)`, `#5f8dff→var(--hc-primary-400)`, `#3a6bff→var(--hc-brand-500)`, `#116dff→var(--hc-primary)`, `#0b52d6→var(--hc-primary-hover)`, `#0f42a8→var(--hc-brand-800)`, `#123a84→var(--hc-brand-900)`, `#0c1f4d→var(--hc-dark)`, `#070f24→var(--hc-dark-deep)`, `#07152f→var(--hc-login-dark)`, `#ffffff→var(--hc-white)`, `#0f172a→var(--hc-ink)`, `#334155→var(--hc-body)`, `#475569→var(--hc-body-soft)`, `#64748b→var(--hc-muted)`, `#94a3b8→var(--hc-muted-light)`, `#cbd5e1→var(--hc-light-text)`, `#e2e8f0→var(--hc-border)`, `#f1f5f9→var(--hc-surface-muted)`, `#f8fafc→var(--hc-surface-soft)`, `#15803d→var(--hc-success)`, `#166534→var(--hc-success-hover)`, `#0f6b32→var(--hc-success-text-hover)`, `#dc2626→var(--hc-danger)`.

Converter também os `!important` de cor em `.hc-add-cart`, `.hc-product-buy__cart` e `.loading-bar`. `rgb()/rgba()` com alpha podem permanecer. Criar `themes/loja-exemplo/public/company-overrides.css` comentado com `:root` contendo os nomes dos tokens, sem valores ativos.
