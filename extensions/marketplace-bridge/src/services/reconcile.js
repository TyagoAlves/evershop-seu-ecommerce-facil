/**
 * Reconciliação — Fase 3 (Mercado Livre e Shopee BR).
 *
 * Compara o registro local do anúncio com o estado remoto e registra apenas
 * divergências como evento. NÃO cria, atualiza, pausa nem apaga anúncio,
 * pedido ou estoque; nenhuma escrita é enfileirada. Preços ausentes ou
 * inválidos nunca são inventados — apenas sinalizados.
 */

import { isEnabled, readMarketplaceConfig } from '../lib/config.js';
import {
  getActiveToken,
  getListing,
  getSyncCursor,
  listConnectedAccounts,
  markTokenUsed,
  saveToken,
  setSyncCursor
} from '../lib/db.js';
import { getProductsForMarketplace } from '../lib/catalog.js';
import { toCents } from '../lib/pricing.js';
import { normalizeSku } from '../lib/normalize.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { markEventAsProcessed, recordEvent } from '../lib/events.js';

const MARKETPLACES = new Set(['mercadolivre', 'shopee']);
const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;
const MARGEM_EXPIRACAO_MS = 30_000;

const CAMINHOS = Object.freeze({
  mercadolivre: Object.freeze({
    listings: '../lib/adapters/mercadolivre/listings.js',
    oauth: '../lib/adapters/mercadolivre/oauth.js'
  }),
  shopee: Object.freeze({
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

function semFalhaSincrona(fn) {
  try {
    const valor = fn();
    return typeof valor === 'string' && valor.trim() ? valor : null;
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

/** Adaptadores ML e Shopee aceitam contextos posicionais/objeto diferentes. */
function chamarAdaptador(fn, { objeto, posicional }) {
  if (typeof fn !== 'function') {
    throw new Error('Função do adaptador indisponível.');
  }
  return fn.length >= 2 ? fn(...posicional) : fn(objeto);
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

/** Refresh de uso único: mesmo protocolo dos demais serviços. */
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

function contextoAdapter({ marketplace, conta, accessToken, sku, externalItemId }) {
  return {
    marketplace,
    accessToken,
    token: accessToken,
    sellerId: sellerIdDaConta(conta),
    seller_id: sellerIdDaConta(conta),
    shopId: shopIdDaConta(conta),
    shop_id: shopIdDaConta(conta),
    sku,
    externalItemId,
    external_item_id: externalItemId,
    itemId: externalItemId,
    item_id: externalItemId,
    siteId: marketplace === 'mercadolivre' ? 'MLB' : 'BR'
  };
}

function idExternoLocal(local) {
  const valor = primeiroCampo(local, ['externalItemId', 'external_item_id', 'itemId', 'item_id']);
  return valor === undefined || valor === null ? null : String(valor);
}

function precoSeguroCents(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }
  const bruto = Number(valor);
  if (!Number.isFinite(bruto) || bruto <= 0) {
    return null;
  }
  try {
    const cents = toCents(bruto);
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

function quantidadeSegura(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

function estadoRemoto(marketplace, encontrado) {
  if (!encontrado || typeof encontrado !== 'object') {
    return null;
  }
  const caminhoModelo = marketplace === 'shopee' ? (encontrado.model ?? {}) : encontrado;
  return {
    externalItemId: idExternoLocal(encontrado),
    status:
      textoSeguro(
        primeiroCampo(encontrado, ['status', 'item_status', 'orderStatus']) ??
          primeiroCampo(caminhoModelo, ['item_status', 'status'])
      ) || null,
    priceCents: precoSeguroCents(
      primeiroCampo(caminhoModelo, ['price', 'current_price', 'priceCents', 'price_cents'])
    ),
    quantity: quantidadeSegura(
      primeiroCampo(caminhoModelo, [
        'available_quantity',
        'availableQuantity',
        'normal_stock',
        'quantity',
        'qty'
      ])
    )
  };
}

function divergencias(local, remoto) {
  const encontradas = [];
  if (local.externalItemId !== remoto.externalItemId) {
    encontradas.push('identificador_externo');
  }
  if (local.status && remoto.status && local.status !== remoto.status) {
    encontradas.push('status');
  }
  if (
    local.priceCents !== null &&
    remoto.priceCents !== null &&
    local.priceCents !== remoto.priceCents
  ) {
    encontradas.push('preco');
  }
  if (local.quantity !== null && remoto.quantity !== null && local.quantity !== remoto.quantity) {
    encontradas.push('quantidade');
  }
  return encontradas;
}

function contadorInicial(marketplace) {
  return {
    marketplace,
    executado: false,
    motivo: null,
    contas: 0,
    verificados: 0,
    divergencias: 0,
    erros: 0
  };
}

/** Único ponto de entrada do cron de reconciliação. */
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
      continue;
    }
    resultado.contas += 1;

    const accessToken = await obterAccessToken(marketplace, conta);
    if (!accessToken) {
      resultado.erros += 1;
      await registrarEvento(
        marketplace,
        'reconciliacao.token.indisponivel',
        `${sellerId}:reconciliacao`,
        { sellerId, motivo: 'Token indisponível; nenhuma consulta remota foi feita.' }
      );
      continue;
    }

    const listings = await carregarAdaptador(marketplace, 'listings');
    if (typeof listings?.findListingBySku !== 'function') {
      resultado.erros += 1;
      await registrarEvento(
        marketplace,
        'reconciliacao.adapter.indisponivel',
        `${sellerId}:reconciliacao`,
        { sellerId, motivo: 'Adaptador de leitura indisponível.' }
      );
      continue;
    }

    // getSyncCursor devolve a linha; o valor está em `.cursor`.
    const linhaCursor = await semFalha(() => getSyncCursor(marketplace, sellerId, 'listings'));
    const cursor = linhaCursor?.cursor ?? null;
    const restante = maximo - resultado.verificados;
    if (restante <= 0) {
      break;
    }

    const produtos = comoArray(
      await semFalha(() => getProductsForMarketplace({ limit: restante, offset: 0 }))
    );

    for (const produto of produtos) {
      if (resultado.verificados >= maximo) {
        break;
      }
      const sku = textoSeguro(normalizeSku(produto?.sku)).toUpperCase();
      if (!sku) {
        continue;
      }

      const local = await semFalha(() => getListing(marketplace, sellerId, sku));
      if (!local) {
        // Sem registro local não há linha de base para divergência; não criar.
        continue;
      }

      const contexto = contextoAdapter({
        marketplace,
        conta,
        accessToken,
        sku,
        externalItemId: idExternoLocal(local)
      });

      try {
        const encontrado = await chamarAdaptador(listings.findListingBySku, {
          objeto: contexto,
          posicional:
            marketplace === 'shopee'
              ? [contexto, sku, {}, {}]
              : [accessToken, { ...contexto, sku, sellerId }]
        });
        resultado.verificados += 1;
        const remoto = estadoRemoto(marketplace, encontrado);

        if (!remoto) {
          resultado.divergencias += 1;
          await registrarEvento(
            marketplace,
            'reconciliacao.divergencia',
            `${sellerId}:${sku}:ausente_remoto`,
            {
              sellerId,
              sku,
              tipos: ['ausente_remoto'],
              local: {
                externalItemId: idExternoLocal(local),
                status: textoSeguro(local.status) || null,
                priceCents: Number(local.priceCents ?? local.price_cents) || null,
                quantity: quantidadeSegura(local.quantity)
              },
              remoto: null,
              acao: 'NENHUMA_SOMENTE_REGISTRO'
            }
          );
          continue;
        }

        const localNormalizado = {
          externalItemId: idExternoLocal(local),
          status: textoSeguro(local.status) || null,
          priceCents:
            Number.isFinite(Number(local.priceCents ?? local.price_cents)) &&
            Number(local.priceCents ?? local.price_cents) > 0
              ? Number(local.priceCents ?? local.price_cents)
              : null,
          quantity: quantidadeSegura(local.quantity)
        };
        const tipos = divergencias(localNormalizado, remoto);

        if (tipos.length > 0) {
          resultado.divergencias += 1;
          await registrarEvento(
            marketplace,
            'reconciliacao.divergencia',
            `${sellerId}:${sku}:${tipos.join('-')}`,
            {
              sellerId,
              sku,
              tipos,
              cursor,
              local: localNormalizado,
              remoto,
              acao: 'NENHUMA_SOMENTE_REGISTRO'
            }
          );
        }
      } catch (erro) {
        resultado.erros += 1;
        await registrarEvento(
          marketplace,
          'reconciliacao.erro',
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
