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

const FALLBACK_CATEGORIES: CategoryItem[] = [
  { name: 'Hidráulica', url: '/category/hidraulica', metaDescription: 'Tubos, conexões e acessórios para levar água até onde você precisar.', image: { url: '/images/categoria-hidraulica.svg', alt: 'Hidráulica' } },
  { name: 'Elétrica', url: '/category/eletrica', metaDescription: 'Fios, cabos, disjuntores e componentes para instalações seguras.', image: { url: '/images/categoria-eletrica.svg', alt: 'Elétrica' } },
  { name: 'Tintas e acabamento', url: '/category/tintas', metaDescription: 'Tintas, massas, vernizes e ferramentas para deixar tudo bonito.', image: { url: '/images/categoria-tintas.svg', alt: 'Tintas' } },
  { name: 'Ferragens', url: '/category/ferragens', metaDescription: 'Fechaduras, parafusos e ferragens para portas, janelas e móveis.', image: { url: '/images/categoria-ferragens.svg', alt: 'Ferragens' } },
  { name: 'Ferramentas', url: '/category/ferramentas', metaDescription: 'Ferramentas manuais e elétricas para cada etapa do trabalho.', image: { url: '/images/categoria-ferramentas.svg', alt: 'Ferramentas' } },
  { name: 'Materiais de construção', url: '/category/materiais-de-construcao', metaDescription: 'Cimento, areia, brita, tijolos e o básico de toda obra.', image: { url: '/images/categoria-materiais.svg', alt: 'Materiais de construção' } }
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
