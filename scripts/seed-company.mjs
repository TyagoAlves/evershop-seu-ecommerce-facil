#!/usr/bin/env node
/**
 * Seed idempotente de catálogo por empresa.
 *
 * Uso:
 *   node scripts/seed-company.mjs --slug loja-exemplo
 *
 * Fontes (somente leitura):
 *   companies/<slug>.json            manifesto da empresa
 *   companies/<slug>.catalog.json    catálogo opcional (sobrescreve manifest.catalog)
 *   schemas/catalog.schema.json      validação do catálogo
 *   extensions/<extension>/generated/widgets.json  widgets e UUIDs gerados
 *   config/generated/company.json    confere o slug gerado, quando presente
 *
 * Regras:
 *   - INSERT ... ON CONFLICT DO NOTHING em todas as entidades com chave natural.
 *   - Nunca cria Women/Men/Kids.
 *   - price 0 + quoteOnly true => produto "sob consulta", sem estoque gerenciado.
 *   - Não apaga nada, não atualiza registros de outra empresa.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';
import { Pool } from 'pg';

const ROOT = process.cwd();
const DEMO_CATEGORY_KEYS = new Set(['women', 'men', 'kids']);
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const LEGACY_CMS_NAMES = {
  empresa: 'Empresa',
  contato: 'Contato',
  departamentos: 'Departamentos'
};
const MENU_PLACEMENTS = [
  { route: 'all', area: 'headerMenuDesktop', sortOrder: 1 },
  { route: 'all', area: 'headerMenuMobile', sortOrder: 2 }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  assert(value && !value.startsWith('--'), `--${name} exige um valor`);
  return value;
}

function readJson(file) {
  assert(existsSync(file), `Arquivo não encontrado: ${file}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`JSON inválido em ${file}: ${error.message}`);
  }
}

function uuidv5(name) {
  const namespace = Buffer.from(DNS_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(namespace).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toDbText(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function expectPrefixed(value, label, expected) {
  assert(
    typeof value === 'string' && value.startsWith(`${expected}-`),
    `${label} deve começar com "${expected}-" (recebido: ${String(value)})`
  );
}

function assertNotDemoCategory(key, name) {
  const base = String(key).toLowerCase();
  const label = String(name || '').toLowerCase();
  assert(
    !DEMO_CATEGORY_KEYS.has(base) && !DEMO_CATEGORY_KEYS.has(label),
    `Categoria demo não permitida: ${name || key}`
  );
}

function imageUrl(image) {
  const raw = typeof image === 'string' ? image : image?.url;
  assert(typeof raw === 'string' && raw.length > 0, 'Imagem de produto sem url');
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/assets/')) return raw;
  return `/assets/${raw.replace(/^\/+/, '')}`;
}

/** Caminho amigável da categoria, respeitando `parent`. */
function categoryPath(key, categories, seen = new Set()) {
  assert(!seen.has(key), `Ciclo de categorias em: ${key}`);
  seen.add(key);
  const category = categories.find((item) => item.key === key);
  assert(category, `Categoria pai não encontrada: ${key}`);
  return category.parent
    ? `${categoryPath(category.parent, categories, seen)}/${category.url_key}`
    : `/${category.url_key}`;
}

