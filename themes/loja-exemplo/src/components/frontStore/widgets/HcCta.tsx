import { Editable, useWidgetSettings } from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { SITE } from '../site.js';

export default function HcCta() {
  const settings = useWidgetSettings();
  const href = String(settings.buttonHref || SITE.whatsappHref);

  return (
    <section className="le-cta">
      <div className="le-container le-cta__inner">
        <span className="le-eyebrow">
          <Editable as="span" fieldPath="settings.eyebrow">
            {String(settings.eyebrow || '')}
          </Editable>
        </span>
        <h2>
          <Editable as="span" fieldPath="settings.title">
            {String(settings.title || '')}
          </Editable>
        </h2>
        <p>
          <Editable as="span" fieldPath="settings.text" multiline>
            {String(settings.text || '')}
          </Editable>
        </p>
        <a
          className="le-btn le-whatsapp le-btn--lg"
          href={href}
          target={href.startsWith('http') ? '_blank' : undefined}
          rel={href.startsWith('http') ? 'noreferrer' : undefined}
        >
          <HcIcon name="check" />
          <Editable as="span" fieldPath="settings.buttonLabel">
            {String(settings.buttonLabel || '')}
          </Editable>
        </a>
      </div>
    </section>
  );
}
