// Operações de anúncio da Shopee BR.
// Nenhuma escrita acontece sem canPublish, preço publicável e consulta prévia
// do anúncio remoto. Assim uma retentativa nunca cria anúncio duplicado.

import { createHash } from 'node:crypto';
import { canPublish, getMarketplaceSettings, isEnabled } from '../../config.js';
import { ConfigError, MarketplaceError } from '../../errors.js';
import { makeIdempotencyKey } from '../../idempotency.js';
import { assertPublishablePrice, toCents } from '../../pricing.js';
import { normalizeSku } from '../../normalize.js';
import { mapProductToPayload } from './mapper.js';
import {
  addItem,
  batchAddItem,
  getBatchTaskResult,
  getItemBaseInfo,
  getModelList,
  searchItems,
  updateItem
} from './client.js';

export { request } from './client.js';
export { mapProductToPayload } from './mapper.js';

const TAMANHO_PAGINA = 50;
const MAXIMO_PAGINAS = 20;

/**
 * Aceita as formas usadas pelos dois adaptadores:
 * - (contexto, produto, settings), com contexto = { accessToken, shopId };
 * - (accessToken, shopId, produto, settings);
 * - (accessToken, { shopId, product, sku, itemId, settings, idempotencyKey }),
 *   mesmo estilo de createListing do Mercado Livre.
 */
function normalizeArguments(primeiro, segundo, terceiro, quarto) {
  if (primeiro && typeof primeiro === 'object' && !Array.isArray(primeiro)) {
    const contexto = { ...primeiro };
    const pareceSettings = (valor) => valor && typeof valor === 'object' && (
      'categoryMap' in valor || 'publishAllowed' in valor ||
      'itemStatusDefault' in valor || 'region' in valor
    );

    let alvo;
    let settings;
    if (segundo !== undefined && pareceSettings(segundo) &&
        (contexto.product || contexto.sku || contexto.itemId)) {
      alvo = contexto.product ?? contexto.sku ?? contexto.itemId;
      settings = segundo;
    } else {
      alvo = segundo !== undefined
        ? segundo
        : (contexto.product ?? contexto.sku ?? contexto.itemId);
      settings = terceiro && typeof terceiro === 'object'
        ? terceiro
        : (contexto.settings ?? null);
    }

    return { contexto, alvo, settings };
  }

  const pareceOpcoes = segundo && typeof segundo === 'object' && !Array.isArray(segundo) && (
    'shopId' in segundo || 'shop_id' in segundo || 'product' in segundo ||
    'sku' in segundo || 'itemId' in segundo || 'settings' in segundo
  );
  if (pareceOpcoes) {
    const opcoes = { ...segundo };
    return {
      contexto: {
        ...opcoes,
        accessToken: typeof primeiro === 'string'
          ? primeiro
          : (opcoes.accessToken ?? '')
      },
      alvo: opcoes.product ?? opcoes.sku ?? opcoes.itemId,
      settings: terceiro && typeof terceiro === 'object'
        ? terceiro
        : (opcoes.settings ?? null)
    };
  }

  return {
    contexto: { accessToken: primeiro, shopId: segundo },
    alvo: terceiro,
    settings: quarto && typeof quarto === 'object' ? quarto : null
  };
}

function resolveSettings(settings, contexto) {
  return settings ?? contexto?.settings ?? getMarketplaceSettings('shopee');
}

function requireCredentials(contexto) {
  const bruto = contexto?.accessToken ?? contexto?.token ?? contexto?.access_token;
  if (typeof bruto !== 'string' || bruto.trim() === '') {
    throw new ConfigError(
      'Token de acesso da Shopee ausente; nenhuma chamada foi feita.',
      { code: 'SHOPEE_TOKEN_MISSING', marketplace: 'shopee' }
    );
  }

  const shopId = Number(contexto?.shopId ?? contexto?.shop_id);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new ConfigError(
      'Shop ID da Shopee inválido; nenhuma chamada foi feita.',
      { code: 'SHOPEE_SHOP_ID_INVALID', marketplace: 'shopee' }
    );
  }

  return { accessToken: bruto.trim(), shopId };
}

