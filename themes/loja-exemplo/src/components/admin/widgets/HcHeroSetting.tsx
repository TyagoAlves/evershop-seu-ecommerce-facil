import {
  Field,
  ImagePickerField,
  Section,
  useScopedFormContext
} from '@components/common/page-builder/index.js';
import React from 'react';
import { ArrayItemField, NumberField, TextAreaField, TextField } from './HcFields.js';

export default function HcHeroSetting() {
  const { watch, setValue } = useScopedFormContext();
  const backgroundImage = String(watch('settings.backgroundImage') || '');

  return (
    <div className="space-y-3">
      <Section title="Imagem de fundo">
        <Field
          label="Imagem"
          hint="Escolha na biblioteca de mídia. Deixe vazio para usar o fundo padrão escuro com o brilho azul."
        >
          <ImagePickerField
            value={backgroundImage}
            onChange={(next) =>
              setValue('settings.backgroundImage', next || null, {
                shouldDirty: true
              })
            }
            selectLabel="Selecionar imagem"
            replaceLabel="Trocar imagem"
            clearLabel="Remover"
          />
        </Field>
        <NumberField
          name="backgroundOpacity"
          label="Opacidade da imagem (%)"
          hint="Padrão: 45. Aumente para fotos (60–85) e reduza para imagens muito claras."
          min={0}
          max={100}
          defaultValue={45}
        />
      </Section>
      <Section title="Texto principal">
        <TextField name="eyebrow" label="Sobtítulo" />
        <TextField name="titleBefore" label="Título – antes do destaque" />
        <TextField name="titleAccent" label="Título – destaque azul" />
        <TextField name="titleAfter" label="Título – depois do destaque" />
        <TextAreaField name="text" label="Descrição" />
      </Section>
      <Section title="Botões">
        <TextField name="primaryLabel" label="Texto do botão principal" />
        <TextField name="primaryHref" label="Link do botão principal" />
        <TextField name="secondaryLabel" label="Texto do botão secundário" />
        <TextField name="secondaryHref" label="Link do botão secundário" />
      </Section>
      <Section title="Indicadores">
        {[0, 1, 2, 3].map((index) => (
          <div className="space-y-2 rounded-md border border-divider p-2" key={index}>
            <div className="text-xs font-medium">Indicador {index + 1}</div>
            <ArrayItemField path={`stats.${index}.value`} label="Valor" />
            <ArrayItemField path={`stats.${index}.label`} label="Legenda" />
          </div>
        ))}
      </Section>
    </div>
  );
}
