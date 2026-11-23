import { Section } from '@components/common/page-builder/index.js';
import React from 'react';
import { ArrayItemField, TextAreaField, TextField } from './HcFields.js';

export default function HcLocationSetting() {
  return (
    <div className="space-y-3">
      <Section title="Conteúdo">
        <TextField name="eyebrow" label="Sobtítulo" />
        <TextField name="title" label="Título" />
        <TextAreaField name="address" label="Endereço" />
      </Section>
      <Section title="Informações" defaultOpen={false}>
        {[0, 1, 2].map((index) => (
          <div className="space-y-2 rounded-md border border-divider p-2" key={index}>
            <div className="text-xs font-medium">Informação {index + 1}</div>
            <ArrayItemField
              path={`meta.${index}.icon`}
              label="Ícone (clock, phone, star, pin)"
            />
            <ArrayItemField path={`meta.${index}.text`} label="Texto" />
          </div>
        ))}
      </Section>
      <Section title="Botões">
        <TextField name="mapsLabel" label="Texto do botão do Maps" />
        <TextField name="mapsHref" label="Link do Google Maps" />
        <TextField name="whatsappLabel" label="Texto do botão do WhatsApp" />
        <TextField name="whatsappHref" label="Link do WhatsApp" />
      </Section>
      <Section title="Cartão do endereço" defaultOpen={false}>
        <TextField name="cardTitle" label="Título" />
        <TextField name="cardLine1" label="Linha 1" />
        <TextField name="cardLine2" label="Linha 2" />
      </Section>
    </div>
  );
}
