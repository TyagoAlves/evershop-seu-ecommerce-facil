// Operações de anúncio no Mercado Livre.
//
// Guardas obrigatórias antes de QUALQUER escrita:
// - `isEnabled` e `canPublish('mercadolivre', sku)` (publishAllowed + allowlist);
// - preço validado por `assertPublishablePrice` dentro do mapper;
// - categoryMap completo (categoryId e listingTypeId) dentro do mapper;
// - chave de idempotência determinística (reaproveitada do outbox);
// - consulta prévia por SKU antes de criar e GET do item completo antes do PUT.
//
// Regra oficial (consulta em 23/11/2026): desde 18/03/2026 um `PUT /items` que
// envia somente `price` retorna HTTP 400. Toda atualização reenvia o payload
// completo (title, category_id, price, available_quantity, condition,
// listing_type_id, pictures, attributes etc.).

import { canPublish, getMarketplaceSettings, isEnabled } from '../../config.js';
import { ConfigError, MarketplaceError, PriceNotAvailableError } from '../../errors.js';
import { makeIdempotencyKey } from '../../idempotency.js';
import { normalizeSku } from '../../normalize.js';
import { getItem, getItemsBulk, request, searchItemsBySku } from './client.js';
import { mapProductToPayload } from './mapper.js';

// Mesmo padrão de exportação do adaptador Shopee, para os serviços poderem
// carregar `request` e `mapProductToPayload` de um único módulo.
export { request } from './client.js';
export { mapProductToPayload } from './mapper.js';

const MERCADOLIVRE = 'mercadolivre';

// Campos do item que podem ser reenviados em um PUT completo. `variations`
// fica de fora: sellers User Products usam um item por SKU.
const CAMPOS_DO_ITEM = [
  'title',
  'description',
  'price',
  'available_quantity',
  'condition',
  'listing_type_id',
  'category_id',
  'pictures',
  'attributes',
  'seller_custom_field',
  'original_price',
  'buying_mode',
  'currency_id',
  'warranty',
  'video',
  'sale_terms',
  'package_size',
  'shipping'
];

function ehObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function erroDeConfiguracao(mensagem, code) {
  return new ConfigError(mensagem, { marketplace: MERCADOLIVRE, code });
}

/** Aceita `(token, opcoes)` e `(token, { ... })`; também aceita objeto com `accessToken`. */
function argumentos(primeiro, segundo) {
  const opcoes = ehObjeto(primeiro) ? { ...primeiro } : ehObjeto(segundo) ? { ...segundo } : {};
  const token = typeof primeiro === 'string' ? primeiro : opcoes.accessToken;
  return { ...opcoes, accessToken: typeof token === 'string' ? token : '' };
}

/** Mesma normalização usada por `canPublish` e pelas chaves do outbox. */
function skuNormalizado(valor) {
  try {
    const sku = normalizeSku(valor);
    if (typeof sku !== 'string' || sku.trim() === '') {
      throw new Error('SKU vazio');
    }
    return sku.trim();
  } catch {
    throw erroDeConfiguracao(
      'SKU inválido para operação de anúncio no Mercado Livre.',
      'ML_SKU_INVALIDO'
    );
  }
}

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

function idObrigatorio(valor, descricao) {
  const texto =
    typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim() : '';
  if (texto === '') {
    throw erroDeConfiguracao(
      `Identificador ${descricao} não informado para o Mercado Livre.`,
      'ML_ID_AUSENTE'
    );
  }
  return texto;
}

/** Falha fechada: sem integração ativa e allowlist, nenhuma escrita acontece. */
function exigirPublicacao(sku) {
  if (!isEnabled(MERCADOLIVRE)) {
    throw erroDeConfiguracao(
      'Integração com o Mercado Livre desativada; nenhuma chamada de escrita foi feita.',
      'ML_INTEGRACAO_DESATIVADA'
    );
  }
  if (!canPublish(MERCADOLIVRE, sku)) {
    throw erroDeConfiguracao(
      'Publicação do SKU não autorizada (publishAllowed/publishSkus); nenhuma chamada de escrita foi feita.',
      'ML_PUBLICACAO_NAO_AUTORIZADA'
    );
  }
}

/**
 * Reaproveita a chave determinística do outbox; quando o chamador não informa,
 * deriva uma chave estável de marketplace + sellerId + operação + sku + item.
 */
function chaveDeIdempotencia(opcoes, { operacao, sku, externalId }) {
  if (typeof opcoes.idempotencyKey === 'string' && opcoes.idempotencyKey.trim() !== '') {
    return opcoes.idempotencyKey.trim();
  }
  return makeIdempotencyKey({
    marketplace: MERCADOLIVRE,
    operation: operacao,
    sku,
    externalId,
    sellerId: opcoes.sellerId ?? opcoes.seller_id ?? undefined
  });
}

