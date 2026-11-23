// Atualização de preço e estoque de anúncios do Mercado Livre (somente MLB).
//
// Regras aplicadas aqui:
// - preço vem exclusivamente de `product.price` (ou do preço real já publicado,
//   no caso de estoque), validado por lib/pricing.js; nunca é inventado;
// - desde 18/03/2026, PUT /items com apenas `price` retorna 400. Por isso todo
//   PUT busca o item completo e reenvia um payload completo e saneado;
// - `requestJson` retenta PUT em 429/5xx. Antes de cada escrita há consulta
//   prévia (GET /items/{id}) e comparação de estado: se o valor desejado já
//   está aplicado, a escrita é ignorada. A mesma chave determinística de
//   idempotência é reutilizada em todas as tentativas da operação;
// - nenhuma chamada acontece sem `canPublish('mercadolivre', sku)` permitir.
// - este módulo não cria anúncio, pedido nem transação real.

import { MarketplaceError } from '../../errors.js';
import { canPublish } from '../../config.js';
import { assertPublishablePrice, fromCents, toCents } from '../../pricing.js';
import { makeIdempotencyKey } from '../../idempotency.js';
import { requestMercadoLivre } from './orders.js';

const MERCADOLIVRE = 'mercadolivre';
const SITE_ID_PADRAO = 'MLB';
const DESCRICAO_MAXIMA = 60000;

function criarErro(mensagem, code) {
  return new MarketplaceError(mensagem, { code, marketplace: MERCADOLIVRE });
}

function validarIdItem(itemId) {
  const texto = itemId == null ? '' : String(itemId).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(texto)) {
    throw criarErro('Identificador de anúncio inválido para o Mercado Livre.', 'ITEM_ID_INVALIDO');
  }
  return texto;
}

function arredondarParaCentavos(valor) {
  return toCents(valor) / 100;
}

/** Aceita um produto (com `price` ou `priceCents`) ou um número em reais. */
function extrairPreco(entrada) {
  if (entrada && typeof entrada === 'object') {
    const produto = entrada.price == null && entrada.priceCents != null
      ? { ...entrada, price: fromCents(entrada.priceCents) }
      : entrada;
    const preco = assertPublishablePrice(produto);
    return { preco: arredondarParaCentavos(preco), produto };
  }

  const preco = Number(entrada);
  const produto = { price: preco };
  assertPublishablePrice(produto);
  return { preco: arredondarParaCentavos(preco), produto };
}

function extrairQuantidade(entrada) {
  let bruto = entrada;
  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) {
    bruto = bruto.qty ?? bruto.quantity ?? bruto.available_quantity ?? bruto.stock;
  }
  const quantidade = Number(bruto);
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw criarErro(
      'Quantidade inválida para atualização de estoque: use um inteiro maior ou igual a zero.',
      'QUANTIDADE_INVALIDA'
    );
  }
  return quantidade;
}

function extrairSku(item, produto, opcoes) {
  const candidato = opcoes.sku ?? item?.seller_custom_field ?? produto?.sku ?? null;
  return typeof candidato === 'string' && candidato.trim() !== '' ? candidato.trim() : null;
}

function verificarGuardPublicacao(sku) {
  let permitido = false;
  try {
    permitido = canPublish(MERCADOLIVRE, sku) === true;
  } catch {
    // Falha de configuração também bloqueia: fail closed, sem chamada de API.
    permitido = false;
  }
  if (!permitido) {
    throw criarErro(
      'Atualização bloqueada: SKU sem permissão de publicação na configuração da empresa.',
      'PUBLICACAO_NAO_PERMITIDA'
    );
  }
}

async function carregarItemCompleto(accessToken, itemId, opcoes) {
  const id = validarIdItem(itemId);
  const siteId = opcoes.siteId ?? SITE_ID_PADRAO;
  const { body } = await requestMercadoLivre({
    accessToken,
    method: 'GET',
    path: `/items/${encodeURIComponent(id)}`
  });

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw criarErro('Resposta inválida ao consultar anúncio no Mercado Livre.', 'ITEM_RESPOSTA_INVALIDA');
  }
  if (body.site_id && body.site_id !== siteId) {
    throw criarErro('Anúncio consultado pertence a site diferente do escopo configurado.', 'ITEM_FORA_DO_SITE');
  }
  return body;
}

function extrairDescricao(item) {
  if (typeof item.description === 'string') return item.description;
  if (typeof item.description?.plain_text === 'string') return item.description.plain_text;
  return null;
}

