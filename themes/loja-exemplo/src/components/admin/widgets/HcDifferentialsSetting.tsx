import { Section } from '@components/common/page-builder/index.js';
import React from 'react';
import { ArrayItemField, TextField } from './HcFields.js';

const ICONS = ['check', 'star', 'truck', 'pin', 'droplet', 'bolt', 'wrench'];

export default function HcDifferentialsSetting() {
  return (
    <div className="space-y-3">
      <Section title="Conteúdo">
        <TextField name="eyebrow" label="Sobtítulo" />
        <TextField name="title" label="Título" />
      </Section>
      <Section title="Diferenciais" defaultOpen={false}>
        {[0, 1, 2, 3].map((index) => (
          <div className="space-y-2 rounded-md border border-divider p-2" key={index}>
            <div className="text-xs font-medium">Diferencial {index + 1}</div>
            <ArrayItemField
              path={`items.${index}.icon`}
              label={`Ícone (${ICONS.join(', ')})`}
            />
            <ArrayItemField path={`items.${index}.title`} label="Título" />
            <ArrayItemField path={`items.${index}.text`} label="Texto" multiline />
          </div>
        ))}
      </Section>
    </div>
  );
}
