#!/usr/bin/env node
/**
 * Provisiona uma nova empresa white-label em uma instalação isolada.
 *
 * Uso (a senha NUNCA é argumento nem entra no manifesto):
 *   COMPANY_ADMIN_PASSWORD='...' npm run company:create -- \
 *     --slug=loja-exemplo \
 *     --domain=https://lojaexemplo.com.br \
 *     --admin-email=admin@lojaexemplo.com.br \
 *     --admin-password=COMPANY_ADMIN_PASSWORD \
 *     --port=3000
 *
 * Alternativa para cofre de segredos: --admin-password-file=/caminho/secret
 * Use --dry-run para validar entradas, dependências, porta e DB sem efeitos.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(HERE, '..');

/** Contexto da execução (preenchido em main). */
let ctx;

const USAGE = `
Uso: npm run company:create -- --slug=<slug> [--domain=https://...] \
  --admin-email=<email> --admin-password=<NOME_DA_ENV> [--admin-password-file=<arquivo>] \
  [--port=3000] [--dry-run] [--confirm-drop-db] [--install-deps]

  --slug                    lowercase, hífens; usado em companies/<slug>/ e nos identificadores PG.
  --domain                  URL pública real (http/https). Opcional; sem ele não há sitemap.
  --admin-email             E-mail do primeiro administrador.
  --admin-password          NOME de variável de ambiente (default: COMPANY_ADMIN_PASSWORD).
                            Não aceita senha em claro na linha de comando.
  --admin-password-file     Alternativa: ler a senha de um arquivo/cofre.
  --port                    1024-65535, livre no localhost.
  --dry-run                 Só valida e imprime o plano; não grava, não roda SQL/comandos.
  --confirm-drop-db         Autoriza dropar um DB criado por esta execução MESMO com dados.
  --install-deps            npm ci na cópia em vez de vincular node_modules da base.
`;

const STEPS = [
  ['validate', 'Validar entradas, dependências, porta e DB'],
  ['prepare', 'Criar companies/<slug>/ e provision.json'],
  ['database', 'Criar role e database PostgreSQL dedicados'],
  ['copy', 'Copiar base para companies/<slug>/'],
  ['env', 'Gravar .env (senhas do DB apenas em disco local)'],
  ['node-modules', 'Vincular node_modules da base (ou npm ci)'],
  ['postinstall', 'Aplicar patches idempotentes via postinstall'],
  ['render', 'Renderizar manifesto (npm run company:render, COMPANY_SLUG)'],
  ['setup', 'Schema + primeiro admin (scripts/install-headless.mjs)'],
  ['seed-company', 'Seeds da empresa (scripts/seed-company.mjs)'],
  ['seed-widgets', 'Widgets/CMS (scripts/seed-homepage-widgets.mjs)'],
  ['seed-metadata', 'Metadata e rewrites (scripts/seed-metadata-cms.mjs)'],
  ['build', 'Build de tema/extensão e bundles'],
  ['sitemap', 'Gerar sitemap (scripts/render-company-sitemap.mjs)'],
  ['start', 'Subir servidor em background'],
  ['healthcheck', 'Verificar HTTP / e /admin']
];

const now = () => new Date().toISOString();
const flag = (name) => path.basename(name);

