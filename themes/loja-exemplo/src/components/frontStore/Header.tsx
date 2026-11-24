import Area from '@components/common/Area.js';
import { useAppState } from '@components/common/context/app.js';
import React, { useEffect, useState } from 'react';
import { company } from './generated/company.js';
import { HcIcon } from './HcIcon.js';
import { HcLogo } from './HcLogo.js';
import { NAV } from './site.js';

const SITE = {
  addressShort: company.address.short,
  hours: company.hours,
  phone: company.phone.display,
  phoneHref: `tel:${company.phone.e164}`,
  whatsappHref: `https://wa.me/${company.whatsapp.number}?text=${encodeURIComponent(company.whatsapp.defaultMessage)}`
};

function hasWidgetIn(areaId, widgets) {
  return Array.isArray(widgets) && widgets.some((w) => Array.isArray(w.areaId) && w.areaId.includes(areaId));
}

export function Header() {
  const [open, setOpen] = useState(false);
  const { widgets } = useAppState() || {};
  // O menu do manifesto é o padrão: Ele aparece quando nenhum widget de menu
  // foi posicionado na área global do cabeçalho. Assim o site nunca fica sem nav.
  const hasDesktopMenu = hasWidgetIn('headerMenuDesktop', widgets);
  const hasMobileMenu = hasWidgetIn('headerMenuMobile', widgets);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className="le-header">
      <div className="le-header__top">
        <div className="le-container le-header__top-inner">
          <span className="le-header__top-item">
            <HcIcon name="pin" />
            {SITE.addressShort}
          </span>
          <span className="le-header__top-item">
            <HcIcon name="clock" />
            {SITE.hours}
          </span>
          <a className="le-header__top-item le-header__top-link" href={SITE.phoneHref}>
            <HcIcon name="phone" />
            {SITE.phone}
          </a>
        </div>
      </div>

      <div className="le-header__main">
        <div className="le-container le-header__inner">
          <HcLogo />

          <div className="le-header__nav-slot">
            {!hasDesktopMenu && NAV.length ? (
              <nav aria-label="Menu principal" className="le-header__nav">
                {NAV.map((item) => (
                  <a key={item.href || item.label} className="le-header__nav-link" href={item.href || '#'}>
                    {item.label}
                  </a>
                ))}
              </nav>
            ) : null}
            <Area
              id="headerMenuDesktop"
              noOuter
              isGlobal
              editableInPageBuilder
              variant="desktop"
            />
          </div>

          <div className="le-header__actions">
            <Area
              id="headerMiddleRight"
              className="le-header__tools"
              isGlobal
              editableInPageBuilder
            />
            <a className="le-btn le-whatsapp le-header__cta" href={SITE.whatsappHref} target="_blank" rel="noreferrer">
              <HcIcon name="whatsapp" />
              <span>Solicitar orçamento</span>
            </a>
            <button
              aria-expanded={open}
              aria-label={open ? 'Fechar menu' : 'Abrir menu'}
              className="le-header__menu-button"
              onClick={() => setOpen(!open)}
              type="button"
            >
              <HcIcon name={open ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <nav aria-label="Menu mobile" className="le-mobile-nav">
          <div className="le-container le-mobile-nav__inner">
            {!hasMobileMenu && NAV.length ? (
              <React.Fragment>
                {NAV.map((item) => (
                  <a
                    key={item.href || item.label}
                    className="le-mobile-nav__link"
                    href={item.href || '#'}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                    <HcIcon name="arrow" />
                  </a>
                ))}
              </React.Fragment>
            ) : null}
            <Area
              id="headerMenuMobile"
              noOuter
              isGlobal
              editableInPageBuilder
              variant="mobile"
              isOpen={open}
              onNavigate={() => setOpen(false)}
            />
            <a className="le-btn le-whatsapp le-mobile-nav__cta" href={SITE.whatsappHref} target="_blank" rel="noreferrer">
              <HcIcon name="whatsapp" />
              Falar no WhatsApp
            </a>
            <p className="le-mobile-nav__meta">{SITE.hours}</p>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