/** Lê widgets do artefato gerado; aceita UUIDs explícitos ou deriva UUID estável. */
function normalizeWidgets(rawWidgets, slug) {
  const widgets = Array.isArray(rawWidgets) ? rawWidgets : rawWidgets?.widgets;
  assert(Array.isArray(widgets), 'generated/widgets.json deve ser um array ou { widgets: [] }');

  return widgets.map((widget, index) => {
    const type = widget.type;
    assert(typeof type === 'string' && type.length > 0, `Widget ${index} sem type`);

    const instanceUuid =
      widget.uuid || widget.instanceUuid || widget.instance?.uuid ||
      uuidv5(`${slug}:widget:${type}`);

    const explicitPlacements = Array.isArray(widget.placements) && widget.placements.length > 0
      ? widget.placements
      : null;

    const placements = explicitPlacements
      ? explicitPlacements.map((placement, position) => ({
          uuid: placement.uuid || uuidv5(`${slug}:placement:${type}:${position}`),
          route: placement.route,
          area: placement.area,
          sortOrder: Number(placement.sortOrder ?? placement.sort_order ?? position + 1)
        }))
      : type === 'hc_menu'
        ? MENU_PLACEMENTS.map((placement, position) => ({
            uuid: uuidv5(`${slug}:placement:${type}:${placement.route}:${placement.area}`),
            ...placement,
            sortOrder: Number(placement.sortOrder ?? position + 1)
          }))
        : [{
            uuid: widget.placementUuid || uuidv5(`${slug}:placement:${type}:homepage:content`),
            route: 'homepage',
            area: 'content',
            sortOrder: Number(widget.sortOrder ?? widget.sort_order ?? (index + 1) * 10)
          }];

    for (const placement of placements) {
      assert(placement.route && placement.area, `Placement sem route/area em ${type}`);
    }

    return {
      type,
      name: widget.name || type,
      settings: widget.settings || {},
      instanceUuid,
      placements
    };
  });
}

// ---------------------------------------------------------------------------
// Entrada e validação
// ---------------------------------------------------------------------------

const slug = arg('slug') || process.env.COMPANY_SLUG || 'loja-exemplo';
assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), `Slug inválido: ${slug}`);

const manifestPath = path.join(ROOT, 'companies', `${slug}.json`);
const catalogOverlayPath = path.join(ROOT, 'companies', `${slug}.catalog.json`);
const schemaPath = path.join(ROOT, 'schemas', 'catalog.schema.json');
const generatedCompanyPath = path.join(ROOT, 'config', 'generated', 'company.json');

const manifest = readJson(manifestPath);
assert(manifest.slug === slug, `Manifesto ${manifestPath} tem slug "${manifest.slug}"`);

if (existsSync(generatedCompanyPath)) {
  const generatedCompany = readJson(generatedCompanyPath);
  assert(
    !generatedCompany.slug || generatedCompany.slug === slug,
    `config/generated/company.json pertence a "${generatedCompany.slug}"`
  );
}

const schema = readJson(schemaPath);
const ajv = new Ajv({ allErrors: true, strict: false });
const validateCatalog = ajv.compile(schema);

const overlayRaw = existsSync(catalogOverlayPath) ? readJson(catalogOverlayPath) : {};
const overlay = overlayRaw.catalog && typeof overlayRaw.catalog === 'object'
  ? overlayRaw.catalog
  : overlayRaw;
const catalog = { ...(manifest.catalog || {}), ...overlay };

if (!validateCatalog(catalog)) {
  throw new Error(`Catálogo inválido: ${ajv.errorsText(validateCatalog.errors)}`);
}

const skuPrefix = catalog.skuPrefix;
const upperPrefix = skuPrefix.toUpperCase();
const lowerPrefix = skuPrefix.toLowerCase();
const categories = catalog.categories || [];
const collections = catalog.collections || [];
const products = catalog.products || [];
const catalogPages = catalog.pages || [];
const legacyCmsSlugs = manifest.default === true ? new Set(manifest.cmsSlugs || []) : new Set();

for (const category of categories) {
  expectPrefixed(category.key, 'category.key', lowerPrefix);
  expectPrefixed(category.url_key, 'category.url_key', lowerPrefix);
  assertNotDemoCategory(category.key.slice(lowerPrefix.length + 1), category.name);
  if (category.parent) expectPrefixed(category.parent, 'category.parent', lowerPrefix);
}

for (const collection of collections) {
  expectPrefixed(collection.code, 'collection.code', lowerPrefix);
}

const knownCategories = new Set(categories.map((category) => category.key));
const knownCollections = new Set(collections.map((collection) => collection.code));

