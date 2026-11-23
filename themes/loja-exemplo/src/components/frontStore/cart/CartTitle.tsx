import { useCartState } from '@components/frontStore/cart/CartContext.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { quoteHref } from '../site.js';

/** Cabeçalho do carrinho em pt-BR, com CTA para fechar o pedido no WhatsApp. */
export function CartTitle() {
  const { data: cart } = useCartState();
  const count = cart.items.length;

  return (
    <div className="le-page-hero le-page-hero--compact le-cart-hero">
      <div className="le-container le-page-hero__inner">
        <div className="le-page-hero__content">
          <span className="le-eyebrow">Sua seleção</span>
          <h1 className="le-page-hero__title">Seu carrinho</h1>
          <div className="le-page-hero__description">
            <p>
              {count === 0
                ? 'Você ainda não selecionou produtos.'
                : `${count} ${count === 1 ? 'item selecionado' : 'itens selecionados'}.`}{' '}
              Os valores são sob consulta — envie sua lista e receba o orçamento
              pelo WhatsApp.
            </p>
          </div>
          {count > 0 && (
            <div className="le-page-hero__actions">
              <a
                className="le-btn le-whatsapp le-btn--lg"
                href={quoteHref('os itens do meu carrinho')}
                target="_blank"
                rel="noreferrer"
              >
                <HcIcon name="whatsapp" />
                Enviar lista para orçamento
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
