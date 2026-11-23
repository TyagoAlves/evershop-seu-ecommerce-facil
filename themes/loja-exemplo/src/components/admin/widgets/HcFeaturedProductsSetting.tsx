import { Section } from '@components/common/page-builder/index.js';
import React from 'react';
import { NumberField, TextAreaField, TextField } from './HcFields.js';

export default function HcFeaturedProductsSetting() {
  return (
    <div className="space-y-3">
      <Section title="Conteúdo">
        <TextField name="eyebrow" label="Sobtítulo" />
        <TextField name="title" label="Título" />
        <TextAreaField name="description" label="Descrição" />
        <TextField name="linkLabel" label="Texto do link" />
        <TextField name="linkHref" label="Link" />
      </Section>
      <Section title="Catálogo">
        <NumberField
          name="limit"
          label="Quantidade de produtos"
          hint="Os produtos são exibidos como “Sob consulta”."
        />
      </Section>
    </div>
  );
}
