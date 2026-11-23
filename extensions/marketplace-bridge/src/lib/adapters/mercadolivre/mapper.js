// Mapeamento de um produto do EverShop para um item do Mercado Livre.
//
// Regras oficiais aplicadas (consulta em 23/11/2026):
// - sellers no modelo User Products usam UM item por SKU, com
//   `seller_custom_field` e SEM o array antigo `variations`;
// - `original_price` só é enviado quando existe valor real no catálogo e é
//   maior que o preço publicável; nunca é inferido;
// - os metadados de rastreabilidade ficam em `seller_custom_field` (SKU) e em
//   `attributes` configurados pela empresa. A API de itens não documenta um
//   campo genérico `metadata`, que poderia causar HTTP 400.
//
// Toda falha de configuração ou preço bloqueia o mapeamento (fail closed).

import { getMarketplaceSettings } from '../../config.js';
import { ConfigError } from '../../errors.js';
import { buildStoreUrl, normalizeSku, normalizeText } from '../../normalize.js';
import { assertPublishablePrice, fromCents, toCents } from '../../pricing.js';

const MERCADOLIVRE = 'mercadolivre';
const TITULO_MAXIMO = 60;
const DESCRICAO_MAXIMA = 30000;
const CONDICOES_ACEITAS = new Set(['new', 'used', 'refurbished', 'not_specified']);
const MODOS_ACEITOS = new Set(['buy_it_now', 'auction']);

function ehObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function erroDeConfiguracao(mensagem, code) {
  return new ConfigError(mensagem, { marketplace: MERCADOLIVRE, code });
}

/** Aceita diretamente o produto ou o contexto do serviço de sincronização. */
function produtoDaEntrada(entrada) {
  if (ehObjeto(entrada?.product)) {
    return entrada.product;
  }
  if (ehObjeto(entrada?.produto)) {
    return entrada.produto;
  }
  return entrada;
}

/** SKU normalizado exatamente como em `canPublish` e nas chaves do outbox. */
function skuObrigatorio(valor) {
  try {
    const sku = normalizeSku(valor);
    if (typeof sku !== 'string' || sku.trim() === '') {
      throw new Error('SKU vazio');
    }
    return sku.trim();
  } catch {
    throw erroDeConfiguracao(
      'SKU inválido: não foi possível mapear o produto para o Mercado Livre.',
      'ML_SKU_INVALIDO'
    );
  }
}

/** Versão tolerante, usada apenas para comparar SKUs vindos da config. */
function skuOpcional(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }
  try {
    const sku = normalizeSku(valor);
    return typeof sku === 'string' ? sku.trim() : '';
  } catch {
    return String(valor).trim().toUpperCase();
  }
}

function textoSeguro(valor, limite) {
  if (valor === undefined || valor === null) {
    return '';
  }
  try {
    return normalizeText(String(valor), limite);
  } catch {
    return String(valor).trim().slice(0, limite);
  }
}

function valorAusente(valor) {
  return (
    valor === undefined ||
    valor === null ||
    (typeof valor === 'string' && valor.trim() === '')
  );
}

/** Exige categoryId e listingTypeId preenchidos no categoryMap do SKU. */
function resolverCategoria(sku, settings) {
  const mapa = Array.isArray(settings?.categoryMap) ? settings.categoryMap : [];

  const porSku = mapa.find(
    (entrada) =>
      entrada &&
      typeof entrada.sku === 'string' &&
      skuOpcional(entrada.sku) === sku
  );

  const porPrefixo = mapa
    .filter(
      (entrada) =>
        entrada &&
        typeof entrada.skuPrefix === 'string' &&
        entrada.skuPrefix.trim() !== '' &&
        sku.startsWith(entrada.skuPrefix.trim().toUpperCase())
    )
    .sort((a, b) => b.skuPrefix.trim().length - a.skuPrefix.trim().length)[0];

  const entrada = porSku ?? porPrefixo;
  if (
    !entrada ||
    valorAusente(entrada.categoryId) ||
    valorAusente(entrada.listingTypeId)
  ) {
    throw erroDeConfiguracao(
      'categoryMap sem categoryId ou listingTypeId configurado para o SKU; anúncio bloqueado.',
      'ML_CATEGORY_MAP_INCOMPLETO'
    );
  }

  return {
    categoryId: String(entrada.categoryId).trim(),
    listingTypeId: String(entrada.listingTypeId).trim()
  };
}

