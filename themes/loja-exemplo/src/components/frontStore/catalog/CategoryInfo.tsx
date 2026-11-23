import { Editor } from '@components/common/Editor.js';
import { useCategory } from '@components/frontStore/catalog/CategoryContext.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { quoteHref } from '../site.js';

/** Cabeçalho escuro de departamento, alinhado ao hero da homepage. */
export function CategoryInfo() {
  const { name, description, image } = useCategory();

  return (
    <div className="le-page-hero le-page-hero--category">
      {image && (
        <>
          <div
            className="le-page-hero__bg"
            style={{ backgroundImage: `url("${image.url}")` }}
          />
          <div className="le-page-hero__scrim" />
        </>
      )}
      <div className="le-container le-page-hero__inner">
        <div className="le-page-hero__content">
          <span className="le-eyebrow">Departamento</span>
          <h1 className="le-page-hero__title">{name}</h1>
          {description && (
            <div className="le-page-hero__description">
              <Editor rows={description} />
            </div>
          )}
          <div className="le-page-hero__actions">
            <a
              className="le-btn le-whatsapp le-btn--lg"
              href={quoteHref(name)}
              target="_blank"
              rel="noreferrer"
            >
              <HcIcon name="whatsapp" />
              Consultar produtos deste departamento
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
