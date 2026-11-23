/**
 * Acesso somente de leitura ao catálogo EverShop 2.4 para os marketplaces.
 *
 * Contrato: docs/ESPECIFICACAO_MARKETPLACES.md, seção 5.
 *
 * Schema conferido em 2026-11-23 em
 * node_modules/@evershop/evershop/src/modules/catalog/migration/:
 * - `product` mantém `product_id`, `sku`, `price`, `weight`, `status` e
 *   `visibility`; `qty`, `manage_stock` e `stock_availability` foram movidos
 *   para `product_inventory` nas versões 1.0.2/1.0.3;
 * - `product_image.image` virou `origin_image` na versão 1.0.6;
 * - `url_key` fica em `product_description`.
 *
 * `product.price` é a ÚNICA fonte de preço. O valor decimal do PostgreSQL é
 * convertido para number sem arredondamento ou inferência; preço nulo/zero
 * segue para `assertPublishablePrice()`, que bloqueia a publicação.
 *
 * DIVERGÊNCIA DO CONTRATO (registrada em 2026-11-23): o texto do contrato pede
 * `getConnection()` de `@evershop/evershop/lib/postgres/connection.js`, mas o
 * `package.json` do @evershop/evershop@2.4.0 não exporta essa subpath
 * (ERR_PACKAGE_PATH_NOT_EXPORTED). A exportação oficial é
 * `@evershop/evershop/lib/postgres`, que aponta exatamente para
 * `dist/lib/postgres/connection.js` e exporta `getConnection`.
 */

import { getConnection } from '@evershop/evershop/lib/postgres';
import { buildStoreUrl, normalizeSku } from './normalize.js';

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 1000;

const COLUNAS_PRODUTO = `
  p.product_id AS "productId",
  p.sku AS "sku",
  pd.name AS "name",
  COALESCE(pd.description, '') AS "description",
  COALESCE(pd.short_description, '') AS "shortDescription",
  p.price AS "price",
  -- Ausência de inventário é tratada como sem estoque, nunca como quantidade
  -- positiva inventada.
  COALESCE(pi.qty, 0) AS "qty",
  COALESCE(pi.manage_stock, FALSE) AS "manageStock",
  COALESCE(pi.stock_availability, FALSE) AS "stockAvailability",
  pd.url_key AS "urlKey",
  p.weight AS "weight",
  (
    SELECT pim.origin_image
    FROM product_image pim
    WHERE pim.product_image_product_id = p.product_id
    ORDER BY pim.is_main DESC NULLS LAST, pim.product_image_id ASC
    LIMIT 1
  ) AS "imagemPrincipal"
`;

const FROM_PRODUTO = `
  FROM product p
  JOIN product_description pd
    ON pd.product_description_product_id = p.product_id
  LEFT JOIN product_inventory pi
    ON pi.product_inventory_product_id = p.product_id
`;

const FILTRO_PUBLICAVEL = 'p.status = TRUE AND p.visibility = TRUE';

function inteiroOuNull(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor)) {
    return valor;
  }
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) {
    const numero = Number(valor.trim());
    if (Number.isSafeInteger(numero)) {
      return numero;
    }
  }
  return null;
}

