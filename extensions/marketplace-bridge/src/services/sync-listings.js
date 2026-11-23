/**
 * Sincronização de anúncios — Fase 3 (Mercado Livre e Shopee BR).
 *
 * Orquestra catálogo, preço, config de publicação, idempotência local,
 * outbox e adaptadores. Nenhuma chamada de API acontece sem que TODAS as
 * guardas passem: marketplace habilitado, conta conectada, token vigente,
 * SKU na allowlist (publishAllowed/publishSkus) e preço publicável.
 *
 * Esta extensão entra desativada por padrão; mesmo com código completo,
 * nenhum anúncio é criado sem configuração explícita e autorização posterior.
 */

import { createHash } from 'node:crypto';
import {
  canPublish,
  getMarketplaceSettings,
  isEnabled,
  readMarketplaceConfig
} from '../lib/config.js';
import {
  getActiveToken,
  getListing,
  getSyncCursor,
  listConnectedAccounts,
  markTokenUsed,
  saveToken,
  setSyncCursor,
  upsertListing
} from '../lib/db.js';
import {
  getProductBySku,
  getProductImages,
  getProductsForMarketplace
} from '../lib/catalog.js';
import { assertPublishablePrice, toCents } from '../lib/pricing.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { normalizeSku } from '../lib/normalize.js';
import { markEventAsProcessed, recordEvent } from '../lib/events.js';
import { enqueue, registerOutboxHandler } from '../lib/outbox.js';

const MARKETPLACES = new Set(['mercadolivre', 'shopee']);
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;
const MARGEM_EXPIRACAO_MS = 30_000;

const CAMINHOS = Object.freeze({
  mercadolivre: Object.freeze({
    listings: '../lib/adapters/mercadolivre/listings.js',
    mapper: '../lib/adapters/mercadolivre/mapper.js',
    oauth: '../lib/adapters/mercadolivre/oauth.js'
  }),
  shopee: Object.freeze({
    listings: '../lib/adapters/shopee/listings.js',
    mapper: '../lib/adapters/shopee/mapper.js',
    oauth: '../lib/adapters/shopee/oauth.js'
  })
});

function primeiroCampo(objeto, nomes) {
  if (!objeto || typeof objeto !== 'object') {
    return undefined;
  }
  for (const nome of nomes) {
    const valor = objeto[nome];
    if (valor !== undefined && valor !== null && valor !== '') {
      return valor;
    }
  }
  return undefined;
}

function comoArray(valor) {
  if (Array.isArray(valor)) {
    return valor;
  }
  if (valor && typeof valor === 'object') {
    for (const chave of ['items', 'rows', 'records', 'products']) {
      if (Array.isArray(valor[chave])) {
        return valor[chave];
      }
    }
  }
  return [];
}

function textoSeguro(valor) {
  if (typeof valor === 'string') {
    return valor.replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return String(valor);
  }
  return '';
}

