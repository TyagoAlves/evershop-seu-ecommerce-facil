#!/usr/bin/env node
/**
 * Validador independente das configurações não secretas de marketplaces.
 *
 * - somente leitura: não grava arquivos, não toca em banco, rede, dist ou .evershop;
 * - lê companies/schema.marketplaces.json e todos os companies/*.marketplaces.json;
 * - usa apenas módulos internos do Node.js (sem dependências externas);
 * - imprime em pt-BR e nunca exibe valores de configuração ou nomes de chaves sensíveis;
 * - termina com código diferente de zero se houver qualquer erro.
 *
 * Uso: node scripts/validate-marketplaces-config.mjs [--help]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_EMPRESAS = path.join(RAIZ, 'companies');
const CAMINHO_SCHEMA = path.join(PASTA_EMPRESAS, 'schema.marketplaces.json');
const SUFIXO = '.marketplaces.json';
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const AJUDA = [
  'Uso: node scripts/validate-marketplaces-config.mjs [--help]',
  'Valida companies/*.marketplaces.json contra companies/schema.marketplaces.json.',
  'Execução somente leitura; nenhum valor de configuração é exibido.'
].join('\n');

function ehObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function correspondeTipo(valor, tipo) {
  switch (tipo) {
    case 'object': return ehObjeto(valor);
    case 'array': return Array.isArray(valor);
    case 'null': return valor === null;
    case 'integer': return Number.isInteger(valor);
    case 'number': return typeof valor === 'number' && Number.isFinite(valor);
    case 'boolean': return typeof valor === 'boolean';
    case 'string': return typeof valor === 'string';
    default: return false;
  }
}

function iguais(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function erro(caminho, mensagem) {
  return { caminho, mensagem };
}

function caminhoFilho(caminho, chave) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(chave))) return `${caminho}.${chave}`;
  return `${caminho}.(chave-omitida)`;
}

function pareceSecreto(chave) {
  const nome = String(chave).toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    'secret',
    'token',
    'password',
    'apikey',
    'partnerkey',
    'clientsecret',
    'accesstoken',
    'refreshtoken',
    'senha',
    'chaveprivada'
  ].some((termo) => nome.includes(termo));
}

function resolverRef(ref, raiz) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let atual = raiz;
  for (const parte of ref.slice(2).split('/')) {
    if (!ehObjeto(atual) || !Object.prototype.hasOwnProperty.call(atual, parte)) return null;
    atual = atual[parte];
  }
  return atual;
}

function seguirRef(no, raiz) {
  let atual = no;
  const vistos = new Set();
  while (ehObjeto(atual) && typeof atual.$ref === 'string') {
    if (vistos.has(atual.$ref)) return null;
    vistos.add(atual.$ref);
    atual = resolverRef(atual.$ref, raiz);
  }
  return atual;
}

/** Subconjunto de JSON Schema 2020-12 usado por companies/schema.marketplaces.json. */
function validarNo(no, valor, caminho, erros, contexto) {
  if (no === true) return;
  if (no === false) {
    erros.push(erro(caminho, 'valor não permitido pelo schema'));
    return;
  }
  if (!ehObjeto(no)) {
    erros.push(erro(caminho, 'schema interno inválido'));
    return;
  }

  if (typeof no.$ref === 'string') {
    const alvo = resolverRef(no.$ref, contexto.raiz);
    if (!alvo) erros.push(erro(caminho, 'referência interna do schema não encontrada'));
    else validarNo(alvo, valor, caminho, erros, contexto);
  }

  if (no.type !== undefined) {
    const tipos = Array.isArray(no.type) ? no.type : [no.type];
    if (!tipos.some((tipo) => correspondeTipo(valor, tipo))) {
      erros.push(erro(caminho, `tipo inválido (esperado: ${tipos.join(' | ')})`));
      return;
    }
  }

  if (Object.prototype.hasOwnProperty.call(no, 'const') && !iguais(no.const, valor)) {
    erros.push(erro(caminho, 'valor diferente do valor obrigatório'));
  }
  if (Array.isArray(no.enum) && !no.enum.some((opcao) => iguais(opcao, valor))) {
    erros.push(erro(caminho, 'valor fora da lista permitida'));
  }
  if (typeof no.pattern === 'string' && typeof valor === 'string') {
    try {
      if (!new RegExp(no.pattern).test(valor)) {
        erros.push(erro(caminho, 'formato inválido'));
      }
    } catch {
      erros.push(erro(caminho, 'padrão inválido no schema'));
    }
  }
  if (typeof no.minLength === 'number' && typeof valor === 'string' && valor.length < no.minLength) {
    erros.push(erro(caminho, 'texto curto demais'));
  }
  if (typeof no.minimum === 'number' && typeof valor === 'number' && valor < no.minimum) {
    erros.push(erro(caminho, 'número abaixo do mínimo permitido'));
  }

  if (Array.isArray(no.allOf)) {
    for (const sub of no.allOf) validarNo(sub, valor, caminho, erros, contexto);
  }
  if (no.not !== undefined) {
    const internos = [];
    validarNo(no.not, valor, caminho, internos, contexto);
    if (internos.length === 0) erros.push(erro(caminho, 'valor proibido pelo schema'));
  }

  if (ehObjeto(valor)) {
    const propriedades = ehObjeto(no.properties) ? no.properties : {};
    for (const nome of Array.isArray(no.required) ? no.required : []) {
      if (!Object.prototype.hasOwnProperty.call(valor, nome)) {
        erros.push(erro(caminhoFilho(caminho, nome), 'campo obrigatório ausente'));
      }
    }
    for (const [nome, sub] of Object.entries(propriedades)) {
      if (Object.prototype.hasOwnProperty.call(valor, nome)) {
        validarNo(sub, valor[nome], caminhoFilho(caminho, nome), erros, contexto);
      }
    }
    if (no.additionalProperties === false) {
      for (const nome of Object.keys(valor)) {
        if (!Object.prototype.hasOwnProperty.call(propriedades, nome)) {
          const seguro = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(nome) && !pareceSecreto(nome);
          erros.push(erro(caminhoFilho(caminho, seguro ? nome : '(chave-omitida)'), 'chave não permitida'));
        }
      }
    }
    if (no.propertyNames !== undefined) {
      for (const nome of Object.keys(valor)) {
        const internos = [];
        validarNo(no.propertyNames, nome, `${caminho}.(nome-da-chave)`, internos, contexto);
        if (internos.length > 0) {
          erros.push(
            erro(`${caminho}.(nome-da-chave)`, 'nome de chave proibido; nome e valor não exibidos')
          );
        }
      }
    }
  }

  if (Array.isArray(valor) && no.items !== undefined) {
    valor.forEach((item, indice) => validarNo(no.items, item, `${caminho}[${indice}]`, erros, contexto));
  }
}