/** Aceita apenas URLs http(s) publicamente resolvíveis (não localhost). */
function fontePublica(fonte) {
  if (!/^https?:\/\//i.test(fonte)) {
    return false;
  }
  try {
    const host = new URL(fonte).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !host.endsWith('.local');
  } catch {
    return false;
  }
}

/**
 * Fotos absolutas; nenhuma imagem é inventada quando o catálogo não tem.
 * `settings.images` aceita o `string[]` devolvido por `getProductImages`
 * (principal primeiro), sem tornar o mapeador assíncrono.
 */
function extrairFotos(product, settings) {
  const brutos = [];
  if (Array.isArray(settings?.images)) {
    brutos.push(...settings.images);
  }
  if (Array.isArray(product.images)) {
    brutos.push(...product.images);
  } else if (typeof product.imageUrl === 'string' && product.imageUrl.trim() !== '') {
    brutos.push(product.imageUrl);
  }

  const fontes = brutos
    .map((imagem) => {
      if (typeof imagem === 'string') {
        return imagem.trim();
      }
      const candidato = imagem?.source ?? imagem?.url ?? imagem?.src;
      return typeof candidato === 'string' ? candidato.trim() : '';
    })
    .filter(fontePublica);

  return [...new Set(fontes)].map((source) => ({ source }));
}

/** Atributos vêm exclusivamente do attributeMap configurado para o SKU. */
function extrairAtributos(sku, settings) {
  const mapa = Array.isArray(settings?.attributeMap) ? settings.attributeMap : [];
  const entrada = mapa.find(
    (item) => item && typeof item.sku === 'string' && skuOpcional(item.sku) === sku
  );

  if (!Array.isArray(entrada?.attributes)) {
    return [];
  }

  return entrada.attributes
    .map((atributo) => ({
      id: valorAusente(atributo?.id) ? '' : String(atributo.id).trim(),
      value_name: valorAusente(atributo?.value_name)
        ? ''
        : String(atributo.value_name).trim()
    }))
    .filter((atributo) => atributo.id !== '' && atributo.value_name !== '');
}

/** Só devolve original_price quando o catálogo informa um valor real e maior. */
function extrairPrecoOriginal(product, precoCentavos) {
  const bruto =
    product.original_price ??
    product.originalPrice ??
    product.compare_at_price ??
    product.compareAtPrice;

  if (valorAusente(bruto)) {
    return undefined;
  }

  const numero = typeof bruto === 'number' ? bruto : Number(bruto);
  if (!Number.isFinite(numero) || numero <= 0) {
    return undefined;
  }

  const centavos = toCents(numero);
  if (centavos <= precoCentavos) {
    return undefined;
  }
  return fromCents(centavos);
}

