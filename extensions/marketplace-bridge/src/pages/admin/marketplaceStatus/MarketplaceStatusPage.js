import { PageHeading } from '@components/admin/PageHeading.js';
import Spinner from '@components/admin/Spinner.js';
import { Badge } from '@components/common/ui/Badge.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@components/common/ui/Card.js';
import React from 'react';
import { useQuery } from 'urql';

/**
 * Painel somente leitura das integrações com marketplaces.
 *
 * Arquivo escrito em JavaScript com `React.createElement` (sem JSX): em modo
 * compilado o EverShop 2.4 lê os componentes de `<extensao>/dist` e aceita
 * somente arquivos `.js` cujo nome começa com letra maiúscula. Não existe etapa
 * de transpilação de `.tsx` da extensão neste template.
 *
 * A consulta GraphQL é administrativa (`.admin.graphql`) e não contém campos
 * de token, segredo, payload de pedido ou dado de comprador. Nenhuma ação
 * desta tela altera configuração, estoque, anúncio ou fila.
 */
const h = React.createElement;

const STATUS_QUERY = `
  query MarketplaceStatusAdmin {
    marketplaceStatus {
      extensionEnabled
      companyConfigAvailable
      companyEnabled
      tablesAvailable
      generatedAt
      warnings
      marketplaces {
        marketplace
        enabled
        publishAllowed
        publishSkus
        publishSkuCount
        lastSyncAt
        tablesAvailable
        accounts {
          sellerId
          shopId
          siteId
          status
          lastSyncAt
        }
        tokens {
          sellerId
          tokenType
          status
          generation
        }
        counts {
          accounts
          tokens
          listings
          listingsWithError
          orders
          events
          eventsPending
          eventsWithError
          outbox
          outboxPending
          outboxWithError
          oauthStatesPending
        }
      }
    }
  }
`;

const ROTULOS_CONTADORES = [
  ['accounts', 'Contas conectadas'],
  ['tokens', 'Tokens (sem valores)'],
  ['listings', 'Anúncios locais'],
  ['listingsWithError', 'Anúncios com erro'],
  ['orders', 'Pedidos importados'],
  ['events', 'Eventos registrados'],
  ['eventsPending', 'Eventos pendentes'],
  ['eventsWithError', 'Eventos com erro'],
  ['outbox', 'Operações na fila'],
  ['outboxPending', 'Fila pendente/em processamento'],
  ['outboxWithError', 'Fila com erro'],
  ['oauthStatesPending', 'Estados OAuth pendentes']
];

function formatarData(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo'
  }).format(data);
}

function rotuloMarketplace(marketplace) {
  if (marketplace === 'mercadolivre') return 'Mercado Livre';
  if (marketplace === 'shopee') return 'Shopee Brasil';
  return marketplace;
}

function rotuloTipoToken(tipo) {
  if (tipo === 'access') return 'Acesso';
  if (tipo === 'refresh') return 'Renovação';
  return tipo;
}

function rotuloEstadoToken(estado) {
  const rotulos = {
    disponivel: 'Disponível',
    ausente: 'Ausente',
    expirado: 'Expirado',
    em_uso: 'Em uso',
    indisponivel: 'Indisponível'
  };
  return Object.prototype.hasOwnProperty.call(rotulos, estado)
    ? rotulos[estado]
    : 'Indisponível';
}

function varianteToken(estado) {
  if (estado === 'disponivel') return 'success';
  if (estado === 'ausente') return 'secondary';
  if (estado === 'expirado' || estado === 'em_uso') return 'warning';
  return 'destructive';
}

function Sinalizador({ ativo }) {
  return h(
    Badge,
    { variant: ativo ? 'success' : 'secondary' },
    ativo ? 'Sim' : 'Não'
  );
}

function CartaoVisaoGeral({ status }) {
  const itens = [
    {
      rotulo: 'Extensão habilitada na instalação',
      ativo: status.extensionEnabled
    },
    {
      rotulo: 'Configuração da empresa disponível',
      ativo: status.companyConfigAvailable
    },
    {
      rotulo: 'Integração habilitada na empresa',
      ativo: status.companyEnabled
    },
    {
      rotulo: 'Tabelas disponíveis para leitura',
      ativo: status.tablesAvailable
    }
  ];

  return h(
    Card,
    null,
    h(
      CardHeader,
      null,
      h(CardTitle, null, 'Visão geral'),
      h(
        CardDescription,
        null,
        'A extensão entra desativada por padrão; nenhuma ação de publicação é executada a partir desta tela.'
      )
    ),
    h(
      CardContent,
      null,
      h(
        'div',
        { className: 'grid grid-cols-1 gap-3 md:grid-cols-2' },
        itens.map((item) =>
          h(
            'div',
            {
              key: item.rotulo,
              className:
                'flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3'
            },
            h('span', { className: 'text-muted-foreground' }, item.rotulo),
            h(Sinalizador, { ativo: item.ativo })
          )
        )
      ),
      h(
        'p',
        { className: 'text-muted-foreground mt-4 text-xs' },
        'Última leitura: ',
        formatarData(status.generatedAt),
        '.'
      )
    )
  );
}

