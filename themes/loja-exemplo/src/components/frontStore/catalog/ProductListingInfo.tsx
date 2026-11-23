import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { quoteHref } from '../site.js';

/** Cabeçalho da página "todos os produtos". */
export function ProductListingInfo() {
  return (
    <div className="le-page-hero le-page-hero--compact">
      <div className="le-container le-page-hero__inner">
        <div className="le-page-hero__content">
          <span className="le-eyebrow">Catálogo</span>
          <h1 className="le-page-hero__title">Todos os produtos</h1>
          <div className="le-page-hero__description">
            <p>
              Hidráulica, elétrica, tintas, ferragens, ferramentas e materiais
              de construção. Valores e disponibilidade sob consulta.
            </p>
          </div>
          <div className="le-page-hero__actions">
            <a
              className="le-btn le-whatsapp le-btn--lg"
              href={quoteHref()}
              target="_blank"
              rel="noreferrer"
            >
              <HcIcon name="whatsapp" />
              Pedir orçamento
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
