/**
 * Resolver do painel administrativo de status das integrações.
 *
 * Regras aplicadas aqui:
 * - o SDL termina em `.admin.graphql` e este resolver em `.admin.resolvers.js`,
 *   portanto o tipo e a query só existem no schema administrativo;
 * - nenhuma função deste arquivo lê `encrypted_value`, `state`, `cursor`,
 *   `payload`, `payload_redacted`, `idempotency_key` ou qualquer dado de
 *   comprador. Apenas contagens, estados derivados e timestamps são expostos;
 * - os acessos a banco usam exclusivamente as funções documentadas de
 *   `lib/db.js` (`withConnection`, `listConnectedAccounts`, `getActiveToken`,
 *   `getSyncCursor`), com SQL parametrizado quando necessário;
 * - mensagens de aviso são genéricas: erros do driver nunca são repassados ao
 *   cliente nem registrados em log com valores de conexão.
 */
import { getConfig } from '@evershop/evershop/lib/util/getConfig';
import {
  getActiveToken,
  getSyncCursor,
  listConnectedAccounts,
  withConnection
} from '../../../lib/db.js';
import {
  getMarketplaceSettings,
  isEnabled,
  readMarketplaceConfig
} from '../../../lib/config.js';

const MARKETPLACES = Object.freeze(['mercadolivre', 'shopee']);
const TIPOS_TOKEN = Object.freeze(['access', 'refresh']);
const KINDS_SINCRONIZACAO = Object.freeze(['listings', 'orders', 'inventory']);

const AVISO_CONFIG = 'Configuração não secreta da empresa indisponível; integrações consideradas desativadas.';
const AVISO_TABELAS = 'Tabelas da extensão indisponíveis para leitura no momento.';
const AVISO_CONTAS = 'Não foi possível listar as contas conectadas de um marketplace.';
const AVISO_TOKENS = 'Não foi possível conferir todos os estados de token.';
const AVISO_SINC = 'Não foi possível conferir todos os cursores de sincronização.';

/**
 * Contadores por marketplace. Todas as comparações usam $1; nenhum valor vem
 * da requisição. `GREATEST` ignora datas nulas e devolve NULL se não houver
 * nenhuma sincronização registrada.
 */
const SQL_CONTADORES = `
  SELECT
    (SELECT COUNT(*)::int
       FROM "marketplace_token" t
       INNER JOIN "marketplace_account" a
         ON a."marketplace_account_id" = t."account_id"
      WHERE a."marketplace" = $1) AS "tokens",
    (SELECT COUNT(*)::int FROM "marketplace_listing" WHERE "marketplace" = $1) AS "listings",
    (SELECT COUNT(*)::int
       FROM "marketplace_listing"
      WHERE "marketplace" = $1
        AND NULLIF(BTRIM(COALESCE("last_error", '')), '') IS NOT NULL) AS "listingsWithError",
    (SELECT COUNT(*)::int FROM "marketplace_order" WHERE "marketplace" = $1) AS "orders",
    (SELECT COUNT(*)::int FROM "marketplace_event" WHERE "marketplace" = $1) AS "events",
    (SELECT COUNT(*)::int
       FROM "marketplace_event"
      WHERE "marketplace" = $1
        AND "processed_at" IS NULL
        AND "status" <> 'failed') AS "eventsPending",
    (SELECT COUNT(*)::int
       FROM "marketplace_event"
      WHERE "marketplace" = $1
        AND ("status" = 'failed'
          OR NULLIF(BTRIM(COALESCE("last_error", '')), '') IS NOT NULL)) AS "eventsWithError",
    (SELECT COUNT(*)::int FROM "marketplace_outbox" WHERE "marketplace" = $1) AS "outbox",
    (SELECT COUNT(*)::int
       FROM "marketplace_outbox"
      WHERE "marketplace" = $1
        AND "status" IN ('pending', 'processing')) AS "outboxPending",
    (SELECT COUNT(*)::int
       FROM "marketplace_outbox"
      WHERE "marketplace" = $1
        AND NULLIF(BTRIM(COALESCE("last_error", '')), '') IS NOT NULL) AS "outboxWithError",
    (SELECT COUNT(*)::int
       FROM "marketplace_oauth_state"
      WHERE "marketplace" = $1
        AND "used_at" IS NULL) AS "oauthStatesPending",
    GREATEST(
      (SELECT MAX("updated_at") FROM "marketplace_sync_state" WHERE "marketplace" = $1),
      (SELECT MAX("last_synced_at") FROM "marketplace_listing" WHERE "marketplace" = $1),
      (SELECT MAX("imported_at") FROM "marketplace_order" WHERE "marketplace" = $1)
    ) AS "ultimaSincronizacao"
`;