function CartaoAvisos({ avisos }) {
  if (!avisos || avisos.length === 0) return null;
  return h(
    Card,
    null,
    h(
      CardHeader,
      null,
      h(CardTitle, null, 'Avisos'),
      h(
        CardDescription,
        null,
        'Mensagens genéricas; detalhes técnicos ficam apenas nos logs internos com redação.'
      )
    ),
    h(
      CardContent,
      null,
      h(
        'ul',
        { className: 'list-disc space-y-1 pl-5 text-sm' },
        avisos.map((aviso) => h('li', { key: aviso }, aviso))
      )
    )
  );
}

function CartaoContadores({ item }) {
  return h(
    'div',
    null,
    h('h3', { className: 'mb-3 text-sm font-medium' }, 'Contadores'),
    h(
      'div',
      { className: 'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4' },
      ROTULOS_CONTADORES.map(([chave, rotulo]) =>
        h(
          'div',
          { key: chave, className: 'rounded-lg border border-border px-3 py-2' },
          h('div', { className: 'text-muted-foreground text-xs' }, rotulo),
          h('div', { className: 'text-lg font-medium' }, item.counts[chave])
        )
      )
    )
  );
}

function CartaoContas({ item }) {
  const contas = item.accounts || [];
  let conteudo;

  if (contas.length === 0) {
    conteudo = h(
      'p',
      { className: 'text-muted-foreground text-sm' },
      'Nenhuma conta conectada.'
    );
  } else {
    conteudo = h(
      'div',
      { className: 'overflow-x-auto' },
      h(
        'table',
        { className: 'w-full border-collapse text-left text-sm' },
        h(
          'thead',
          null,
          h(
            'tr',
            { className: 'border-b border-border text-muted-foreground' },
            ['Vendedor', 'Loja', 'Site', 'Status', 'Última sincronização'].map(
              (rotulo) =>
                h('th', { key: rotulo, className: 'px-2 py-2 font-medium' }, rotulo)
            )
          )
        ),
        h(
          'tbody',
          null,
          contas.map((conta, indice) =>
            h(
              'tr',
              {
                key: `${conta.sellerId ?? 'conta'}-${indice}`,
                className: 'border-b border-border'
              },
              h('td', { className: 'px-2 py-2' }, conta.sellerId ?? '—'),
              h('td', { className: 'px-2 py-2' }, conta.shopId ?? '—'),
              h('td', { className: 'px-2 py-2' }, conta.siteId ?? '—'),
              h('td', { className: 'px-2 py-2' }, conta.status),
              h(
                'td',
                { className: 'px-2 py-2' },
                formatarData(conta.lastSyncAt)
              )
            )
          )
        )
      )
    );
  }

  return h(
    'div',
    null,
    h(
      'h3',
      { className: 'mb-3 text-sm font-medium' },
      'Contas conectadas (',
      contas.length,
      ')'
    ),
    conteudo
  );
}

function CartaoTokens({ item }) {
  const tokens = item.tokens || [];
  let conteudo;

  if (tokens.length === 0) {
    conteudo = h(
      'p',
      { className: 'text-muted-foreground text-sm' },
      'Nenhum token associado às contas conectadas.'
    );
  } else {
    conteudo = h(
      'div',
      { className: 'overflow-x-auto' },
      h(
        'table',
        { className: 'w-full border-collapse text-left text-sm' },
        h(
          'thead',
          null,
          h(
            'tr',
            { className: 'border-b border-border text-muted-foreground' },
            ['Vendedor', 'Tipo', 'Estado', 'Geração'].map((rotulo) =>
              h('th', { key: rotulo, className: 'px-2 py-2 font-medium' }, rotulo)
            )
          )
        ),
        h(
          'tbody',
          null,
          tokens.map((token, indice) =>
            h(
              'tr',
              {
                key: `${token.sellerId ?? 'conta'}-${token.tokenType}-${indice}`,
                className: 'border-b border-border'
              },
              h('td', { className: 'px-2 py-2' }, token.sellerId ?? '—'),
              h(
                'td',
                { className: 'px-2 py-2' },
                rotuloTipoToken(token.tokenType)
              ),
              h(
                'td',
                { className: 'px-2 py-2' },
                h(
                  Badge,
                  { variant: varianteToken(token.status) },
                  rotuloEstadoToken(token.status)
                )
              ),
              h('td', { className: 'px-2 py-2' }, token.generation ?? '—')
            )
          )
        )
      )
    );
  }

  return h(
    'div',
    null,
    h(
      'h3',
      { className: 'mb-3 text-sm font-medium' },
      'Status dos tokens (sem valores)'
    ),
    conteudo,
    h(
      'p',
      { className: 'text-muted-foreground mt-2 text-xs' },
      'O painel mostra apenas presença, validade aproximada e geração. Tokens, envelopes cifrados e segredos nunca são exibidos.'
    )
  );
}