function mapearFotos(item) {
  if (!Array.isArray(item.pictures)) return null;
  const fotos = item.pictures
    .slice(0, 12)
    .map((foto) => {
      if (foto?.id != null && String(foto.id) !== '') return { id: String(foto.id) };
      const origem = foto?.source ?? foto?.url ?? foto?.secure_url;
      return origem ? { source: String(origem) } : null;
    })
    .filter(Boolean);
  return fotos.length > 0 ? fotos : null;
}

function mapearAtributos(item) {
  if (!Array.isArray(item.attributes)) return null;
  const atributos = item.attributes
    .slice(0, 50)
    .map((atributo) => {
      if (atributo?.id == null || String(atributo.id) === '') return null;
      if (atributo.value_name != null) {
        return { id: String(atributo.id), value_name: String(atributo.value_name) };
      }
      if (atributo.value_id != null) {
        return { id: String(atributo.id), value_id: String(atributo.value_id) };
      }
      return null;
    })
    .filter(Boolean);
  return atributos.length > 0 ? atributos : null;
}

function mapearTermosDeVenda(item) {
  if (!Array.isArray(item.sale_terms)) return null;
  const termos = item.sale_terms
    .map((termo) => {
      if (termo?.id == null || String(termo.id) === '') return null;
      return {
        id: String(termo.id),
        ...(termo.value_id != null ? { value_id: String(termo.value_id) } : {})
      };
    })
    .filter(Boolean);
  return termos.length > 0 ? termos : null;
}

function mapearEnvio(item) {
  if (!item.shipping || typeof item.shipping !== 'object') return null;
  const envio = {};
  for (const chave of ['free_shipping', 'mode', 'logistic_type', 'store_pick_up']) {
    if (item.shipping[chave] !== undefined) envio[chave] = item.shipping[chave];
  }
  return Object.keys(envio).length > 0 ? envio : null;
}

/**
 * Monta o payload completo exigido pelo PUT /items. Campos somente-leitura
 * (`id`, `seller`, `permalink`, `paging`, etc.) são descartados.
 */
function montarPayloadCompleto(item, { preco, quantidade }) {
  if (!Number.isFinite(preco) || preco <= 0) {
    throw criarErro('Preço inválido para atualização de anúncio.', 'PRECO_INVALIDO');
  }
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw criarErro('Quantidade inválida para atualização de anúncio.', 'QUANTIDADE_INVALIDA');
  }
  for (const campo of ['title', 'category_id', 'condition', 'listing_type_id']) {
    if (typeof item[campo] !== 'string' || item[campo].trim() === '') {
      throw criarErro(
        `Anúncio incompleto no Mercado Livre: campo ${campo} ausente; PUT foi bloqueado.`,
        'ITEM_INCOMPLETO_PARA_ATUALIZACAO'
      );
    }
  }

  const descricao = extrairDescricao(item);
  const fotos = mapearFotos(item);
  const atributos = mapearAtributos(item);
  const termos = mapearTermosDeVenda(item);
  const envio = mapearEnvio(item);

  return {
    title: item.title,
    category_id: item.category_id,
    price: preco,
    available_quantity: quantidade,
    condition: item.condition,
    listing_type_id: item.listing_type_id,
    ...(typeof item.subtitle === 'string' && item.subtitle.trim() !== '' ? { subtitle: item.subtitle } : {}),
    ...(typeof item.buying_mode === 'string' && item.buying_mode.trim() !== '' ? { buying_mode: item.buying_mode } : {}),
    ...(typeof item.seller_custom_field === 'string' && item.seller_custom_field.trim() !== ''
      ? { seller_custom_field: item.seller_custom_field }
      : {}),
    ...(descricao ? { description: descricao.slice(0, DESCRICAO_MAXIMA) } : {}),
    ...(typeof item.warranty_type === 'string' && item.warranty_type.trim() !== ''
      ? {
          warranty_type: item.warranty_type,
          ...(item.warranty_time != null ? { warranty_time: String(item.warranty_time) } : {})
        }
      : {}),
    ...(fotos ? { pictures: fotos } : {}),
    ...(atributos ? { attributes: atributos } : {}),
    ...(termos ? { sale_terms: termos } : {}),
    ...(envio ? { shipping: envio } : {})
  };
}

function estadoJaAplicado(item, payload, campos) {
  for (const campo of campos) {
    const atual = Number(item[campo]);
    const desejado = Number(payload[campo]);
    if (!Number.isFinite(atual) || !Number.isFinite(desejado)) {
      // Sem valor local confiável não há como provar que a escrita é redundante.
      return false;
    }
    if (toCents(atual) !== toCents(desejado)) return false;
  }
  return true;
}

