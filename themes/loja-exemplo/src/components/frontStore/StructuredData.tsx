import React from 'react';
import { company } from './generated/company.js';

export function StructuredData() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: company.name,
    description: company.description,
    telephone: company.phone.display,
    email: company.publicEmail || undefined,
    url: company.domain,
    address: {
      '@type': 'PostalAddress',
      streetAddress: company.address.streetAddress,
      addressLocality: company.address.locality,
      addressRegion: company.address.region,
      postalCode: company.address.postalCode,
      addressCountry: company.address.country
    },
    openingHours: company.hours,
    sameAs: [company.facebook].filter(Boolean)
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