function Publicacao({ item }) {
  const bloqueada = !item.publishAllowed || item.publishSkuCount === 0;
  const skus = item.publishSkus || [];

  return h(
    'div',
    { className: 'rounded-lg border border-border px-4 py-3' },
    h(
      'div',
      { className: 'mb-2 flex items-center justify-between gap-4' },
      h('span', { className: 'text-sm font-medium' }, 'Publicação'),
      h(
        Badge,
        { variant: bloqueada ? 'secondary' : 'warning' },
        bloqueada ? 'Bloqueada' : 'Configurada (sem envio automático)'
      )
    ),
    h(
      'div',
      { className: 'text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs' },
      h(
        'span',
        null,
        'publishAllowed: ',
        h(Sinalizador, { ativo: item.publishAllowed })
      ),
      h('span', null, 'SKUs na allowlist: ', item.publishSkuCount)
    ),
    skus.length > 0
      ? h(
          'p',
          { className: 'text-muted-foreground mt-2 break-words text-xs' },
          'Allowlist: ',
          skus.join(', ')
        )
      : null,
    h(
      'p',
      { className: 'text-muted-foreground mt-2 text-xs' },
      'Lista vazia nunca significa “todos os SKUs”. Esta tela não cria, atualiza nem pausa anúncios.'
    )
  );
}

function CartaoMarketplace({ item }) {
  return h(
    Card,
    null,
    h(
      CardHeader,
      null,
      h(CardTitle, null, rotuloMarketplace(item.marketplace)),
      h(
        CardDescription,
        null,
        item.marketplace,
        ' · habilitado no painel da empresa: ',
        item.enabled ? 'sim' : 'não',
        ' · última sincronização: ',
        formatarData(item.lastSyncAt),
        item.tablesAvailable ? '' : ' · tabelas indisponíveis'
      )
    ),
    h(
      CardContent,
      { className: 'space-y-6' },
      h(Publicacao, { item }),
      h(CartaoContadores, { item }),
      h(CartaoContas, { item }),
      h(CartaoTokens, { item })
    )
  );
}

export default function MarketplaceStatusPage() {
  const [{ data, fetching }] = useQuery({ query: STATUS_QUERY });
  const status = data?.marketplaceStatus ?? null;

  const filhos = [h(PageHeading, { heading: 'Status das integrações com marketplaces' })];

  const conteudo = [];

  if (fetching && !status) {
    conteudo.push(
      h(
        'div',
        { key: 'carregando', className: 'flex justify-center py-12' },
        h(Spinner, { width: 40, height: 40 })
      )
    );
  }

  if (!fetching && !status) {
    conteudo.push(
      h(
        Card,
        { key: 'indisponivel' },
        h(
          CardHeader,
          null,
          h(CardTitle, null, 'Status indisponível'),
          h(
            CardDescription,
            null,
            'Não foi possível carregar o status. Verifique a autenticação administrativa e tente novamente mais tarde.'
          )
        )
      )
    );
  }

  if (status) {
    conteudo.push(
      h(CartaoVisaoGeral, { key: 'visao', status }),
      h(CartaoAvisos, { key: 'avisos', avisos: status.warnings }),
      ...status.marketplaces.map((item) =>
        h(CartaoMarketplace, { key: item.marketplace, item })
      ),
      h(
        'p',
        { key: 'rodape', className: 'text-muted-foreground text-xs' },
        'Somente leitura: nenhum segredo, token, dado de comprador ou preço é exibido nesta página.'
      )
    );
  }

  filhos.push(h('div', { className: 'space-y-6 p-6' }, conteudo));

  return h(React.Fragment, null, ...filhos);
}

export const layout = {
  areaId: 'content',
  sortOrder: 10
};
