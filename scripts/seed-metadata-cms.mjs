/**
 * Correções de dados que o seeder do EverShop 2.4.0 não aplica:
 *
 * 1. `setting` vazia => metadata genérica ("EverShop" / "The best eCommerce
 *    platform"). Inserimos storeName/storeDescription/favicon em pt-BR.
 * 2. `evershop seed` cria as páginas CMS, mas não cria as linhas de
 *    `url_rewrite`. Sem elas, `/page/empresa` redireciona 301 para `/empresa`
 *    e `/empresa` cai no 404. Criamos o mesmo par que o
 *    `syncPageUrlRewrite` do core usaria.
 *
 * Idempotente: seguro rodar depois de cada seed.
 */
import 'dotenv/config';
import { Pool } from 'pg';

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

  await client.query(
    `INSERT INTO setting (name, value, is_json) VALUES
       ('storeName', $1, false),
       ('storeDescription', $2, false),
       ('favicon', $3, false)
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value`,
    [
      'Loja Exemplo',
      'Materiais de construção, hidráulica, elétrica, tintas, ferragens e ferramentas em Sua Cidade, UF. Preço justo e atendimento próximo nas lojas 1 e 2.',
      '/favicon.svg'
    ]
  );

  const rewrites = await client.query(
    `INSERT INTO url_rewrite (entity_type, entity_uuid, request_path, target_path)
     SELECT 'cms_page', p.uuid, '/' || d.url_key, '/page/' || d.url_key
     FROM cms_page p
     JOIN cms_page_description d
       ON d.cms_page_description_cms_page_id = p.cms_page_id
     WHERE d.url_key IN ('empresa', 'contato', 'departamentos')
     ON CONFLICT (entity_uuid) DO UPDATE SET
       request_path = EXCLUDED.request_path,
       target_path = EXCLUDED.target_path,
       entity_type = EXCLUDED.entity_type
     RETURNING request_path, target_path`
  );

  await client.query('COMMIT');
  console.log(
    `Seed de metadata e CMS concluído: ${rewrites.rowCount} rewrite(s) de página.`
  );
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Falha ao aplicar seed de metadata/CMS:', error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
