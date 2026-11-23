#!/usr/bin/env node
// Verificações locais da Fase 3 (Mercado Livre e Shopee BR).
// Somente leitura: sem build, seed, migração, SQL, rede, publicação ou escrita em arquivos.
// Nunca imprime valores de segredos: as mensagens trazem apenas arquivo, linha e nome da variável/chave.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'extensions', 'marketplace-bridge');
const TESTS = path.join(EXTENSION, 'tests');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

// Nomes da seção 4 da especificação. IDs, URIs e SHOPEE_ENV não são segredos,
// mas em .env.example devem permanecer apenas como nomes, sem valor preenchido.
const MARKETPLACE_ENV_NAMES = Object.freeze([
  'MARKETPLACE_TOKEN_ENCRYPTION_KEY',
  'ML_APP_ID',
  'ML_CLIENT_SECRET',
  'ML_REDIRECT_URI',
  'ML_WEBHOOK_SECRET',
  'SHOPEE_PARTNER_ID',
  'SHOPEE_PARTNER_KEY',
  'SHOPEE_REDIRECT_URI',
  'SHOPEE_WEBHOOK_SECRET',
  'SHOPEE_ENV'
]);

// Apenas variáveis de segredo. DB_PASSWORD/ADMIN_PASSWORD ficam fora desta lista
// para não acusar a credencial de teste já existente no CI legado; em .env.example
// elas ainda são conferidas pelo sufixo (ver verificarEnvExample).
const SECRET_ENV_NAMES = Object.freeze([
  'MARKETPLACE_TOKEN_ENCRYPTION_KEY',
  'ML_CLIENT_SECRET',
  'ML_WEBHOOK_SECRET',
  'SHOPEE_PARTNER_KEY',
  'SHOPEE_WEBHOOK_SECRET'
]);

// Chaves com aparência de segredo que a especificação proíbe em config versionada.
const SECRET_KEY_NAMES = Object.freeze([
  'clientSecret',
  'partnerKey',
  'webhookSecret',
  'accessToken',
  'refreshToken',
  'apiKey',
  'tokenEncryptionKey'
]);

const PLACEHOLDER = /^(?:|troque[-_]?esta[-_]?senha[-_]?local|changeme|change[-_]?me|replace[-_]?me|todo|placeholder|redacted|\[redacted\]|preencher[-_ ]no[-_ ]cofre|segredo[_ ]local|seu[-_ ].+|xxx+|[*]{3,}|[.]{3,})$/i;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.evershop', 'dist', 'media', 'coverage', '.next', 'vendor', '.turbo'
]);

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yml', '.yaml',
  '.md', '.txt', '.sql', '.html', '.htm', '.xml', '.example', '.csv', '.graphql'
]);

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const relativoDe = (absoluto) => path.relative(ROOT, absoluto).split(path.sep).join('/');

/** Remove aspas externas, comentário inline de .env e espaços; nunca devolve segredo para exibição. */
function normalizarValor(valor) {
  let texto = String(valor ?? '').trim();
  if (texto.startsWith('#')) return '';
  if (texto.length >= 2) {
    const primeiro = texto[0];
    const ultimo = texto[texto.length - 1];
    if ((primeiro === '"' || primeiro === "'" || primeiro === '`') && ultimo === primeiro) {
      texto = texto.slice(1, -1).trim();
    }
  }
  return texto;
}

