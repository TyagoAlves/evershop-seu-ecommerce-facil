import React, { useEffect, useState } from 'react';

/**
 * JSON-LD da empresa ativa.
 *
 * O módulo gerado `./generated/company.js` é carregado de forma tolerante a
 * falha: ele é produzido por `company:render` e pode não existir em um checkout
 * limpo. Nesse caso, usamos um fallback neutro mínimo para não quebrar o build.
 */

interface CompanyAddress {
  streetAddress?: string | null;
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

interface CompanyPhone {
  display?: string | null;
  e164?: string | null;
}

interface CompanyLike {
  domain?: string | null;
  name?: string | null;
  shortName?: string | null;
  description?: string | null;
  city?: string | null;
  uf?: string | null;
  phone?: CompanyPhone | null;
  address?: CompanyAddress | null;
  hours?: string | null;
  mapsUrl?: string | null;
  placeId?: string | null;
  facebook?: string | null;
  publicEmail?: string | null;
  seo?: { description?: string | null } | null;
}

const FALLBACK_COMPANY: CompanyLike = {
  domain: 'https://lojaexemplo.com.br',
  name: 'Loja Exemplo',
  shortName: 'EXEMPLO',
  description:
    'E-commerce de exemplo com EverShop. Personalize manifesto, catálogo e conteúdo.',
  city: 'São Paulo',
  uf: 'SP',
  phone: { display: '(11) 4000-0000', e164: '+551140000000' },
  address: {
    streetAddress: 'Rua Exemplo, 100 - Centro',
    locality: 'São Paulo',
    region: 'SP',
    postalCode: '01000-000',
    country: 'BR'
  },
  hours: 'Seg a Sex, 8h às 18h',
  mapsUrl: null,
  placeId: null,
  facebook: null,
  publicEmail: 'contato@lojaexemplo.com.br'
};

const GENERATED_COMPANY_URL = new URL('./generated/company.js', import.meta.url).href;

let generatedCompanyPromise: Promise<CompanyLike | null> | null = null;

function loadGeneratedCompany(): Promise<CompanyLike | null> {
  if (!generatedCompanyPromise) {
    generatedCompanyPromise = import(/* webpackIgnore: true */ GENERATED_COMPANY_URL)
      .then((module) => {
        const candidate = module?.COMPANY ?? module?.default ?? module?.company;
        return candidate && typeof candidate === 'object' ? (candidate as CompanyLike) : null;
      })
      .catch(() => null);
  }
  return generatedCompanyPromise;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildJsonLd(company: CompanyLike): Record<string, unknown> | null {
  const domain = text(company.domain)?.replace(/\/+$/, '');
  const name = text(company.name);
  if (!domain || !name) return null;

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': `${domain}/#organization`,
    name,
    url: domain
  };

  const shortName = text(company.shortName);
  if (shortName) data.alternateName = shortName;

  const description = text(company.description) ?? text(company.seo?.description);
  if (description) data.description = description;

  const telephone = text(company.phone?.e164) ?? text(company.phone?.display);
  if (telephone) data.telephone = telephone;

  const email = text(company.publicEmail);
  if (email) data.email = email;

  const address = company.address;
  const postalAddress: Record<string, unknown> = { '@type': 'PostalAddress' };
  const streetAddress = text(address?.streetAddress);
  const locality = text(address?.locality) ?? text(company.city);
  const region = text(address?.region) ?? text(company.uf);
  const postalCode = text(address?.postalCode);
  const country = text(address?.country);

  if (streetAddress) postalAddress.streetAddress = streetAddress;
  if (locality) postalAddress.addressLocality = locality;
  if (region) postalAddress.addressRegion = region;
  if (postalCode) postalAddress.postalCode = postalCode;
  if (country) postalAddress.addressCountry = country;
  if (Object.keys(postalAddress).length > 1) data.address = postalAddress;

  const hours = text(company.hours);
  if (hours) data.openingHours = hours;

  const sameAs: string[] = [];
  const facebook = text(company.facebook);
  if (facebook) sameAs.push(facebook);
  if (sameAs.length > 0) data.sameAs = sameAs;

  const mapsUrl = text(company.mapsUrl);
  if (mapsUrl) data.hasMap = mapsUrl;

  const placeId = text(company.placeId);
  if (placeId) data.placeId = placeId;

  return data;
}

function serialize(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function StructuredData() {
  const [company, setCompany] = useState<CompanyLike>(FALLBACK_COMPANY);

  useEffect(() => {
    let active = true;
    loadGeneratedCompany().then((loaded) => {
      if (active && loaded) setCompany(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const data = buildJsonLd(company);
  const json = data ? serialize(data) : '';

  useEffect(() => {
    if (!json || typeof document === 'undefined') return;
    document
      .querySelectorAll('script[data-store-structured-data="true"]:not(#store-structured-data)')
      .forEach((node) => node.remove());
  }, [json]);

  if (!json) return null;

  return (
    <script
      id="store-structured-data"
      data-store-structured-data="true"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

export default StructuredData;
