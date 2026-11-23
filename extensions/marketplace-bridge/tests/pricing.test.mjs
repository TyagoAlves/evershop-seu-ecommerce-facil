import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertPublishablePrice, fromCents, toCents } from '../src/lib/pricing.js';
import { PriceNotAvailableError } from '../src/lib/errors.js';

// Valores sintéticos usados apenas como fixture de teste; não entram no
// catálogo, em payloads nem em configuração de publicação.

describe('assertPublishablePrice', () => {
  it('aceita número decimal positivo e devolve exatamente product.price', () => {
    const produto = { price: 10.1, salePrice: 99, compareAtPrice: 999 };
    assert.equal(assertPublishablePrice(produto), 10.1);
  });

  it('rejeita preço zero', () => {
    assert.throws(
      () => assertPublishablePrice({ price: 0 }),
      PriceNotAvailableError
    );
  });

  it('rejeita preço negativo', () => {
    assert.throws(
      () => assertPublishablePrice({ price: -1 }),
      PriceNotAvailableError
    );
  });

  it('rejeita preço nulo', () => {
    assert.throws(
      () => assertPublishablePrice({ price: null }),
      PriceNotAvailableError
    );
  });

  it('rejeita preço undefined, inclusive quando o campo não existe', () => {
    assert.throws(
      () => assertPublishablePrice({ price: undefined }),
      PriceNotAvailableError
    );
    assert.throws(() => assertPublishablePrice({}), PriceNotAvailableError);
    assert.throws(() => assertPublishablePrice(undefined), PriceNotAvailableError);
    assert.throws(() => assertPublishablePrice(null), PriceNotAvailableError);
  });

  it('rejeita NaN e valores não finitos', () => {
    assert.throws(
      () => assertPublishablePrice({ price: Number.NaN }),
      PriceNotAvailableError
    );
    assert.throws(
      () => assertPublishablePrice({ price: Number.POSITIVE_INFINITY }),
      PriceNotAvailableError
    );
    assert.throws(
      () => assertPublishablePrice({ price: Number.NEGATIVE_INFINITY }),
      PriceNotAvailableError
    );
  });

  it('rejeita string numérica (não é number)', () => {
    assert.throws(
      () => assertPublishablePrice({ price: '10.10' }),
      PriceNotAvailableError
    );
    assert.throws(
      () => assertPublishablePrice({ price: '0' }),
      PriceNotAvailableError
    );
  });

  it('nunca infere preço de outros campos', () => {
    assert.throws(
      () =>
        assertPublishablePrice({
          sku: 'LE-0001',
          salePrice: 10,
          specialPrice: 10,
          price: null
        }),
      PriceNotAvailableError
    );
  });
});

describe('toCents', () => {
  it('converte decimais sem erro de ponto flutuante', () => {
    assert.equal(toCents(10.1), 1010);
    assert.equal(toCents(1.005), 101);
    assert.equal(toCents(2.675), 268);
    assert.equal(toCents(0.1 + 0.2), 30);
  });

  it('arredonda meia unidade para cima', () => {
    assert.equal(toCents(0.005), 1);
    assert.equal(toCents(9.995), 1000);
  });

  it('lida com zero, negativos e notação exponencial', () => {
    assert.equal(toCents(0), 0);
    assert.equal(toCents(-1.005), -101);
    assert.equal(toCents(1e-7), 0);
  });

  it('rejeita entradas que não sejam number finito', () => {
    for (const valor of [null, undefined, Number.NaN, '10.10', '', {}, [], Infinity]) {
      assert.throws(() => toCents(valor), PriceNotAvailableError);
    }
  });

  it('falha fechado quando o resultado não é um inteiro seguro', () => {
    assert.throws(() => toCents(1e21), PriceNotAvailableError);
  });
});

describe('fromCents', () => {
  it('converte centavos inteiros para reais', () => {
    assert.equal(fromCents(1010), 10.1);
    assert.equal(fromCents(50), 0.5);
    assert.equal(fromCents(0), 0);
    assert.equal(fromCents(-1010), -10.1);
  });

  it('rejeita valores que não sejam inteiros seguros', () => {
    for (const valor of [1.5, Number.NaN, '1010', null, undefined, Infinity]) {
      assert.throws(() => fromCents(valor), PriceNotAvailableError);
    }
  });

  it('faz ida e volta com decimais problemáticos', () => {
    assert.equal(fromCents(toCents(1.005)), 1.01);
    assert.equal(fromCents(toCents(10.1)), 10.1);
  });
});