function respostaSegura(body, itemId, idempotencyKey, motivo, pulou) {
  return {
    itemId,
    idempotencyKey,
    atualizado: !pulou,
    ...(pulou ? { skipped: true, motivo } : {}),
    ...(body && typeof body === 'object'
      ? {
          resposta: {
            id: body.id != null ? String(body.id) : null,
            price: body.price ?? null,
            available_quantity: body.available_quantity ?? null,
            status: body.status ?? null
          }
        }
      : {})
  };
}

async function enviarAtualizacao(accessToken, itemId, payload, { idempotencyKey, camposComparados, item }) {
  // Consulta prévia: evita PUT redundante quando requestJson retenta a escrita
  // ou quando outro processo já aplicou exatamente o mesmo valor.
  if (item && estadoJaAplicado(item, payload, camposComparados)) {
    return respostaSegura(null, itemId, idempotencyKey, 'valor_ja_aplicado', true);
  }

  const { status, body } = await requestMercadoLivre({
    accessToken,
    method: 'PUT',
    path: `/items/${encodeURIComponent(itemId)}`,
    body: payload,
    idempotencyKey
  });

  if (status >= 400) {
    // normalizarResposta já lança MarketplaceHttpError; este ramo é defensivo.
    throw criarErro('Falha ao atualizar anúncio no Mercado Livre.', 'FALHA_ATUALIZACAO_ITEM');
  }
  return respostaSegura(body, itemId, idempotencyKey, null, false);
}

/**
 * Atualiza o preço de um anúncio existente.
 * `produtoOuPreco` deve ser o produto do EverShop (com `price` real) ou o
 * próprio número; `opcoes.sku` identifica o SKU autorizado na config.
 */
export async function updatePrice(accessToken, itemId, produtoOuPreco, opcoes = {}) {
  const id = validarIdItem(itemId);
  const { preco, produto } = extrairPreco(produtoOuPreco);
  const item = await carregarItemCompleto(accessToken, id, opcoes);
  const sku = extrairSku(item, produto, opcoes);
  verificarGuardPublicacao(sku);

  const quantidade = Number(item.available_quantity);
  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw criarErro('Quantidade atual do anúncio indisponível; PUT foi bloqueado.', 'QUANTIDADE_REMOTA_INDISPONIVEL');
  }
  const payload = montarPayloadCompleto(item, { preco, quantidade });
  const idempotencyKey = makeIdempotencyKey({
    marketplace: MERCADOLIVRE,
    operation: 'update_price',
    sku,
    externalId: id,
    ...(opcoes.sellerId ? { sellerId: opcoes.sellerId } : {})
  });

  return enviarAtualizacao(accessToken, id, payload, {
    idempotencyKey,
    camposComparados: ['price'],
    item
  });
}

/**
 * Atualiza o estoque de um anúncio existente reenviando o payload completo.
 * O preço reenviado é o preço real já publicado no item (nunca inventado).
 * Produtos com `manageStock`/`manage_stock` falso são ignorados.
 */
export async function updateStock(accessToken, itemId, quantidadeOuProduto, opcoes = {}) {
  const id = validarIdItem(itemId);
  const produto = quantidadeOuProduto && typeof quantidadeOuProduto === 'object' && !Array.isArray(quantidadeOuProduto)
    ? quantidadeOuProduto
    : null;
  if (produto && (produto.manageStock === false || produto.manage_stock === false)) {
    return {
      itemId: id,
      atualizado: false,
      skipped: true,
      motivo: 'manage_stock_desativado',
      idempotencyKey: null
    };
  }

  const quantidade = extrairQuantidade(quantidadeOuProduto);
  const item = await carregarItemCompleto(accessToken, id, opcoes);
  const sku = extrairSku(item, produto, opcoes);
  verificarGuardPublicacao(sku);

  const precoPublicado = Number(item.price);
  assertPublishablePrice({ price: precoPublicado });
  const payload = montarPayloadCompleto(item, {
    preco: arredondarParaCentavos(precoPublicado),
    quantidade
  });
  const idempotencyKey = makeIdempotencyKey({
    marketplace: MERCADOLIVRE,
    operation: 'update_stock',
    sku,
    externalId: id,
    ...(opcoes.sellerId ? { sellerId: opcoes.sellerId } : {})
  });

  return enviarAtualizacao(accessToken, id, payload, {
    idempotencyKey,
    camposComparados: ['available_quantity'],
    item
  });
}