/** Resposta enxuta e estável para os serviços de sincronização. */
function respostaDoAnuncio(resposta, payload) {
  const corpo = ehObjeto(resposta?.body) ? resposta.body : {};
  const id = corpo.id ?? corpo.item_id;
  if (id === undefined || id === null || String(id).trim() === '') {
    throw new MarketplaceError(
      'O Mercado Livre não devolveu o identificador do anúncio.',
      { marketplace: MERCADOLIVRE, code: 'ML_ID_ANUNCIO_AUSENTE' }
    );
  }

  // `headers` é o objeto Headers nativo devolvido por requestJson.
  const requestId =
    typeof resposta?.headers?.get === 'function'
      ? resposta.headers.get('x-request-id')
      : null;

  return {
    externalItemId: String(id),
    id: String(id),
    status: typeof corpo.status === 'string' ? corpo.status : null,
    sku: corpo.seller_custom_field ?? payload?.seller_custom_field ?? null,
    siteId: corpo.site_id ?? null,
    permalink: corpo.permalink ?? null,
    requestId,
    body: corpo,
    payload
  };
}

function extrairIdsDaBusca(corpo) {
  const resultados = Array.isArray(corpo)
    ? corpo
    : ehObjeto(corpo) && Array.isArray(corpo.results)
      ? corpo.results
      : [];

  return resultados
    .map((item) =>
      typeof item === 'string' || typeof item === 'number'
        ? String(item).trim()
        : ehObjeto(item) && item.id !== undefined && item.id !== null
          ? String(item.id).trim()
          : ''
    )
    .filter(Boolean);
}

function normalizarItemRemoto(item) {
  return {
    externalItemId: String(item.id),
    id: String(item.id),
    status: typeof item.status === 'string' ? item.status : null,
    sku: item.seller_custom_field ?? null,
    price: item.price ?? null,
    available_quantity: item.available_quantity ?? null,
    category_id: item.category_id ?? null,
    listing_type_id: item.listing_type_id ?? null,
    title: item.title ?? null,
    siteId: item.site_id ?? null,
    body: item
  };
}

/**
 * Busca um anúncio pelo SKU e devolve o item completo via multiget oficial.
 * Operação de LEITURA: não exige `canPublish` e não chama endpoints de escrita.
 */
export async function findListingBySku(accessToken, opcoes = {}) {
  const args = argumentos(accessToken, opcoes);
  const sellerId = idObrigatorio(args.sellerId ?? args.seller_id, 'do vendedor');
  const sku = skuNormalizado(args.sku ?? args.product?.sku);

  const busca = await searchItemsBySku(args.accessToken, sellerId, sku);
  const ids = extrairIdsDaBusca(busca.body);
  if (ids.length === 0) {
    return null;
  }

  // Multiget: GET /items/bulk?ids= (o antigo /items?ids= foi descontinuado
  // em 25/10/2026, conforme documentação oficial consultada em 23/11/2026).
  const multiget = await getItemsBulk(args.accessToken, ids);
  const itens = Array.isArray(multiget.body) ? multiget.body : [];

  const item =
    itens.find(
      (candidato) =>
        ehObjeto(candidato) &&
        !candidato.error &&
        skuOpcional(candidato.seller_custom_field) === sku
    ) ??
    itens.find(
      (candidato) => ehObjeto(candidato) && !candidato.error && candidato.id !== undefined
    );

  if (item) {
    return normalizarItemRemoto(item);
  }

  // fallback para respostas de bulk parciais: leitura individual do primeiro id.
  const individual = await getItem(args.accessToken, ids[0]);
  if (ehObjeto(individual.body) && !individual.body.error && individual.body.id !== undefined) {
    return normalizarItemRemoto(individual.body);
  }

  // A busca encontrou ids, mas não foi possível ler o detalhe: sinaliza sem
  // inventar atributos do anúncio.
  return {
    externalItemId: ids[0],
    id: ids[0],
    status: null,
    sku,
    price: null,
    available_quantity: null,
    category_id: null,
    listing_type_id: null,
    title: null,
    siteId: null,
    body: {}
  };
}

/** Copia seletivamente os campos do item remoto, sem campos somente leitura. */
function camposAtuaisPermitidos(item) {
  const payload = {};
  for (const campo of CAMPOS_DO_ITEM) {
    const valor = item?.[campo];
    if (valor !== undefined && valor !== null) {
      payload[campo] = valor;
    }
  }
  delete payload.variations;
  return payload;
}

function fotosParaPayload(valor) {
  if (!Array.isArray(valor)) {
    return [];
  }
  return valor
    .map((foto) => {
      const fonte = typeof foto === 'string' ? foto : foto?.source ?? foto?.url ?? foto?.src;
      return typeof fonte === 'string' ? fonte.trim() : '';
    })
    .filter(Boolean)
    .map((source) => ({ source }));
}