/** Mensagens curtas, sem token, assinatura, query assinada ou payload bruto. */
function mensagemSegura(erro) {
  if (erro === null || erro === undefined) {
    return 'erro não informado';
  }
  const texto = textoSeguro(erro.message ?? erro);
  return texto
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/\b(access_token|refresh_token|token|sign|secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

async function semFalha(fn) {
  try {
    return await fn();
  } catch {
    // Falha de observabilidade ou de leitura nunca derruba o cron inteiro.
    return null;
  }
}

async function registrarEvento(marketplace, topico, idExterno, payload) {
  const registrado = await semFalha(() =>
    recordEvent({
      marketplace,
      topic: topico,
      externalEventId: textoSeguro(idExterno),
      payload
    })
  );
  if (registrado?.eventId !== null && registrado?.eventId !== undefined) {
    await semFalha(() => markEventAsProcessed(registrado.eventId, null));
  }
  return registrado;
}

async function carregarAdaptador(marketplace, tipo) {
  const caminho = CAMINHOS[marketplace]?.[tipo];
  if (!caminho) {
    return null;
  }
  try {
    return await import(caminho);
  } catch {
    // Adaptador ausente: fail closed, sem chamada de API.
    return null;
  }
}

/** Ponte para adaptadores posicionais (ML) e baseados em objeto (Shopee). */
function chamarAdaptador(fn, { objeto, posicional }) {
  if (typeof fn !== 'function') {
    throw new Error('Função do adaptador indisponível.');
  }
  return fn.length >= 2 ? fn(...posicional) : fn(objeto);
}

function posicoesPreco({ marketplace, accessToken, conta, sku, externalItemId, produto, modelId }) {
  return marketplace === 'shopee'
    ? [
        accessToken,
        shopIdDaConta(conta),
        externalItemId,
        modelId,
        produto,
        { sku, retries: 0 }
      ]
    : [
        accessToken,
        externalItemId,
        produto,
        {
          sku,
          sellerId: sellerIdDaConta(conta),
          siteId: 'MLB'
        }
      ];
}

/** Shopee exige model_id; obtemos o modelo real do anúncio via listings. */
async function modeloShopee(marketplace, conta, accessToken, sku, externalItemId) {
  if (marketplace !== 'shopee') {
    return null;
  }
  const listings = await carregarAdaptador(marketplace, 'listings');
  if (typeof listings?.findListingBySku !== 'function') {
    return null;
  }
  const contexto = contextoAdapter({
    marketplace,
    conta,
    accessToken,
    sku,
    externalItemId
  });
  const encontrado = await chamarAdaptador(listings.findListingBySku, {
    objeto: contexto,
    posicional: [contexto, sku, {}, {}]
  });
  const candidato = primeiroCampo(encontrado?.model ?? encontrado, ['modelId', 'model_id']);
  const numero = Number(candidato);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function limiteEfetivo(limit) {
  const configurado = readMarketplaceConfig()?.sync?.batchSize;
  const bruto =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : Number(configurado) > 0
        ? Number(configurado)
        : LIMITE_PADRAO;
  return Math.min(LIMITE_MAXIMO, Math.max(1, Math.trunc(bruto)));
}

function idDaConta(conta) {
  return primeiroCampo(conta, ['accountId', 'account_id', 'id']);
}

function sellerIdDaConta(conta) {
  return primeiroCampo(conta, ['sellerId', 'seller_id', 'shopId', 'shop_id']);
}

function shopIdDaConta(conta) {
  const valor = primeiroCampo(conta, ['shopId', 'shop_id']);
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : 0;
}

function idDoToken(token) {
  // A coluna real da migration é marketplace_token_id.
  return primeiroCampo(token, ['marketplace_token_id', 'id', 'tokenId', 'token_id']);
}

/** getActiveToken devolve a linha com encrypted_value; a chave vem do ambiente. */
function valorDoToken(token) {
  const cifrado = primeiroCampo(token, ['encrypted_value', 'encryptedValue']);
  if (typeof cifrado === 'string' && cifrado.trim() !== '') {
    return semFalhaSincrona(() => decryptSecret(cifrado));
  }
  const direto = primeiroCampo(token, ['value', 'plaintext', 'decryptedValue', 'decrypted_value']);
  return typeof direto === 'string' && direto.trim() ? direto : null;
}

function semFalhaSincrona(fn) {
  try {
    const valor = fn();
    return typeof valor === 'string' && valor.trim() ? valor : null;
  } catch {
    return null;
  }
}

function dataDoToken(valor) {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.getTime();
  }
  const numero = Number(valor);
  if (Number.isFinite(numero) && numero > 0) {
    // Números pequenos são segundos (expires_in); os demais, milissegundos.
    return numero < 1e12 ? numero * 1000 : numero;
  }
  const tempo = Date.parse(String(valor));
  return Number.isNaN(tempo) ? null : tempo;
}

function tokenVencido(token) {
  const expira = dataDoToken(primeiroCampo(token, ['expiresAt', 'expires_at', 'expiresIn', 'expires_in']));
  if (expira === null) {
    // Sem informação de validade, considera vigente para evitar renovação cega.
    return false;
  }
  return expira <= Date.now() + MARGEM_EXPIRACAO_MS;
}

/** Refresh de uso único: used_at preenchido impede qualquer reenvio. */
function tokenUsado(token) {
  return primeiroCampo(token, ['usedAt', 'used_at']) !== undefined;
}

function validadeRenovada(resposta, tipo) {
  const direta = dataDoToken(primeiroCampo(resposta, ['expiresAt', 'expires_at']));
  if (direta !== null) {
    return new Date(direta).toISOString();
  }
  const segundos = Number(primeiroCampo(resposta, ['expiresIn', 'expires_in']));
  if (Number.isFinite(segundos) && segundos > 0) {
    return new Date(Date.now() + segundos * 1000).toISOString();
  }
  return null;
}

/**
 * Obtém access token vigente. Refresh é de uso único: marca o anterior como
 * usado ANTES de gravar o novo, sempre com generation incrementado.
 * Nunca devolve nem registra o valor do token.
 */
async function obterAccessToken(marketplace, conta) {
  const accountId = idDaConta(conta);
  if (!accountId) {
    return null;
  }

  const access = await semFalha(() => getActiveToken({ accountId, type: 'access' }));
  const accessValido = valorDoToken(access);
  if (accessValido && !tokenVencido(access)) {
    return accessValido;
  }

  const refresh = await semFalha(() => getActiveToken({ accountId, type: 'refresh' }));
  const refreshValor = valorDoToken(refresh);
  if (!refresh || !refreshValor || tokenVencido(refresh) || tokenUsado(refresh)) {
    // Sem refresh vigente, a conta precisa de nova autorização: fail closed.
    return null;
  }

  const oauth = await carregarAdaptador(marketplace, 'oauth');
  if (typeof oauth?.refreshAccessToken !== 'function') {
    return null;
  }

  const resposta = await oauth.refreshAccessToken(
    marketplace === 'shopee'
      ? { shopId: shopIdDaConta(conta), refreshToken: refreshValor }
      : refreshValor
  );
  if (!resposta || typeof resposta !== 'object') {
    return null;
  }

  const geracaoAtual = Number(primeiroCampo(refresh, ['generation']));
  const proximaGeracao = Number.isSafeInteger(geracaoAtual) && geracaoAtual >= 0
    ? geracaoAtual + 1
    : 1;

  // Ordem obrigatória: invalidar o refresh antigo ANTES de devolver/usar o
  // novo. A atomicidade entre markTokenUsed e saveToken depende de lib/db.js
  // expor as duas gravações na mesma transação (registrado como dependência).
  const idRefresh = idDoToken(refresh);
  if (idRefresh !== undefined && idRefresh !== null) {
    await semFalha(() => markTokenUsed(idRefresh));
  }

  const novoAccess = primeiroCampo(resposta, ['accessToken', 'access_token']);
  if (typeof novoAccess !== 'string' || novoAccess === '') {
    return null;
  }

  const escopo = primeiroCampo(resposta, ['scope']) ?? null;
  const expiraAccess = validadeRenovada(resposta, 'access');
  await semFalha(() =>
    saveToken({
      accountId,
      type: 'access',
      value: encryptSecret(novoAccess),
      expiresAt: expiraAccess,
      scope: escopo,
      generation: proximaGeracao
    })
  );

  const novoRefresh = primeiroCampo(resposta, ['refreshToken', 'refresh_token']);
  if (typeof novoRefresh === 'string' && novoRefresh !== '') {
    await semFalha(() =>
      saveToken({
        accountId,
        type: 'refresh',
        value: encryptSecret(novoRefresh),
        expiresAt: validadeRenovada(resposta, 'refresh'),
        scope: escopo,
        generation: proximaGeracao
      })
    );
  }

  return novoAccess;
}

function contextoAdapter({ marketplace, conta, accessToken, settings, sku, produto, payload, externalItemId, quantidade, precoCents, cursor, idempotencyKey }) {
  const sellerId = sellerIdDaConta(conta);
  const shopId = shopIdDaConta(conta);
  return {
    marketplace,
    accessToken,
    token: accessToken,
    idempotencyKey,
    sellerId,
    seller_id: sellerId,
    shopId,
    shop_id: shopId,
    siteId: primeiroCampo(conta, ['siteId', 'site_id']) ?? settings.siteId ?? null,
    settings,
    marketplaceSettings: settings,
    sku,
    product: produto,
    produto,
    payload,
    externalItemId,
    external_item_id: externalItemId,
    itemId: externalItemId,
    item_id: externalItemId,
    quantity: quantidade,
    quantidade,
    priceCents,
    price_cents: precoCents,
    since: cursor ?? null,
    limit: 1
  };
}

function idExternoDoAnuncio(valor) {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor === 'string' || typeof valor === 'number') {
    return String(valor);
  }
  if (typeof valor !== 'object') {
    return null;
  }
  for (const chave of [
    'externalItemId',
    'external_item_id',
    'itemId',
    'item_id',
    'listingId',
    'listing_id',
    'id',
    'code'
  ]) {
    const candidato = valor[chave];
    if (typeof candidato === 'string' && candidato.trim()) {
      return candidato.trim();
    }
    if (typeof candidato === 'number' && Number.isFinite(candidato)) {
      return String(candidato);
    }
  }
  return null;
}

function canonico(valor) {
  if (Array.isArray(valor)) {
    return valor.map(canonico);
  }
  if (valor && typeof valor === 'object') {
    const objeto = {};
    for (const chave of Object.keys(valor).sort()) {
      objeto[chave] = canonico(valor[chave]);
    }
    return objeto;
  }
  return valor;
}

function hashPayload(payload) {
  return createHash('sha256')
    .update(JSON.stringify(canonico(payload ?? {})), 'utf8')
    .digest('hex');
}

function quantidadeProduto(produto) {
  const bruta = Number(produto?.qty ?? produto?.quantity ?? 0);
  if (!Number.isFinite(bruta) || bruta <= 0) {
    return 0;
  }
  return Math.floor(bruta);
}

function statusLocal(marketplace, settings, payload) {
  if (marketplace === 'shopee') {
    return settings.itemStatusDefault ?? 'UNLIST';
  }
  return payload?.status ?? 'active';
}

async function contaPorSellerId(marketplace, sellerId) {
  const contas = comoArray(await semFalha(() => listConnectedAccounts(marketplace)));
  const desejado = String(sellerId ?? '');
  return (
    contas.find((conta) => String(sellerIdDaConta(conta) ?? '') === desejado) ?? null
  );
}

/**
 * Manipuladores da outbox. Sem registro, processOutbox falha fechado; aqui as
 * operações são idempotentes por marketplace + seller + sku e repetem as
 * guardas de config e preço antes de qualquer chamada remota.
 */
async function manipularAnuncio({ marketplace, operation, payload, sku, externalId, idempotencyKey }) {
  if (!MARKETPLACES.has(marketplace) || !isEnabled(marketplace)) {
    return null;
  }

  const skuNormalizado = textoSeguro(normalizeSku(sku ?? payload?.sku)).toUpperCase();
  const sellerId = payload?.sellerId ?? externalId;
  if (!skuNormalizado || !sellerId || !canPublish(marketplace, skuNormalizado)) {
    return null;
  }

  const produto = await semFalha(() => getProductBySku(skuNormalizado));
  if (!produto) {
    return null;
  }
  assertPublishablePrice(produto);
  const precoCents = toCents(produto.price);

  const conta = await contaPorSellerId(marketplace, sellerId);
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  const listings = await carregarAdaptador(marketplace, 'listings');
  const mapper = await carregarAdaptador(marketplace, 'mapper');
  if (!accessToken || typeof listings?.findListingBySku !== 'function') {
    return null;
  }

  const settings = getMarketplaceSettings(marketplace) ?? {};
  const imagens = await semFalha(() => getProductImages(produto.productId ?? null));
  const contexto = contextoAdapter({
    marketplace,
    conta: conta ?? {},
    accessToken,
    settings: { ...settings, images: comoArray(imagens) },
    sku: skuNormalizado,
    produto,
    precoCents,
    quantidade: quantidadeProduto(produto),
    idempotencyKey: idempotencyKey ?? null
  });

  const encontrado = await listings.findListingBySku(contexto);
  const externalItemId = idExternoDoAnuncio(encontrado);
  const payloadMapeado =
    typeof mapper?.mapProductToPayload === 'function'
      ? await semFalha(() => mapper.mapProductToPayload(contexto))
      : null;

  if (externalItemId && (operation === 'listing.update' || operation === 'listing.upsert')) {
    if (typeof listings.updateListing !== 'function') {
      return null;
    }
    await listings.updateListing({ ...contexto, externalItemId, payload: payloadMapeado });
    return null;
  }
  if (externalItemId || operation !== 'listing.create') {
    // Já existe anúncio: não repetir criação (idempotência).
    return null;
  }
  if (typeof listings.createListing !== 'function') {
    return null;
  }

  const criado = await listings.createListing({ ...contexto, payload: payloadMapeado });
  const idCriado = idExternoDoAnuncio(criado);
  if (!idCriado) {
    throw new Error('O adaptador não devolveu identificador externo ao processar a outbox.');
  }

  await upsertListing({
    marketplace,
    sellerId,
    sku: skuNormalizado,
    productId: produto.productId ?? null,
    externalItemId: idCriado,
    status: statusLocal(marketplace, settings, payloadMapeado),
    priceCents,
    quantity: quantidadeProduto(produto),
    payloadHash: hashPayload(payloadMapeado),
    lastError: null
  });
  return null;
}

async function manipularPreco({ marketplace, payload, sku, externalId }) {
  if (!MARKETPLACES.has(marketplace) || !isEnabled(marketplace)) {
    return null;
  }

  const skuNormalizado = textoSeguro(normalizeSku(sku ?? payload?.sku)).toUpperCase();
  const sellerId = payload?.sellerId ?? externalId;
  if (!skuNormalizado || !sellerId || !canPublish(marketplace, skuNormalizado)) {
    return null;
  }

  const produto = await semFalha(() => getProductBySku(skuNormalizado));
  if (!produto) {
    return null;
  }
  assertPublishablePrice(produto);
  const precoCents = toCents(produto.price);

  const local = await semFalha(() => getListing(marketplace, sellerId, skuNormalizado));
  const externalItemId = local?.externalItemId ?? local?.external_item_id ?? null;
  if (!externalItemId || Number(local?.priceCents ?? local?.price_cents) === precoCents) {
    return null;
  }

  const conta = await contaPorSellerId(marketplace, sellerId);
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  const inventory = await carregarAdaptador(marketplace, 'inventory');
  if (!accessToken || typeof inventory?.updatePrice !== 'function') {
    return null;
  }

  const settings = getMarketplaceSettings(marketplace) ?? {};
  const contextoPreco = contextoAdapter({
    marketplace,
    conta: conta ?? {},
    accessToken,
    settings,
    sku: skuNormalizado,
    produto,
    externalItemId,
    precoCents
  });
  const modelId = await modeloShopee(
    marketplace,
    conta ?? {},
    accessToken,
    skuNormalizado,
    externalItemId
  );
  if (marketplace === 'shopee' && !modelId) {
    // Sem model_id não há escrita segura de preço na Shopee.
    return null;
  }

  await chamarAdaptador(inventory.updatePrice, {
    objeto: contextoPreco,
    posicional: posicoesPreco({
      marketplace,
      accessToken,
      conta: conta ?? {},
      sku: skuNormalizado,
      externalItemId,
      produto,
      modelId
    })
  });

  await upsertListing({
    marketplace,
    sellerId,
    sku: skuNormalizado,
    productId: produto.productId ?? local?.productId ?? null,
    externalItemId,
    status: local?.status ?? statusLocal(marketplace, settings, null),
    priceCents,
    quantity: Math.max(0, Math.floor(Number(local?.quantity ?? 0) || 0)),
    payloadHash: local?.payloadHash ?? local?.payload_hash ?? hashPayload({ precoCents }),
    lastError: null
  });
  return null;
}

registerOutboxHandler('listing.upsert', manipularAnuncio);
registerOutboxHandler('listing.create', manipularAnuncio);
registerOutboxHandler('listing.update', manipularAnuncio);
registerOutboxHandler('listing.price', manipularPreco);
// Nomes exportados pelos adapters de inventory (operações de escrita).
registerOutboxHandler('updatePrice', manipularPreco);

function contadorInicial(marketplace) {
  return {
    marketplace,
    executado: false,
    motivo: null,
    contas: 0,
    processados: 0,
    ignorados: 0,
    erros: 0
  };
}

/** Único ponto de entrada dos crons. Marketplace inválido/desativado é no-op. */
export async function run({ marketplace, limit } = {}) {
  const resultado = contadorInicial(typeof marketplace === 'string' ? marketplace : null);

  if (!MARKETPLACES.has(marketplace) || !isEnabled(marketplace)) {
    resultado.motivo = 'Marketplace inválido ou desativado; nenhuma ação executada.';
    return resultado;
  }

  const settings = getMarketplaceSettings(marketplace) ?? {};
  const maximo = limiteEfetivo(limit);
  const contas = comoArray(await semFalha(() => listConnectedAccounts(marketplace)));

  for (const conta of contas) {
    const sellerId = sellerIdDaConta(conta);
    if (!sellerId) {
      resultado.ignorados += 1;
      continue;
    }
    resultado.contas += 1;

    const accessToken = await obterAccessToken(marketplace, conta);
    if (!accessToken) {
      // Conta desconectada/token ausente: no-op seguro, sem chamada de API.
      resultado.ignorados += 1;
      await registrarEvento(
        marketplace,
        'sincronizacao.token.indisponivel',
        `${sellerId}:anuncios`,
        { sellerId, motivo: 'Token indisponível para a conta; nenhuma API foi chamada.' }
      );
      continue;
    }

    // getSyncCursor devolve a linha; o valor está em `.cursor`.
    const linhaCursor = await semFalha(() => getSyncCursor(marketplace, sellerId, 'listings'));
    const cursor = linhaCursor?.cursor ?? null;
    const listings = await carregarAdaptador(marketplace, 'listings');
    const mapper = await carregarAdaptador(marketplace, 'mapper');
    if (typeof listings?.findListingBySku !== 'function') {
      resultado.erros += 1;
      await registrarEvento(
        marketplace,
        'sincronizacao.adapter.indisponivel',
        `${sellerId}:anuncios`,
        { sellerId, motivo: 'Adaptador de anúncios indisponível; nenhuma API foi chamada.' }
      );
      continue;
    }

    const restante = maximo - resultado.processados;
    if (restante <= 0) {
      break;
    }
    const produtos = comoArray(
      await semFalha(() => getProductsForMarketplace({ limit: restante, offset: 0 }))
    );

    for (const produto of produtos) {
      if (resultado.processados >= maximo) {
        break;
      }

      const sku = textoSeguro(normalizeSku(produto?.sku)).toUpperCase();
      if (!sku) {
        resultado.ignorados += 1;
        continue;
      }

      // Guarda 1: allowlist explícita. Vazia nunca significa "todos os SKUs".
      if (!canPublish(marketplace, sku)) {
        resultado.ignorados += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.publicacao.bloqueada',
          `${sellerId}:${sku}:publicacao`,
          {
            sellerId,
            sku,
            motivo: 'Publicação não autorizada: publishAllowed desativado ou SKU fora de publishSkus.'
          }
        );
        continue;
      }

      // Guarda 2: preço da única fonte autorizada (product.price).
      try {
        assertPublishablePrice(produto);
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.preco.indisponivel',
          `${sellerId}:${sku}:preco`,
          { sellerId, sku, motivo: mensagemSegura(erro) }
        );
        continue;
      }

      let precoCents;
      try {
        precoCents = toCents(produto.price);
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.preco.invalido',
          `${sellerId}:${sku}:preco`,
          { sellerId, sku, motivo: mensagemSegura(erro) }
        );
        continue;
      }

      const quantidade = quantidadeProduto(produto);
      const local = await semFalha(() => getListing(marketplace, sellerId, sku));

      // Registro durável PRIMEIRO: a chave determinística da outbox é reutilizada
      // em mapeador, listings e client em todas as tentativas (corrida segura).
      const registrado = await enqueue({
        marketplace,
        operation: 'listing.upsert',
        sku,
        externalId: sellerId,
        payload: {
          sellerId,
          sku,
          productId: produto?.productId ?? produto?.product_id ?? null,
          quantity: quantidade,
          priceCents
        }
      });
      const idempotencyKey = registrado?.idempotencyKey ?? null;

      const imagens = await semFalha(() =>
        getProductImages(produto?.productId ?? local?.productId ?? null)
      );
      const contextoBase = contextoAdapter({
        marketplace,
        conta,
        accessToken,
        settings: { ...settings, images: comoArray(imagens) },
        sku,
        produto,
        precoCents,
        quantidade,
        cursor,
        idempotencyKey
      });

      try {
        const encontrado = await listings.findListingBySku(contextoBase);
        let externalItemId = idExternoDoAnuncio(encontrado);

        let payload = null;
        if (typeof mapper?.mapProductToPayload === 'function') {
          payload = await semFalha(() => mapper.mapProductToPayload(contextoBase));
        }
        const contextoEscrita = {
          ...contextoBase,
          payload,
          externalItemId
        };

        if (externalItemId) {
          if (typeof listings.updateListing !== 'function') {
            throw new Error('Adaptador sem updateListing; atualização bloqueada.');
          }
          await listings.updateListing(contextoEscrita);
        } else {
          if (typeof listings.createListing !== 'function') {
            throw new Error('Adaptador sem createListing; criação bloqueada.');
          }
          const criado = await listings.createListing(contextoEscrita);
          externalItemId = idExternoDoAnuncio(criado);
          if (!externalItemId) {
            const confirmado = await semFalha(() => listings.findListingBySku(contextoBase));
            externalItemId = idExternoDoAnuncio(confirmado);
          }
        }

        if (!externalItemId) {
          throw new Error('O adaptador não devolveu identificador externo do anúncio.');
        }

        await upsertListing({
          marketplace,
          sellerId,
          sku,
          productId: produto?.productId ?? produto?.product_id ?? local?.productId ?? null,
          externalItemId,
          status: statusLocal(marketplace, settings, payload),
          priceCents,
          quantity: quantidade,
          payloadHash: hashPayload(payload),
          lastError: null
        });

        resultado.processados += 1;
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.anuncio.erro',
          `${sellerId}:${sku}:erro`,
          { sellerId, sku, motivo: mensagemSegura(erro) }
        );
      }
    }

    await semFalha(() =>
      setSyncCursor(marketplace, sellerId, 'listings', new Date().toISOString())
    );
  }

  resultado.executado = true;
  return resultado;
}
