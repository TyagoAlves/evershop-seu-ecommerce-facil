import React from 'react';
import { company } from './generated/company.js';

export function HcLogo({ className = '' }: { className?: string }) {
  return (
    <span className={['le-logo', className].filter(Boolean).join(' ')}>
      <span className="le-logo__name">{company.name.toUpperCase()}</span>
      <span className="le-logo__sub">{company.shortName}</span>
    </span>
  );
}
