import { Editable, useWidgetSettings } from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';
import { SITE } from '../site.js';

type MetaItem = { id?: string; icon?: string; text?: string };

export default function HcLocation() {
  const settings = useWidgetSettings();
  const meta = Array.isArray(settings.meta) ? (settings.meta as MetaItem[]) : [];
  const mapsHref = String(settings.mapsHref || SITE.mapsUrl);
  const whatsappHref = String(settings.whatsappHref || SITE.whatsappHref);

  return (
    <section className="le-section le-section--soft">
      <div className="le-container le-location">
        <div>
          <span className="le-section__eyebrow">
            <Editable as="span" fieldPath="settings.eyebrow">
              {String(settings.eyebrow || '')}
            </Editable>
          </span>
          <h2 className="le-section-title">
            <Editable as="span" fieldPath="settings.title">
              {String(settings.title || '')}
            </Editable>
          </h2>
          <p className="le-muted">
            <Editable as="span" fieldPath="settings.address" multiline>
              {String(settings.address || '')}
            </Editable>
          </p>
          <div className="le-location__meta">
            {meta.map((item, index) => (
              <span key={item.id || index}>
                <HcIcon name={item.icon || 'pin'} />{' '}
                <Editable as="span" fieldPath={`settings.meta.${index}.text`}>
                  {String(item.text || '')}
                </Editable>
              </span>
            ))}
          </div>
          <div className="le-location__actions">
            <a
              className="le-btn le-btn-primary"
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
            >
              <Editable as="span" fieldPath="settings.mapsLabel">
                {String(settings.mapsLabel || '')}
              </Editable>{' '}
              <HcIcon name="arrow" />
            </a>
            <a
              className="le-btn le-whatsapp"
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
            >
              <Editable as="span" fieldPath="settings.whatsappLabel">
                {String(settings.whatsappLabel || '')}
              </Editable>
            </a>
          </div>
        </div>
        <div className="le-location__card">
          <div className="le-location__pin"><HcIcon name="pin" /></div>
          <strong>
            <Editable as="span" fieldPath="settings.cardTitle">
              {String(settings.cardTitle || '')}
            </Editable>
          </strong>
          <span>
            <Editable as="span" fieldPath="settings.cardLine1">
              {String(settings.cardLine1 || '')}
            </Editable>
          </span>
          <span>
            <Editable as="span" fieldPath="settings.cardLine2">
              {String(settings.cardLine2 || '')}
            </Editable>
          </span>
        </div>
      </div>
    </section>
  );
}
