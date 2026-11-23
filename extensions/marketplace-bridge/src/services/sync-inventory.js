/**
 * Sincronização de estoque — Fase 3 (Mercado Livre e Shopee BR).
 *
 * Compara a quantidade do catálogo EverShop com o último registro local do
 * anúncio e propaga a diferença ao marketplace. Respeita manage_stock, nunca
 * envia quantidade negativa e exige preço publicável antes de qualquer
 * escrita remota. Reconcilia apenas anúncios já registrados localmente.
 */

import { canPublish, isEnabled, readMarketplaceConfig } from '../lib/config.js';
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
import { getProductBySku, getProductsForMarketplace } from '../lib/catalog.js';
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
    inventory: '../lib/adapters/mercadolivre/inventory.js',
    listings: '../lib/adapters/mercadolivre/listings.js',
    oauth: '../lib/adapters/mercadolivre/oauth.js'
  }),
  shopee: Object.freeze({
    inventory: '../lib/adapters/shopee/inventory.js',
    listings: '../lib/adapters/shopee/listings.js',
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

/** Ponte para adaptadores posicionais (ML) e baseados em objeto (Shopee). */
function chamarAdaptador(fn, { objeto, posicional }) {
  if (typeof fn !== 'function') {
    throw new Error('Função do adaptador indisponível.');
  }
  return fn.length >= 2 ? fn(...posicional) : fn(objeto);
}

function posicoesEstoque({ marketplace, accessToken, conta, sku, externalItemId, quantidade, produto, modelId }) {
  return marketplace === 'shopee'
    ? [
        accessToken,
        shopIdDaConta(conta),
        externalItemId,
        modelId,
        quantidade,
        { sku, retries: 0 }
      ]
    : [
        accessToken,
        externalItemId,
        { quantity: quantidade, product: produto, sku, quantidade },
        { sku, sellerId: sellerIdDaConta(conta), siteId: 'MLB' }
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

function contextoAdapter({ marketplace, conta, accessToken, sku, externalItemId, quantidade, precoCents, cursor }) {
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
    sku,
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

function quantidadeSegura(produto) {
  const bruta = Number(produto?.qty ?? produto?.quantity ?? 0);
  if (!Number.isFinite(bruta) || bruta <= 0) {
    return 0;
  }
  return Math.floor(bruta);
}

function gerenciaEstoque(produto) {
  if (produto?.manageStock === undefined || produto?.manageStock === null) {
    return true;
  }
  return produto.manageStock === true || produto.manageStock === 1 || produto.manageStock === '1';
}

function idExternoDoRegistro(local) {
  return (
    primeiroCampo(local, ['externalItemId', 'external_item_id', 'itemId', 'item_id']) ?? null
  );
}

function quantidadeDoRegistro(local) {
  const valor = Number(primeiroCampo(local, ['quantity', 'qty']) ?? -1);
  return Number.isFinite(valor) && valor >= 0 ? Math.floor(valor) : -1;
}

async function contaPorSellerId(marketplace, sellerId) {
  const contas = comoArray(await semFalha(() => listConnectedAccounts(marketplace)));
  const desejado = String(sellerId ?? '');
  return contas.find((conta) => String(sellerIdDaConta(conta) ?? '') === desejado) ?? null;
}

/** Reexecução segura da outbox: compara com o registro local antes de chamar API. */
async function manipularEstoque({ marketplace, payload, externalId, sku }) {
  if (!MARKETPLACES.has(marketplace) || !isEnabled(marketplace)) {
    return null;
  }

  const skuNormalizado = textoSeguro(normalizeSku(sku ?? payload?.sku)).toUpperCase();
  const sellerId = textoSeguro(payload?.sellerId) ?? textoSeguro(externalId);
  if (!skuNormalizado || !sellerId || !canPublish(marketplace, skuNormalizado)) {
    return null;
  }

  const produto = await semFalha(() => getProductBySku(skuNormalizado));
  if (!produto || !gerenciaEstoque(produto)) {
    return null;
  }
  assertPublishablePrice(produto);
  const precoCents = toCents(produto.price);
  const quantidade = quantidadeSegura(produto);

  const local = await semFalha(() => getListing(marketplace, sellerId, skuNormalizado));
  const externalItemId = idExternoDoRegistro(local);
  if (!externalItemId || quantidadeDoRegistro(local) === quantidade) {
    // Já aplicado (ou sem anúncio conhecido): não repetir chamada remota.
    return null;
  }

  const conta = await contaPorSellerId(marketplace, sellerId);
  const accessToken = conta ? await obterAccessToken(marketplace, conta) : null;
  const inventory = await carregarAdaptador(marketplace, 'inventory');
  if (!accessToken || typeof inventory?.updateStock !== 'function') {
    return null;
  }

  const contexto = contextoAdapter({
    marketplace,
    conta: conta ?? {},
    accessToken,
    sku: skuNormalizado,
    externalItemId,
    quantidade,
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
    // Sem model_id não há escrita segura de estoque na Shopee.
    return null;
  }

  await chamarAdaptador(inventory.updateStock, {
    objeto: contexto,
    posicional: posicoesEstoque({
      marketplace,
      accessToken,
      conta: conta ?? {},
      sku: skuNormalizado,
      externalItemId,
      quantidade,
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
    status: local?.status ?? null,
    priceCents: Number(local?.priceCents ?? local?.price_cents) || precoCents,
    quantity: quantidade,
    payloadHash: local?.payloadHash ?? local?.payload_hash ?? null,
    lastError: null
  });
  return null;
}

registerOutboxHandler('listing.stock', manipularEstoque);
// Nome exportado pelo adapter Shopee (operação de escrita de estoque).
registerOutboxHandler('updateStock', manipularEstoque);

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
        `${sellerId}:estoque`,
        { sellerId, motivo: 'Token indisponível para a conta; nenhuma API foi chamada.' }
      );
      continue;
    }

    const inventory = await carregarAdaptador(marketplace, 'inventory');
    if (typeof inventory?.updateStock !== 'function') {
      resultado.erros += 1;
      await registrarEvento(
        marketplace,
        'sincronizacao.adapter.indisponivel',
        `${sellerId}:estoque`,
        { sellerId, motivo: 'Adaptador de estoque indisponível; nenhuma API foi chamada.' }
      );
      continue;
    }

    // getSyncCursor devolve a linha; o valor está em `.cursor`.
    const linhaCursor = await semFalha(() => getSyncCursor(marketplace, sellerId, 'inventory'));
    const cursor = linhaCursor?.cursor ?? null;
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

      if (!gerenciaEstoque(produto)) {
        // manage_stock desligado: quantidade do EverShop não é autoritativa.
        resultado.ignorados += 1;
        continue;
      }

      if (!canPublish(marketplace, sku)) {
        resultado.ignorados += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.estoque.bloqueado',
          `${sellerId}:${sku}:estoque`,
          {
            sellerId,
            sku,
            motivo: 'SKU fora da allowlist de publicação; estoque não foi alterado no marketplace.'
          }
        );
        continue;
      }

      const local = await semFalha(() => getListing(marketplace, sellerId, sku));
      const externalItemId = idExternoDoRegistro(local);
      if (!externalItemId) {
        resultado.ignorados += 1;
        continue;
      }

      const quantidade = quantidadeSegura(produto);
      if (quantidadeDoRegistro(local) === quantidade) {
        resultado.ignorados += 1;
        continue;
      }

      try {
        assertPublishablePrice(produto);
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.estoque.preco.indisponivel',
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
          'sincronizacao.estoque.preco.invalido',
          `${sellerId}:${sku}:preco`,
          { sellerId, sku, motivo: mensagemSegura(erro) }
        );
        continue;
      }

      const contexto = contextoAdapter({
        marketplace,
        conta,
        accessToken,
        sku,
        externalItemId,
        quantidade,
        precoCents,
        cursor
      });

      try {
        await enqueue({
          marketplace,
          operation: 'listing.stock',
          sku,
          externalId: sellerId,
          payload: {
            sellerId,
            sku,
            externalItemId,
            quantity: quantidade,
            priceCents
          }
        });

        const modelId = await modeloShopee(
          marketplace,
          conta,
          accessToken,
          sku,
          externalItemId
        );
        if (marketplace === 'shopee' && !modelId) {
          // Sem model_id não há escrita segura de estoque na Shopee.
          resultado.ignorados += 1;
          continue;
        }

        await chamarAdaptador(inventory.updateStock, {
          objeto: contexto,
          posicional: posicoesEstoque({
            marketplace,
            accessToken,
            conta,
            sku,
            externalItemId,
            quantidade,
            produto,
            modelId
          })
        });

        await upsertListing({
          marketplace,
          sellerId,
          sku,
          productId: produto.productId ?? local?.productId ?? null,
          externalItemId,
          status: local?.status ?? null,
          priceCents: Number(local?.priceCents ?? local?.price_cents) || precoCents,
          quantity: quantidade,
          payloadHash: local?.payloadHash ?? local?.payload_hash ?? null,
          lastError: null
        });

        resultado.processados += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.estoque.atualizado',
          `${sellerId}:${sku}:estoque`,
          { sellerId, sku, quantidade }
        );
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'sincronizacao.estoque.erro',
          `${sellerId}:${sku}:erro`,
          { sellerId, sku, motivo: mensagemSegura(erro) }
        );
      }
    }

    await semFalha(() =>
      setSyncCursor(marketplace, sellerId, 'inventory', new Date().toISOString())
    );
  }

  resultado.executado = true;
  return resultado;
}
