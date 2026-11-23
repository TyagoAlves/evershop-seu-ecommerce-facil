import React from 'react';
import { HcIcon } from '../../components/frontStore/HcIcon.js';
import { quoteHref } from '../../components/frontStore/site.js';

/** Cabeçalho do blog no slot `blogListHeader` da página blogHome. */
export default function BlogHomeHeader() {
  return (
    <div className="le-page-hero le-page-hero--compact">
      <div className="le-container le-page-hero__inner">
        <div className="le-page-hero__content">
          <span className="le-eyebrow">Blog &amp; dicas</span>
          <h1 className="le-page-hero__title">Orientação para sua obra</h1>
          <div className="le-page-hero__description">
            <p>
              Dicas práticas de hidráulica, elétrica, pintura e manutenção,
              escritas por quem atende todos os dias em Sua Cidade.
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
              Tirar dúvida com um especialista
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export const layout = {
  areaId: 'blogListHeader',
  sortOrder: 10
};