/** Usado apenas no .env.example: qualquer valor não placeholder é inadmissível (nomes apenas). */
function valorPermitido(valor) {
  const texto = normalizarValor(valor);
  if (texto === '') return true;
  if (/^<[^>]*>$/.test(texto)) return true;
  if (PLACEHOLDER.test(texto)) return true;
  if (/^(?:null|undefined|none|n\/a)$/i.test(texto)) return true;
  if (/^(?:process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env|os\s*\.\s*environ|env\s*\.)/.test(texto)) return true;
  if (/^[A-Za-z_$][\w$]*\s*(?:\.|\[|\()/.test(texto)) return true;
  if (/^\$\{/.test(texto)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(texto) && /(?:secret|token|key|senha|password|env|credencial|valor)/i.test(texto)) return true;
  return false;
}

function removerAspas(texto) {
  const valor = String(texto ?? '').trim();
  if (valor.length >= 2) {
    const primeiro = valor[0];
    const ultimo = valor[valor.length - 1];
    if ((primeiro === '"' || primeiro === "'" || primeiro === '`') && ultimo === primeiro) {
      return valor.slice(1, -1);
    }
  }
  return valor;
}

function valorLiteralSegredo(valor, { permitirTextoLongo = false } = {}) {
  const bruto = String(valor ?? '').trim();
  if (bruto === '') return null;
  const aspas = bruto[0] === '"' || bruto[0] === "'" || bruto[0] === '`';

  const interno = aspas ? removerAspas(bruto) : bruto;
  const texto = interno.trim();
  if (texto === '') return null;
  if (PLACEHOLDER.test(texto)) return null;
  if (/^(?:null|undefined|none|n\/a|true|false)$/i.test(texto)) return null;
  if (/^<[^>]*>$/.test(texto)) return null;
  if (/^\$\{/.test(texto)) return null;

  if (aspas) {
    // Só string literal com aparência real de credencial.
    if (texto.length < 8) return null;
    if (/[\\/]/.test(texto) && !/[A-Za-z0-9_-]{16,}/.test(texto)) return null;
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\([^)]*\))*$/.test(texto)) return null;
    const pareceCredencial = /^(?:[A-Za-z0-9+/=_-]{16,}|[A-Fa-f0-9]{32,})$/.test(texto) ||
      (texto.length >= 12 && /[A-Za-z]/.test(texto) && /\d/.test(texto));
    return pareceCredencial ? { aspas } : null;
  }

  // Não literal entre aspas: só aceite token textual longo, sem cara de código.
  if (!permitirTextoLongo) return null;
  if (!/^[A-Za-z0-9+/=_-]{24,}$/.test(texto)) return null;
  if (/^[A-Za-z_$][\w$]*$/.test(texto) && /[a-z]/.test(texto) && !/\d/.test(texto)) return null;
  const pareceCredencial = /^(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/=_-]{24,})$/.test(texto) &&
    (/\d/.test(texto) || /[+/=_-]/.test(texto));
  return pareceCredencial ? { aspas } : null;
}

function verificarEnvExample() {
  const problemas = [];
  if (!fs.existsSync(ENV_EXAMPLE)) {
    problemas.push('.env.example não encontrado na raiz do template.');
    return problemas;
  }

  const texto = fs.readFileSync(ENV_EXAMPLE, 'utf8').replace(/^\uFEFF/, '');
  const vistos = new Set();
  texto.split(/\r?\n/).forEach((linha, indice) => {
    const limpa = linha.trim();
    if (limpa === '' || limpa.startsWith('#')) return;

    const posicao = linha.indexOf('=');
    if (posicao === -1) return;

    const nome = linha.slice(0, posicao).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) return;

    if (vistos.has(nome)) {
      problemas.push(`.env.example:${indice + 1} — variável ${nome} repetida.`);
    }
    vistos.add(nome);

    const eMarketplace = MARKETPLACE_ENV_NAMES.includes(nome);
    const eSegredoLegado = /(?:PASSWORD|SECRET|TOKEN|_KEY)$/.test(nome);
    if (!eMarketplace && !eSegredoLegado) return;

    if (!valorPermitido(linha.slice(posicao + 1))) {
      problemas.push(
        `.env.example:${indice + 1} — ${nome} está preenchido; mantenha apenas o nome da variável ` +
          `(valor real somente no cofre/.env da instalação).`
      );
    }
  });

  return problemas;
}

function compilarNomes(nomes) {
  const alternancia = nomes.map(escapar).join('|');
  return new RegExp("([`\"']?)(" + alternancia + ")\\1", "gi");
}

function arquivoIgnorado(relativo, nome) {
  if (nome === '.env' || (nome.startsWith('.env.') && nome !== '.env.example')) return true;
  if (/^public\/sitemap[^/]*\.xml$/i.test(relativo)) return true;
  if (/\.(?:log|lock|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|pdf|zip|gz|tar|mp4|webm|map)$/i.test(nome)) return true;
  const extensao = path.extname(nome).toLowerCase();
  return extensao !== '' && !TEXT_EXT.has(extensao);
}