function atributosParaPayload(valor) {
  if (!Array.isArray(valor)) {
    return [];
  }
  return valor
    .map((atributo) => ({
      id:
        atributo?.id === undefined || atributo?.id === null
          ? ''
          : String(atributo.id).trim(),
      value_name:
        atributo?.value_name === undefined || atributo?.value_name === null
          ? ''
          : String(atributo.value_name).trim()
    }))
    .filter((atributo) => atributo.id !== '' && atributo.value_name !== '');
}

function envioParaPayload(valor) {
  if (!ehObjeto(valor)) {
    return undefined;
  }
  const envio = {};
  for (const campo of ['mode', 'free_shipping', 'local_pick_up', 'logistic_type']) {
    if (valor[campo] !== undefined && valor[campo] !== null) {
      envio[campo] = valor[campo];
    }
  }
  return Object.keys(envio).length > 0 ? envio : undefined;
}

/**
 * Monta o payload COMPLETO do PUT a partir do item remoto e dos valores atuais
 * do catálogo. `listing_type_id` e `category_id` são imutáveis após a criação,
 * por isso vêm do item lido; preço/quantidade/texto vêm do produto validado.
 */
export function buildFullUpdatePayload(desejado, itemAtual) {
  const payload = camposAtuaisPermitidos(itemAtual);

  payload.title = desejado?.title ?? payload.title;
  payload.description = desejado?.description ?? payload.description;
  payload.price = desejado?.price;
  payload.available_quantity = desejado?.available_quantity ?? payload.available_quantity;
  payload.condition = desejado?.condition ?? payload.condition;
  payload.seller_custom_field = desejado?.seller_custom_field ?? payload.seller_custom_field;
  payload.buying_mode = desejado?.buying_mode ?? payload.buying_mode;
  payload.currency_id = desejado?.currency_id ?? payload.currency_id;

  if (!ehObjeto(itemAtual)) {
    itemAtual = {};
  }
  if (
    itemAtual.listing_type_id !== undefined &&
    itemAtual.listing_type_id !== null &&
    String(itemAtual.listing_type_id).trim() !== ''
  ) {
    payload.listing_type_id = itemAtual.listing_type_id;
  }
  if (
    itemAtual.category_id !== undefined &&
    itemAtual.category_id !== null &&
    String(itemAtual.category_id).trim() !== ''
  ) {
    payload.category_id = itemAtual.category_id;
  }

  const fotosDesejadas = fotosParaPayload(desejado?.pictures);
  payload.pictures = fotosDesejadas.length > 0
    ? fotosDesejadas
    : fotosParaPayload(payload.pictures);

  const atributosDesejados = atributosParaPayload(desejado?.attributes);
  payload.attributes = atributosDesejados.length > 0
    ? atributosDesejados
    : atributosParaPayload(payload.attributes);

  const preco = Number(payload.price);
  if (!Number.isFinite(preco) || preco <= 0) {
    throw new PriceNotAvailableError(
      'Preço publicável indisponível; o PUT completo do Mercado Livre foi bloqueado.'
    );
  }

  if (desejado?.original_price !== undefined) {
    payload.original_price = desejado.original_price;
  } else if (typeof payload.original_price !== 'number' || payload.original_price <= preco) {
    delete payload.original_price;
  }

  const envio = envioParaPayload(payload.shipping);
  if (envio) {
    payload.shipping = envio;
  } else {
    delete payload.shipping;
  }

  for (const campo of Object.keys(payload)) {
    if (payload[campo] === undefined) {
      delete payload[campo];
    }
  }
  delete payload.variations;

  return payload;
}

/** Payload completo para pausar (nunca apenas `status`). */
export function buildPausePayload(itemAtual) {
  const payload = camposAtuaisPermitidos(itemAtual);
  payload.status = 'paused';

  const envio = envioParaPayload(payload.shipping);
  if (envio) {
    payload.shipping = envio;
  } else {
    delete payload.shipping;
  }
  delete payload.variations;
  return payload;
}

/**
 * Cria um anúncio. Exige `sellerId` para a consulta prévia por SKU: se o item
 * já existir, reaproveita o registro e não faz POST (idempotência de escrita).
 */