function parseArgs(argv) {
  const opts = {
    slug: null,
    domain: undefined,
    adminEmail: null,
    adminPasswordEnv: null,
    adminPasswordFile: null,
    port: null,
    dryRun: false,
    help: false,
    confirmDropDb: false,
    installDeps: false
  };
  const booleans = new Set(['dry-run', 'help', 'confirm-drop-db', 'install-deps']);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Argumento inesperado: ${token}`);
    const eq = token.indexOf('=');
    const name = token.slice(2, eq === -1 ? undefined : eq);
    let value = eq === -1 ? undefined : token.slice(eq + 1);

    if (booleans.has(name)) {
      if (value !== undefined) throw new Error(`--${name} não aceita valor`);
      opts[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
      continue;
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i += 1;
      }
    }
    switch (name) {
      case 'slug':
        opts.slug = value;
        break;
      case 'domain':
        opts.domain = value;
        break;
      case 'admin-email':
        opts.adminEmail = value;
        break;
      case 'admin-password':
        // O valor é o NOME da env; senha em claro na CLI é recusada.
        opts.adminPasswordEnv = value || 'COMPANY_ADMIN_PASSWORD';
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(opts.adminPasswordEnv)) {
          throw new Error(
            '--admin-password recebe o NOME da variável de ambiente, não a senha. ' +
              'Ex.: --admin-password=COMPANY_ADMIN_PASSWORD'
          );
        }
        break;
      case 'admin-password-file':
        opts.adminPasswordFile = value;
        break;
      case 'port':
        opts.port = value;
        break;
      default:
        throw new Error(`Opção desconhecida: --${name}`);
    }
  }
  return opts;
}

function validateOpts(opts) {
  if (opts.help) return;
  if (!opts.slug) throw new Error('--slug é obrigatório');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(opts.slug) || opts.slug.length > 40) {
    throw new Error('--slug deve ser lowercase com hífens (máx. 40 caracteres)');
  }
  if (['schema', '_template', '.rollback', 'loja-exemplo'].includes(opts.slug)) {
    throw new Error(`Slug reservado (baseline/protegido): ${opts.slug}`);
  }
  if (!opts.adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.adminEmail)) {
    throw new Error('--admin-email é obrigatório e deve ser um e-mail válido');
  }
  if (opts.adminPasswordFile && opts.adminPasswordEnv) {
    throw new Error('Use --admin-password ou --admin-password-file, não ambos');
  }
  const port = Number(opts.port);
  if (!opts.port || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('--port deve ser um inteiro entre 1024 e 65535');
  }
  opts.port = port;

  if (opts.domain !== undefined) {
    if (!opts.domain) {
      opts.domain = null;
    } else {
      let url;
      try {
        url = new URL(opts.domain);
      } catch {
        throw new Error('--domain deve ser uma URL completa, ex.: https://lojaexemplo.com.br');
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('--domain deve usar http:// ou https://');
      }
      opts.domain = url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''));
    }
  }
}

async function resolveAdminSecret(opts) {
  let secret;
  if (opts.adminPasswordFile) {
    secret = (await readFile(path.resolve(opts.adminPasswordFile), 'utf8')).trim();
  } else {
    const envName = opts.adminPasswordEnv || 'COMPANY_ADMIN_PASSWORD';
    secret = process.env[envName] ?? process.env.ADMIN_PASSWORD;
    if (!secret) {
      throw new Error(
        `Defina ${envName} no ambiente (ou use --admin-password-file). ` +
          'A senha nunca vai no manifesto nem na linha de comando.'
      );
    }
  }
  if (secret.length < 8) throw new Error('A senha do admin deve ter ao menos 8 caracteres');
  return secret;
}

function pgIdentifier(raw) {
  const stem = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 6);
  return `${stem}_${hash}`.slice(0, 63);
}
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const quoteLiteral = (value) => `'${String(value).replace(/'/g, "''").replace(/\0/g, '')}'`;

function portIsFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function adminDbConfig() {
  return {
    host: process.env.PGADMIN_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.PGADMIN_PORT || process.env.DB_PORT || 5432),
    user: process.env.PGADMIN_USER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.PGADMIN_PASSWORD || process.env.POSTGRES_PASSWORD || '',
    database: process.env.PGADMIN_DATABASE || 'postgres'
  };
}

async function getAdminPool(ctx) {
  if (!ctx.adminPool) ctx.adminPool = new ctx.Pool(adminDbConfig());
  return ctx.adminPool;
}

async function fileExists(file) {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function loadManifest(slug) {
  const file = path.join(BASE, 'companies', `${slug}.json`);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.schema !== 1) throw new Error(`Manifesto ${file} deve ter schema: 1`);
  if (manifest.slug !== slug) throw new Error(`Manifesto ${file} declara slug "${manifest.slug}"`);
  return manifest;
}