function skuFromTarget(alvo, contexto) {
  let bruto;
  if (typeof alvo === 'string') {
    bruto = alvo;
  } else if (alvo && typeof alvo === 'object' && !Array.isArray(alvo)) {
    bruto = alvo.sku ?? alvo.seller_sku ?? alvo.sellerSku ?? contexto?.sku;
  } else {
    bruto = contexto?.sku;
  }

  try {
    const sku = normalizeSku(bruto);
    return typeof sku === 'string' ? sku.trim() : '';
  } catch {
    return '';
  }
}

/** Guarda de publicação: integração desativada ou canPublish falso bloqueiam a escrita. */
export function assertCanPublish(sku) {
  if (!isEnabled('shopee')) {
    throw new ConfigError(
      'Integração com a Shopee desativada; nenhuma chamada de escrita foi feita.',
      { code: 'SHOPEE_INTEGRACAO_DESATIVADA', marketplace: 'shopee' }
    );
  }

  if (canPublish('shopee', sku)) {
    return;
  }

  const erro = new MarketplaceError(
    `Publicação na Shopee bloqueada para o SKU ${sku || '(sem SKU)'}: canPublish não autorizou a operação.`,
    { code: 'PUBLISH_NOT_ALLOWED', marketplace: 'shopee' }
  );
  erro.sku = sku;
  throw erro;
}

export function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Chave determinística reaproveitada do outbox (marketplace + seller + sku). */
function idempotencyKeyFor(contexto, operacao, sku, externalId) {
  const informada = contexto?.idempotencyKey;
  if (typeof informada === 'string' && informada.trim() !== '') {
    return informada.trim();
  }

  return makeIdempotencyKey({
    marketplace: 'shopee',
    operation: operacao,
    sku,
    externalId,
    sellerId: contexto?.sellerId ?? contexto?.seller_id ?? contexto?.shopId
  });
}

function requireProduct(alvo) {
  if (!alvo || typeof alvo !== 'object' || Array.isArray(alvo)) {
    throw new ConfigError(
      'Produto do catálogo obrigatório para gerar o anúncio da Shopee.',
      { code: 'SHOPEE_PRODUCT_MISSING', marketplace: 'shopee' }
    );
  }
  return alvo;
}

function extractItemId(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidatos = [
    value.item_id,
    value.itemId,
    value.externalItemId,
    value.item?.item_id,
    value.response?.item_id,
    value.response?.itemId,
    value.body?.response?.item_id,
    value.body?.response?.itemId
  ];

  for (const candidato of candidatos) {
    const numero = Number(candidato);
    if (Number.isSafeInteger(numero) && numero > 0) {
      return numero;
    }
  }
  return null;
}

function explicitItemIds(alvo, contexto, settings, sku) {
  const fontes = [];
  if (Array.isArray(contexto?.itemIds)) {
    fontes.push(...contexto.itemIds);
  } else if (contexto?.itemIds) {
    fontes.push(contexto.itemIds);
  }
  fontes.push(contexto?.itemId, contexto?.item_id, contexto?.externalItemId);
  fontes.push(alvo?.itemId, alvo?.item_id, alvo?.externalItemId);

  const mapa = settings?.itemMap;
  if (mapa && typeof mapa === 'object') {
    fontes.push(mapa[sku], mapa[alvo?.sku]);
  }

  const ids = [];
  for (let fonte of fontes) {
    if (fonte && typeof fonte === 'object') {
      fonte = fonte.itemId ?? fonte.item_id ?? fonte.externalItemId;
    }
    const numero = Number(fonte);
    if (Number.isSafeInteger(numero) && numero > 0 && !ids.includes(numero)) {
      ids.push(numero);
    }
  }
  return ids;
}

function extractItems(body) {
  const resposta = body?.response ?? body;
  if (!resposta || typeof resposta !== 'object') {
    return [];
  }
  for (const chave of ['item_list', 'items', 'item', 'list']) {
    const valor = resposta[chave];
    if (Array.isArray(valor)) {
      return valor.filter((item) => item && typeof item === 'object');
    }
    if (valor && typeof valor === 'object' && chave === 'item') {
      return [valor];
    }
  }
  return [];
}

function extractModels(body) {
  const resposta = body?.response ?? body;
  if (!resposta || typeof resposta !== 'object') {
    return [];
  }
  for (const chave of ['models', 'model_list', 'model']) {
    const valor = resposta[chave];
    if (Array.isArray(valor)) {
      return valor.filter((model) => model && typeof model === 'object');
    }
    if (valor && typeof valor === 'object' && chave === 'model') {
      return [valor];
    }
  }
  return [];
}