function numeroOuNull(valor) {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : null;
  }
  if (typeof valor === 'string' && valor.trim() !== '') {
    const numero = Number(valor.trim());
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

function urlAbsoluta(caminho) {
  if (typeof caminho !== 'string' || caminho.trim() === '') {
    return null;
  }
  const valor = caminho.trim();
  // Imagens já absolutas (CDN, por exemplo) não recebem a base da loja.
  return /^https?:\/\//i.test(valor) ? valor : buildStoreUrl(valor);
}

function limites(limit, offset) {
  const limite = inteiroOuNull(limit);
  const deslocamento = inteiroOuNull(offset);
  return {
    limite:
      limite === null || limite < 1
        ? LIMITE_PADRAO
        : Math.min(limite, LIMITE_MAXIMO),
    deslocamento: deslocamento === null || deslocamento < 0 ? 0 : deslocamento
  };
}

function listaSkus(skus) {
  if (!Array.isArray(skus)) {
    return [];
  }
  const normalizados = new Set();
  for (const sku of skus) {
    const valor = normalizeSku(sku);
    if (valor !== '') {
      normalizados.add(valor);
    }
  }
  return [...normalizados];
}

function mapearProduto(linha) {
  return {
    productId: inteiroOuNull(linha.productId),
    sku: typeof linha.sku === 'string' ? linha.sku : '',
    name: typeof linha.name === 'string' ? linha.name : '',
    description: typeof linha.description === 'string' ? linha.description : '',
    shortDescription:
      typeof linha.shortDescription === 'string' ? linha.shortDescription : '',
    price: numeroOuNull(linha.price),
    qty: inteiroOuNull(linha.qty) ?? 0,
    manageStock: linha.manageStock === true,
    stockAvailability: linha.stockAvailability === true,
    urlKey: typeof linha.urlKey === 'string' ? linha.urlKey : '',
    imageUrl: urlAbsoluta(linha.imagemPrincipal),
    weight: numeroOuNull(linha.weight)
  };
}

/**
 * Lista paginada de produtos ativos e visíveis, opcionalmente filtrada por SKU.
 * A comparação de SKU usa TRIM/UPPER no banco e normalização no JavaScript,
 * garantindo a mesma chave usada por idempotência e allowlist.
 *
 * @param {{ limit?: number, offset?: number, skus?: string[] }} opcoes
 * @returns {Promise<Array<{productId: number|null, sku: string, name: string,
 *   description: string, shortDescription: string, price: number|null,
 *   qty: number, manageStock: boolean, stockAvailability: boolean,
 *   urlKey: string, imageUrl: string|null, weight: number|null}>>}
 */
export async function getProductsForMarketplace({
  limit = LIMITE_PADRAO,
  offset = 0,
  skus = []
} = {}) {
  const { limite, deslocamento } = limites(limit, offset);
  const filtros = [FILTRO_PUBLICAVEL];
  const valores = [];
  let textoSkus = '';

  const skusNormalizados = listaSkus(skus);
  if (skusNormalizados.length > 0) {
    valores.push(skusNormalizados);
    textoSkus = ` AND UPPER(TRIM(p.sku)) = ANY($${valores.length}::text[])`;
  }

  valores.push(limite, deslocamento);
  const texto = `
    SELECT ${COLUNAS_PRODUTO}
    ${FROM_PRODUTO}
    WHERE ${filtros.join(' AND ')}${textoSkus}
    ORDER BY p.product_id ASC
    LIMIT $${valores.length - 1}
    OFFSET $${valores.length}
  `;

  const client = await getConnection();
  try {
    const resultado = await client.query({ text: texto, values: valores });
    return (resultado?.rows ?? []).map(mapearProduto);
  } finally {
    client.release();
  }
}

/**
 * Busca um único produto publicável por SKU, com o mesmo formato de
 * `getProductsForMarketplace`. Retorna `null` quando não existe ou está
 * desativado/invisível.
 *
 * @param {string} sku
 * @returns {Promise<object|null>}
 */
export async function getProductBySku(sku) {
  const normalizado = normalizeSku(sku);
  if (normalizado === '') {
    return null;
  }

  const bruto = typeof sku === 'string' ? sku.trim().toUpperCase() : '';
  const valores = normalizado === bruto ? [normalizado] : [normalizado, bruto];
  const marcadores = valores.map((_, indice) => `$${indice + 1}`).join(', ');
  const texto = `
    SELECT ${COLUNAS_PRODUTO}
    ${FROM_PRODUTO}
    WHERE ${FILTRO_PUBLICAVEL}
      AND UPPER(TRIM(p.sku)) IN (${marcadores})
    ORDER BY p.product_id ASC
    LIMIT 1
  `;

  const client = await getConnection();
  try {
    const resultado = await client.query({ text: texto, values: valores });
    return resultado?.rows?.length > 0 ? mapearProduto(resultado.rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Imagens absolutas do produto em `product_image`, principal primeiro.
 * Retorna `string[]` pronto para `pictures[].source` (ML) ou upload (Shopee).
 * A ordem é determinística por `is_main` e `product_image_id`.
 *
 * @param {number|string} productId
 * @returns {Promise<string[]>}
 */
export async function getProductImages(productId) {
  const id = inteiroOuNull(productId);
  if (id === null || id < 1) {
    return [];
  }

  const texto = `
    SELECT origin_image
    FROM product_image
    WHERE product_image_product_id = $1
      AND origin_image IS NOT NULL
      AND TRIM(origin_image) <> ''
    ORDER BY is_main DESC NULLS LAST, product_image_id ASC
  `;

  const client = await getConnection();
  try {
    const resultado = await client.query({ text: texto, values: [id] });
    return (resultado?.rows ?? [])
      .map((linha) => urlAbsoluta(linha.origin_image))
      .filter((url) => url !== null);
  } finally {
    client.release();
  }
}

// Reexportação para que mapeadores importem catálogo e normalização de um
// único módulo, sem duplicar a base da loja nem as regras de chave.
export { buildStoreUrl, normalizeSku, normalizeText } from './normalize.js';