/** Varredura extra e independente do schema: nenhum nome de chave sensível é impresso. */
function verificarChavesSensiveis(valor, caminho, erros) {
  if (ehObjeto(valor)) {
    for (const chave of Object.keys(valor)) {
      if (pareceSecreto(chave)) {
        erros.push(
          erro(`${caminho}.(nome-da-chave)`, 'chave com aparência de segredo; nome e valor omitidos')
        );
      } else {
        verificarChavesSensiveis(valor[chave], caminhoFilho(caminho, chave), erros);
      }
    }
  } else if (Array.isArray(valor)) {
    valor.forEach((item, indice) => verificarChavesSensiveis(item, `${caminho}[${indice}]`, erros));
  }
}

/** Confere que o próprio schema mantém as garantias de segurança exigidas no contrato. */
function verificarGarantias(schema) {
  const problemas = [];
  if (schema?.$schema !== DRAFT) problemas.push('o schema não declara JSON Schema draft 2020-12');
  if (schema?.additionalProperties !== false) {
    problemas.push('a raiz do schema não usa additionalProperties: false');
  }

  const marketplaces = seguirRef(schema?.properties?.marketplaces, schema);
  if (marketplaces?.additionalProperties !== false) {
    problemas.push('marketplaces não usa additionalProperties: false');
  }
  for (const nome of ['mercadolivre', 'shopee']) {
    const bloco = seguirRef(marketplaces?.properties?.[nome], schema);
    if (bloco?.additionalProperties !== false) {
      problemas.push(`marketplaces.${nome} não usa additionalProperties: false`);
    }
  }
  for (const nome of ['sync', 'inventory']) {
    const bloco = seguirRef(schema?.properties?.[nome], schema);
    if (bloco?.additionalProperties !== false) {
      problemas.push(`${nome} não usa additionalProperties: false`);
    }
  }

  const ml = seguirRef(marketplaces?.properties?.mercadolivre, schema)?.properties;
  const shopee = seguirRef(marketplaces?.properties?.shopee, schema)?.properties;
  if (ml?.siteId?.const !== 'MLB') problemas.push('Mercado Livre não exige siteId MLB');
  if (shopee?.region?.const !== 'BR') problemas.push('Shopee não exige region BR');

  const desativado = [ml?.enabled?.default, shopee?.enabled?.default,
    ml?.publishAllowed?.default, shopee?.publishAllowed?.default];
  if (desativado.some((valor) => valor !== false)) {
    problemas.push('os defaults de enabled/publishAllowed não são false');
  }
  const skus = ml?.publishSkus?.default;
  if (!Array.isArray(skus) || skus.length !== 0 || !Array.isArray(shopee?.publishSkus?.default)
      || shopee.publishSkus.default.length !== 0) {
    problemas.push('o default de publishSkus não é uma lista vazia');
  }

  const padrao = schema?.$defs?.semChavesDeSegredo?.propertyNames?.not?.pattern;
  if (typeof padrao !== 'string' || !padrao) {
    problemas.push('o schema não proíbe chaves com aparência de segredo');
  } else {
    try {
      new RegExp(padrao);
    } catch {
      problemas.push('o padrão de proibição de segredos do schema é inválido');
    }
  }
  return problemas;
}