function sameSku(value, sku) {
  try {
    const normalizado = normalizeSku(value);
    return typeof normalizado === 'string' && normalizado.trim() === sku;
  } catch {
    return false;
  }
}

function buildFound(item, model, itemId, sku) {
  return {
    marketplace: 'shopee',
    sku,
    externalItemId: String(itemId),
    itemId,
    status: item?.item_status ?? item?.status ?? null,
    item: item ?? null,
    model: model ?? null
  };
}

/**
 * Localiza o anúncio pelo SKU. O SKU pode estar em item_sku ou no model_list;
 * por isso a busca paginada é complementada com get_model_list por item.
 * @returns {Promise<object|null>} dados do anúncio ou null quando inexistente
 */
export async function findListingBySku(primeiro, segundo, terceiro, quarto) {
  const { contexto, alvo, settings: settingsArg } = normalizeArguments(
    primeiro, segundo, terceiro, quarto
  );
  const settings = resolveSettings(settingsArg, contexto);
  const sku = skuFromTarget(alvo, contexto);
  if (sku === '') {
    throw new ConfigError(
      'SKU obrigatório para localizar o anúncio na Shopee.',
      { code: 'SHOPEE_SKU_MISSING', marketplace: 'shopee' }
    );
  }

  const { accessToken, shopId } = requireCredentials(contexto);
  const candidatos = [];
  const vistos = new Set();
  const adicionar = (itens) => {
    for (const item of itens) {
      const id = extractItemId(item);
      if (id && !vistos.has(id)) {
        vistos.add(id);
        candidatos.push({ item, id });
      }
    }
  };

  const explicados = explicitItemIds(alvo, contexto, settings, sku);
  if (explicados.length > 0) {
    const resposta = await getItemBaseInfo(accessToken, shopId, explicados);
    adicionar(extractItems(resposta?.body));
  }

  const paginasConfiguradas = Number(settings?.searchPages);
  const limitePaginas = Number.isSafeInteger(paginasConfiguradas) && paginasConfiguradas > 0
    ? Math.min(paginasConfiguradas, MAXIMO_PAGINAS)
    : 10;

  for (let pagina = 1; pagina <= limitePaginas; pagina += 1) {
    const resposta = await searchItems(accessToken, shopId, {
      pageNumber: pagina,
      pageSize: TAMANHO_PAGINA
    });
    const itens = extractItems(resposta?.body);
    adicionar(itens);
    if (itens.length < TAMANHO_PAGINA) {
      break;
    }
  }

  for (const { item, id } of candidatos) {
    if (sameSku(item.item_sku ?? item.seller_sku ?? item.sku, sku)) {
      return buildFound(item, null, id, sku);
    }

    const respostaModelos = await getModelList(accessToken, shopId, id);
    const modelo = extractModels(respostaModelos?.body).find((candidato) =>
      sameSku(
        candidato.model_sku ?? candidato.seller_sku ?? candidato.sku,
        sku
      )
    );
    if (modelo) {
      return buildFound(item, modelo, id, sku);
    }
  }

  return null;
}

/** Confirma que o item remoto existe antes de atualizar ou pausar. */
async function resolveExistingItemId({ alvo, contexto, settings, sku, accessToken, shopId }) {
  const explicados = explicitItemIds(alvo, contexto, settings, sku);
  if (explicados.length > 0) {
    const resposta = await getItemBaseInfo(accessToken, shopId, explicados);
    const itens = extractItems(resposta?.body);
    const encontrado = itens.find((item) => extractItemId(item) === explicados[0]);
    if (!encontrado) {
      throw new ConfigError(
        `Anúncio da Shopee ${explicados[0]} não encontrado; nenhuma atualização foi feita.`,
        { code: 'SHOPEE_LISTING_NOT_FOUND', marketplace: 'shopee' }
      );
    }
    return { itemId: explicados[0], item: encontrado };
  }

  const existente = await findListingBySku(contexto, sku, settings);
  if (!existente) {
    throw new ConfigError(
      `Anúncio da Shopee não encontrado para o SKU ${sku}; a criação não é feita por esta operação.`,
      { code: 'SHOPEE_LISTING_NOT_FOUND', marketplace: 'shopee' }
    );
  }
  return { itemId: existente.itemId, item: existente.item };
}

