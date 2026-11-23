/**
 * Sincronização de pedidos — Fase 3 (Mercado Livre e Shopee BR).
 *
 * Busca pedidos recentes nos adaptadores, aplica dedupe por
 * marketplace + seller_id + external_order_id e ajusta o estoque do EverShop
 * de forma transacional (via lib/db.js), nunca abaixo de zero.
 *
 * Conta desconectada, refresh usado ou token ausente são no-op seguro:
 * nenhuma API é chamada e o evento registrado já sai marcado como processado.
 */

import {
  readMarketplaceConfig,
  isEnabled
} from '../lib/config.js';
import {
  adjustEverShopStock,
  getActiveToken,
  getSyncCursor,
  insertOrderIfAbsent,
  listConnectedAccounts,
  markTokenUsed,
  saveToken,
  setSyncCursor
} from '../lib/db.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { getProductBySku } from '../lib/catalog.js';
import { toCents } from '../lib/pricing.js';
import { normalizeSku } from '../lib/normalize.js';
import { markEventAsProcessed, recordEvent } from '../lib/events.js';
import { enqueue, registerOutboxHandler } from '../lib/outbox.js';

const MARKETPLACES = new Set(['mercadolivre', 'shopee']);
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;
const MARGEM_EXPIRACAO_MS = 30_000;

