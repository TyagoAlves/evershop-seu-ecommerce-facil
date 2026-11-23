/**
 * Renderiza os artefatos da empresa ativa a partir de companies/<slug>.json.
 *
 * - Sem dependências externas e sem acesso à rede.
 * - Determinístico: mesmos manifesto/schema => mesmos arquivos, mesma ordem.
 * - O manifesto é escolhido por COMPANY_SLUG, com fallback para a Exemplo.
 * - Os logs mostram apenas caminhos relativos (nunca valores do manifesto).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (target) => path.relative(root, target).replaceAll('\\', '/');
const readJson = (target) => JSON.parse(readFileSync(target, 'utf8'));

function writeText(target, content) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  console.log(`[company:render] ${rel(target)}`);
}

/** Subconjunto de JSON Schema usado por companies/schema.json. */
function validate(value, rule, schema, at, errors) {
  if (rule.$ref) {
    const name = rule.$ref.split('/').pop();
    return validate(value, schema.$defs[name], schema, at, errors);
  }

  const types = Array.isArray(rule.type)
    ? rule.type
    : rule.type
      ? [rule.type]
      : [];
  if (types.length) {
    const matches = (type) => {
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object') {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      }
      if (type === 'integer') return Number.isInteger(value);
      return typeof value === type;
    };
    if (!types.some(matches)) {
      errors.push(`${at}: tipo inválido`);
      return;
    }
  }

  if ('const' in rule && value !== rule.const) {
    errors.push(`${at}: valor fixo inválido`);
    return;
  }
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`${at}: valor fora da lista permitida`);
    return;
  }
  if (rule.pattern && typeof value === 'string' && !new RegExp(rule.pattern).test(value)) {
    errors.push(`${at}: formato inválido`);
    return;
  }

  if (rule.properties && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required || []) {
      if (!(key in value)) errors.push(`${at}.${key}: obrigatório`);
    }
    for (const [key, childRule] of Object.entries(rule.properties)) {
      if (key in value) validate(value[key], childRule, schema, `${at}.${key}`, errors);
    }
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in rule.properties)) errors.push(`${at}.${key}: propriedade não permitida`);
      }
    }
  }

  if (rule.items && Array.isArray(value)) {
    value.forEach((item, index) => validate(item, rule.items, schema, `${at}[${index}]`, errors));
  }
}

const get = (source, field) =>
  field.split('.').reduce((current, key) => (current == null ? current : current[key]), source);

const slug = process.env.COMPANY_SLUG || 'loja-exemplo';
const schemaPath = path.join(root, 'companies', 'schema.json');
const manifestPath = path.join(root, 'companies', `${slug}.json`);