/**
 * Cria o anúncio. Se já existir anúncio para o SKU, não repete a escrita:
 * devolve o registro existente com alreadyExists = true.
 */
export async function createListing(primeiro, segundo, terceiro, quarto) {
  const { contexto, alvo, settings: settingsArg } = normalizeArguments(
    primeiro, segundo, terceiro, quarto
  );
  const settings = resolveSettings(settingsArg, contexto);
  const product = requireProduct(alvo);
  const sku = skuFromTarget(product, contexto);

  assertCanPublish(sku);
  assertPublishablePrice(product);

  const payload = mapProductToPayload(product, settings);
  const payloadHash = hashPayload(payload);
  const { accessToken, shopId } = requireCredentials(contexto);

  const existente = await findListingBySku(contexto, sku, settings);
  if (existente) {
    return {
      marketplace: 'shopee',
      sku,
      externalItemId: existente.externalItemId,
      itemId: existente.itemId,
      status: existente.status ?? 'UNKNOWN',
      priceCents: toCents(payload.price),
      payloadHash,
      idempotencyKey: idempotencyKeyFor(contexto, 'create_listing', sku),
      alreadyExists: true,
      skippedWrite: true
    };
  }

  const resposta = await addItem(accessToken, shopId, payload);
  const itemId = extractItemId(resposta);
  if (!itemId) {
    throw new MarketplaceError(
      'A API Shopee não devolveu item_id ao criar o anúncio; não tente novamente sem consultar a loja.',
      { code: 'SHOPEE_ITEM_ID_MISSING', marketplace: 'shopee' }
    );
  }

  return {
    marketplace: 'shopee',
    sku,
    externalItemId: String(itemId),
    itemId,
    status: payload.item_status,
    priceCents: toCents(payload.price),
    payloadHash,
    idempotencyKey: idempotencyKeyFor(contexto, 'create_listing', sku),
    alreadyExists: false,
    skippedWrite: false
  };
}

/** Atualiza anúncio existente; nunca cria um novo quando o item não é encontrado. */
export async function updateListing(primeiro, segundo, terceiro, quarto) {
  const { contexto, alvo, settings: settingsArg } = normalizeArguments(
    primeiro, segundo, terceiro, quarto
  );
  const settings = resolveSettings(settingsArg, contexto);
  const product = requireProduct(alvo);
  const sku = skuFromTarget(product, contexto);

  assertCanPublish(sku);
  assertPublishablePrice(product);

  const payload = mapProductToPayload(product, settings);
  const { accessToken, shopId } = requireCredentials(contexto);
  const { itemId } = await resolveExistingItemId({
    alvo, contexto, settings, sku, accessToken, shopId
  });

  const corpo = { ...payload, item_id: itemId };
  await updateItem(accessToken, shopId, corpo);

  return {
    marketplace: 'shopee',
    sku,
    externalItemId: String(itemId),
    itemId,
    status: payload.item_status,
    priceCents: toCents(payload.price),
    payloadHash: hashPayload(corpo),
    idempotencyKey: idempotencyKeyFor(contexto, 'update_listing', sku, String(itemId)),
    alreadyExists: true,
    skippedWrite: false
  };
}

/** Pausa o anúncio (item_status = UNLIST), com consulta prévia obrigatória. */
export async function pauseListing(primeiro, segundo, terceiro, quarto) {
  const { contexto, alvo, settings: settingsArg } = normalizeArguments(
    primeiro, segundo, terceiro, quarto
  );
  const settings = resolveSettings(settingsArg, contexto);
  const sku = skuFromTarget(alvo, contexto);

  assertCanPublish(sku);

  const { accessToken, shopId } = requireCredentials(contexto);
  const produtoLocal = alvo && typeof alvo === 'object' && !Array.isArray(alvo) &&
    alvo.price !== undefined
    ? alvo
    : null;

  let payload;
  if (produtoLocal) {
    assertPublishablePrice(produtoLocal);
    payload = {
      ...mapProductToPayload(produtoLocal, settings),
      item_status: 'UNLIST'
    };
  }

  const { itemId } = await resolveExistingItemId({
    alvo, contexto, settings, sku, accessToken, shopId
  });

  const corpo = { ...(payload ?? {}), item_id: itemId, item_status: 'UNLIST' };
  await updateItem(accessToken, shopId, corpo);

  return {
    marketplace: 'shopee',
    sku,
    externalItemId: String(itemId),
    itemId,
    status: 'UNLIST',
    payloadHash: hashPayload(corpo),
    idempotencyKey: idempotencyKeyFor(contexto, 'pause_listing', sku, String(itemId)),
    skippedWrite: false
  };
}

