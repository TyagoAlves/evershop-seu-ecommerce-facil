import { Editable, useWidgetSettings } from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { SITE } from '../site.js';

type Stat = { id?: string; value?: string; label?: string };

export default function HcHero() {
  const settings = useWidgetSettings();
  const stats = Array.isArray(settings.stats) ? (settings.stats as Stat[]) : [];
  const primaryHref = String(settings.primaryHref || SITE.whatsappHref);
  const secondaryHref = String(settings.secondaryHref || '/products');
  const backgroundImage = String(settings.backgroundImage || '').trim();
  const opacityValue = Number(settings.backgroundOpacity);
  const backgroundOpacity = Number.isFinite(opacityValue) ? opacityValue : 45;

  const bgStyle: React.CSSProperties = { opacity: backgroundOpacity / 100 };
  if (backgroundImage) {
    bgStyle.backgroundImage = `url("${backgroundImage}")`;
    bgStyle.backgroundPosition = 'center';
    bgStyle.backgroundSize = 'cover';
    bgStyle.backgroundRepeat = 'no-repeat';
  }

  return (
    <section className="le-hero">
      <div className="le-hero__bg" style={bgStyle} />
      <div className="le-hero__glow" />
      <div className="le-container le-hero__inner">
        <span className="le-eyebrow">
          <HcIcon name="pin" />
          <Editable as="span" fieldPath="settings.eyebrow">
            {String(settings.eyebrow || '')}
          </Editable>
        </span>
        <h1 className="le-hero__title">
          <Editable as="span" fieldPath="settings.titleBefore">
            {String(settings.titleBefore || '')}
          </Editable>{' '}
          <span>
            <Editable as="span" fieldPath="settings.titleAccent">
              {String(settings.titleAccent || '')}
            </Editable>
          </span>
          <Editable as="span" fieldPath="settings.titleAfter">
            {String(settings.titleAfter || '')}
          </Editable>
        </h1>
        <p className="le-hero__text">
          <Editable as="span" fieldPath="settings.text" multiline>
            {String(settings.text || '')}
          </Editable>
        </p>
        <div className="le-hero__actions">
          <a
            className="le-btn le-whatsapp le-btn--lg"
            href={primaryHref}
            target={primaryHref.startsWith('http') ? '_blank' : undefined}
            rel={primaryHref.startsWith('http') ? 'noreferrer' : undefined}
          >
            <HcIcon name="check" />
            <Editable as="span" fieldPath="settings.primaryLabel">
              {String(settings.primaryLabel || '')}
            </Editable>
          </a>
          <a className="le-btn le-btn-secondary le-btn--lg" href={secondaryHref}>
            <Editable as="span" fieldPath="settings.secondaryLabel">
              {String(settings.secondaryLabel || '')}
            </Editable>
            <HcIcon name="arrow" />
          </a>
        </div>
        <div className="le-hero__stats">
          {stats.map((stat, index) => (
            <div className="le-hero__stat" key={stat.id || index}>
              <strong>
                <Editable as="span" fieldPath={`settings.stats.${index}.value`}>
                  {String(stat.value || '')}
                </Editable>
              </strong>
              <span>
                <Editable as="span" fieldPath={`settings.stats.${index}.label`}>
                  {String(stat.label || '')}
                </Editable>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
