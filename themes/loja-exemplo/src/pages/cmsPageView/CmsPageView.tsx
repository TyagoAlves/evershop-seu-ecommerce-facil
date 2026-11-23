import { Editor } from '@components/common/Editor.js';
import React from 'react';
import { HcIcon } from '../../components/frontStore/HcIcon.js';
import { quoteHref } from '../../components/frontStore/site.js';

/** Página CMS com o mesmo visual premium das demais páginas do tema. */
export default function CmsPageView({ page }: { page: { name: string; content: any } }) {
  return (
    <>
      <div className="le-page-hero le-page-hero--compact">
        <div className="le-container le-page-hero__inner">
          <div className="le-page-hero__content">
            <span className="le-eyebrow">Loja Exemplo</span>
            <h1 className="le-page-hero__title">{page.name}</h1>
            <div className="le-page-hero__actions">
              <a
                className="le-btn le-whatsapp le-btn--lg"
                href={quoteHref(`a página "${page.name}"`)}
                target="_blank"
                rel="noreferrer"
              >
                <HcIcon name="whatsapp" />
                Fale com a nossa equipe
              </a>
            </div>
          </div>
        </div>
      </div>
      <div className="le-cms-content">
        <div className="le-container">
          <Editor rows={page.content} />
        </div>
      </div>
    </>
  );
}

export const layout = {
  areaId: 'content',
  sortOrder: 1
};

export const query = `
  query Query {
    page: currentCmsPage {
      name
      content
    }
  }
`;
