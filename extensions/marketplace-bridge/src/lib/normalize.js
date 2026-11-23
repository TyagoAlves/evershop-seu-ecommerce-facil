/**
 * Normalização compartilhada entre o catálogo e os adaptadores.
 *
 * Contrato: docs/ESPECIFICACAO_MARKETPLACES.md, seção 5 e
 * docs/FLUXOS_MARKETPLACES.md (etapas 4 e 7).
 *
 * Todas as funções são puras do ponto de vista do catálogo: não leem banco,
 * não chamam API e nunca alteram o produto original. A base absoluta das URLs
 * usa o auxiliar oficial do EverShop 2.4 `getBaseUrl()`, cuja precedência é
 * EVERSHOP_HOME_URL -> config `shop.homeUrl` -> http://localhost:<PORT>.
 */

import { getBaseUrl } from '@evershop/evershop/lib/util/getBaseUrl';

// Controle C0/C1, marcas de largura zero e separadores de linha Unicode não
// devem atravessar SKUs, textos ou URLs (comuns em cópias de ERP/planilhas).
const INVISIVEIS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;
const MARCAS_DIACRITICAS = /[\u0300-\u036f]/g;
// SKU: letras/dígitos, ponto, hífen e underscore. Espaços internos são
// removidos; hífen é preservado porque faz parte de SKUs como LE-0001.
const FORA_DO_SKU = /[^A-Z0-9._-]/g;

function comoTexto(valor) {
  if (typeof valor === 'string') {
    return valor;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return String(valor);
  }
  return '';
}

function semInvisiveis(texto) {
  return texto.replace(INVISIVEIS, '');
}

/**
 * Normaliza SKU para chaves determinísticas (idempotência, allowlist e filas).
 * Remove bordas, caracteres de controle/invisíveis e diacríticos, converte para
 * maiúsculas e descarta caracteres especiais. Nunca gera valor quando a entrada
 * é vazia: o chamador deve tratar `''` como SKU inválido e falhar fechado.
 *
 * @param {unknown} sku
 * @returns {string}
 */
export function normalizeSku(sku) {
  const base = semInvisiveis(comoTexto(sku).normalize('NFD'))
    .replace(MARCAS_DIACRITICAS, '')
    .trim()
    .toUpperCase();

  return base.replace(FORA_DO_SKU, '');
}

/**
 * Texto seguro para títulos/descrições: apara bordas, remove invisíveis,
 * colapsa espaços repetidos e, quando informado, limita o tamanho.
 * Não acrescenta reticências para não alterar o limite solicitado.
 *
 * @param {unknown} value
 * @param {number} [maxLength] inteiro >= 0; valores inválidos não truncam
 * @returns {string}
 */
export function normalizeText(value, maxLength) {
  let texto = semInvisiveis(comoTexto(value))
    .replace(/\s+/g, ' ')
    .trim();

  if (Number.isInteger(maxLength) && maxLength >= 0) {
    texto = texto.slice(0, maxLength);
  }

  return texto;
}

/**
 * Monta a URL absoluta da loja para uma chave de produto. A chave pode vir de
 * product_description.url_key (slug) ou de um caminho de imagem já iniciado
 * por `/assets/`. Barras nas bordas são removidas antes da composição.
 *
 * @param {unknown} urlKey
 * @returns {string} URL absoluta terminada em `/` quando a chave é vazia
 */
export function buildStoreUrl(urlKey) {
  const base = String(getBaseUrl() ?? '').replace(/\/+$/, '');
  const chave = semInvisiveis(comoTexto(urlKey))
    .trim()
    .replace(/^\/+|\/+$/g, '');

  return chave === '' ? `${base}/` : `${base}/${chave}`;
}
