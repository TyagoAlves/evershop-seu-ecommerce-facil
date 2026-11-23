import {
  Editable,
  useWidgetSettings
} from '@components/common/page-builder/index.js';
import React from 'react';
import { HcIcon } from '../HcIcon.js';

type MenuLink = {
  id?: string;
  label?: string;
  href?: string;
  showInDesktop?: boolean;
};

interface HcMenuProps {
  areaProps?: {
    variant?: 'desktop' | 'mobile';
    isOpen?: boolean;
    onNavigate?: () => void;
    [key: string]: unknown;
  };
}

function LinkLabel({
  index,
  label
}: {
  index: number;
  label: string;
}) {
  return (
    <Editable as="span" fieldPath={`settings.links.${index}.label`}>
      {label}
    </Editable>
  );
}

export default function HcMenu({ areaProps }: HcMenuProps) {
  const settings = useWidgetSettings();
  const links = Array.isArray(settings.links)
    ? (settings.links as MenuLink[])
    : [];
  const isMobile = areaProps?.variant === 'mobile';
  const isOpen = areaProps?.isOpen !== false;

  if (isMobile && !isOpen) return null;

  const renderLink = (link: MenuLink, index: number) => {
    const href = String(link.href || '').trim();
    if (!href && !String(link.label || '').trim()) return null;

    if (isMobile) {
      return (
        <a
          className="le-mobile-nav__link"
          href={href || '#'}
          key={link.id || index}
          onClick={() => areaProps?.onNavigate?.()}
        >
          <LinkLabel index={index} label={String(link.label || '')} />
          <HcIcon name="arrow" />
        </a>
      );
    }

    return (
      <a
        className="le-header__nav-link"
        href={href || '#'}
        key={link.id || index}
      >
        <LinkLabel index={index} label={String(link.label || '')} />
      </a>
    );
  };

  if (isMobile) {
    return (
      <React.Fragment>
        {links.map((link, index) => renderLink(link, index))}
      </React.Fragment>
    );
  }

  return (
    <nav aria-label="Menu principal" className="le-header__nav">
      {links.map((link, index) =>
        link.showInDesktop === false ? null : renderLink(link, index)
      )}
    </nav>
  );
}
