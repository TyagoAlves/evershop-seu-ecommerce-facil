import { Image } from '@components/common/Image.js';
import { ProductNoThumbnail } from '@components/common/ProductNoThumbnail.js';
import { ProductData } from '@components/frontStore/catalog/ProductContext.js';
import { ProductListAddToCart } from '@components/frontStore/catalog/ProductListAddToCart.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { quoteHref } from '../site.js';

/**
 * Card de produto do tema. O catálogo é demonstrativo, sem preço real:
 * mostramos "Sob consulta", permitimos montar a lista no carrinho e mantemos
 * o atalho para WhatsApp. Substitui o componente do core via alias.
 */
export const ProductListItemRender = ({
  product,
  imageWidth,
  imageHeight,
  layout = 'grid'
}: {
  product: ProductData;
  imageWidth?: number;
  imageHeight?: number;
  layout?: 'grid' | 'list';
}) => {
  const image = product.image;
  const href = quoteHref(product.name);

  if (layout === 'list') {
    return (
      <div className="le-product-row le-card">
        <a className="le-product-row__image" href={product.url}>
          {image ? (
            <Image
              src={image.url}
              alt={image.alt || product.name}
              width={imageWidth || 160}
              height={imageHeight || 160}
              loading="lazy"
              sizes="160px"
            />
          ) : (
            <ProductNoThumbnail width={imageWidth} height={imageHeight} />
          )}
        </a>
        <div className="le-product-row__body">
          <a className="le-product-row__name" href={product.url}>
            {product.name}
          </a>
          <span className="le-product-row__sku">SKU {product.sku}</span>
          <div className="le-product-row__actions">
            <span className="le-price-pill">Sob consulta</span>
            <ProductListAddToCart product={product} className="le-add-cart" />
            <a className="le-product-card__quote" href={href} target="_blank" rel="noreferrer">
              <HcIcon name="whatsapp" />
              Consultar
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="le-card le-product-card">
      <a className="le-product-card__image" href={product.url}>
        {image ? (
          <Image
            src={image.url}
            alt={image.alt || product.name}
            width={imageWidth || 800}
            height={imageHeight || 800}
            loading="lazy"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <ProductNoThumbnail width={imageWidth} height={imageHeight} />
        )}
      </a>
      <div className="le-product-card__body">
        <a className="le-product-card__name" href={product.url}>
          {product.name}
        </a>
        <span className="le-product-card__sku">SKU {product.sku}</span>
        <span className="le-product-card__price">Sob consulta</span>
        <div className="le-product-card__actions">
          <ProductListAddToCart product={product} className="le-add-cart" />
          <a className="le-product-card__quote" href={href} target="_blank" rel="noreferrer">
            <HcIcon name="whatsapp" />
            Consultar no WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};
