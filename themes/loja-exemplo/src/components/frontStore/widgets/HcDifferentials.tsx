import { Editable, useWidgetSettings } from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';

type Differential = {
  id?: string;
  icon?: string;
  title?: string;
  text?: string;
};

export default function HcDifferentials() {
  const settings = useWidgetSettings();
  const items = Array.isArray(settings.items) ? (settings.items as Differential[]) : [];

  return (
    <section className="le-section">
      <div className="le-container">
        <div className="le-section__head">
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
          </div>
        </div>
        <div className="le-differentials">
          {items.map((item, index) => (
            <div className="le-differential" key={item.id || index}>
              <span className="le-differential__icon">
                <HcIcon name={item.icon || 'check'} />
              </span>
              <h3>
                <Editable as="span" fieldPath={`settings.items.${index}.title`}>
                  {String(item.title || '')}
                </Editable>
              </h3>
              <p>
                <Editable as="span" fieldPath={`settings.items.${index}.text`} multiline>
                  {String(item.text || '')}
                </Editable>
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
