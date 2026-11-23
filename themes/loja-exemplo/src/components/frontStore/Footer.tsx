import React from 'react';
import { company } from './generated/company.js';
import { HcIcon } from './HcIcon.js';
import { HcLogo } from './HcLogo.js';

interface FooterProps {
  copyRight?: string;
  showPoweredBy?: boolean;
}

const SITE = {
  address: company.address.full,
  hours: company.hours,
  mapsUrl: company.mapsUrl,
  phone: company.phone.display,
  phoneHref: `tel:${company.phone.e164}`,
  whatsapp: company.whatsapp.display,
  whatsappHref: `https://wa.me/${company.whatsapp.number}?text=${encodeURIComponent(company.whatsapp.defaultMessage)}`,
  facebook: company.facebook
};

export function Footer({ copyRight }: FooterProps) {
  const ratingText = company.rating
    ? `${company.rating.value} no Google · ${company.rating.reviews} ${company.rating.reviews === 1 ? 'avaliação' : 'avaliações'}`
    : null;

  return (
    <footer className="le-footer">
      <div className="le-container le-footer__grid">
        <div className="le-footer__brand">
          <div className="le-footer__logo">
            <HcLogo light />
          </div>
          <p>
            {company.description}
          </p>
          <a className="le-btn le-whatsapp" href={SITE.whatsappHref} target="_blank" rel="noreferrer">
            <HcIcon name="check" />
            Falar no WhatsApp
          </a>
        </div>

        <div className="le-footer__column">
          <h3>Navegação</h3>
          <ul>
            {company.nav.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </div>

        <div className="le-footer__column">
          <h3>Contato</h3>
          <ul>
            <li>
              <HcIcon name="check" />
              <a href={SITE.whatsappHref} target="_blank" rel="noreferrer">
                WhatsApp: {SITE.whatsapp}
              </a>
            </li>
            <li>
              <HcIcon name="phone" />
              <a href={SITE.phoneHref}>{SITE.phone}</a>
            </li>
            <li>
              <HcIcon name="pin" />
              <a href={SITE.mapsUrl} target="_blank" rel="noreferrer">
                Ver no Google Maps
              </a>
            </li>
            {SITE.facebook ? (
              <li>
                <HcIcon name="arrow" />
                <a href={SITE.facebook} target="_blank" rel="noreferrer">
                  Facebook
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="le-footer__column">
          <h3>Onde estamos</h3>
          <p className="le-footer__address">{SITE.address}</p>
          <p className="le-footer__hours">
            <HcIcon name="clock" />
            {SITE.hours}
          </p>
          {ratingText ? (
            <p className="le-footer__rating">
              <HcIcon name="star" />
              {ratingText}
            </p>
          ) : null}
        </div>
      </div>

      <div className="le-footer__bottom">
        <div className="le-container">
          {copyRight || `© 2026 ${company.name}. Todos os direitos reservados.`}
        </div>
      </div>
    </footer>
  );
}