async function preflight(ctx) {
  const { opts } = ctx;
  const missing = [];

  try {
    ctx.manifest = await loadManifest(opts.slug);
  } catch (error) {
    missing.push(`companies/${opts.slug}.json (${error.message})`);
  }

  for (const rel of [
    'scripts/render-company-config.mjs',
    'scripts/seed-company.mjs',
    'scripts/render-company-sitemap.mjs'
  ]) {
    if (!(await fileExists(path.join(BASE, rel)))) missing.push(rel);
  }

  const pkg = JSON.parse(await readFile(path.join(BASE, 'package.json'), 'utf8'));
  for (const script of ['company:create', 'company:render']) {
    if (!pkg.scripts?.[script]) missing.push(`package.json → script "${script}"`);
  }
  if (!opts.installDeps && !(await fileExists(path.join(BASE, 'node_modules')))) {
    missing.push('node_modules da base (use --install-deps)');
  }

  ctx.portFree = await portIsFree(opts.port);
  if (!ctx.portFree) missing.push(`porta ${opts.port} ocupada no localhost`);

  try {
    ctx.Pool = (await import('pg')).Pool;
    const pool = await getAdminPool(ctx);
    const [dbResult, roleResult] = await Promise.all([
      pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [ctx.dbName]),
      pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ctx.roleName])
    ]);
    ctx.dbExists = dbResult.rowCount > 0;
    ctx.roleExists = roleResult.rowCount > 0;
    if (ctx.dbExists) missing.push(`database "${ctx.dbName}" já existe`);
    if (ctx.roleExists) missing.push(`role "${ctx.roleName}" já existe`);
  } catch (error) {
    ctx.dbCheckError = error.message;
    missing.push(`PostgreSQL admin: ${error.message}`);
  }

  if (missing.length && !opts.dryRun) {
    throw new Error(`Dependências/pré-requisitos ausentes:\n  - ${missing.join('\n  - ')}`);
  }
  ctx.missing = missing;
}

function writeProvision(ctx, patch = {}) {
  if (ctx.opts.dryRun) return Promise.resolve();
  Object.assign(ctx.provision, patch, { updatedAt: now() });
  const target = path.join(ctx.companyDir, 'provision.json');
  const temp = `${target}.tmp`;
  return writeFile(temp, `${JSON.stringify(ctx.provision, null, 2)}\n`, {
    mode: 0o600
  }).then(() => rename(temp, target));
}

async function runStep(ctx, id, action) {
  const step = ctx.provision.steps.find((item) => item.id === id);
  if (!step) throw new Error(`Etapa desconhecida: ${id}`);
  step.status = 'running';
  step.startedAt = now();
  await writeProvision(ctx);
  try {
    step.detail = (await action()) ?? null;
    step.status = 'done';
    step.finishedAt = now();
    await writeProvision(ctx);
    console.log(`[ok] ${id}${step.detail ? ` — ${step.detail}` : ''}`);
  } catch (error) {
    step.status = 'failed';
    step.error = String(error.message || error);
    step.finishedAt = now();
    await writeProvision(ctx);
    throw error;
  }
}

async function skipStep(ctx, id, reason) {
  const step = ctx.provision.steps.find((item) => item.id === id);
  step.status = 'skipped';
  step.detail = reason;
  await writeProvision(ctx);
  console.log(`[skip] ${id} — ${reason}`);
}

function npmInvocation(args) {
  if (process.env.npm_execpath) {
    return [process.execPath, [process.env.npm_execpath, ...args]];
  }
  return [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];
}

async function runCommand(ctx, label, command, args, extraEnv = {}, cwd = ctx.companyDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...ctx.childEnv, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`${label} falhou (exit ${code})${stderr ? `: ${stderr.trim().slice(-600)}` : ''}`));
    });
  });
}

const runNpm = (ctx, label, args, extraEnv) => {
  const [command, commandArgs] = npmInvocation(args);
  return runCommand(ctx, label, command, commandArgs, extraEnv);
};
const runNode = (ctx, rel, extraEnv) =>
  runCommand(ctx, rel, process.execPath, [path.join(ctx.companyDir, rel)], extraEnv);

async function createDatabase(ctx) {
  const pool = await getAdminPool(ctx);
  await pool.query(
    `CREATE ROLE ${quoteIdent(ctx.roleName)} LOGIN PASSWORD ${quoteLiteral(ctx.dbPassword)}`
  );
  ctx.roleCreated = true;
  // CREATE DATABASE não pode rodar dentro de transação.
  await pool.query(
    `CREATE DATABASE ${quoteIdent(ctx.dbName)} OWNER ${quoteIdent(ctx.roleName)}`
  );
  ctx.dbCreated = true;

  const probe = new ctx.Pool({
    host: adminDbConfig().host,
    port: adminDbConfig().port,
    database: ctx.dbName,
    user: ctx.roleName,
    password: ctx.dbPassword,
    ssl: false
  });
  try {
    const result = await probe.query('SELECT current_database() AS db, current_user AS usr');
    return `conectado como ${result.rows[0].usr} em ${result.rows[0].db}`;
  } finally {
    await probe.end();
  }
}

