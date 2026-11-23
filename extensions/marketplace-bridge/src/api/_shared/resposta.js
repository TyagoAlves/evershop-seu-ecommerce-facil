/** Respostas HTTP das rotas públicas da integração, sem vazar detalhes sensíveis. */

const CABECALHOS_SEGuros = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
});

function textoCodigo(erro, padrao) {
  const bruto = erro && typeof erro === 'object' ? erro.code : null;
  if (typeof bruto !== 'string') return padrao;
  const limpo = bruto.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
  return limpo || padrao;
}

/** Código curto e determinístico, seguro para devolver ao chamador ou registrar. */
export function codigoSeguro(erro, padrao = 'FALHA_INTERNA') {
  return textoCodigo(erro, padrao);
}

/** Traduz classes de domínio em status HTTP sem repetir mensagens da API remota. */
export function statusParaErro(erro) {
  const nome = erro && typeof erro === 'object' ? erro.name : '';
  const codigo = textoCodigo(erro, '');

  if (nome === 'WebhookVerificationError' || codigo.startsWith('WEBHOOK_')) return 401;
  if (nome === 'SecretsMissingError' || codigo.startsWith('SEGREDO')) return 503;
  if (nome === 'IdempotencyConflictError' || codigo.includes('IDEMPOTENCIA')) return 409;
  if (nome === 'MarketplaceHttpError') return 502;
  if (
    codigo.includes('INVALID') ||
    codigo.includes('INVALIDO') ||
    codigo.includes('AUSENTE') ||
    codigo.includes('REQUIRED') ||
    codigo.includes('PARAMETROS')
  ) {
    return 400;
  }
  return 500;
}

/** Envia JSON encerrando a cadeia: as rotas usam assinatura de três argumentos. */
export function responderJson(response, status, corpo) {
  if (!response || response.headersSent) return;
  for (const [nome, valor] of Object.entries(CABECALHOS_SEGuros)) {
    response.setHeader(nome, valor);
  }
  response.status(status).json(corpo);
}

/** Erro genérico: nunca devolve `erro.message`, payload bruto, token ou assinatura. */
export function responderErro(response, erro, mensagemPadrao = 'Não foi possível concluir a operação.') {
  const status = statusParaErro(erro);
  responderJson(response, status, {
    erro: {
      status,
      message: mensagemPadrao,
      code: codigoSeguro(erro)
    }
  });
}