for (const product of products) {
  expectPrefixed(product.sku, 'product.sku', upperPrefix);
  expectPrefixed(product.url_key, 'product.url_key', lowerPrefix);
  if (product.category) {
    expectPrefixed(product.category, 'product.category', lowerPrefix);
    assert(knownCategories.has(product.category), `Categoria ${product.category} não declarada`);
  }
  for (const code of product.collections || []) {
    expectPrefixed(code, 'product.collections[]', lowerPrefix);
    assert(knownCollections.has(code), `Collection ${code} não declarada`);
  }
}

for (const page of catalogPages) {
  if (!page.url_key.startsWith(`${lowerPrefix}-`) && !legacyCmsSlugs.has(page.url_key)) {
    throw new Error(`page.url_key deve começar com "${lowerPrefix}-" (recebido: ${page.url_key})`);
  }
}

if (manifest.default !== true) {
  for (const urlKey of manifest.cmsSlugs || []) {
    expectPrefixed(urlKey, 'cmsSlugs[]', lowerPrefix);
  }
}

// Páginas derivadas de cmsSlugs do manifesto (dados reais já conhecidos).
const pages = [...catalogPages];
const declaredPages = new Set(pages.map((page) => page.url_key));
for (const urlKey of manifest.cmsSlugs || []) {
  if (!declaredPages.has(urlKey)) {
    pages.push({
      url_key: urlKey,
      name: LEGACY_CMS_NAMES[urlKey] || urlKey,
      status: true,
      content: null
    });
  }
}

const extension = manifest.extension || 'loja-exemplo-home';
const theme = manifest.theme || 'loja-exemplo';
const widgetsPath = path.join(ROOT, 'extensions', extension, 'generated', 'widgets.json');
const widgets = normalizeWidgets(readJson(widgetsPath), slug);

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSLMODE === 'disable' ? false : true,
  max: 2
});

const client = await pool.connect();
const counts = {};

async function query(text, params = []) {
  return client.query(text, params);
}

async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function inserted(text, params, counter) {
  const result = await query(text, params);
  if (result.rowCount > 0) counts[counter] = (counts[counter] || 0) + result.rowCount;
  return result;
}