async function copyBase(ctx) {
  await cp(BASE, ctx.companyDir, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(BASE, source);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      const top = parts[0];
      if (['node_modules', '.git', '.evershop', 'media', 'logs', '.rollback'].includes(top)) {
        return false;
      }
      if (top === 'companies' && parts[1] === ctx.opts.slug) return false;
      if (top === 'public' && /^sitemap.*\.xml$/i.test(parts[1] || '')) return false;
      if (['themes', 'extensions'].includes(top) && parts[2] === 'dist') return false;
      return true;
    }
  });
  return ctx.companyDir;
}

async function writeEnv(ctx) {
  const homeUrl = ctx.opts.domain || `http://localhost:${ctx.opts.port}`;
  const lines = [
    '# Gerado por scripts/company-create.mjs — não versionar.',
    `DB_HOST="${adminDbConfig().host}"`,
    `DB_PORT="${adminDbConfig().port}"`,
    `DB_NAME="${ctx.dbName}"`,
    `DB_USER="${ctx.roleName}"`,
    `DB_PASSWORD="${ctx.dbPassword}"`,
    'DB_SSLMODE="disable"',
    `PORT="${ctx.opts.port}"`,
    `HOME_URL="${homeUrl}"`,
    `EVERSHOP_HOME_URL="${homeUrl}"`,
    `COMPANY_SLUG="${ctx.opts.slug}"`,
    ctx.opts.domain ? `COMPANY_DOMAIN="${ctx.opts.domain}"` : null,
    ctx.manifest?.theme ? `THEME="${ctx.manifest.theme}"` : null
  ].filter(Boolean);
  await writeFile(path.join(ctx.companyDir, '.env'), `${lines.join('\n')}\n`, { mode: 0o600 });
  // ADMIN_* NÃO é gravado: segredos são injetados apenas no env dos filhos.
  return '.env gravado (senha do DB não exibida; senha do admin não persistida)';
}