function lerJson(caminho) {
  let texto;
  try {
    texto = fs.readFileSync(caminho, 'utf8');
  } catch (e) {
    return { erro: `falha ao ler o arquivo (código: ${e.code || 'desconhecido'})` };
  }
  try {
    return { valor: JSON.parse(texto) };
  } catch (e) {
    const correspondencia = /position (\d+)/.exec(String(e.message));
    let detalhe = '';
    if (correspondencia) {
      const posicao = Number(correspondencia[1]);
      const antes = texto.slice(0, posicao);
      const linha = antes.split('\n').length;
      const coluna = posicao - antes.lastIndexOf('\n');
      detalhe = ` (linha ${linha}, coluna ${coluna})`;
    }
    return { erro: `JSON inválido${detalhe}; detalhes do parser omitidos para não expor segredos` };
  }
}

function listaDeAvisos(config) {
  const avisos = [];
  if (config?.enabled === true) avisos.push('integração habilitada no nível da empresa');
  for (const [nome, bloco] of Object.entries(config?.marketplaces || {})) {
    if (bloco?.enabled === true) avisos.push(`${nome}: integração habilitada`);
    if (bloco?.publishAllowed === true) avisos.push(`${nome}: publishAllowed habilitado`);
    if (Array.isArray(bloco?.publishSkus) && bloco.publishSkus.length > 0) {
      avisos.push(`${nome}: publishSkus não vazio (${bloco.publishSkus.length} SKU(s))`);
    }
  }
  return avisos;
}

function arquivosDeConfiguracao() {
  return fs
    .readdirSync(PASTA_EMPRESAS, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && entrada.name.endsWith(SUFIXO)
      && entrada.name !== path.basename(CAMINHO_SCHEMA))
    .map((entrada) => entrada.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function main() {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes('--help') || argumentos.includes('-h')) {
    console.log(AJUDA);
    return;
  }
  if (argumentos.length > 0) {
    console.error('ERRO: argumento desconhecido. Use --help para ver o uso.');
    process.exitCode = 1;
    return;
  }

  console.log('Validação das configurações de marketplaces (somente leitura)');

  const carregado = lerJson(CAMINHO_SCHEMA);
  if (carregado.erro) {
    console.error(`ERRO companies/schema.marketplaces.json: ${carregado.erro}`);
    process.exitCode = 1;
    return;
  }
  const schema = carregado.valor;
  const garantias = verificarGarantias(schema);
  if (garantias.length > 0) {
    for (const problema of garantias) {
      console.error(`ERRO companies/schema.marketplaces.json: ${problema}`);
    }
    process.exitCode = 1;
    return;
  }

  let arquivos;
  try {
    arquivos = arquivosDeConfiguracao();
  } catch (e) {
    console.error(`ERRO: não foi possível listar companies/ (código: ${e.code || 'desconhecido'})`);
    process.exitCode = 1;
    return;
  }
  if (arquivos.length === 0) {
    console.error(`ERRO: nenhum arquivo *${SUFIXO} encontrado em companies/`);
    process.exitCode = 1;
    return;
  }

  let validos = 0;
  let invalidos = 0;
  for (const nome of arquivos) {
    const relativo = `companies/${nome}`;
    const config = lerJson(path.join(PASTA_EMPRESAS, nome));
    if (config.erro) {
      invalidos += 1;
      console.error(`ERRO ${relativo}: ${config.erro}`);
      continue;
    }

    const erros = [];
    validarNo(schema, config.valor, '$', erros, { raiz: schema });
    verificarChavesSensiveis(config.valor, '$', erros);
    const slugEsperado = nome.slice(0, -SUFIXO.length);
    if (ehObjeto(config.valor) && config.valor.slug !== slugEsperado) {
      erros.push(erro('$.slug', 'slug diverge do nome do arquivo'));
    }

    if (erros.length > 0) {
      invalidos += 1;
      console.error(`ERRO ${relativo}`);
      for (const item of erros) console.error(`  - ${item.caminho}: ${item.mensagem}`);
    } else {
      validos += 1;
      console.log(`OK ${relativo}`);
      for (const aviso of listaDeAvisos(config.valor)) console.log(`  AVISO ${relativo}: ${aviso}`);
    }
  }

  console.log(`Resultado: ${validos} arquivo(s) válido(s), ${invalidos} inválido(s).`);
  if (invalidos > 0) process.exitCode = 1;
}

main();