export async function createListing(accessToken, opcoes = {}) {
  const args = argumentos(accessToken, opcoes);
  const produto = args.product;
  const sku = skuNormalizado(produto?.sku);
  const sellerId = idObrigatorio(args.sellerId ?? args.seller_id, 'do vendedor');

  exigirPublicacao(sku);

  const existente = await findListingBySku(args.accessToken, { sellerId, sku });
  if (existente) {
    return { ...existente, jaExistia: true, criado: false };
  }

  const settings = args.settings ?? getMarketplaceSettings(MERCADOLIVRE);
  const payload = mapProductToPayload(produto, settings);
  const chave = chaveDeIdempotencia(args, { operacao: 'create_listing', sku });

  const resposta = await request(args.accessToken, {
    method: 'POST',
    path: '/items',
    body: payload,
    idempotencyKey: chave
  });

  return {
    ...respostaDoAnuncio(resposta, payload),
    idempotencyKey: chave,
    jaExistia: false,
    criado: true
  };
}

/**
 * Atualiza um anúncio. O item completo é lido antes do PUT e o payload
 * reenviado por inteiro — envio somente de `price` retorna 400 desde
 * 18/03/2026 (documentação oficial consultada em 23/11/2026).
 */
export async function updateListing(accessToken, opcoes = {}) {
  const args = argumentos(accessToken, opcoes);
  const itemId = idObrigatorio(
    args.itemId ?? args.externalItemId ?? args.id,
    'do anúncio'
  );

  // Quando o SKU já é conhecido, a guarda roda ANTES de qualquer chamada à API.
  // Sem SKU informado, ao menos `isEnabled` é verificado antes da leitura.
  const skuInformado = args.sku ?? args.product?.sku;
  if (skuInformado !== undefined && skuInformado !== null && String(skuInformado).trim() !== '') {
    exigirPublicacao(skuNormalizado(skuInformado));
  } else if (!isEnabled(MERCADOLIVRE)) {
    throw erroDeConfiguracao(
      'Integração com o Mercado Livre desativada; nenhuma chamada à API foi feita.',
      'ML_INTEGRACAO_DESATIVADA'
    );
  }

  // Leitura prévia: obrigatória para montar o payload completo e para conferir
  // o SKU remoto antes de qualquer escrita.
  const atualResposta = await getItem(args.accessToken, itemId);
  const atual = ehObjeto(atualResposta.body) ? atualResposta.body : {};

  const skuRemoto = skuOpcional(atual.seller_custom_field);
  const sku = skuNormalizado(args.sku ?? args.product?.sku ?? skuRemoto);
  if (skuRemoto !== '' && skuRemoto !== sku) {
    throw erroDeConfiguracao(
      'SKU do anúncio remoto diverge do SKU informado; atualização bloqueada.',
      'ML_SKU_DIVERGENTE'
    );
  }

  exigirPublicacao(sku);

  if (!ehObjeto(args.product)) {
    throw erroDeConfiguracao(
      'Produto obrigatório para atualizar o anúncio do Mercado Livre.',
      'ML_PRODUTO_AUSENTE'
    );
  }

  const settings = args.settings ?? getMarketplaceSettings(MERCADOLIVRE);
  const desejado = mapProductToPayload(args.product, settings);
  const payload = buildFullUpdatePayload(desejado, atual);
  const chave = chaveDeIdempotencia(args, {
    operacao: 'update_listing',
    sku,
    externalId: itemId
  });

  const resposta = await request(args.accessToken, {
    method: 'PUT',
    path: `/items/${encodeURIComponent(itemId)}`,
    body: payload,
    idempotencyKey: chave
  });

  return { ...respostaDoAnuncio(resposta, payload), idempotencyKey: chave };
}

/** Pausa um anúncio existente reenviando payload completo com `status: paused`. */
export async function pauseListing(accessToken, opcoes = {}) {
  const args = argumentos(accessToken, opcoes);
  const itemId = idObrigatorio(
    args.itemId ?? args.externalItemId ?? args.id,
    'do anúncio'
  );

  const skuInformado = args.sku ?? args.product?.sku;
  if (skuInformado !== undefined && skuInformado !== null && String(skuInformado).trim() !== '') {
    exigirPublicacao(skuNormalizado(skuInformado));
  } else if (!isEnabled(MERCADOLIVRE)) {
    throw erroDeConfiguracao(
      'Integração com o Mercado Livre desativada; nenhuma chamada à API foi feita.',
      'ML_INTEGRACAO_DESATIVADA'
    );
  }

  const atualResposta = await getItem(args.accessToken, itemId);
  const atual = ehObjeto(atualResposta.body) ? atualResposta.body : {};
  const sku = skuNormalizado(args.sku ?? args.product?.sku ?? atual.seller_custom_field);

  exigirPublicacao(sku);

  const payload = buildPausePayload(atual);
  const chave = chaveDeIdempotencia(args, {
    operacao: 'pause_listing',
    sku,
    externalId: itemId
  });

  const resposta = await request(args.accessToken, {
    method: 'PUT',
    path: `/items/${encodeURIComponent(itemId)}`,
    body: payload,
    idempotencyKey: chave
  });

  return { ...respostaDoAnuncio(resposta, payload), idempotencyKey: chave };
}