/** Não seleciona `encrypted_value`: apenas metadados não secretos. */
const SQL_METADADOS_TOKEN = `
  SELECT "token_type" AS "tokenType", "expires_at" AS "expiresAt",
         "generation", "used_at" AS "usedAt"
    FROM "marketplace_token"
   WHERE "account_id" = $1::int
`;

function textoOuNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

function inteiroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

function isoOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function contadoresZerados() {
  return {
    accounts: 0,
    tokens: 0,
    listings: 0,
    listingsWithError: 0,
    orders: 0,
    events: 0,
    eventsPending: 0,
    eventsWithError: 0,
    outbox: 0,
    outboxPending: 0,
    outboxWithError: 0,
    oauthStatesPending: 0
  };
}

function extensaoHabilitada() {
  try {
    const lista = getConfig('system.extensions', []);
    if (!Array.isArray(lista)) return false;
    const atual = lista.find((item) => item && item.name === 'marketplace-bridge');
    return Boolean(atual && atual.enabled === true);
  } catch {
    // Configuração ilegível nunca habilita a integração.
    return false;
  }
}

function normalizarConta(linha, marketplace) {
  if (!linha) return null;
  return {
    accountId: inteiroOuNulo(
      linha.marketplace_account_id ?? linha.accountId ?? linha.account_id
    ),
    marketplace,
    sellerId: textoOuNulo(linha.seller_id ?? linha.sellerId),
    shopId: textoOuNulo(linha.shop_id ?? linha.shopId),
    siteId: textoOuNulo(linha.site_id ?? linha.siteId),
    status: textoOuNulo(linha.status) ?? 'desconhecido',
    lastSyncAt: null
  };
}

async function lerContadores(marketplace, avisos) {
  try {
    const linha = await withConnection(async (client) => {
      const resultado = await client.query(SQL_CONTADORES, [marketplace]);
      return resultado.rows?.[0] ?? null;
    });

    if (!linha) {
      avisos.add(AVISO_TABELAS);
      return { contadores: contadoresZerados(), lastSyncAt: null, tablesAvailable: false };
    }

    const contadores = contadoresZerados();
    for (const chave of Object.keys(contadores)) {
      const valor = inteiroOuNulo(linha[chave]);
      contadores[chave] = valor === null ? 0 : Math.max(0, valor);
    }

    return {
      contadores,
      lastSyncAt: isoOuNulo(linha.ultimaSincronizacao),
      tablesAvailable: true
    };
  } catch {
    avisos.add(AVISO_TABELAS);
    return { contadores: contadoresZerados(), lastSyncAt: null, tablesAvailable: false };
  }
}

async function lerContas(marketplace, avisos) {
  try {
    const linhas = await listConnectedAccounts(marketplace);
    const lista = Array.isArray(linhas) ? linhas : [];
    return lista
      .map((linha) => normalizarConta(linha, marketplace))
      .filter((conta) => conta !== null);
  } catch {
    avisos.add(AVISO_CONTAS);
    return [];
  }
}