try {
  await query('BEGIN');

  // 1) Categorias -----------------------------------------------------------
  const categoryIds = new Map();

  for (const category of categories) {
    const result = await query(
      `INSERT INTO category (status, include_in_nav, position, show_products, parent_id)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT DO NOTHING
       RETURNING category_id`,
      [
        category.status !== false,
        category.include_in_nav !== false,
        category.position ?? null,
        category.show_products !== false
      ]
    );

    let categoryId = result.rows[0]?.category_id;
    if (!categoryId) {
      const existing = await one(
        `SELECT category_description_category_id AS category_id
         FROM category_description WHERE url_key = $1`,
        [category.url_key]
      );
      assert(existing, `Categoria ${category.url_key} existe sem descrição`);
      categoryId = existing.category_id;
    }
    categoryIds.set(category.key, categoryId);
  }

  for (const category of categories) {
    if (!category.parent) continue;
    const parentId = categoryIds.get(category.parent);
    assert(parentId, `Categoria pai ${category.parent} não resolvida`);
    await query(
      `UPDATE category SET parent_id = $2
       WHERE category_id = $1 AND parent_id IS NULL`,
      [categoryIds.get(category.key), parentId]
    );
  }

  for (const category of categories) {
    const categoryId = categoryIds.get(category.key);
    await inserted(
      `INSERT INTO category_description
         (category_description_category_id, name, short_description, description,
          image, meta_title, meta_keywords, meta_description, url_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        categoryId,
        category.name,
        category.short_description ?? null,
        toDbText(category.description),
        category.image ?? null,
        category.meta_title ?? null,
        category.meta_keywords ?? null,
        category.meta_description ?? null,
        category.url_key
      ],
      'categoryDescriptions'
    );

    const row = await one('SELECT uuid FROM category WHERE category_id = $1', [categoryId]);
    const requestPath = categoryPath(category.key, categories);
    await inserted(
      `INSERT INTO url_rewrite (entity_type, entity_uuid, request_path, target_path)
       VALUES ('category', $1, $2, $3)
       ON CONFLICT (entity_uuid) DO NOTHING`,
      [row.uuid, requestPath, `/category/${row.uuid}`],
      'urlRewrites'
    );
  }

  // 2) Collections ----------------------------------------------------------
  const collectionIds = new Map();

  for (const collection of collections) {
    const result = await query(
      `INSERT INTO collection (name, code, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING
       RETURNING collection_id`,
      [collection.name, collection.code, collection.description ?? null]
    );

    let collectionId = result.rows[0]?.collection_id;
    if (!collectionId) {
      const existing = await one('SELECT collection_id FROM collection WHERE code = $1', [collection.code]);
      assert(existing, `Collection ${collection.code} existe sem id`);
      collectionId = existing.collection_id;
    }
    collectionIds.set(collection.code, collectionId);
  }

  // 3) Produtos -------------------------------------------------------------
  const quoteSkus = [];

  for (const product of products) {
    const quoteOnly = product.quoteOnly !== false &&
      (manifest.priceMode === 'quote' || product.quoteOnly === true);
    const price = quoteOnly ? 0 : Number(product.price ?? 0);
    const categoryId = product.category ? categoryIds.get(product.category) ?? null : null;

    const result = await query(
      `INSERT INTO product (type, visibility, status, sku, price, weight, group_id, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
       ON CONFLICT (sku) DO NOTHING
       RETURNING product_id, uuid`,
      [
        product.type || 'simple',
        product.visibility !== false,
        product.status !== false,
        product.sku,
        price,
        quoteOnly ? 0 : Number(product.weight ?? 0),
        categoryId
      ]
    );

    let productId = result.rows[0]?.product_id;
    let productUuid = result.rows[0]?.uuid;
    if (!productId) {
      const existing = await one('SELECT product_id, uuid FROM product WHERE sku = $1', [product.sku]);
      assert(existing, `Produto ${product.sku} existe sem id`);
      productId = existing.product_id;
      productUuid = existing.uuid;
    }

    if (quoteOnly) quoteSkus.push(product.sku);

    await inserted(
      `INSERT INTO product_description
         (product_description_product_id, name, description, short_description,
          url_key, meta_title, meta_description, meta_keywords)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        productId,
        product.name,
        toDbText(product.description),
        product.short_description ?? null,
        product.url_key,
        product.meta_title ?? null,
        product.meta_description ?? null,
        product.meta_keywords ?? null
      ],
      'productDescriptions'
    );

    await inserted(
      `INSERT INTO product_inventory
         (product_inventory_product_id, qty, manage_stock, stock_availability)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_inventory_product_id) DO NOTHING`,
      [
        productId,
        quoteOnly ? Number(product.qty ?? 9999) : Number(product.qty ?? 0),
        quoteOnly ? false : product.manage_stock === true,
        product.stock_availability !== false
      ],
      'inventories'
    );

    if (categoryId) {
      await inserted(
        `INSERT INTO product_category (category_id, product_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [categoryId, productId],
        'productCategories'
      );
    }

    for (const code of product.collections || []) {
      await inserted(
        `INSERT INTO product_collection (collection_id, product_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [collectionIds.get(code), productId],
        'productCollections'
      );
    }

    const images = product.images || [];
    for (let index = 0; index < images.length; index += 1) {
      const value = images[index];
      const url = imageUrl(value);
      const isMain = typeof value === 'string' ? index === 0 : value.isMain === true;
      await inserted(
        `INSERT INTO product_image (product_image_product_id, origin_image, is_main)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (
           SELECT 1 FROM product_image
           WHERE product_image_product_id = $1 AND origin_image = $2
         )`,
        [productId, url, isMain],
        'images'
      );
    }

    const requestPath = product.category
      ? `${categoryPath(product.category, categories)}/${product.url_key}`
      : `/${product.url_key}`;

    await inserted(
      `INSERT INTO url_rewrite (entity_type, entity_uuid, request_path, target_path)
       VALUES ('product', $1, $2, $3)
       ON CONFLICT (entity_uuid) DO NOTHING`,
      [productUuid, requestPath, `/product/${productUuid}`],
      'urlRewrites'
    );
  }

  // 4) Páginas CMS ----------------------------------------------------------
  for (const page of pages) {
    let existing = await one(
      `SELECT p.cms_page_id, p.uuid
       FROM cms_page p
       JOIN cms_page_description d
         ON d.cms_page_description_cms_page_id = p.cms_page_id
       WHERE d.url_key = $1`,
      [page.url_key]
    );

    if (!existing) {
      const created = await query(
        `INSERT INTO cms_page (status) VALUES ($1)
         ON CONFLICT DO NOTHING
         RETURNING cms_page_id, uuid`,
        [page.status !== false]
      );
      existing = created.rows[0] || null;
      assert(existing, `Falha ao criar cms_page ${page.url_key}`);
      counts.cmsPages = (counts.cmsPages || 0) + 1;
    }

    await inserted(
      `INSERT INTO cms_page_description
         (cms_page_description_cms_page_id, url_key, name, content,
          meta_title, meta_keywords, meta_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        existing.cms_page_id,
        page.url_key,
        page.name,
        toDbText(page.content),
        page.meta_title ?? null,
        page.meta_keywords ?? null,
        page.meta_description ?? null
      ],
      'cmsPageDescriptions'
    );

    await inserted(
      `INSERT INTO url_rewrite (entity_type, entity_uuid, request_path, target_path)
       SELECT 'cms_page', $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM url_rewrite WHERE entity_uuid = $1
       )`,
      [existing.uuid, `/${page.url_key}`, `/page/${page.url_key}`],
      'urlRewrites'
    );
  }

  // 5) Settings -------------------------------------------------------------
  // storeName/storeDescription só para a empresa default: em DB compartilhado,
  // uma empresa não-default nunca sobrescreve os dados globais de outra.
  const settings = manifest.default === true
    ? [
        ...(manifest.name ? [['storeName', manifest.name, false]] : []),
        ...(manifest.description ? [['storeDescription', manifest.description, false]] : [])
      ]
    : [];

  settings.push(
    [`company:${slug}:skuPrefix`, skuPrefix, false],
    [`company:${slug}:quoteSkus`, JSON.stringify(quoteSkus), true]
  );

  for (const [name, value, isJson] of settings) {
    await inserted(
      `INSERT INTO setting (name, value, is_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [name, value, isJson],
      'settings'
    );
  }

  // 6) Widgets --------------------------------------------------------------
  for (const widget of widgets) {
    const instanceResult = await query(
      `INSERT INTO widget_instance (uuid, name, type, settings, status, theme)
       VALUES ($1, $2, $3, $4::jsonb, true, $5)
       ON CONFLICT (uuid) DO NOTHING
       RETURNING widget_instance_id`,
      [widget.instanceUuid, widget.name, widget.type, JSON.stringify(widget.settings), theme]
    );

    let widgetInstanceId = instanceResult.rows[0]?.widget_instance_id;
    if (!widgetInstanceId) {
      const existing = await one(
        'SELECT widget_instance_id FROM widget_instance WHERE uuid = $1',
        [widget.instanceUuid]
      );
      assert(existing, `Widget ${widget.type} existe sem id`);
      widgetInstanceId = existing.widget_instance_id;
    }

    for (const placement of widget.placements) {
      await inserted(
        `INSERT INTO widget_placement
           (uuid, widget_instance_id, route, area, sort_order, theme)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (uuid) DO NOTHING`,
        [
          placement.uuid,
          widgetInstanceId,
          placement.route,
          placement.area,
          placement.sortOrder,
          theme
        ],
        'placements'
      );
    }
  }

  await query('COMMIT');
  console.log(`Seed ${slug} concluído: ${JSON.stringify(counts)}`);
} catch (error) {
  await query('ROLLBACK');
  console.error(`Falha no seed de ${slug}:`, error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
