import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Padrões proibidos para o template público genérico.
// Strings divididas para evitar auto-detecção acidental em alguns contextos.
const FORBIDDEN = [
  { id: 'nome-castro', re: /Castro/g },
  { id: 'hidroeletrica', re: /Hidroel[\u00e9e]trica/gi },
  { id: 'qnp', re: /\bQNP\b/g },
  { id: 'st-p-sul', re: /St\.?\s*P\s*Sul/gi },
  { id: 'ceilandia', re: /Ceil[\u00e2a]ndia/gi },
  { id: 'brasilia-real', re: /Bras[\u00ed]lia,\s*DF/gi },
  { id: 'cep-real', re: /\b72231-\d{3}\b/g },
  { id: 'telefone-real-3376', re: /\b3376[-\s]?8677\b/g },
  { id: 'whatsapp-real', re: /\b(?:\+?55\s*)?(?:\(61\)\s*)?99192[-\s]?3208\b/g },
  { id: 'wa-e164-real', re: /\b5561991923208\b/g },
  { id: 'facebook-real-id', re: /100068056431851/g },
  { id: 'repo-privado', re: /Hidroel-trica-Castro-MVP/g },
  { id: 'usuario-tyago', re: /\bTyago\b/gi },
  { id: 'path-absoluto-usuario', re: /C:\\Users\\tyago/gi },
  { id: 'dominio-castro', re: /hidroeletricacastro\.com\.br/gi },
  { id: 'sku-hc', re: /\bHC-\d{3}\b/g },
];

const IGNORE = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.evershop\//,
  /(^|\/)\.git\//,
  /(^|\/)media\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)scripts\/check-company-leaks\.mjs$/, // este arquivo contém os padrões
];

function parseArgs(argv) {
  const out = { html: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--html') { out.html = argv[++i]; if (!out.html) throw new Error('--html requer URL'); }
    else if (a.startsWith('--html=')) { out.html = a.slice(7); }
    else if (a === '--help' || a === '-h') { console.log('Uso: node scripts/check-company-leaks.mjs [--html <url>]'); process.exit(0); }
    else throw new Error('argumento desconhecido: ' + a);
  }
  return out;
}

function trackedOrAllFiles() {
  try {
    const raw = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return raw.toString('utf8').split('\0').filter(Boolean).map(p => p.split(path.sep).join('/'));
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (IGNORE.some(re => re.test(rel))) continue;
        if (e.isDirectory()) walk(full);
        else out.push(rel);
      }
    };
    walk(ROOT);
    return out;
  }
}

function isIgnored(rel) { return IGNORE.some(re => re.test(rel)); }

function scan(rel, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const rule of FORBIDDEN) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        findings.push({ file: rel, line: idx + 1, col: m.index + 1, rule: rule.id, value: m[0] });
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
      }
    }
  });
  return findings;
}

function scanFile(rel) {
  if (isIgnored(rel)) return [];
  let buf;
  try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch { return []; }
  if (buf.includes(0)) return [];
  return scan(rel, buf.toString('utf8'));
}

async function scanHtml(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Use http(s)');
  const res = await fetch(parsed, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return scan(url, await res.text());
}

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }

const findings = [];
try {
  const files = [...new Set(trackedOrAllFiles())];
  findings.push(...files.flatMap(scanFile));
  if (opts.html) findings.push(...(await scanHtml(opts.html)));
} catch (e) { console.error('falha na varredura: ' + e.message); process.exit(1); }

if (findings.length > 0) {
  for (const f of findings) console.log(`${f.file}:${f.line}:${f.col} [${f.rule}] ${f.value}`);
  console.error(`${findings.length} ocorrência(s) proibida(s).`);
  process.exit(1);
}
console.log('Nenhum vazamento detectado.');
