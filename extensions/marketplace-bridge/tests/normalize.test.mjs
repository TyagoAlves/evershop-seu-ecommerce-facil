import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

/**
 * Testes escritos contra as assinaturas documentadas em
 * docs/ESPECIFICACAO_MARKETPLACES.md, seção 5. O módulo `normalize.js` pertence
 * a outro dono; este arquivo apenas consome a interface pública.
 *
 * A base usada aqui é um domínio reservado (RFC 2606) e existe somente dentro
 * deste processo de teste: não é domínio da Exemplo nem configuração real.
 */
const BASE_URL_TESTE = 'https://loja-teste.example';
const baseUrlAnterior = process.env.EVERSHOP_HOME_URL;
process.env.EVERSHOP_HOME_URL = BASE_URL_TESTE;

after(() => {
  if (baseUrlAnterior === undefined) {
    delete process.env.EVERSHOP_HOME_URL;
  } else {
    process.env.EVERSHOP_HOME_URL = baseUrlAnterior;
  }
});

const { buildStoreUrl, normalizeSku, normalizeText } = await import(
  '../src/lib/normalize.js'
);

describe('normalizeSku', () => {
  it('remove espaços nas bordas e converte para maiúsculas', () => {
    assert.equal(normalizeSku('  le-0001  '), 'LE-0001');
    assert.equal(normalizeSku('le-0001'), 'LE-0001');
  });

  it('descarta caracteres invisíveis ou de controle', () => {
    assert.equal(normalizeSku('\u200Bhc\u0000-0001\u200B'), 'LE-0001');
  });
});

describe('normalizeText', () => {
  it('apara bordas e colapsa espaços repetidos', () => {
    assert.equal(normalizeText('  Tubo   PVC  '), 'Tubo PVC');
  });

  it('respeita o tamanho máximo informado', () => {
    const texto = 'Tubo PVC 100 mm';
    const resultado = normalizeText(texto, 8);

    assert.equal(typeof resultado, 'string');
    assert.ok(resultado.length <= 8, `Esperado no máximo 8 caracteres; recebido: ${resultado}`);
    assert.equal(resultado.slice(0, 4), 'Tubo');
  });

  it('funciona sem maxLength para texto simples', () => {
    assert.equal(normalizeText('  Tubo PVC  '), 'Tubo PVC');
  });
});

describe('buildStoreUrl', () => {
  it('usa EVERSHOP_HOME_URL como base absoluta e mantém a chave', () => {
    const url = buildStoreUrl('tubo-pvc-100mm');

    assert.equal(typeof url, 'string');
    const parsed = new URL(url);
    assert.equal(parsed.origin, new URL(BASE_URL_TESTE).origin);
    assert.ok(parsed.pathname.includes('tubo-pvc-100mm'));
    assert.ok(!url.includes('localhost'));
  });
});
