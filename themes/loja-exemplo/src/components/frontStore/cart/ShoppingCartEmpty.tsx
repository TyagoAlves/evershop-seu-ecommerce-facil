import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { quoteHref, SITE } from '../site.js';

/** Estado vazio do carrinho em pt-BR, com WhatsApp em vez de checkout. */
export function ShoppingCartEmpty() {
  return (
    <div className="le-empty-cart le-card">
      <span className="le-eyebrow le-eyebrow--dark">Sua seleção</span>
      <h2 className="le-empty-cart__title">Seu carrinho está vazio</h2>
      <p className="le-empty-cart__text">
        Monte sua lista de materiais e envie pelo WhatsApp. Nossa equipe
        responde com valores, disponibilidade e prazo de entrega.
      </p>
      <div className="le-empty-cart__actions">
        <a className="le-btn le-whatsapp le-btn--lg" href={quoteHref()} target="_blank" rel="noreferrer">
          <HcIcon name="whatsapp" />
          Pedir orçamento pelo WhatsApp
        </a>
        <a className="le-empty-cart__link" href="/products">
          Ver todos os produtos
        </a>
      </div>
      <p className="le-empty-cart__foot">
        Ou ligue <a href={SITE.phoneHref}>{SITE.phone}</a> · {SITE.hours}
      </p>
    </div>
  );
}
