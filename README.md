# evershop-seu-ecommerce-facil

Template público white-label de e-commerce baseado em **EverShop 2.4.0**. A identidade da loja (nome, domínio, contatos, conteúdo, tema, catálogo e SEO) é controlada por **manifestos de empresa**, permitindo replicar a mesma base para diferentes negócios sem acoplar dados reais ao repositório.

## Identidade de exemplo

Os exemplos abaixo são fictícios e servem apenas como referência de configuração:

- **Nome:** Loja Exemplo
- **Slug:** `loja-exemplo`
- **Domínio:** `https://lojaexemplo.com.br`
- **E-mail público:** `contato@lojaexemplo.com.br`
- **Telefone:** `(11) 4000-0000`
- **WhatsApp:** `(11) 90000-0000` / `5511900000000`
- **Endereço:** Rua Exemplo, 100 - Centro, São Paulo - SP, 01000-000

## Requisitos

- Node.js 20+
- PostgreSQL 14+ (testado com PostgreSQL 16)
- npm

## Quickstart local

```bash
npm install
cp .env.example .env
# Edite .env com credenciais locais e COMPANY_SLUG/EVERSHOP_HOME_URL
npm run setup
npm run seed
npm run seed:home
npm run build
npm start
```

URLs locais padrão:

- Loja: `http://localhost:3001`
- Admin: `http://localhost:3001/admin`

> `npm install` executa patches idempotentes de pós-instalação para o EverShop 2.4.0 (ajustes de compatibilidade, pt-BR, build/seed no Windows e correções locais). Não edite `node_modules` manualmente: os patches são reaplicados no `postinstall`.

## Configuração por manifesto

O template usa um manifesto por empresa em `companies/<slug>.json`, validado pelo schema `companies/schema.json`.

- `COMPANY_SLUG` define qual manifesto está ativo.
- `npm run company:render` lê o manifesto ativo e gera artefatos derivados:
  - `config/generated/company.json`
  - `extensions/<extension>/generated/widgets.json`
  - `themes/<theme>/src/components/frontStore/generated/company.ts`
- `npm run build` executa `company:render` antes de compilar tema/extensão e gerar os bundles.

Arquivos úteis:

- `companies/_template.json`: modelo base do manifesto.
- `companies/schema.json`: contrato do manifesto de empresa.
- `companies/loja-exemplo.json`: exemplo fictício incluído no template.
- `config/default.json`: configuração padrão do EverShop/tema/extensões.
- `config/custom-environment-variables.json`: mapeamento de variáveis de ambiente.
- `.env.example`: exemplo de variáveis locais; copie para `.env` e ajuste.

## Estrutura do projeto

```text
.
├── companies/                  # Manifestos e schemas por empresa
├── config/                     # Configuração EverShop e artefatos gerados
├── extensions/                 # Extensões locais (home, config, marketplace etc.)
├── public/                     # Arquivos públicos
├── schemas/                    # Schemas auxiliares
├── scripts/                    # Renderização, seed, patches, validações e provisionamento
├── themes/                     # Temas EverShop
├── translations/               # Traduções pt-BR
├── .env.example
├── package.json
└── README.md
```

## Scripts úteis

| Script | Descrição |
| --- | --- |
| `npm run setup` | Cria schema/migrations e o primeiro administrador. Exige `ADMIN_PASSWORD`. |
| `npm run seed` | Executa seed base do EverShop e seed de metadata/CMS pt-BR. |
| `npm run seed:home` | Insere widgets da home no page builder. Idempotente. |
| `npm run company:render` | Renderiza artefatos da empresa ativa a partir de `companies/<COMPANY_SLUG>.json`. |
| `npm run company:create` | Provisiona uma instalação isolada para uma nova empresa (valida entradas, DB, cópia, build e healthcheck). |
| `npm run theme:compile` | Compila tema e extensão local. |
| `npm run build` | Renderiza empresa, compila tema/extensão e gera bundles de produção. |
| `npm start` | Sobe a loja e o admin. |
| `npm run dev` | Modo de desenvolvimento do EverShop. |
| `npm run mp:config` | Valida configurações não secretas de marketplaces. |
| `npm run mp:secrets` | Verifica ausência de segredos versionados e checagens locais de marketplace. |
| `npm run check:leaks` | Verifica vazamentos de dados de empresa/identidade no repositório. |

## Tema, extensões e home

- Tema padrão do exemplo: `loja-exemplo`.
- Extensão de home do exemplo: `loja-exemplo-home`, com widgets editáveis pelo page builder.
- Extensão `company-config` aplica configurações derivadas do manifesto.
- A home é composta por widgets no page builder; após o seed, edite em `/admin/page-builder/edit/homepage`.

## Marketplaces

A integração de marketplaces é opcional e vem **desativada por padrão**.

- Em `config/default.json`, a extensão `marketplace-bridge` está com `enabled: false`.
- Os arquivos `companies/*.marketplaces.json` são configurações **não secretas** e devem manter integrações/publicação desativadas até revisão explícita.
- Antes de habilitar, valide com `npm run mp:config` e `npm run mp:secrets`.
- Credenciais, tokens, chaves e segredos de webhook **nunca** devem ser commitados em manifestos, schemas ou exemplos versionados. Use variáveis de ambiente/cofre da instalação.

## Aviso de segredos e dados sensíveis

- Não versione `.env`, senhas, tokens, chaves privadas ou credenciais de banco/admin.
- Use `.env.example` apenas com nomes de variáveis e placeholders seguros.
- `ADMIN_PASSWORD` deve ser fornecido no ambiente durante `npm run setup`.
- Antes de publicar um fork/template, execute `npm run check:leaks` e revise dados de contato, domínio, catálogo e mídia.

## Produção

Antes de publicar:

1. Defina `EVERSHOP_HOME_URL` (ou `HOME_URL`) com o domínio canônico da empresa.
2. Configure `COMPANY_SLUG` para o manifesto correto.
3. Defina segredos apenas no ambiente/cofre da instalação.
4. Execute `npm run build`.
5. No ambiente de destino, execute `npm run setup`, `npm run seed` e `npm run seed:home`.
6. Revise o conteúdo do page builder e os dados públicos antes de expor a loja.

## Licença e uso

Este repositório é um template técnico. Ao adaptá-lo para um negócio real, substitua todos os dados de exemplo, revise integrações, políticas legais, mídias e configurações de domínio antes da publicação.
