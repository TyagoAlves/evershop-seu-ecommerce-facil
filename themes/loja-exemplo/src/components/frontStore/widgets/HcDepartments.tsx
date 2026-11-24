import { Editable, useWidgetSettings } from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';

type CategoryItem = {
  categoryId?: number;
  name?: string;
  url?: string | null;
  metaDescription?: string | null;
  image?: { url?: string | null; alt?: string | null } | null;
};

interface HcDepartmentsProps {
  categories?: { items?: CategoryItem[] } | null;
}

// Categorias de demonstração, usadas apenas enquanto o catálogo está vazio.
// Substitua pelo catálogo real da sua empresa (ver companies/<slug>.json).
const FALLBACK_CATEGORIES: CategoryItem[] = [
  { name: 'Categoria 1', url: '/category/categoria-1', metaDescription: 'Descreva esta categoria no catálogo da sua empresa.', image: { url: '/images/categoria-coberturas.svg', alt: 'Categoria 1' } },
  { name: 'Categoria 2', url: '/category/categoria-2', metaDescription: 'Descreva esta categoria no catálogo da sua empresa.', image: { url: '/images/categoria-eletrica.svg', alt: 'Categoria 2' } },
  { name: 'Categoria 3', url: '/category/categoria-3', metaDescription: 'Descreva esta categoria no catálogo da sua empresa.', image: { url: '/images/categoria-coberturas.svg', alt: 'Categoria 3' } },
  { name: 'Categoria 4', url: '/category/categoria-4', metaDescription: 'Descreva esta categoria no catálogo da sua empresa.', image: { url: '/images/categoria-iluminacao.svg', alt: 'Categoria 4' } },
  { name: 'Categoria 5', url: '/category/categoria-5', metaDescription: 'Descreva esta categoria no catálogo da sua empresa.', image: { url: '/images/categoria-materiais.svg', alt: 'Categoria 5' } },
  { name: 'Categoria 6', url: '/category/categoria-6', metaDescription: 'Descreva esta categoria no catálogo da sua empresa.', image: { url: '/images/categoria-materiais.svg', alt: 'Categoria 6' } }
];

export default function HcDepartments({ categories }: HcDepartmentsProps) {
  const settings = useWidgetSettings();
  const limit = Number(settings.limit || 9);
  const categoryItems =
    categories?.items && categories.items.length > 0
      ? categories.items.filter((category) => category.name).slice(0, limit)
      : FALLBACK_CATEGORIES;

  return (
    <section className="le-section">
      <div className="le-container">
        <div className="le-section__head">
          <div>
            <span className="le-section__eyebrow">
              <Editable as="span" fieldPath="settings.eyebrow">
                {String(settings.eyebrow || '')}
              </Editable>
            </span>
            <h2 className="le-section-title">
              <Editable as="span" fieldPath="settings.title">
                {String(settings.title || '')}
              </Editable>
            </h2>
            <p className="le-muted">
              <Editable as="span" fieldPath="settings.description" multiline>
                {String(settings.description || '')}
              </Editable>
            </p>
          </div>
          <a className="le-section__link" href={String(settings.linkHref || '/departamentos')}>
            <Editable as="span" fieldPath="settings.linkLabel">
              {String(settings.linkLabel || '')}
            </Editable>{' '}
            <HcIcon name="arrow" />
          </a>
        </div>

        <div className="le-category-grid">
          {categoryItems.map((category, index) => (
            <a
              className="le-card le-category-card"
              href={category.url || '/products'}
              key={category.categoryId || category.name || index}
            >
              <div className="le-category-card__image">
                {category.image?.url ? (
                  <img
                    alt={category.image.alt || category.name || ''}
                    loading="lazy"
                    src={category.image.url}
                  />
                ) : (
                  <HcIcon name="toolbox" />
                )}
              </div>
              <div className="le-category-card__body">
                <h3>{category.name}</h3>
                <p>{category.metaDescription || 'Confira a variedade deste departamento.'}</p>
                <span className="le-category-card__link">
                  Explorar <HcIcon name="arrow" />
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export const query = `
  query Query($limit: Int) {
    categories(filters: [
      { key: "status", operation: eq, value: "1" },
      { key: "limit", operation: eq, value: $limit }
    ]) {
      items {
        categoryId
        name
        url
        metaDescription
        image { url alt }
      }
    }
  }
`;

export const variables = `{
  limit: getWidgetSetting("limit", 9)
}`;