if (!/^(_template|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(slug)) {
  throw new Error('[company:render] COMPANY_SLUG: formato inválido');
}
if (!existsSync(manifestPath)) {
  throw new Error(`[company:render] Manifesto não encontrado: ${rel(manifestPath)}`);
}

const schema = readJson(schemaPath);
const company = readJson(manifestPath);
const errors = [];
validate(company, schema, schema, rel(manifestPath), errors);
if (errors.length) {
  throw new Error(`[company:render] Manifesto inválido:\n- ${errors.join('\n- ')}`);
}

const requiredForRender = [
  'theme',
  'extension',
  'name',
  'whatsapp.number',
  'whatsapp.infoMessage',
  'hero.eyebrow',
  'hero.titlePrefix',
  'hero.titleHighlight',
  'hero.titleSuffix',
  'hero.text',
  'hero.primaryLabel',
  'hero.secondaryLabel',
  'hero.secondaryHref',
  'departmentsIntro',
  'featured',
  'differentialsIntro',
  'cta.eyebrow',
  'cta.title',
  'cta.text',
  'cta.label',
  'location.eyebrow',
  'location.title',
  'location.address',
  'location.mapsHref',
  'location.mapsLabel',
  'location.whatsappLabel',
  'location.cardTitle',
  'location.cardLine1',
  'location.cardLine2'
];
for (const field of requiredForRender) {
  const value = get(company, field);
  if (value === undefined || value === null || value === '') {
    throw new Error(`[company:render] ${rel(manifestPath)}: campo obrigatório ausente: ${field}`);
  }
}

const waHref = (message) =>
  `https://wa.me/${company.whatsapp.number}?text=${encodeURIComponent(message)}`;
const infoHref = waHref(company.whatsapp.infoMessage);

function widget(type, label, description, category, icon, sortOrder, settings) {
  return {
    type,
    name: `${label} – ${company.name}`,
    description,
    category,
    icon,
    sortOrder,
    settings
  };
}

function buildWidgets() {
  const { hero, departmentsIntro, featured, differentialsIntro, cta, location } = company;

  return [
    widget('hc_menu', 'Menu', 'Links de navegação do cabeçalho e do menu mobile.', 'navigation', 'Menu', 5, {
      links: company.nav.map(({ id, label, href, showInDesktop }) => ({
        id,
        label,
        href,
        showInDesktop
      }))
    }),
    widget('hc_hero', 'Hero', 'Bloco principal da home com chamada para o WhatsApp e indicadores.', 'content', 'LayoutDashboard', 10, {
      backgroundImage: null,
      backgroundOpacity: 45,
      eyebrow: hero.eyebrow,
      titleBefore: hero.titlePrefix,
      titleAccent: hero.titleHighlight,
      titleAfter: hero.titleSuffix,
      text: hero.text,
      primaryLabel: hero.primaryLabel,
      primaryHref: infoHref,
      secondaryLabel: hero.secondaryLabel,
      secondaryHref: hero.secondaryHref,
      stats: hero.stats
    }),
    widget('hc_departments', 'Departamentos', 'Grade de categorias da home com dados do catálogo.', 'content', 'Grid2X2', 20, {
      eyebrow: departmentsIntro.eyebrow,
      title: departmentsIntro.title,
      description: departmentsIntro.description,
      linkLabel: departmentsIntro.linkLabel,
      linkHref: departmentsIntro.linkHref,
      limit: departmentsIntro.limit
    }),
    widget('hc_featured_products', 'Produtos em destaque', 'Grade de produtos sob consulta com dados do catálogo.', 'commerce', 'Package', 30, {
      eyebrow: featured.eyebrow,
      title: featured.title,
      description: featured.description,
      linkLabel: featured.linkLabel,
      linkHref: featured.linkHref,
      limit: featured.limit
    }),
    widget('hc_differentials', 'Diferenciais', `Quatro motivos para comprar na ${company.name}.`, 'content', 'BadgeCheck', 40, {
      eyebrow: differentialsIntro.eyebrow,
      title: differentialsIntro.title,
      items: company.differentials
    }),
    widget('hc_cta', 'CTA WhatsApp', 'Bloco de orçamento sem compromisso pelo WhatsApp.', 'marketing', 'MessageCircle', 50, {
      eyebrow: cta.eyebrow,
      title: cta.title,
      text: cta.text,
      buttonLabel: cta.label,
      buttonHref: infoHref
    }),
    widget('hc_location', 'Localização', 'Endereço, horários e links de contato da loja.', 'content', 'MapPin', 60, {
      eyebrow: location.eyebrow,
      title: location.title,
      address: location.address,
      meta: location.meta,
      mapsLabel: location.mapsLabel,
      mapsHref: location.mapsHref,
      whatsappLabel: location.whatsappLabel,
      whatsappHref: infoHref,
      cardTitle: location.cardTitle,
      cardLine1: location.cardLine1,
      cardLine2: location.cardLine2
    })
  ];
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const companyTs = path.join(
  root,
  'themes',
  company.theme,
  'src',
  'components',
  'frontStore',
  'generated',
  'company.ts'
);
const widgetsJson = path.join(root, 'extensions', company.extension, 'generated', 'widgets.json');
const generatedManifest = path.join(root, 'config', 'generated', 'company.json');

writeText(companyTs, `export const COMPANY = ${JSON.stringify(company, null, 2)};\n\nexport default COMPANY;\n`);
writeText(widgetsJson, json(buildWidgets()));
writeText(generatedManifest, json(company));
