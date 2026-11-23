/**
 * Criptografia e comparação segura para segredos e assinaturas de webhook.
 *
 * Formato do payload: "v1:<iv>:<tag>:<cipher>", todos os campos em base64
 * padrão (iv de 12 bytes, tag GCM de 16 bytes e ciphertext AES-256-GCM).
 * A chave vem exclusivamente de MARKETPLACE_TOKEN_ENCRYPTION_KEY (base64 de
 * 32 bytes), lida do ambiente a cada chamada — sem cache, para permitir
 * rotação sem recarregar o processo.
 *
 * Nenhuma função registra ou devolve o valor recebido em mensagens de erro.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

import { ConfigError, MarketplaceError, SecretsMissingError } from './errors.js';

const ALGORITMO = 'aes-256-gcm';
const VERSAO = 'v1';
const TAMANHO_CHAVE_BYTES = 32;
const TAMANHO_IV_BYTES = 12;
const TAMANHO_TAG_BYTES = 16;
const NOME_VARIAVEL_CHAVE = 'MARKETPLACE_TOKEN_ENCRYPTION_KEY';

// Base64 padrão e canônico: o teste de ida e volta abaixo rejeita variações
// não canônicas que Buffer.from(..., 'base64') aceitaria silenciosamente.
const BASE64_CANONICO = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CHAVE_BASE64_SEM_PADDING = /^[A-Za-z0-9+/]{43}$/;

const MSG_CHAVE_AUSENTE =
  `A chave de criptografia de tokens não foi configurada. ` +
  `Defina ${NOME_VARIAVEL_CHAVE} no ambiente da instalação.`;
const MSG_CHAVE_INVALIDA =
  `A chave de criptografia de tokens é inválida. ` +
  `${NOME_VARIAVEL_CHAVE} deve conter base64 padrão de 32 bytes.`;
const MSG_PAYLOAD_MALFORMADO = 'O payload criptografado está malformado.';
const MSG_FALHA_AUTENTICACAO =
  'Não foi possível descriptografar o valor; a verificação de autenticidade falhou.';

function carregarChave() {
  const bruta = process.env[NOME_VARIAVEL_CHAVE];

  if (typeof bruta !== 'string' || bruta.trim() === '') {
    throw new SecretsMissingError(MSG_CHAVE_AUSENTE, {
      code: 'TOKEN_ENCRYPTION_KEY_MISSING'
    });
  }

  const valor = bruta.trim();
  const semPadding = valor.replace(/=+$/, '');

  // 32 bytes = 43 caracteres sem padding. Aceitamos no máximo o '=' canônico.
  if (
    !CHAVE_BASE64_SEM_PADDING.test(semPadding) ||
    (valor !== semPadding && valor !== `${semPadding}=`)
  ) {
    throw new ConfigError(MSG_CHAVE_INVALIDA, {
      code: 'TOKEN_ENCRYPTION_KEY_INVALID'
    });
  }

  const chave = Buffer.from(valor, 'base64');

  if (
    chave.length !== TAMANHO_CHAVE_BYTES ||
    chave.toString('base64').replace(/=+$/, '') !== semPadding
  ) {
    chave.fill(0);
    throw new ConfigError(MSG_CHAVE_INVALIDA, {
      code: 'TOKEN_ENCRYPTION_KEY_INVALID'
    });
  }

  return chave;
}

function exigirTexto(valor, mensagem, code) {
  if (typeof valor !== 'string') {
    throw new MarketplaceError(mensagem, { code });
  }
}

function decodificarBase64(valor, mensagem, code) {
  if (typeof valor !== 'string' || !BASE64_CANONICO.test(valor)) {
    throw new MarketplaceError(mensagem, { code });
  }

  const bytes = Buffer.from(valor, 'base64');
  if (bytes.toString('base64') !== valor) {
    throw new MarketplaceError(mensagem, { code });
  }
  return bytes;
}

function paraBytes(valor, nomeParametro) {
  if (typeof valor === 'string') {
    return Buffer.from(valor, 'utf8');
  }
  if (Buffer.isBuffer(valor)) {
    return valor;
  }
  if (valor instanceof Uint8Array) {
    return Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength);
  }
  throw new MarketplaceError(`O parâmetro ${nomeParametro} deve ser texto ou Buffer.`, {
    code: 'INVALID_CRYPTO_INPUT'
  });
}

/** Cifra um segredo em AES-256-GCM; retorna "v1:<iv>:<tag>:<cipher>" em base64. */
export function encryptSecret(plaintext) {
  exigirTexto(
    plaintext,
    'O valor a criptografar deve ser um texto.',
    'INVALID_PLAINTEXT'
  );

  const chave = carregarChave();
  try {
    const iv = randomBytes(TAMANHO_IV_BYTES);
    const cipher = createCipheriv(ALGORITMO, chave, iv);
    const cifrado = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSAO,
      iv.toString('base64'),
      tag.toString('base64'),
      cifrado.toString('base64')
    ].join(':');
  } finally {
    chave.fill(0);
  }
}

