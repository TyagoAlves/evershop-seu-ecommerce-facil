import Area from '@components/common/Area.js';
import { Form } from '@components/common/form/Form.js';
import { NumberField } from '@components/common/form/NumberField.js';
import { Button } from '@components/common/ui/Button.js';
import { toast } from '@components/common/ui/Sonner.js';
import { AddToCart } from '@components/frontStore/cart/AddToCart.js';
import { useProduct } from '@components/frontStore/catalog/ProductContext.js';
import { VariantSelector } from '@components/frontStore/catalog/VariantSelector.js';
import React from 'react';
import { useForm } from 'react-hook-form';
import { HcIcon } from '../HcIcon.js';
import { quoteHref, SITE } from '../site.js';

/**
 * Caixa de compra do tema: preço sob consulta, mas com carrinho funcional para
 * o cliente montar sua lista. O WhatsApp continua disponível como atalho.
 * Mantemos a Area `productSinglePageForm` para não perder os blocos de
 * atributos e variantes registrados pelo core.
 */
export function ProductSingleForm() {
  const { sku, name, inventory } = useProduct();
  const form = useForm();
  const [addingToCart, setAddingToCart] = React.useState(false);

  return (
    <Form id="productForm" method="POST" submitBtn={false} form={form}>
      <Area
        id="productSinglePageForm"
        coreComponents={[
          {
            component: { default: <VariantSelector /> },
            sortOrder: 10,
            id: 'variantSelector'
          }
        ]}
      />
      <div className="le-product-buy">
        <AddToCart
          product={{ sku, isInStock: inventory.isInStock }}
          qty={form.watch('qty') || 1}
          onError={(error: any) => toast.error(error?.message || error)}
        >
          {(state: any, actions: any) => (
            <div className="le-product-buy__row">
              <NumberField
                name="qty"
                label="Quantidade"
                className="le-product-buy__qty"
                min={1}
                allowDecimals={false}
                required
                placeholder="Quantidade"
                defaultValue={1}
              />
              <Button
                variant="default"
                size="lg"
                className="le-product-buy__cart"
                disabled={!state.canAddToCart || state.isLoading}
                isLoading={addingToCart || state.isLoading}
                onClick={() => {
                  form.trigger().then((isValid) => {
                    if (isValid) {
                      setAddingToCart(true);
                      actions.addToCart();
                    }
                  }).finally(() => setAddingToCart(false));
                }}
              >
                <HcIcon name="cart" />
                {inventory.isInStock ? 'Adicionar ao carrinho' : 'Esgotado'}
              </Button>
            </div>
          )}
        </AddToCart>
        <a
          className="le-btn le-whatsapp le-btn--lg le-product-buy__cta"
          href={quoteHref(name)}
          target="_blank"
          rel="noreferrer"
        >
          <HcIcon name="whatsapp" />
          Solicitar preço no WhatsApp
        </a>
        <p className="le-product-buy__note">
          Ou ligue{' '}
          <a href={SITE.phoneHref}>{SITE.phone}</a>. Atendimento em{' '}
          {SITE.addressShort}.
        </p>
      </div>
    </Form>
  );
}