async function linkNodeModules(ctx) {
  if (ctx.opts.installDeps) {
    await runNpm(ctx, 'npm ci', ['ci']);
    return 'npm ci na cópia';
  }
  ctx.linkPath = path.join(ctx.companyDir, 'node_modules');
  await symlink(path.join(BASE, 'node_modules'), ctx.linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  ctx.linkedNodeModules = true;
  return 'junction/symlink para node_modules da base (patches compartilhados)';
}

async function startServer(ctx) {
  await mkdir(path.join(ctx.companyDir, 'logs'), { recursive: true });
  const log = await open(path.join(ctx.companyDir, 'logs', 'server.log'), 'a');
  try {
    const [command, args] = npmInvocation(['start']);
    const child = spawn(command, args, {
      cwd: ctx.companyDir,
      env: ctx.childEnv,
      detached: process.platform !== 'win32',
      stdio: ['ignore', log.fd, log.fd],
      windowsHide: true
    });
    ctx.serverPid = child.pid;
    child.unref();
    await writeFile(path.join(ctx.companyDir, 'server.pid'), `${child.pid}\n`);
    return `PID ${child.pid}`;
  } finally {
    await log.close();
  }
}

async function killServer(ctx) {
  if (!ctx.serverPid) return;
  if (process.platform === 'win32') {
    await runCommand(ctx, 'taskkill', 'taskkill', ['/PID', String(ctx.serverPid), '/T', '/F'], {}, BASE);
  } else {
    try {
      process.kill(-ctx.serverPid, 'SIGTERM');
    } catch {
      process.kill(ctx.serverPid, 'SIGTERM');
    }
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthcheck(ctx) {
  const base = `http://127.0.0.1:${ctx.opts.port}`;
  const paths = ['/', '/admin'];
  const failures = [];
  for (const route of paths) {
    let ok = false;
    for (let attempt = 0; attempt < 24 && !ok; attempt += 1) {
      try {
        const response = await fetch(`${base}${route}`, {
          signal: AbortSignal.timeout(2500)
        });
        ok = response.ok;
      } catch {
        // servidor ainda subindo
      }
      if (!ok) await delay(500);
    }
    if (!ok) failures.push(route);
  }
  if (failures.length) throw new Error(`Healthcheck falhou em: ${failures.join(', ')}`);
  return `${base}/ e ${base}/admin responderam 200`;
}

async function databaseHasData(ctx) {
  try {
    const appPool = new ctx.Pool({
      host: adminDbConfig().host,
      port: adminDbConfig().port,
      database: ctx.dbName,
      user: ctx.roleName,
      password: ctx.dbPassword,
      ssl: false
    });
    try {
      const tables = await appPool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const known = new Set(tables.rows.map((row) => row.table_name));
      for (const table of ['customer', 'order', 'product', 'cms_page', 'widget_instance', 'admin_user']) {
        if (!known.has(table)) continue;
        const result = await appPool.query(`SELECT COUNT(*)::int AS total FROM ${quoteIdent(table)}`);
        if (result.rows[0]?.total > 0) return true;
      }
      return false;
    } finally {
      await appPool.end();
    }
  } catch {
    // Sem conseguir inspecionar, preserve o DB (rollback conservador).
    return true;
  }
}

async function rollback(ctx, error) {
  const notes = [];

  if (ctx.serverPid) {
    try {
      await killServer(ctx);
      notes.push('servidor interrompido');
    } catch (killError) {
      notes.push(`falha ao parar servidor: ${killError.message}`);
    }
  }

  if (ctx.dbCreated) {
    try {
      const hasData = await databaseHasData(ctx);
      if (hasData && !ctx.opts.confirmDropDb) {
        notes.push(
          `DB ${ctx.dbName} MANTIDO: contém dados. Reavalie; --confirm-drop-db autoriza remoção.`
        );
      } else {
        const pool = await getAdminPool(ctx);
        await pool.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [ctx.dbName]
        );
        await pool.query(`DROP DATABASE IF EXISTS ${quoteIdent(ctx.dbName)}`);
        if (ctx.roleCreated) await pool.query(`DROP ROLE IF EXISTS ${quoteIdent(ctx.roleName)}`);
        notes.push('DB/role criados nesta execução removidos');
      }
    } catch (dbError) {
      notes.push(`falha no rollback do DB: ${dbError.message}`);
    }
  }

  if (ctx.linkedNodeModules && ctx.linkPath) {
    try {
      const stat = await lstat(ctx.linkPath);
      if (stat.isSymbolicLink()) await unlink(ctx.linkPath); // nunca rm -rf: não apagar a base
    } catch {
      // link já removido ou inexistente.
    }
  }

  ctx.provision.rollback = {
    at: now(),
    triggeredBy: String(error.message || error),
    notes
  };
  await writeProvision(ctx);

  if (await fileExists(ctx.companyDir)) {
    const rollbackRoot = path.join(BASE, 'companies', '.rollback');
    await mkdir(rollbackRoot, { recursive: true });
    const target = path.join(rollbackRoot, `${ctx.opts.slug}-${Date.now()}`);
    try {
      await rename(ctx.companyDir, target);
      ctx.finalPath = target;
    } catch {
      notes.push(`não foi possível mover a pasta; estado mantido em ${ctx.companyDir}`);
      await writeProvision(ctx).catch(() => {});
    }
  }
  return notes;
}

function printDryRun(ctx) {
  console.log(`DRY-RUN — nada foi gravado; nenhum SQL de alteração/comando foi executado.`);
  console.log(`slug: ${ctx.opts.slug}`);
  console.log(`domínio: ${ctx.opts.domain || '(ausente — sitemap será ignorado)'}`);
  console.log(`porta: ${ctx.opts.port} ${ctx.portFree ? '(livre)' : '(OCUPADA)'}`);
  console.log(`database/role: ${ctx.dbName} / ${ctx.roleName}`);
  console.log(`pasta: ${ctx.companyDir}`);
  if (ctx.missing.length) console.log(`pendências:\n  - ${ctx.missing.join('\n  - ')}`);
  console.log('etapas planejadas:');
  for (const [id, label] of STEPS) console.log(`  - ${id}: ${label}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  validateOpts(opts);
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  ctx = {
    opts,
    dbName: pgIdentifier(`db_${opts.slug}`),
    roleName: pgIdentifier(`role_${opts.slug}`),
    dbPassword: randomBytes(24).toString('base64url'),
    companyDir: path.join(BASE, 'companies', opts.slug),
    finalPath: path.join(BASE, 'companies', opts.slug),
    manifest: null,
    missing: [],
    dbCreated: false,
    roleCreated: false,
    linkedNodeModules: false,
    serverPid: null,
    adminPool: null,
    provision: null,
    childEnv: null
  };

  try {
    await preflight(ctx);
  } catch (error) {
    console.error(`Pré-validação falhou: ${error.message}`);
    await ctx.adminPool?.end().catch(() => {});
    process.exitCode = 1;
    return;
  }

  ctx.provision = {
    schema: 1,
    slug: opts.slug,
    domain: opts.domain ?? null,
    port: opts.port,
    database: ctx.dbName,
    role: ctx.roleName,
    adminEmail: opts.adminEmail,
    adminPasswordSource: opts.adminPasswordFile
      ? `file:${flag(opts.adminPasswordFile)}`
      : `env:${opts.adminPasswordEnv || 'COMPANY_ADMIN_PASSWORD'}`,
    mode: opts.dryRun ? 'dry-run' : 'apply',
    startedAt: now(),
    steps: STEPS.map(([id, label]) => ({ id, label, status: 'pending' }))
  };

  if (opts.dryRun) {
    printDryRun(ctx);
    return;
  }

  const adminSecret = await resolveAdminSecret(opts);
  ctx.childEnv = {
    ...process.env,
    DB_HOST: adminDbConfig().host,
    DB_PORT: String(adminDbConfig().port),
    DB_NAME: ctx.dbName,
    DB_USER: ctx.roleName,
    DB_PASSWORD: ctx.dbPassword,
    DB_SSLMODE: 'disable',
    PORT: String(opts.port),
    HOME_URL: opts.domain || `http://localhost:${opts.port}`,
    COMPANY_SLUG: opts.slug,
    COMPANY_DOMAIN: opts.domain || '',
    ...(ctx.manifest?.name ? { ADMIN_FULLNAME: ctx.manifest.name } : {}),
    ADMIN_EMAIL: opts.adminEmail,
    ADMIN_PASSWORD: adminSecret
  };

  // A primeira escrita em provision.json precisa do diretório existindo.
  await mkdir(ctx.companyDir, { recursive: true });
  const validateStep = ctx.provision.steps.find((step) => step.id === 'validate');
  validateStep.status = 'done';
  validateStep.finishedAt = now();
  validateStep.detail = ctx.missing.length
    ? `validação concluída com pendências: ${ctx.missing.join('; ')}`
    : 'entradas, dependências, porta e DB validados';
  await writeProvision(ctx);

  try {
    await runStep(ctx, 'prepare', async () => {
      await mkdir(ctx.companyDir, { recursive: true });
      await writeProvision(ctx);
      return ctx.companyDir;
    });

    await runStep(ctx, 'database', () => createDatabase(ctx));
    await runStep(ctx, 'copy', () => copyBase(ctx));
    await runStep(ctx, 'env', () => writeEnv(ctx));
    await runStep(ctx, 'node-modules', () => linkNodeModules(ctx));
    await runStep(ctx, 'postinstall', () => runNpm(ctx, 'postinstall', ['run', 'postinstall']));
    await runStep(ctx, 'render', () => runNpm(ctx, 'company:render', ['run', 'company:render']));
    await runStep(ctx, 'setup', () => runNpm(ctx, 'setup', ['run', 'setup']));
    await runStep(ctx, 'seed-company', () => runNode(ctx, 'scripts/seed-company.mjs'));
    await runStep(ctx, 'seed-widgets', () => runNode(ctx, 'scripts/seed-homepage-widgets.mjs'));
    await runStep(ctx, 'seed-metadata', () => runNode(ctx, 'scripts/seed-metadata-cms.mjs'));
    await runStep(ctx, 'build', () => runNpm(ctx, 'build', ['run', 'build']));
    if (opts.domain) {
      await runStep(ctx, 'sitemap', () =>
        runNode(ctx, 'scripts/render-company-sitemap.mjs', { COMPANY_DOMAIN: opts.domain })
      );
    } else {
      await skipStep(ctx, 'sitemap', 'sem --domain/manifesto: nada inventado');
    }
    await runStep(ctx, 'start', () => startServer(ctx));
    await runStep(ctx, 'healthcheck', () => healthcheck(ctx));

    ctx.provision.finishedAt = now();
    ctx.provision.result = 'success';
    await writeProvision(ctx);
  } catch (error) {
    ctx.provision.result = 'failed';
    ctx.provision.finishedAt = now();
    await writeProvision(ctx);
    const notes = await rollback(ctx, error);
    console.error(`Falha na provisão: ${error.message}`);
    for (const note of notes) console.error(`rollback: ${note}`);
    process.exitCode = 1;
  } finally {
    await ctx.adminPool?.end().catch(() => {});
  }

  console.log(`Estado: ${ctx.finalPath}`);
  console.log(`Provision: ${path.join(ctx.finalPath, 'provision.json')}`);
}

await main();
