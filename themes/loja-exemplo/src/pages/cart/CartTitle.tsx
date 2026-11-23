import React from 'react';
import { CartTitle as HcCartTitle } from '../../components/frontStore/cart/CartTitle.js';

/** Substitui o título padrão do carrinho pelo cabeçalho do tema, em pt-BR. */
export default function CartTitle() {
  return <HcCartTitle />;
}

export const layout = {
  areaId: 'shoppingCartHeader',
  sortOrder: 10
};
