import { Editable, useWidgetSettings } from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';

type ProductItem = {
  productId?: number;
  name?: string;
  url?: string | null;
  metaDescription?: string | null;
  image?: { url?: string | null; alt?: string | null } | null;
};

interface HcFeaturedProductsProps {
  products?: { items?: ProductItem[] } | null;
}

export default function HcFeaturedProducts({ products }: HcFeaturedProductsProps) {
  const settings = useWidgetSettings();
  const limit = Number(settings.limit || 6);
  const productItems =
    products?.items?.filter((product) => product.name)?.slice(0, limit) ?? [];

  if (productItems.length === 0) return null;

  return (
    <section className="le-section le-section--soft">
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
          <a className="le-section__link" href={String(settings.linkHref || '/products')}>
            <Editable as="span" fieldPath="settings.linkLabel">
              {String(settings.linkLabel || '')}
            </Editable>{' '}
            <HcIcon name="arrow" />
          </a>
        </div>
        <div className="le-product-grid">
          {productItems.map((product, index) => (
            <a
              className="le-card le-product-card"
              href={product.url || '/products'}
              key={product.productId || index}
            >
              <div className="le-product-card__image">
                {product.image?.url ? (
                  <img
                    alt={product.image.alt || product.name || ''}
                    loading="lazy"
                    src={product.image.url}
                  />
                ) : (
                  <HcIcon name="toolbox" />
                )}
              </div>
              <div className="le-product-card__body">
                <h3>{product.name}</h3>
                <p>{product.metaDescription}</p>
                <span className="le-product-card__price">Sob consulta</span>
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
    products(filters: [{ key: "limit", operation: eq, value: $limit }]) {
      items {
        productId
        name
        url
        metaDescription
        image { url alt }
      }
    }
  }
`;

export const variables = `{
  limit: getWidgetSetting("limit", 6)
}`;
