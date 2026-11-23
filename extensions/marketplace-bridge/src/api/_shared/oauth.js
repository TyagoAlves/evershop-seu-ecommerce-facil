/** Apoio compartilhado às rotas OAuth: state de uso único e tokens cifrados. */

import { randomBytes } from 'node:crypto';

import { isEnabled } from '../../lib/config.js';
import { requireSecrets } from '../../lib/secrets.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { MarketplaceError } from '../../lib/errors.js';
import {
  consumeOAuthState,
  getActiveToken,
  saveOAuthState,
  saveToken,
  upsertAccount
} from '../../lib/db.js';

function valorPresente(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function erroSeguro(mensagem, code, marketplace) {
  return new MarketplaceError(mensagem, { code, marketplace });
}

/** Texto curto da query, sem aceitar valores longos ou objetos. */
export function textoDaQuery(valor, limite = 255) {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo.slice(0, limite);
}

/** Identificador numérico do administrador autenticado, quando disponível. */
export function idDoUsuarioAdmin(request) {
  const usuario = request?.locals?.user ?? request?.getCurrentUser?.() ?? null;
  const bruto = usuario?.admin_user_id ?? usuario?.adminUserId ?? null;
  const numero = Number(bruto);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function marketplacesValidos(marketplace) {
  return marketplace === 'mercadolivre' || marketplace === 'shopee';
}

function exigirConfigAtiva(marketplace) {
  if (!marketplacesValidos(marketplace) || !isEnabled(marketplace)) {
    throw erroSeguro(
      'Marketplace inválido ou desativado; a autorização não foi iniciada.',
      'MARKETPLACE_DESATIVADO',
      marketplace
    );
  }
}

/** Gera state imprevisível, grava-o antes do redirect e devolve a URL do provedor. */
export async function iniciarAutorizacao({ marketplace, request, adapter }) {
  exigirConfigAtiva(marketplace);
  requireSecrets(marketplace);

  const state = randomBytes(32).toString('base64url');
  await saveOAuthState({
    state,
    marketplace,
    adminUserId: idDoUsuarioAdmin(request)
  });

  if (typeof adapter?.getAuthorizationUrl !== 'function') {
    throw erroSeguro('Adaptador OAuth indisponível.', 'OAUTH_ADAPTER_AUSENTE', marketplace);
  }
  return adapter.getAuthorizationUrl(state);
}

/** Consome o state de forma atômica e valida os parâmetros mínimos do callback. */
export async function validarCallback({ marketplace, request }) {
  exigirConfigAtiva(marketplace);
  requireSecrets(marketplace);

  const state = textoDaQuery(request?.query?.state, 255);
  const code = textoDaQuery(request?.query?.code, 2048);
  if (!state || !code) {
    throw erroSeguro(
      'Parâmetros de autorização ausentes ou inválidos.',
      'OAUTH_PARAMETROS_INVALIDOS',
      marketplace
    );
  }

  const registro = await consumeOAuthState(state, marketplace);
  if (!registro) {
    throw erroSeguro(
      'Estado de autorização inválido, expirado ou já utilizado.',
      'OAUTH_STATE_INVALIDO',
      marketplace
    );
  }

  return { state, code, registro };
}

function inteiroPositivo(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function textoPositivo(valor, limite = 128) {
  if (!valorPresente(String(valor ?? ''))) return null;
  return String(valor).trim().slice(0, limite);
}

function dataIsoValida(valor) {
  if (valor == null || valor === '') return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isFinite(data.getTime()) ? data.toISOString() : null;
}

function idDaConta(conta) {
  const bruto = conta?.marketplace_account_id ?? conta?.accountId ?? conta?.id ?? null;
  const numero = Number(bruto);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Grava conta conectada e tokens já cifrados. `generation` é omitido de propósito:
 * a camada de banco incrementa a geração existente ou começa em 1.
 */
export async function salvarContaConectada({
  marketplace,
  sellerId,
  shopId = null,
  siteId = null,
  tokens
} = {}) {
  const vendedor = textoPositivo(sellerId);
  if (!vendedor) {
    throw erroSeguro('Identidade do vendedor ausente na autorização.', 'OAUTH_IDENTIDADE_INVALIDA', marketplace);
  }
  if (!valorPresente(tokens?.accessToken)) {
    throw erroSeguro('Token de acesso ausente na autorização.', 'OAUTH_TOKEN_INVALIDO', marketplace);
  }

  const conta = await upsertAccount({
    marketplace,
    sellerId: vendedor,
    shopId: inteiroPositivo(shopId),
    siteId: textoPositivo(siteId, 32),
    status: 'connected'
  });
  const accountId = idDaConta(conta);
  if (!accountId) {
    throw erroSeguro('Não foi possível salvar a conta conectada.', 'OAUTH_CONTA_NAO_SALVA', marketplace);
  }

  const expiracao = dataIsoValida(tokens.expiresAt);
  await saveToken({
    accountId,
    type: 'access',
    value: encryptSecret(tokens.accessToken),
    expiresAt: expiracao,
    scope: tokens.scope ?? null
  });

  if (valorPresente(tokens.refreshToken)) {
    await saveToken({
      accountId,
      type: 'refresh',
      value: encryptSecret(tokens.refreshToken),
      expiresAt: null,
      scope: null
    });
  }

  return {
    accountId,
    sellerId: vendedor,
    shopId: inteiroPositivo(shopId)
  };
}

/** Token descriptografado apenas no servidor; usado por contextos de webhook/worker. */
export async function obterAccessTokenDescriptografado({ marketplace, conta } = {}) {
  const accountId = idDaConta(conta);
  if (!accountId) return null;

  const token = await getActiveToken({ accountId, type: 'access' });
  const cifrado = token?.encrypted_value ?? token?.value ?? null;
  if (!valorPresente(cifrado)) return null;

  return decryptSecret(cifrado);
}
