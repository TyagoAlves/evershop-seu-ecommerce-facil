import { company } from './generated/company.js';

export const site = {
  name: company.name,
  shortName: company.shortName,
  domain: company.domain,
  phone: company.phone,
  whatsapp: company.whatsapp,
  address: company.address,
  hours: company.hours,
  mapsUrl: company.mapsUrl,
  email: company.publicEmail,
  socials: {
    facebook: company.facebook
  }
} as const;
