import { useProduct } from '@components/frontStore/catalog/ProductContext.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { quoteHref } from '../site.js';

/** Preço do catálogo demonstrativo: sempre "sob consulta", sem R$ 0,00. */
export function ProductSinglePrice() {
  const { name } = useProduct();
  return (
    <div className="le-single-price">
      <span className="le-price-pill le-price-pill--lg">Sob consulta</span>
      <span className="le-single-price__note">
        Consulte valor e disponibilidade diretamente com nossa equipe.
      </span>
      <a
        className="le-single-price__link"
        href={quoteHref(name)}
        target="_blank"
        rel="noreferrer"
      >
        <HcIcon name="whatsapp" />
        Falar com vendedor
      </a>
    </div>
  );
}