const CAMINHOS = Object.freeze({
  mercadolivre: Object.freeze({
    orders: '../lib/adapters/mercadolivre/orders.js',
    oauth: '../lib/adapters/mercadolivre/oauth.js',
    webhook: '../lib/adapters/mercadolivre/webhook.js'
  }),
  shopee: Object.freeze({
    orders: '../lib/adapters/shopee/orders.js',
    oauth: '../lib/adapters/shopee/oauth.js',
    webhook: '../lib/adapters/shopee/webhook.js'
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
    for (const chave of ['items', 'rows', 'records', 'orders']) {
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

function mensagemSegura(erro) {
  if (erro === null || erro === undefined) {
    return 'erro não informado';
  }
  return textoSeguro(erro.message ?? erro)
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/\b(access_token|refresh_token|token|sign|secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

async function semFalha(fn) {
  try {
    return await fn();
  } catch {
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
    return null;
  }
}

/**
 * Os adaptadores ML usam assinatura posicional `(token, ..., opcoes)`;
 * adaptadores em estilo objeto têm `length` 0/1. Esta ponte evita duplicar
 * implementação e mantém os serviços independentes do estilo do adaptador.
 */
function chamarAdaptador(fn, { objeto, posicional }) {
  if (typeof fn !== 'function') {
    throw new Error('Função do adaptador indisponível.');
  }
  return fn.length >= 2 ? fn(...posicional) : fn(objeto);
}

function argumentosPedido(contexto) {
  return {
    accessToken: contexto.accessToken,
    sellerId: contexto.sellerId,
    shopId: contexto.shopId,
    siteId: marketplaceSiteId(contexto.marketplace),
    limit: contexto.limit ?? 1
  };
}

function posicoesLeituraPedido(marketplace, accessToken, idExterno, contexto = {}) {
  return marketplace === 'shopee'
    ? [accessToken, contexto.shopId ?? 0, idExterno, { retries: 0 }]
    : [
        accessToken,
        idExterno,
        {
          siteId: 'MLB',
          shopId: contexto.shopId,
          sellerId: contexto.sellerId
        }
      ];
}

function posicoesListagemPedidos(marketplace, accessToken, sellerId, cursor, contexto = {}) {
  return marketplace === 'shopee'
    ? [accessToken, contexto.shopId ?? sellerId, cursor, contexto.limit ?? 50]
    : [
        accessToken,
        sellerId,
        cursor,
        { ...argumentosPedido(contexto), limit: contexto.limit ?? 50 }
      ];
}

function marketplaceSiteId(marketplace) {
  return marketplace === 'mercadolivre' ? 'MLB' : 'BR';
}

function pedidoDentroDoSite(pedido, marketplace) {
  if (marketplace !== 'mercadolivre') {
    return true;
  }
  const site = primeiroCampo(pedido, ['siteId', 'site_id']);
  return site === undefined || site === null || site === 'MLB';
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
  const numero = Number(primeiroCampo(conta, ['shopId', 'shop_id']));
  return Number.isSafeInteger(numero) && numero > 0 ? numero : 0;
}

function idDoToken(token) {
  return primeiroCampo(token, ['marketplace_token_id', 'id', 'tokenId', 'token_id']);
}

function semFalhaSincrona(fn) {
  try {
    const valor = fn();
    return typeof valor === 'string' && valor.trim() ? valor : null;
  } catch {
    return null;
  }
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

function dataDoToken(valor) {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.getTime();
  }
  const numero = Number(valor);
  if (Number.isFinite(numero) && numero > 0) {
    return numero < 1e12 ? numero * 1000 : numero;
  }
  const tempo = Date.parse(String(valor));
  return Number.isNaN(tempo) ? null : tempo;
}

function tokenVencido(token) {
  const expira = dataDoToken(primeiroCampo(token, ['expiresAt', 'expires_at', 'expiresIn', 'expires_in']));
  return expira === null ? false : expira <= Date.now() + MARGEM_EXPIRACAO_MS;
}

/** Refresh de uso único: used_at preenchido impede qualquer reenvio. */
function tokenUsado(token) {
  return primeiroCampo(token, ['usedAt', 'used_at']) !== undefined;
}

function validadeRenovada(resposta) {
  const direta = dataDoToken(primeiroCampo(resposta, ['expiresAt', 'expires_at']));
  if (direta !== null) {
    return new Date(direta).toISOString();
  }
  const segundos = Number(primeiroCampo(resposta, ['expiresIn', 'expires_in']));
  return Number.isFinite(segundos) && segundos > 0
    ? new Date(Date.now() + segundos * 1000).toISOString()
    : null;
}

/** Tokens normalizados: { accessToken, refreshToken, expiresAt, expiresIn, scope, shopId, sellerId }. */
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
  const proximaGeracao =
    Number.isSafeInteger(geracaoAtual) && geracaoAtual >= 0 ? geracaoAtual + 1 : 1;

  // Invalida o refresh antigo ANTES de devolver/usar o novo. A atomicidade
  // entre markTokenUsed e saveToken depende de lib/db.js (ver resposta final).
  const idRefresh = idDoToken(refresh);
  if (idRefresh !== undefined && idRefresh !== null) {
    await semFalha(() => markTokenUsed(idRefresh));
  }

  const novoAccess = primeiroCampo(resposta, ['accessToken', 'access_token']);
  if (typeof novoAccess !== 'string' || novoAccess === '') {
    return null;
  }

  const escopo = primeiroCampo(resposta, ['scope']) ?? null;
  await semFalha(() =>
    saveToken({
      accountId,
      type: 'access',
      value: encryptSecret(novoAccess),
      expiresAt: validadeRenovada(resposta),
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
        expiresAt: validadeRenovada(resposta),
        scope: escopo,
        generation: proximaGeracao
      })
    );
  }

  return novoAccess;
}

function contextoAdapter({ marketplace, conta, accessToken, externalOrderId, cursor, limit }) {
  const sellerId = sellerIdDaConta(conta);
  const shopId = shopIdDaConta(conta);
  return {
    marketplace,
    accessToken,
    token: accessToken,
    sellerId,
    seller_id: sellerId,
    shopId,
    shop_id: shopId,
    externalOrderId,
    external_order_id: externalOrderId,
    orderId: externalOrderId,
    order_id: externalOrderId,
    ordersn: externalOrderId,
    since: cursor ?? null,
    limit: limit ?? 1
  };
}

function idDoPedido(pedido) {
  const valor = primeiroCampo(pedido, [
    'externalOrderId',
    'external_order_id',
    'orderId',
    'order_id',
    'id',
    'ordersn',
    'orderSn',
    'order_sn'
  ]);
  if (valor === undefined || valor === null) {
    return null;
  }
  const texto = textoSeguro(valor);
  return texto || null;
}

function itensDoPedido(detalhe) {
  const candidato = primeiroCampo(detalhe, ['items', 'orderItems', 'order_items', 'item']);
  return comoArray(candidato);
}

function skuDoItem(item) {
  const valor = primeiroCampo(item, [
    'sku',
    'sellerSku',
    'seller_sku',
    'seller_custom_field',
    'modelSku',
    'model_sku'
  ]);
  const texto = textoSeguro(valor);
  return texto || null;
}

function quantidadeDoItem(item) {
  const bruta = Number(primeiroCampo(item, ['quantity', 'qty', 'item_quantity']) ?? 1);
  return Number.isFinite(bruta) && bruta > 0 ? Math.floor(bruta) : 1;
}

function totalCentsDoPedido(detalhe, item) {
  const bruto = Number(
    primeiroCampo(item, ['total', 'amount', 'price']) ??
      primeiroCampo(detalhe, ['total', 'total_amount', 'paidAmount', 'paid_amount']) ??
      0
  );
  return Number.isFinite(bruto) && bruto > 0 ? toCents(bruto) : 0;
}

function dataDoPedido(pedido) {
  const bruta = primeiroCampo(pedido, [
    'dateCreated',
    'date_created',
    'createdAt',
    'created_at',
    'createTime',
    'create_time',
    'date'
  ]);
  if (bruta === undefined) {
    return null;
  }
  const tempo = bruta instanceof Date ? bruta.getTime() : dataDoToken(bruta);
  return tempo === null || !Number.isFinite(tempo) ? null : new Date(tempo).toISOString();
}

function ehCancelamento(status) {
  return textoSeguro(status).toLowerCase().startsWith('cancel');
}

function foiInserido(resultado) {
  if (resultado === null || resultado === undefined || resultado === false) {
    return false;
  }
  if (typeof resultado === 'object') {
    if (
      resultado.inserido === false ||
      resultado.inserted === false ||
      resultado.created === false ||
      resultado.duplicate === true ||
      resultado.duplicated === true
    ) {
      return false;
    }
    return true;
  }
  return true;
}

async function contaPorSellerId(marketplace, sellerId) {
  const contas = comoArray(await semFalha(() => listConnectedAccounts(marketplace)));
  const desejado = String(sellerId ?? '');
  return contas.find((conta) => String(sellerIdDaConta(conta) ?? '') === desejado) ?? null;
}

/**
 * Importa um pedido já identificado. Usada pelo cron e pelo manipulador da
 * outbox: a idempotência do insert evita baixa duplicada de estoque.
 */
async function importarPedido({ marketplace, conta, accessToken, pedido, cursor, sellerId }) {
  const idExterno = idDoPedido(pedido);
  if (!idExterno) {
    return { situacao: 'ignorado', motivo: 'sem identificador externo', data: null };
  }

  const orders = await carregarAdaptador(marketplace, 'orders');
  if (typeof orders?.getOrderDetail !== 'function') {
    return { situacao: 'erro', motivo: 'adaptador de pedidos indisponível', data: null };
  }

  const contextoLeitura = contextoAdapter({
    marketplace,
    conta,
    accessToken,
    externalOrderId: idExterno
  });
  const detalhe =
    (await semFalha(() =>
      chamarAdaptador(orders.getOrderDetail, {
        objeto: contextoLeitura,
        posicional: posicoesLeituraPedido(marketplace, accessToken, idExterno, contextoLeitura)
      })
    )) ?? pedido;

  if (!pedidoDentroDoSite(detalhe, marketplace)) {
    return { situacao: 'ignorado', motivo: 'pedido fora do site permitido', data: null };
  }

  const status = textoSeguro(
    primeiroCampo(detalhe, ['status', 'order_status', 'orderStatus']) ??
      primeiroCampo(pedido, ['status', 'order_status', 'orderStatus'])
  ) || null;
  const data = dataDoPedido(detalhe) ?? dataDoPedido(pedido);
  let processados = 0;
  let ignorados = 0;
  let ultimoErro = null;
  const itensValidos = [];

  for (const item of itensDoPedido(detalhe)) {
    const skuNormalizado = textoSeguro(normalizeSku(skuDoItem(item) ?? skuDoItem(pedido))).toUpperCase();
    if (!skuNormalizado) {
      ignorados += 1;
      continue;
    }

    const produto = await semFalha(() => getProductBySku(skuNormalizado));
    const productId = produto?.productId ?? null;
    if (!productId) {
      ignorados += 1;
      continue;
    }

    const quantidade = quantidadeDoItem(item);
    let totalCents = 0;
    try {
      totalCents = totalCentsDoPedido(detalhe, item);
    } catch {
      // Totals ausentes/inválidos não bloqueiam a importação do pedido.
      totalCents = 0;
    }
    itensValidos.push({ skuNormalizado, productId, quantidade, totalCents });
  }

  if (itensValidos.length === 0) {
    return { situacao: 'ignorado', motivo: 'sem itens verificáveis', data, ignorados };
  }

  // A chave única do pedido é (marketplace, seller_id, external_order_id):
  // uma única inserção inclusive para pedidos com vários SKUs.
  const primeiro = itensValidos[0];
  const payloadRedacted = {
    marketplace,
    sellerId,
    externalOrderId: idExterno,
    skus: itensValidos.map((item) => item.skuNormalizado),
    productIds: itensValidos.map((item) => item.productId),
    status,
    data
  };

  let inserido;
  try {
    inserido = await insertOrderIfAbsent({
      marketplace,
      sellerId,
      externalOrderId: idExterno,
      sku: primeiro.skuNormalizado,
      productId: primeiro.productId,
      quantity: primeiro.quantidade,
      totalCents: itensValidos.reduce((soma, item) => soma + item.totalCents, 0),
      status,
      payloadRedacted
    });
  } catch (erro) {
    ultimoErro = mensagemSegura(erro);
    return { situacao: 'erro', motivo: ultimoErro, data, ignorados };
  }

  if (!foiInserido(inserido)) {
    // Pedido já importado: nenhuma baixa de estoque é repetida.
    return { situacao: 'ignorado', motivo: 'pedido já importado', data, ignorados };
  }

  for (const item of itensValidos) {
    const delta = ehCancelamento(status) ? item.quantidade : -item.quantidade;
    try {
      await adjustEverShopStock({
        productId: item.productId,
        delta,
        reason: `marketplace:${marketplace}:seller:${sellerId}:pedido:${idExterno}:sku:${item.skuNormalizado}`
      });
      processados += 1;
    } catch (erro) {
      ultimoErro = mensagemSegura(erro);
    }
  }

  if (ultimoErro !== null) {
    return { situacao: 'erro', motivo: ultimoErro, data, processados, ignorados };
  }
  return {
    situacao: processados > 0 ? 'processado' : 'ignorado',
    data,
    processados,
    ignorados,
    status
  };
}

/** Manipulador da outbox: retry seguro, sem duplicar baixa de estoque. */
async function manipularPedido({ marketplace, payload, externalId, sku }) {
  if (!MARKETPLACES.has(marketplace) || !isEnabled(marketplace)) {
    return null;
  }

  const idExterno = textoSeguro(payload?.externalOrderId ?? externalId) || null;
  const sellerId = textoSeguro(payload?.sellerId) || null;
  if (!idExterno || !sellerId) {
    return null;
  }

  const conta = await contaPorSellerId(marketplace, sellerId);
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  if (!accessToken) {
    return null;
  }

  const pedido = {
    externalOrderId: idExterno,
    sku: sku ?? null,
    status: payload?.status ?? null,
    dateCreated: payload?.data ?? null,
    items: comoArray(payload?.itens)
  };

  const resultado = await importarPedido({
    marketplace,
    conta: conta ?? {},
    accessToken,
    pedido,
    sellerId
  });
  if (resultado.situacao === 'erro') {
    throw new Error(resultado.motivo);
  }
  return null;
}

/** Resolve a conta conectada a partir do sellerId/shopId do evento. */
async function contaDoEvento(marketplace, payload = {}) {
  const contas = comoArray(await semFalha(() => listConnectedAccounts(marketplace)));
  const desejado = String(payload.sellerId ?? payload.shopId ?? '');
  if (desejado) {
    return (
      contas.find(
        (conta) =>
          String(sellerIdDaConta(conta) ?? '') === desejado ||
          String(shopIdDaConta(conta) ?? '') === desejado
      ) ?? null
    );
  }
  return marketplace === 'mercadolivre' ? contas[0] ?? null : null;
}

/** Notificação ML: importa apenas recursos de pedido; dedupe evita repetição. */
async function manipularNotificacaoML({ marketplace, payload }) {
  if (marketplace !== 'mercadolivre' || !isEnabled(marketplace)) {
    return null;
  }
  const topico = textoSeguro(payload?.topic).toLowerCase();
  const recurso = textoSeguro(payload?.resource);
  const idExterno = textoSeguro(payload?.resourceId) || textoSeguro(payload?.externalEventId);
  if (!idExterno || (!topico.includes('order') && !recurso.includes('/orders/'))) {
    return null;
  }
  if (payload?.siteId && payload.siteId !== 'MLB') {
    return null;
  }

  const conta = await contaDoEvento(marketplace, payload);
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  const sellerId = sellerIdDaConta(conta ?? {}) ?? payload?.sellerId;
  if (!accessToken || !sellerId) {
    return null;
  }

  const resultado = await importarPedido({
    marketplace,
    conta: conta ?? {},
    accessToken,
    pedido: { externalOrderId: idExterno },
    sellerId
  });
  if (resultado.situacao === 'erro') {
    throw new Error(resultado.motivo);
  }
  return null;
}

/** missed_feeds ML: reprocessa a janela e importa cada pedido com dedupe. */
async function manipularMissedFeedsML({ marketplace, payload }) {
  if (marketplace !== 'mercadolivre' || !isEnabled(marketplace)) {
    return null;
  }
  const conta = await contaDoEvento(marketplace, payload);
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  const sellerId = sellerIdDaConta(conta ?? {}) ?? payload?.sellerId;
  if (!accessToken || !sellerId) {
    return null;
  }
  if (payload?.siteId && payload.siteId !== 'MLB') {
    return null;
  }

  const webhook = await carregarAdaptador(marketplace, 'webhook');
  if (typeof webhook?.reprocessarMissedFeeds !== 'function') {
    return null;
  }

  const janela = payload?.janela ?? { de: payload?.de, ate: payload?.ate };
  const reprocessado = await chamarAdaptador(webhook.reprocessarMissedFeeds, {
    objeto: { accessToken, sellerId, janela, limit: 50 },
    posicional: [accessToken, sellerId, janela, { limit: 50 }]
  });

  for (const pedido of comoArray(reprocessado?.orders)) {
    if (!pedidoDentroDoSite(pedido, marketplace)) {
      continue;
    }
    const importado = await importarPedido({
      marketplace,
      conta: conta ?? {},
      accessToken,
      pedido,
      sellerId
    });
    if (importado.situacao === 'erro') {
      throw new Error(importado.motivo);
    }
  }
  return null;
}

/** followUp da Shopee: consulta o detalhe e importa com a mesma chave de dedupe. */
async function manipularRefreshOrderDetailShopee({ marketplace, payload }) {
  if (marketplace !== 'shopee' || !isEnabled(marketplace)) {
    return null;
  }
  const shopId = Number(payload?.shopId ?? 0);
  const ordersn = textoSeguro(payload?.ordersn);
  if (!shopId || !ordersn) {
    return null;
  }

  const conta = await contaDoEvento(marketplace, { shopId });
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  if (!accessToken) {
    return null;
  }

  const orders = await carregarAdaptador(marketplace, 'orders');
  if (typeof orders?.getOrderDetail !== 'function') {
    return null;
  }
  const contexto = contextoAdapter({ marketplace, conta: conta ?? {}, accessToken, externalOrderId: ordersn });
  const detalhe = await chamarAdaptador(orders.getOrderDetail, {
    objeto: contexto,
    posicional: posicoesLeituraPedido(marketplace, accessToken, ordersn, contexto)
  });
  if (!detalhe) {
    return null;
  }

  const resultado = await importarPedido({
    marketplace,
    conta: conta ?? {},
    accessToken,
    pedido: detalhe,
    sellerId: sellerIdDaConta(conta ?? {})
  });
  if (resultado.situacao === 'erro') {
    throw new Error(resultado.motivo);
  }
  return null;
}

registerOutboxHandler('order.import', manipularPedido);
registerOutboxHandler('processar_notificacao_mercadolivre', manipularNotificacaoML);
registerOutboxHandler('reprocessar_missed_feeds_mercadolivre', manipularMissedFeedsML);
registerOutboxHandler('refreshOrderDetail', manipularRefreshOrderDetailShopee);

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
        `${sellerId}:pedidos`,
        { sellerId, motivo: 'Token indisponível para a conta; nenhuma API foi chamada.' }
      );
      continue;
    }

    const orders = await carregarAdaptador(marketplace, 'orders');
    if (typeof orders?.fetchRecentOrders !== 'function') {
      resultado.erros += 1;
      await registrarEvento(
        marketplace,
        'sincronizacao.adapter.indisponivel',
        `${sellerId}:pedidos`,
        { sellerId, motivo: 'Adaptador de pedidos indisponível; nenhuma API foi chamada.' }
      );
      continue;
    }

    // getSyncCursor devolve a linha; o valor está em `.cursor`.
    const linhaCursor = await semFalha(() => getSyncCursor(marketplace, sellerId, 'orders'));
    const cursor = linhaCursor?.cursor ?? null;
    const restante = maximo - resultado.processados;
    if (restante <= 0) {
      break;
    }

    const contextoListagem = contextoAdapter({
      marketplace,
      conta,
      accessToken,
      cursor,
      limit: restante
    });
    const respostaPedidos = await semFalha(() =>
      chamarAdaptador(orders.fetchRecentOrders, {
        objeto: contextoListagem,
        posicional: posicoesListagemPedidos(
          marketplace,
          accessToken,
          sellerId,
          cursor,
          { ...contextoListagem, limit: restante }
        )
      })
    );

    // Resposta oficial do ML: { orders, results, nextCursor, hasMore, total, siteId }.
    if (
      marketplace === 'mercadolivre' &&
      respostaPedidos &&
      typeof respostaPedidos === 'object' &&
      respostaPedidos.siteId !== undefined &&
      respostaPedidos.siteId !== 'MLB'
    ) {
      resultado.ignorados += 1;
      await registrarEvento(
        marketplace,
        'sincronizacao.pedidos.fora_do_site',
        `${sellerId}:pedidos`,
        { sellerId, motivo: 'Resposta fora do site MLB; nenhum pedido foi importado.' }
      );
      continue;
    }

    const pedidos = comoArray(respostaPedidos).filter((pedido) =>
      pedidoDentroDoSite(pedido, marketplace)
    );

    let cursorMaisRecente = cursor ?? null;

    for (const pedido of pedidos) {
      if (resultado.processados >= maximo) {
        break;
      }

      const idExterno = idDoPedido(pedido);
      if (!idExterno) {
        resultado.ignorados += 1;
        continue;
      }

      await enqueue({
        marketplace,
        operation: 'order.import',
        sku: textoSeguro(normalizeSku(skuDoItem(pedido))).toUpperCase() || idExterno,
        externalId: `${sellerId}:${idExterno}`,
        payload: {
          sellerId,
          externalOrderId: idExterno,
          status: textoSeguro(pedido?.status) || null,
          data: dataDoPedido(pedido)
        }
      });

      try {
        const importado = await importarPedido({
          marketplace,
          conta,
          accessToken,
          pedido,
          cursor,
          sellerId
        });

        if (importado.situacao === 'erro') {
          resultado.erros += 1;
          await registrarEvento(
            marketplace,
            'sincronizacao.pedido.erro',
            `${sellerId}:${idExterno}:erro`,
            { sellerId, externalOrderId: idExterno, motivo: importado.motivo }
          );
          continue;
        }

        resultado.processados += importado.processados ?? 0;
        resultado.ignorados += importado.ignorados ?? 0;
        if (
          importado.data &&
          (cursorMaisRecente === null || importado.data > cursorMaisRecente)
        ) {
          cursorMaisRecente = importado.data;
        }

        if (importado.situacao === 'processado') {
          await registrarEvento(
            marketplace,
            'sincronizacao.pedido.importado',
            `${sellerId}:${idExterno}:importado`,
            {
              sellerId,
              externalOrderId: idExterno,
              sku: textoSeguro(normalizeSku(skuDoItem(pedido))).toUpperCase() || null,
              status: importado.status ?? null
            }
          );
        }
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.pedido.erro',
          `${sellerId}:${idExterno}:erro`,
          { sellerId, externalOrderId: idExterno, motivo: mensagemSegura(erro) }
        );
      }
    }

    if (cursorMaisRecente && cursorMaisRecente !== cursor) {
      await semFalha(() =>
        setSyncCursor(marketplace, sellerId, 'orders', cursorMaisRecente)
      );
    }
  }

  resultado.executado = true;
  return resultado;
}