function listarArquivosTexto() {
  const encontrados = [];
  const pilha = [ROOT];
  while (pilha.length > 0) {
    const diretorio = pilha.pop();
    let entradas = [];
    try {
      entradas = fs.readdirSync(diretorio, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const absoluto = path.join(diretorio, entrada.name);
      const relativo = relativoDe(absoluto);
      if (entrada.isDirectory()) {
        if (!SKIP_DIRS.has(entrada.name)) pilha.push(absoluto);
        continue;
      }
      if (!entrada.isFile() || arquivoIgnorado(relativo, entrada.name)) continue;
      encontrados.push({ absoluto, relativo });
    }
  }
  return encontrados;
}

function extrairValorAtribuido(linha, inicio) {
  let i = inicio;
  while (i < linha.length && /\s/.test(linha[i])) i += 1;
  if (i >= linha.length) return null;

  const aspas = linha[i];
  if (aspas === '"' || aspas === "'" || aspas === '`') {
    let j = i + 1;
    let escapado = false;
    while (j < linha.length) {
      const c = linha[j];
      if (escapado) {
        escapado = false;
        j += 1;
        continue;
      }
      if (c === '\\') {
        escapado = true;
        j += 1;
        continue;
      }
      if (c === aspas) return linha.slice(i, j + 1);
      j += 1;
    }
    return linha.slice(i);
  }

  let j = i;
  let profundidade = 0;
  let stringAspas = null;
  let escapado = false;
  while (j < linha.length) {
    const c = linha[j];
    if (stringAspas) {
      if (escapado) {
        escapado = false;
      } else if (c === '\\') {
        escapado = true;
      } else if (c === stringAspas) {
        stringAspas = null;
      }
      j += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      stringAspas = c;
      j += 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') profundidade += 1;
    if (c === ')' || c === ']' || c === '}') profundidade = Math.max(0, profundidade - 1);
    if (profundidade === 0 && /[\s,;]/.test(c)) break;
    j += 1;
  }
  return linha.slice(i, j);
}

function verificarArquivosVersionados() {
  const problemas = [];
  const vistos = new Set();
  const padraoNomes = compilarNomes([...SECRET_ENV_NAMES, ...SECRET_KEY_NAMES]);

  for (const { absoluto, relativo } of listarArquivosTexto()) {
    let texto;
    try {
      const estado = fs.statSync(absoluto);
      if (!estado.isFile() || estado.size > 2 * 1024 * 1024) continue;
      texto = fs.readFileSync(absoluto, 'utf8');
    } catch {
      continue;
    }
    if (texto.includes('\0')) continue;

    const extensao = path.extname(absoluto).toLowerCase();
    const permitirTextoLongo = extensao === '.json';
    let emComentarioBloco = false;

    texto.split(/\r?\n/).forEach((linha, indice) => {
      let trecho = linha;
      if (emComentarioBloco) {
        const fim = trecho.indexOf('*/');
        if (fim === -1) return;
        trecho = trecho.slice(fim + 2);
        emComentarioBloco = false;
      }
      const inicioBloco = trecho.indexOf('/*');
      const inicioLinha = trecho.indexOf('//');
      let corte = trecho.length;
      if (inicioBloco !== -1) {
        corte = Math.min(corte, inicioBloco);
        if (trecho.indexOf('*/', inicioBloco + 2) === -1) emComentarioBloco = true;
      }
      if (inicioLinha !== -1) corte = Math.min(corte, inicioLinha);
      trecho = trecho.slice(0, corte);
      if (trecho.trim() === '') return;

      padraoNomes.lastIndex = 0;
      let ocorrencia = null;
      while ((ocorrencia = padraoNomes.exec(trecho)) !== null) {
        const nome = ocorrencia[2];
        const aposNome = ocorrencia.index + ocorrencia[0].length;
        let i = aposNome;
        while (i < trecho.length && /\s/.test(trecho[i])) i += 1;

        const charAnterior = trecho[ocorrencia.index - 1];
        const operador = trecho.slice(i, i + 3);
        const operador2 = trecho.slice(i, i + 2);
        const ehAtribuicao = trecho[i] === '=' && trecho[i + 1] !== '=' && trecho[i + 1] !== '>';
        const ehDoisPontos = trecho[i] === ':' && trecho[i + 1] !== '=';
        if (!ehAtribuicao && !ehDoisPontos) continue;
        if (/^[!=<>]/.test(charAnterior || '')) continue;
        if (operador === '===' || operador === '!==' || operador2 === '==' || operador2 === '!=' || operador2 === '=>' || operador2 === '<=' || operador2 === '>=') continue;

        const valor = extrairValorAtribuido(trecho, i + 1);
        if (!valorLiteralSegredo(valor, { permitirTextoLongo })) continue;

        const chave = `${relativo}:${indice + 1}:${nome}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        problemas.push(
          `${relativo}:${indice + 1} — ${nome} está preenchido com valor literal em arquivo versionado.`
        );
      }
    });
  }

  return problemas;
}

/** Redação defensiva de qualquer saída de subprocesso antes de exibi-la. */
function redactOutput(texto) {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((linha) =>
      linha.replace(
        /([A-Za-z_]*(?:secret|token|key|senha|password)[A-Za-z_]*\s*(?:=|:)\s*)([^\s,;}]+)/gi,
        '$1[REDACTED]'
      )
    )
    .join('\n');
}

function coletarArquivos(diretorio, extensoes) {
  const encontrados = [];
  if (!fs.existsSync(diretorio)) return encontrados;
  const pilha = [diretorio];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    let entradas = [];
    try {
      entradas = fs.readdirSync(atual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const absoluto = path.join(atual, entrada.name);
      if (entrada.isDirectory()) {
        if (!SKIP_DIRS.has(entrada.name)) pilha.push(absoluto);
        continue;
      }
      if (entrada.isFile() && extensoes.has(path.extname(entrada.name).toLowerCase())) {
        encontrados.push(absoluto);
      }
    }
  }
  return encontrados.sort();
}

function verificarSintaxe() {
  if (!fs.existsSync(EXTENSION)) {
    console.error('Extensão extensions/marketplace-bridge não encontrada.');
    return 1;
  }

  const arquivos = coletarArquivos(EXTENSION, new Set(['.js']));
  if (arquivos.length === 0) {
    console.error('Nenhum arquivo .js encontrado em extensions/marketplace-bridge.');
    return 1;
  }

  let falhas = 0;
  for (const absoluto of arquivos) {
    const resultado = spawnSync(process.execPath, ['--check', absoluto], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (resultado.status === 0) continue;

    const linha = (resultado.stderr || '').match(/:(\d+)/);
    console.error(
      `Falha de sintaxe em ${relativoDe(absoluto)}${linha ? `, linha ${linha[1]}` : ''}.`
    );
    if (resultado.stderr) process.stderr.write(redactOutput(resultado.stderr));
    falhas += 1;
  }

  if (falhas > 0) {
    console.error(`${falhas} arquivo(s) com falha de sintaxe.`);
    return 1;
  }

  console.log(`Sintaxe OK: ${arquivos.length} arquivo(s) .js verificado(s) com node --check.`);
  return 0;
}

function executarTestes() {
  if (!fs.existsSync(TESTS)) {
    console.error('Pasta extensions/marketplace-bridge/tests não encontrada.');
    return 1;
  }

  const arquivos = coletarArquivos(TESTS, new Set(['.mjs', '.js'])).filter((arquivo) =>
    /\.(?:test|spec)\.(?:mjs|js)$/i.test(arquivo)
  );
  if (arquivos.length === 0) {
    console.error('Nenhum teste *.test.mjs ou *.test.js encontrado em extensions/marketplace-bridge/tests.');
    return 1;
  }

  console.log(`Executando ${arquivos.length} arquivo(s) de teste local (sem rede).`);
  const resultado = spawnSync(process.execPath, ['--test', ...arquivos], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (resultado.stdout) process.stdout.write(redactOutput(resultado.stdout));
  if (resultado.stderr) process.stderr.write(redactOutput(resultado.stderr));
  if (resultado.error) {
    console.error('Falha ao iniciar node --test: ' + resultado.error.message);
    return 1;
  }
  return resultado.status === null ? 1 : resultado.status;
}

function main() {
  const modo = String(process.argv[2] || '--secrets').toLowerCase();

  if (modo === '--help' || modo === '-h') {
    console.log('Uso: node scripts/check-marketplace-secrets.mjs [--secrets | --check | --help]');
    console.log('  --secrets (padrão): confere .env.example e arquivos versionados, sem exibir valores.');
    console.log('  --check: executa node --check nos .js da extensão e node --test nos testes locais.');
    return 0;
  }

  if (modo === '--check') {
    const sintaxe = verificarSintaxe();
    if (sintaxe !== 0) return sintaxe;
    return executarTestes();
  }

  if (modo === '--secrets') {
    const problemas = [...new Set([...verificarEnvExample(), ...verificarArquivosVersionados()])];
    if (problemas.length === 0) {
      console.log('Nenhum segredo versionado detectado.');
      return 0;
    }
    console.error('Possíveis segredos versionados detectados:');
    for (const problema of problemas) console.error('- ' + problema);
    console.error(
      'Nenhum valor de segredo foi exibido. Retire o valor do arquivo versionado e use o cofre/.env da instalação.'
    );
    return 1;
  }

  console.error('Modo desconhecido. Use --secrets, --check ou --help.');
  return 1;
}

process.exitCode = main();
