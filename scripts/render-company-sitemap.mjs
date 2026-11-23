/**
 * Sitemap/robots da empresa ativa.
 *
 * - Lê `companies/<COMPANY_SLUG>.json` (default: loja-exemplo).
 * - Usa `domain` do manifesto como base absoluta de todos os `<loc>`.
 * - Força a regeneração; se o domínio/slug mudou, remove o `meta.json` do
 *   fingerprint antes de gerar (o core não inclui `baseUrl` no fingerprint).
 * - Gera `public/robots.txt` somente quando `seo.robotsTxt` existe no manifesto.
 * - Não executa nenhum comando git: os XML em `public/` são artefatos locais de
 *   deploy e não devem ser adicionados ao repositório.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SLUG = 'loja-exemplo';
const slug = String(process.env.COMPANY_SLUG || DEFAULT_SLUG).trim() || DEFAULT_SLUG;
const manifestPath = path.join(ROOT, 'companies', `${slug}.json`);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeDomain(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Manifesto "${slug}": "domain" é obrigatório.`);
  }
  const normalized = value.trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Manifesto "${slug}": "domain" inválido: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Manifesto "${slug}": "domain" deve ser http(s): ${value}`);
  }
  return normalized;
}

function withSitemapDirective(text, sitemapUrl) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*Sitemap\s*:/i.test(line));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('', `Sitemap: ${sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}

const manifest = await readJson(manifestPath);
if (!manifest) {
  throw new Error(`Manifesto não encontrado: ${manifestPath}`);
}

const domain = normalizeDomain(manifest.domain);

// Precisa acontecer antes de qualquer import do core: node-config congela a
// configuração no primeiro import e `getBaseUrl()` prioriza EVERSHOP_HOME_URL.
process.env.EVERSHOP_HOME_URL = domain;
process.env.HOME_URL = domain;

const cacheDir = path.join(ROOT, '.evershop', 'sitemap');
const metaPath = path.join(cacheDir, 'meta.json');
const markerPath = path.join(cacheDir, 'company-domain.json');
const previous = await readJson(markerPath);
const targetChanged =
  !previous || previous.domain !== domain || previous.slug !== slug;

if (targetChanged) {
  await rm(metaPath, { force: true });
}
await mkdir(cacheDir, { recursive: true });
await writeFile(
  markerPath,
  `${JSON.stringify({ slug, domain }, null, 2)}\n`,
  'utf8'
);

const coreDist = path.join(
  ROOT,
  'node_modules',
  '@evershop',
  'evershop',
  'dist'
);
const coreFile = (relativePath) =>
  pathToFileURL(path.join(coreDist, relativePath)).href;

// Registra os collectors do core (e das extensões) em um processo headless.
const { headlessBoot } = await import(
  coreFile('bin/lib/bootstrap/headlessBoot.js')
);
await headlessBoot({
  context: { process: 'import' },
  refreshSettings: true,
  loadRoutes: true
});

const { generateSitemap } = await import(
  '@evershop/evershop/base/services/sitemap'
);
const result = await generateSitemap({ force: true, baseUrl: domain });

const robotsTxt =
  typeof manifest.seo?.robotsTxt === 'string'
    ? manifest.seo.robotsTxt.trim()
    : '';

if (robotsTxt) {
  const publicDir = path.join(ROOT, 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(
    path.join(publicDir, 'robots.txt'),
    withSitemapDirective(robotsTxt, `${domain}/sitemap.xml`),
    'utf8'
  );
}

// Fecha o pool para o comando terminar; não altera dados.
try {
  const { pool } = await import(coreFile('lib/postgres/connection.js'));
  await pool?.end?.();
} catch {
  // Pool indisponível em algum ambiente de CI; nada a fechar.
}

console.log(
  `[company-sitemap] ${slug}: ${result.urlCount} URL(s) em ${result.files.length} arquivo(s), base=${domain}, force=${result.generated}.`
);
console.log(
  '[company-sitemap] XML gerados localmente; não executar git add/commit nestes artefatos.'
);