/** Descifra e autentica um payload "v1:<iv>:<tag>:<cipher>"; retorna o texto. */
export function decryptSecret(payload) {
  exigirTexto(payload, MSG_PAYLOAD_MALFORMADO, 'INVALID_ENCRYPTED_PAYLOAD');

  const partes = payload.split(':');
  if (partes.length !== 4) {
    throw new MarketplaceError(MSG_PAYLOAD_MALFORMADO, {
      code: 'INVALID_ENCRYPTED_PAYLOAD'
    });
  }

  const [versao, ivBase64, tagBase64, cifradoBase64] = partes;
  if (versao !== VERSAO) {
    throw new MarketplaceError('A versão do payload criptografado não é suportada.', {
      code: 'UNSUPPORTED_ENCRYPTION_VERSION'
    });
  }

  const iv = decodificarBase64(
    ivBase64,
    MSG_PAYLOAD_MALFORMADO,
    'INVALID_ENCRYPTED_PAYLOAD'
  );
  const tag = decodificarBase64(
    tagBase64,
    MSG_PAYLOAD_MALFORMADO,
    'INVALID_ENCRYPTED_PAYLOAD'
  );
  const cifrado = decodificarBase64(
    cifradoBase64,
    MSG_PAYLOAD_MALFORMADO,
    'INVALID_ENCRYPTED_PAYLOAD'
  );

  if (iv.length !== TAMANHO_IV_BYTES || tag.length !== TAMANHO_TAG_BYTES) {
    throw new MarketplaceError(MSG_PAYLOAD_MALFORMADO, {
      code: 'INVALID_ENCRYPTED_PAYLOAD'
    });
  }

  const chave = carregarChave();
  try {
    const decipher = createDecipheriv(ALGORITMO, chave, iv);
    decipher.setAuthTag(tag);
    const claro = Buffer.concat([decipher.update(cifrado), decipher.final()]);
    return claro.toString('utf8');
  } catch {
    // Não repassamos a exceção original: ela pode carregar detalhes do payload.
    throw new MarketplaceError(MSG_FALHA_AUTENTICACAO, {
      code: 'DECRYPTION_FAILED'
    });
  } finally {
    chave.fill(0);
  }
}

/**
 * Variante de normalização usada apenas na comparação de assinaturas.
 * Retorna null para qualquer tipo inesperado, sem lançar nem registrar valores.
 */
function paraBytesOuNulo(valor) {
  if (typeof valor === 'string') {
    return Buffer.from(valor, 'utf8');
  }
  if (Buffer.isBuffer(valor)) {
    return valor;
  }
  if (valor instanceof Uint8Array) {
    return Buffer.from(valor.buffer, valor.byteOffset, valor.byteLength);
  }
  return null;
}

/** HMAC-SHA256 de `data` com `key`; aceita texto ou Buffer; retorna hex minúsculo. */
export function hmacSha256Hex(key, data) {
  const chave = paraBytes(key, 'key');
  const conteudo = paraBytes(data, 'data');
  return createHmac('sha256', chave).update(conteudo).digest('hex').toLowerCase();
}

/**
 * Comparação em tempo constante que SEMPRE retorna booleano.
 * Normalizamos as entradas para bytes e comparamos digests SHA-256 de tamanho
 * fixo com timingSafeEqual, evitando revelar o tamanho das assinaturas.
 * Entradas inválidas (null, undefined, números, objetos etc.) retornam false,
 * sem lançar e sem expor valores em mensagens ou logs.
 */
export function safeEqual(a, b) {
  try {
    const esquerda = paraBytesOuNulo(a);
    const direita = paraBytesOuNulo(b);

    if (esquerda === null || direita === null) {
      return false;
    }

    const hashEsquerda = createHash('sha256').update(esquerda).digest();
    const hashDireita = createHash('sha256').update(direita).digest();
    return timingSafeEqual(hashEsquerda, hashDireita);
  } catch {
    // Falha fechada: nenhuma entrada inesperada vira exceção nesta função.
    return false;
  }
}
