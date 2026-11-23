/**
 * Transforma as seções da home e o menu do cabeçalho em widgets editáveis
 * pelo page builder.
 *
 * Idempotente: UUIDs fixos evitam duplicatas quando o script é executado
 * novamente. Não publica o rascunho do construtor e não altera widgets
 * adicionados pelo admin.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';

const COMPANY_CONFIG_PATH = path.join(
  process.cwd(),
  'config',
  'generated',
  'company.json'
);
const DEFAULT_THEME = 'loja-exemplo';
const THEME = existsSync(COMPANY_CONFIG_PATH)
  ? JSON.parse(readFileSync(COMPANY_CONFIG_PATH, 'utf8')).theme || DEFAULT_THEME
  : DEFAULT_THEME;
const ROUTE = 'homepage';
const AREA = 'content';
const MENU_ROUTE = 'all';
const MENU_AREAS = [
  { area: 'headerMenuDesktop', sortOrder: 1, uuid: '688f6783-f7a2-409c-b60f-3c62251ecc47' },
  { area: 'headerMenuMobile', sortOrder: 2, uuid: '28da3e8f-2fc1-4bc8-bbd4-18bc2360d2e0' }
];
const DEMO_MENU_UUID = '73459ff6-1757-4e89-81e5-29af403b50bb';

const UUIDS = {
  hc_menu: {
    instance: 'ee935d4f-2d89-4309-bfb4-97ec5fcccee7'
  },
  hc_hero: {
    instance: 'a89bbc17-a59f-4993-aa79-720993ca5740',
    placement: '4a092e36-4a22-4de9-82a1-4dfe5cbd77d3'
  },
  hc_departments: {
    instance: 'e59eecc8-c25b-4710-b1c5-aadd2c07d2d5',
    placement: 'e3daef77-90ad-4d83-b0f1-299b6ef6a9b5'
  },
  hc_featured_products: {
    instance: '6a593ab2-07d8-4b34-a57b-89500ffec44b',
    placement: 'f53fcdb2-57a7-470c-bf68-11ac7d49153d'
  },
  hc_differentials: {
    instance: '7c6ecd66-72aa-4a75-890c-e792b8fa03e8',
    placement: '5449f4e2-f820-4861-bfc2-0951be3e5604'
  },
  hc_cta: {
    instance: 'ecb2ad1e-7df1-4511-b2d1-a2694003c1b8',
    placement: '9ea51ad3-eaae-49a9-abb5-0acc5f368ab5'
  },
  hc_location: {
    instance: '0d439058-d6c9-4d07-8328-807ebed6252a',
    placement: '2cbd8e11-872c-44bd-8548-cfeaa4b37a52'
  }
};

const LEGACY_SLUG = 'loja-exemplo';
const SLUG = process.env.COMPANY_SLUG || LEGACY_SLUG; // contrato, linha 88
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // namespace DNS RFC 4122

function uuidv5(name) {
  const bytes = Buffer.concat([
    Buffer.from(UUID_NS.replace(/-/g, ''), 'hex'),
    Buffer.from(name, 'utf8')
  ]);
  const digest = createHash('sha1').update(bytes).digest().subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const instanceUuid = (type) =>
  SLUG === LEGACY_SLUG
    ? UUIDS[type].instance
    : uuidv5(`${SLUG}:${type}:instance`);

const placementUuid = (type, area = 'content') =>
  SLUG === LEGACY_SLUG
    ? type === 'hc_menu'
      ? MENU_AREAS.find((target) => target.area === area).uuid
      : UUIDS[type].placement
    : uuidv5(`${SLUG}:${type}:${area}:placement`);

const WIDGETS_PATH = path.join(
  process.cwd(),
  'extensions', 'loja-exemplo-home', 'generated', 'widgets.json'
);
const FALLBACK_WIDGETS_PATH = path.join(
  process.cwd(),
  'extensions', 'loja-exemplo-home', 'widgets.json'
);
const widgets = JSON.parse(
  readFileSync(
    existsSync(WIDGETS_PATH) ? WIDGETS_PATH : FALLBACK_WIDGETS_PATH,
    'utf8'
  )
);

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

try {
  await client.query('BEGIN');

  let created = 0;

  const ensureInstance = async (widget, uuid) => {
    const instance = await client.query(
      `INSERT INTO widget_instance (uuid, name, type, settings, status, theme)
       VALUES ($1, $2, $3, $4::jsonb, true, $5)
       ON CONFLICT (uuid) DO NOTHING
       RETURNING widget_instance_id`,
      [uuid, widget.name, widget.type, JSON.stringify(widget.settings), THEME]
    );
    if (instance.rowCount > 0) created += 1;

    return (
      instance.rows[0]?.widget_instance_id ??
      (
        await client.query(
          'SELECT widget_instance_id FROM widget_instance WHERE uuid = $1',
          [uuid]
        )
      ).rows[0].widget_instance_id
    );
  };

  const ensurePlacement = async (uuid, instanceId, route, area, sortOrder) => {
    const placement = await client.query(
      `INSERT INTO widget_placement
         (uuid, widget_instance_id, route, area, sort_order, theme)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (uuid) DO NOTHING
       RETURNING widget_placement_id`,
      [uuid, instanceId, route, area, sortOrder, THEME]
    );
    if (placement.rowCount > 0) created += 1;
  };

  for (const widget of widgets) {
    if (SLUG === LEGACY_SLUG && !UUIDS[widget.type]) {
      throw new Error(`UUID não definido para ${widget.type}`);
    }

    const instanceId = await ensureInstance(widget, instanceUuid(widget.type));

    if (widget.type === 'hc_menu') {
      for (const target of MENU_AREAS) {
        await ensurePlacement(
          placementUuid(widget.type, target.area),
          instanceId, MENU_ROUTE, target.area, target.sortOrder
        );
      }
      continue;
    }

    await ensurePlacement(
      placementUuid(widget.type),
      instanceId, ROUTE, AREA, widget.sortOrder
    );
  }

  // O menu demo do seed não é renderizado pelo tema customizado; o hc_menu
  // editável ocupa o lugar dele na lista de camadas.
  if (SLUG === 'loja-exemplo') {
    const demoPlacement = await client.query(
      `DELETE FROM widget_placement
       WHERE widget_instance_id = (
         SELECT widget_instance_id FROM widget_instance WHERE uuid = $1
       )`,
      [DEMO_MENU_UUID]
    );
    const demoInstance = await client.query(
      'DELETE FROM widget_instance WHERE uuid = $1',
      [DEMO_MENU_UUID]
    );
    if (demoPlacement.rowCount > 0 || demoInstance.rowCount > 0) created += 1;
  }

  await client.query('COMMIT');
  console.log(
    `Seed da home concluído: ${widgets.length} widgets (${created} criações/ajustes nesta execução).`
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Falha ao semear widgets da home:', error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
