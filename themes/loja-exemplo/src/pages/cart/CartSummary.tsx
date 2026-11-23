import { useCartState } from '@components/frontStore/cart/CartContext.js';
import React from 'react';
import { HcIcon } from '../../components/frontStore/HcIcon.js';
import { quoteHref, SITE } from '../../components/frontStore/site.js';

/** Substitui o resumo de checkout por um pedido de orçamento pelo WhatsApp. */
export default function CartSummary() {
  const { data: cart } = useCartState();
  const count = cart.items.length;

  return (
    <aside className="le-quote-card le-card">
      <span className="le-eyebrow le-eyebrow--dark">Orçamento</span>
      <h2 className="le-quote-card__title">Resumo da sua lista</h2>
      <p className="le-quote-card__text">
        {count} {count === 1 ? 'item selecionado' : 'itens selecionados'}. Como
        trabalhamos com preços sob consulta, envie sua lista pelo WhatsApp e a
        nossa equipe responde com valores e prazo de entrega.
      </p>
      <div className="le-quote-card__total">
        <span>Total</span>
        <strong>Sob consulta</strong>
      </div>
      <a
        className="le-btn le-whatsapp le-btn--lg le-quote-card__cta"
        href={quoteHref('os itens do meu carrinho')}
        target="_blank"
        rel="noreferrer"
      >
        <HcIcon name="whatsapp" />
        Solicitar orçamento
      </a>
      <p className="le-quote-card__foot">
        Ou ligue <a href={SITE.phoneHref}>{SITE.phone}</a> · {SITE.hours}
      </p>
      <a className="le-quote-card__back" href="/products">
        Continuar comprando
      </a>
    </aside>
  );
}

export const layout = {
  areaId: 'shoppingCartSummary',
  sortOrder: 10
};
