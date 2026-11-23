import { Section } from '@components/common/page-builder/index.js';
import React from 'react';
import { TextAreaField, TextField } from './HcFields.js';

export default function HcCtaSetting() {
  return (
    <div className="space-y-3">
      <Section title="Conteúdo">
        <TextField name="eyebrow" label="Sobtítulo" />
        <TextField name="title" label="Título" />
        <TextAreaField name="text" label="Descrição" />
      </Section>
      <Section title="Botão do WhatsApp">
        <TextField name="buttonLabel" label="Texto do botão" />
        <TextField name="buttonHref" label="Link do WhatsApp" />
      </Section>
    </div>
  );
}