function extractTaskId(body) {
  const resposta = body?.response ?? body;
  const bruto = resposta?.task_id ?? resposta?.taskId;
  const numero = Number(bruto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Lote opcional (v2.product.batch_add_item). Todas as guardas são aplicadas
 * antes de qualquer chamada, e o resultado é consultado depois pelo task_id.
 */
export async function createListingsBatch(primeiro, segundo, terceiro, quarto) {
  const { contexto, alvo, settings: settingsArg } = normalizeArguments(
    primeiro, segundo, terceiro, quarto
  );
  const settings = resolveSettings(settingsArg, contexto);
  const produtos = Array.isArray(alvo) ? alvo : [alvo];
  if (produtos.length === 0 || produtos.every((item) => item === undefined)) {
    throw new ConfigError(
      'Nenhum produto informado para o lote da Shopee.',
      { code: 'SHOPEE_BATCH_EMPTY', marketplace: 'shopee' }
    );
  }

  const { accessToken, shopId } = requireCredentials(contexto);
  const preparados = produtos.map((produto) => {
    const item = requireProduct(produto);
    const sku = skuFromTarget(item, contexto);
    assertCanPublish(sku);
    assertPublishablePrice(item);
    const payload = mapProductToPayload(item, settings);
    return { sku, payload, payloadHash: hashPayload(payload) };
  });

  // Idempotência do lote: SKUs já presentes na loja nunca são reenviados.
  const existentes = [];
  const ineditos = [];
  for (const item of preparados) {
    const atual = await findListingBySku(contexto, item.sku, settings);
    if (atual) {
      existentes.push({ sku: item.sku, externalItemId: atual.externalItemId });
    } else {
      ineditos.push(item);
    }
  }

  if (ineditos.length === 0) {
    return {
      marketplace: 'shopee',
      taskId: null,
      count: 0,
      skippedWrite: true,
      idempotencyKey: idempotencyKeyFor(
        contexto, 'batch_add_item', preparados.map((item) => item.sku).join(',')
      ),
      existentes
    };
  }

  const resposta = await batchAddItem(accessToken, shopId, {
    items: ineditos.map((item) => item.payload)
  });
  const taskId = extractTaskId(resposta?.body);
  if (!taskId) {
    throw new MarketplaceError(
      'A API Shopee não devolveu task_id para o lote; consulte a loja antes de repetir.',
      { code: 'SHOPEE_TASK_ID_MISSING', marketplace: 'shopee' }
    );
  }

  return {
    marketplace: 'shopee',
    taskId,
    count: ineditos.length,
    skippedWrite: false,
    idempotencyKey: idempotencyKeyFor(
      contexto, 'batch_add_item', ineditos.map((item) => item.sku).join(',')
    ),
    existentes,
    itens: ineditos.map((item) => ({
      sku: item.sku,
      payloadHash: item.payloadHash
    }))
  };
}

/** Consulta o resultado de um lote via v2.product.get_batch_task_result. */
export async function getBatchResult(primeiro, segundo, terceiro) {
  const { contexto, alvo } = normalizeArguments(primeiro, segundo, terceiro);
  const { accessToken, shopId } = requireCredentials(contexto);
  const bruto = alvo && typeof alvo === 'object'
    ? (alvo.taskId ?? alvo.task_id)
    : alvo;
  const taskId = Number(bruto);

  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new ConfigError(
      'task_id inválido para consultar o lote da Shopee.',
      { code: 'SHOPEE_TASK_ID_INVALID', marketplace: 'shopee' }
    );
  }

  const resposta = await getBatchTaskResult(accessToken, shopId, { task_id: taskId });
  return resposta?.body?.response ?? resposta?.body ?? null;
}
