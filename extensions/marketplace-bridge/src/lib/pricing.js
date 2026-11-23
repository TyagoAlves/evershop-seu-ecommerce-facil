/**
 * Preço publicável: conversão para centavos e validação da única fonte
 * autorizada (`product.price`). Nenhuma inferência a partir de outros campos.
 *
 * A conversão usa a representação decimal do número em vez de `value * 100`,
 * porque a multiplicação direta sofre erro de ponto flutuante (por exemplo,
 * 1.005 * 100 = 100.49999999999999 e seria arredondado para 1,00 em vez de
 * 1,01). O cálculo abaixo desloca a vírgula sobre os dígitos e arredonda com
 * BigInt, com meia unidade para cima (regra comercial usual em BRL).
 */

import { PriceNotAvailableError } from './errors.js';

const NUMERO_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

function exigirNumeroFinito(valor, mensagem) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new PriceNotAvailableError(mensagem);
  }
}

/**
 * Converte um valor em reais para centavos inteiros.
 * @param {number} value valor em reais
 * @returns {number} quantidade inteira de centavos
 * @throws {PriceNotAvailableError} quando o valor não é number finito ou
 *   quando o resultado não cabe em um inteiro seguro.
 */
export function toCents(value) {
  exigirNumeroFinito(
    value,
    'Preço inválido: informe um número finito para converter em centavos.'
  );

  const partes = NUMERO_DECIMAL.exec(String(value));
  if (!partes) {
    throw new PriceNotAvailableError(
      'Preço inválido: representação decimal não reconhecida.'
    );
  }

  const [, sinal, parteInteira, parteDecimal = '', expoenteTexto = '0'] = partes;
  const digitos = `${parteInteira}${parteDecimal}`.replace(/^0+(?=\d)/, '');
  // +2 desloca a vírgula dois lugares; a parte decimal já foi incorporada aos
  // dígitos, por isso ela é subtraída do expoente.
  const expoente = Number(expoenteTexto) - parteDecimal.length + 2;

  let centavos;
  if (expoente >= 0) {
    centavos = BigInt(`${digitos}${'0'.repeat(expoente)}`);
  } else {
    const casas = -expoente;
    const inteiro = digitos.slice(0, digitos.length - casas);
    const proximoDigito = digitos[digitos.length - casas] ?? '0';
    const deveArredondar = proximoDigito >= '5';
    centavos =
      BigInt(inteiro || '0') + (deveArredondar ? 1n : 0n);
  }

  if (sinal === '-') {
    centavos = -centavos;
  }

  const resultado = Number(centavos);
  if (!Number.isSafeInteger(resultado)) {
    throw new PriceNotAvailableError(
      'Preço fora da faixa segura de conversão para centavos.'
    );
  }

  return resultado;
}

/**
 * Converte centavos inteiros de volta para reais.
 * @param {number} cents quantidade inteira de centavos
 * @returns {number} valor em reais
 * @throws {PriceNotAvailableError} quando `cents` não é um inteiro seguro.
 */
export function fromCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new PriceNotAvailableError(
      'Centavos inválidos: informe um número inteiro seguro.'
    );
  }

  return cents / 100;
}

/**
 * Valida o preço publicável de um produto. Fail closed: qualquer valor ausente
 * ou inválido bloqueia a operação antes de montar payloads ou chamar APIs.
 * @param {{ price?: unknown } | null | undefined} product produto do catálogo
 * @returns {number} o próprio `product.price`, validado
 * @throws {PriceNotAvailableError} quando `price` não é number finito > 0
 */
export function assertPublishablePrice(product) {
  const preco = product === null || product === undefined ? undefined : product.price;

  if (typeof preco !== 'number' || Number.isNaN(preco)) {
    throw new PriceNotAvailableError(
      'Preço indisponível: product.price deve ser um número válido.'
    );
  }

  if (!Number.isFinite(preco)) {
    throw new PriceNotAvailableError(
      'Preço indisponível: product.price deve ser finito.'
    );
  }

  if (preco <= 0) {
    throw new PriceNotAvailableError(
      'Preço indisponível: product.price deve ser maior que zero.'
    );
  }

  return preco;
}
