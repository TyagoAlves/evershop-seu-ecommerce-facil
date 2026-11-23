import React from 'react';
import { company } from './generated/company.js';

export function HcLogo({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <a
      href="/"
      aria-label={company.name}
      className={['le-logo', light ? 'le-logo--light' : '', className].filter(Boolean).join(' ')}
    >
      <span className="le-logo__name">{company.name.toUpperCase()}</span>
      <span className="le-logo__sub">{company.shortName}</span>
    </a>
  );
}
