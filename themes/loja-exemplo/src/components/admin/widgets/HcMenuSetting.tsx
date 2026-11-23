import { Section } from '@components/common/page-builder/index.js';
import React from 'react';
import { ArrayItemField, BooleanItemField } from './HcFields.js';

const LINK_COUNT = 6;

export default function HcMenuSetting() {
  return (
    <div className="space-y-3">
      <Section title="Links de navegação">
        <p className="text-[11px] text-muted-foreground">
          O menu mobile mostra todos os links. Desmarque “Mostrar no desktop”
          para esconder um link apenas no cabeçalho.
        </p>
        {Array.from({ length: LINK_COUNT }, (_, index) => (
          <div className="space-y-2 rounded-md border border-divider p-2" key={index}>
            <div className="text-xs font-medium">Link {index + 1}</div>
            <ArrayItemField path={`links.${index}.label`} label="Texto" />
            <ArrayItemField
              path={`links.${index}.href`}
              label="Endereço"
              hint="Ex.: /departamentos ou https://…"
            />
            <BooleanItemField
              path={`links.${index}.showInDesktop`}
              label="Mostrar no desktop"
            />
          </div>
        ))}
      </Section>
    </div>
  );
}
