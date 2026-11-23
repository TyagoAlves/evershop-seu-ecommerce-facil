/**
 * Non-interactive equivalent of `evershop install`.
 * Creates the .env-driven database schema and the first administrator.
 */
import 'dotenv/config';
import { mkdir } from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import {
  commit,
  execute,
  insertOnUpdate,
  rollback,
  startTransaction
} from '@evershop/postgres-query-builder';
import { hashPassword } from '@evershop/evershop/lib/util/passwordHelper';
import { CONSTANTS } from '@evershop/evershop/lib/helpers';
import { getCoreModules } from '../node_modules/@evershop/evershop/dist/bin/lib/loadModules.js';
import { migrate } from '../node_modules/@evershop/evershop/dist/bin/lib/bootstrap/migrate.js';

const db = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const admin = {
  fullName: process.env.ADMIN_FULLNAME || 'Loja Exemplo',
  email: process.env.ADMIN_EMAIL || 'admin@lojaexemplo.com.br',
  password: process.env.ADMIN_PASSWORD
};

if (!admin.password) {
  throw new Error('Defina ADMIN_PASSWORD no .env antes de executar npm run setup.');
}

const pool = new Pool({
  ...db,
  ssl: process.env.DB_SSLMODE === 'disable' ? false : true,
  max: 10,
  idleTimeoutMillis: 30000
});

const connection = await pool.connect();
await startTransaction(connection);

try {
  await execute(
    connection,
    `CREATE TABLE IF NOT EXISTS "admin_user" (
      "admin_user_id" INT GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
      "uuid" UUID NOT NULL DEFAULT gen_random_uuid (),
      "status" boolean NOT NULL DEFAULT TRUE,
      "email" varchar NOT NULL,
      "password" varchar NOT NULL,
      "full_name" varchar DEFAULT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ADMIN_USER_EMAIL_UNIQUE" UNIQUE ("email"),
      CONSTRAINT "ADMIN_USER_UUID_UNIQUE" UNIQUE ("uuid")
    );`
  );

  await insertOnUpdate('admin_user', ['email'])
    .given({
      status: 1,
      email: admin.email,
      password: hashPassword(admin.password),
      full_name: admin.fullName
    })
    .execute(connection);

  await migrate(getCoreModules(), connection);
  await commit(connection);

  await mkdir(path.resolve(CONSTANTS.ROOTPATH, 'media'), { recursive: true });
  await mkdir(path.resolve(CONSTANTS.ROOTPATH, 'public'), { recursive: true });

  console.log(`EverShop instalado em ${db.database}. Admin: ${admin.email}`);
} catch (error) {
  await rollback(connection);
  console.error('Falha na instalação headless:', error);
  process.exitCode = 1;
} finally {
  // O query builder do EverShop libera a conexão durante as migrations.
  await pool.end();
}
