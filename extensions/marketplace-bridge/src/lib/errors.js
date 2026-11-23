/**
 * Erros de domínio da integração com marketplaces.
 *
 * Regras aplicadas a todas as classes:
 * - mensagens em pt-BR, sem segredos, tokens ou payload completo de pedido;
 * - `code` é um identificador estável e pode ser sobrescrito por `options.code`;
 * - `marketplace` só é definido quando informado (ex.: "mercadolivre", "shopee");
 * - em `MarketplaceHttpError`, `status` e `requestId` ficam disponíveis para
 *   observabilidade, mas nunca são interpolados na mensagem de erro.
 *
 * Uso: new SecretsMissingError('...', { marketplace: 'mercadolivre' })
 *      new MarketplaceHttpError('...', 429, { requestId: '...' })
 */

const MENSAGENS_PADRAO = Object.freeze({
  MarketplaceError: 'Falha na integração com marketplace.',
  SecretsMissingError: 'Segredos necessários não foram configurados para a integração.',
  PriceNotAvailableError: 'Preço publicável indisponível; a operação foi bloqueada.',
  ConfigError: 'Configuração inválida para a integração com marketplace.',
  MarketplaceHttpError: 'Falha na comunicação com a API do marketplace.',
  WebhookVerificationError: 'Não foi possível validar a assinatura do webhook.',
  IdempotencyConflictError: 'Conflito de idempotência: a operação já foi registrada.'
});

const CODIGOS_PADRAO = Object.freeze({
  MarketplaceError: 'MARKETPLACE_ERROR',
  SecretsMissingError: 'SECRETS_MISSING',
  PriceNotAvailableError: 'PRICE_NOT_AVAILABLE',
  ConfigError: 'CONFIG_ERROR',
  MarketplaceHttpError: 'MARKETPLACE_HTTP_ERROR',
  WebhookVerificationError: 'WEBHOOK_VERIFICATION_ERROR',
  IdempotencyConflictError: 'IDEMPOTENCY_CONFLICT'
});

function ehObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

/** Aceita `new Erro(msg, opcoes)` e `new Erro(msg, opcoes, opcoesAdicionais)`. */
function normalizarOpcoes(primaria, secundaria) {
  if (typeof primaria === 'number') {
    return { ...(ehObjeto(secundaria) ? secundaria : {}), status: primaria };
  }
  return {
    ...(ehObjeto(primaria) ? primaria : {}),
    ...(ehObjeto(secundaria) ? secundaria : {})
  };
}

function mensagemOuPadrao(mensagem, nomeClasse) {
  if (typeof mensagem === 'string' && mensagem.trim() !== '') {
    return mensagem;
  }
  return MENSAGENS_PADRAO[nomeClasse] ?? MENSAGENS_PADRAO.MarketplaceError;
}

export class MarketplaceError extends Error {
  constructor(mensagem, opcoes = {}, opcoesAdicionais = undefined) {
    const opts = normalizarOpcoes(opcoes, opcoesAdicionais);
    const nomeClasse = new.target.name || 'MarketplaceError';

    super(
      mensagemOuPadrao(mensagem, nomeClasse),
      opts.cause === undefined ? undefined : { cause: opts.cause }
    );

    this.name = nomeClasse;
    this.code =
      typeof opts.code === 'string' && opts.code !== ''
        ? opts.code
        : (CODIGOS_PADRAO[nomeClasse] ?? CODIGOS_PADRAO.MarketplaceError);

    if (opts.marketplace !== undefined && opts.marketplace !== null) {
      this.marketplace = opts.marketplace;
    }

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class SecretsMissingError extends MarketplaceError {}

export class PriceNotAvailableError extends MarketplaceError {}

export class ConfigError extends MarketplaceError {}

export class MarketplaceHttpError extends MarketplaceError {
  constructor(mensagem, opcoes = {}, opcoesAdicionais = undefined) {
    const opts = normalizarOpcoes(opcoes, opcoesAdicionais);
    super(mensagem, opts);

    const statusBruto = opts.status;
    const status =
      typeof statusBruto === 'number'
        ? statusBruto
        : typeof statusBruto === 'string' && /^\d{3}$/.test(statusBruto)
          ? Number(statusBruto)
          : null;

    this.status = Number.isInteger(status) ? status : null;
    this.requestId =
      typeof opts.requestId === 'string' && opts.requestId !== ''
        ? opts.requestId
        : null;
  }
}

export class WebhookVerificationError extends MarketplaceError {}

export class IdempotencyConflictError extends MarketplaceError {}