function descricaoDoProduto(product) {
  const base = textoSeguro(
    product.description ?? product.shortDescription ?? product.name,
    DESCRICAO_MAXIMA
  );

  let urlLoja = '';
  try {
    const candidata = buildStoreUrl(product.urlKey);
    // Somente HTTPS: URLs locais (http://localhost) nunca entram no anúncio.
    if (typeof candidata === 'string' && /^https:\/\//i.test(candidata.trim())) {
      urlLoja = candidata.trim();
    }
  } catch {
    // Sem URL configurada a descrição segue apenas com o texto do catálogo.
  }

  return [base, urlLoja ? `Mais informações: ${urlLoja}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, DESCRICAO_MAXIMA);
}

/**
 * Monta o payload completo de um item do Mercado Livre.
 *
 * @param {object} entrada produto normalizado pelo catálogo ou contexto do
 *   serviço de sincronização (com `product`/`produto` e `settings` aninhados)
 * @param {object|null} [settingsBruto] ajustes da empresa; quando ausente, usa
 *   os do contexto ou lê a config. `settings.images` pode conter o `string[]`
 *   de `getProductImages(productId)`.
 * @returns {object} payload sem `variations`
 * @throws {PriceNotAvailableError|ConfigError} quando uma guarda falha
 */
export function mapProductToPayload(entrada, settingsBruto) {
  const product = produtoDaEntrada(entrada);
  const settings =
    settingsBruto ??
    (ehObjeto(entrada) ? (entrada.settings ?? entrada.marketplaceSettings) : null) ??
    getMarketplaceSettings(MERCADOLIVRE);

  if (!ehObjeto(product)) {
    throw erroDeConfiguracao(
      'Produto inválido: não foi possível montar o anúncio do Mercado Livre.',
      'ML_PRODUTO_INVALIDO'
    );
  }

  // Guarda de preço primeiro: price ausente, zero ou negativo falha fechado.
  const precoValidado = assertPublishablePrice(product);
  const precoCentavos = toCents(precoValidado);

  const sku = skuObrigatorio(product.sku);
  const categoria = resolverCategoria(sku, settings);

  const siteId = settings?.siteId === undefined || settings?.siteId === null
    ? 'MLB'
    : String(settings.siteId).trim().toUpperCase();
  if (siteId !== 'MLB') {
    throw erroDeConfiguracao(
      'siteId do Mercado Livre deve ser MLB.',
      'ML_SITE_INVALIDO'
    );
  }

  const moeda = settings?.currencyId === undefined || settings?.currencyId === null
    ? 'BRL'
    : String(settings.currencyId).trim().toUpperCase();
  if (moeda !== 'BRL') {
    throw erroDeConfiguracao(
      'currencyId do Mercado Livre deve ser BRL.',
      'ML_MOEDA_INVALIDA'
    );
  }

  const condition = valorAusente(settings?.conditionDefault)
    ? 'new'
    : String(settings.conditionDefault).trim().toLowerCase();
  if (!CONDICOES_ACEITAS.has(condition)) {
    throw erroDeConfiguracao(
      'conditionDefault do Mercado Livre é inválido.',
      'ML_CONDICAO_INVALIDA'
    );
  }

  const buyingMode = valorAusente(settings?.buyingMode)
    ? 'buy_it_now'
    : String(settings.buyingMode).trim().toLowerCase();
  if (!MODOS_ACEITOS.has(buyingMode)) {
    throw erroDeConfiguracao(
      'buyingMode do Mercado Livre é inválido.',
      'ML_MODO_INVALIDO'
    );
  }

  const titulo = textoSeguro(product.name ?? product.shortDescription, TITULO_MAXIMO);
  if (titulo === '') {
    throw erroDeConfiguracao(
      'Nome do produto indisponível para o título do anúncio.',
      'ML_TITULO_AUSENTE'
    );
  }

  const quantidadeBruta = Number(product.qty ?? product.quantity ?? 0);
  const available_quantity = Number.isFinite(quantidadeBruta)
    ? Math.max(0, Math.floor(quantidadeBruta))
    : 0;

  // Nenhuma `variations`: um item por SKU no modelo User Products.
  const payload = {
    seller_custom_field: sku,
    title: titulo,
    description: descricaoDoProduto(product),
    price: fromCents(precoCentavos),
    available_quantity,
    condition,
    buying_mode: buyingMode,
    currency_id: moeda,
    listing_type_id: categoria.listingTypeId,
    category_id: categoria.categoryId,
    pictures: extrairFotos(product, settings),
    attributes: extrairAtributos(sku, settings)
  };

  const precoOriginal = extrairPrecoOriginal(product, precoCentavos);
  if (precoOriginal !== undefined) {
    payload.original_price = precoOriginal;
  }

  return payload;
}
