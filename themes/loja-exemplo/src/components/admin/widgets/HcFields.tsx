import {
  drawerInputClass,
  drawerTextareaClass,
  Field,
  useScopedFormContext
} from '@components/common/page-builder/index.js';
import React from 'react';

export function TextField({
  name,
  label,
  hint,
  type = 'text'
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
}) {
  const { register } = useScopedFormContext();
  return (
    <Field label={label} hint={hint}>
      <input
        type={type}
        className={drawerInputClass}
        {...register(`settings.${name}`)}
      />
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  hint
}: {
  name: string;
  label: string;
  hint?: string;
}) {
  const { register } = useScopedFormContext();
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={3}
        className={drawerTextareaClass}
        {...register(`settings.${name}`)}
      />
    </Field>
  );
}

export function NumberField({
  name,
  label,
  hint,
  min = 1,
  max = 24,
  defaultValue
}: {
  name: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  defaultValue?: number;
}) {
  const { register, watch, setValue } = useScopedFormContext();
  const value = watch(`settings.${name}`);

  React.useEffect(() => {
    if (defaultValue === undefined) return;
    const empty =
      value === undefined || value === null || value === '' ||
      (typeof value === 'number' && Number.isNaN(value));
    if (empty) {
      setValue(`settings.${name}`, defaultValue);
    }
  }, [value, defaultValue, name, setValue]);

  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={min}
        max={max}
        className={drawerInputClass}
        {...register(`settings.${name}`, { valueAsNumber: true })}
      />
    </Field>
  );
}

export function BooleanItemField({
  path,
  label
}: {
  path: string;
  label: string;
}) {
  const { register } = useScopedFormContext();
  return (
    <Field label={label}>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" {...register(`settings.${path}`)} />
        Sim
      </label>
    </Field>
  );
}

export function ArrayItemField({
  path,
  label,
  hint,
  multiline = false
}: {
  path: string;
  label: string;
  hint?: string;
  multiline?: boolean;
}) {
  const { register } = useScopedFormContext();
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <textarea
          rows={2}
          className={drawerTextareaClass}
          {...register(`settings.${path}`)}
        />
      ) : (
        <input className={drawerInputClass} {...register(`settings.${path}`)} />
      )}
    </Field>
  );
}