async function ultimaSincronizacaoDaConta(conta, avisos) {
  const datas = [];
  for (const kind of KINDS_SINCRONIZACAO) {
    let linha = null;
    try {
      // O retorno contém `.cursor`; aqui só a data é lida — o cursor jamais
      // sai do resolver e nunca é exibido no painel.
      linha =
        conta.accountId === null || conta.sellerId === null
          ? null
          : await getSyncCursor(conta.marketplace, conta.sellerId, kind);
    } catch {
      avisos.add(AVISO_SINC);
    }
    const iso = isoOuNulo(linha?.updated_at ?? linha?.updatedAt);
    if (iso) datas.push(iso);
  }
  return datas.length > 0 ? datas.sort().at(-1) : null;
}

async function lerStatusTokens(conta, avisos) {
  let metadados = [];
  try {
    metadados = conta.accountId === null
      ? []
      : await withConnection(async (client) => {
          const resultado = await client.query(SQL_METADADOS_TOKEN, [conta.accountId]);
          return resultado.rows ?? [];
        });
  } catch {
    avisos.add(AVISO_TOKENS);
  }

  const status = [];
  for (const tipo of TIPOS_TOKEN) {
    const metadado = metadados.find((item) => item.tokenType === tipo) ?? null;

    let disponivel = false;
    try {
      // `getActiveToken` devolve a linha cifrada; ela não é lida nem copiada
      // para a resposta. Interessa apenas saber se existe token utilizável.
      const ativo = conta.accountId === null
        ? null
        : await getActiveToken({ accountId: conta.accountId, type: tipo });
      disponivel = Boolean(ativo);
    } catch {
      avisos.add(AVISO_TOKENS);
    }

    let estado;
    if (disponivel) {
      estado = 'disponivel';
    } else if (!metadado) {
      estado = 'ausente';
    } else if (metadado.usedAt) {
      estado = 'em_uso';
    } else if (
      metadado.expiresAt &&
      new Date(metadado.expiresAt).getTime() <= Date.now()
    ) {
      estado = 'expirado';
    } else {
      estado = 'indisponivel';
    }

    status.push({
      accountId: conta.accountId,
      marketplace: conta.marketplace,
      sellerId: conta.sellerId,
      tokenType: tipo,
      status: estado,
      generation: inteiroOuNulo(metadado?.generation)
    });
  }
  return status;
}

async function montarStatus() {
  const avisos = new Set();
  const config = readMarketplaceConfig();
  if (!config) avisos.add(AVISO_CONFIG);

  const marketplaces = [];
  for (const marketplace of MARKETPLACES) {
    const settings = getMarketplaceSettings(marketplace) ?? {};
    const { contadores, lastSyncAt, tablesAvailable } = await lerContadores(
      marketplace,
      avisos
    );
    const contas = await lerContas(marketplace, avisos);

    const accounts = [];
    const tokens = [];
    for (const conta of contas) {
      accounts.push({
        ...conta,
        lastSyncAt: await ultimaSincronizacaoDaConta(conta, avisos)
      });
      tokens.push(...(await lerStatusTokens(conta, avisos)));
    }

    const publishSkus = Array.isArray(settings.publishSkus)
      ? settings.publishSkus.filter(
          (sku) => typeof sku === 'string' && sku.trim() !== ''
        )
      : [];

    marketplaces.push({
      marketplace,
      enabled: isEnabled(marketplace),
      publishAllowed: settings.publishAllowed === true,
      publishSkus,
      publishSkuCount: publishSkus.length,
      accounts,
      tokens,
      counts: { ...contadores, accounts: contas.length },
      lastSyncAt,
      tablesAvailable
    });
  }

  return {
    extensionEnabled: extensaoHabilitada(),
    companyConfigAvailable: Boolean(config),
    companyEnabled: Boolean(config && config.enabled === true),
    tablesAvailable: marketplaces.every((item) => item.tablesAvailable),
    marketplaces,
    warnings: [...avisos],
    generatedAt: new Date().toISOString()
  };
}

export default {
  Query: {
    marketplaceStatus: async (_root, _args, context) => {
      // Defesa em profundidade: o SDL já é administrativo, mas a query também
      // exige usuário autenticado no painel.
      if (!context || !context.user) {
        throw new Error(
          'Acesso negado: é necessário estar autenticado no painel administrativo.'
        );
      }
      return montarStatus();
    }
  }
};
