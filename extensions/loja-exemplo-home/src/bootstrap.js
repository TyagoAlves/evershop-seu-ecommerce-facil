import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerWidget } from '@evershop/evershop/lib/widget';

const distDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(distDir, '..');
const themeRoot = path.resolve(
  extensionRoot,
  '..',
  '..',
  'themes',
  'loja-exemplo',
  'dist',
  'components'
);

const GENERATED_WIDGETS_PATH = path.join(
  extensionRoot,
  'generated',
  'widgets.json'
);
const FALLBACK_WIDGETS_PATH = path.join(extensionRoot, 'widgets.json');

const widgetsPath = fs.existsSync(GENERATED_WIDGETS_PATH)
  ? GENERATED_WIDGETS_PATH
  : FALLBACK_WIDGETS_PATH;

const widgets = JSON.parse(fs.readFileSync(widgetsPath, 'utf8'));

const COMPONENTS = {
  hc_menu: ['HcMenu', 'HcMenuSetting'],
  hc_hero: ['HcHero', 'HcHeroSetting'],
  hc_departments: ['HcDepartments', 'HcDepartmentsSetting'],
  hc_featured_products: ['HcFeaturedProducts', 'HcFeaturedProductsSetting'],
  hc_differentials: ['HcDifferentials', 'HcDifferentialsSetting'],
  hc_cta: ['HcCta', 'HcCtaSetting'],
  hc_location: ['HcLocation', 'HcLocationSetting']
};

const stringField = { type: 'string' };
const nullableStringField = { type: ['string', 'null'] };
const booleanField = { type: 'boolean' };
const integerField = { type: 'integer', minimum: 1, maximum: 24 };
const percentField = { type: 'integer', minimum: 0, maximum: 100 };
const linkSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: stringField,
    label: stringField,
    href: stringField,
    showInDesktop: booleanField
  }
};
const statSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: stringField,
    value: stringField,
    label: stringField
  }
};
const diffSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: stringField,
    icon: stringField,
    title: stringField,
    text: stringField
  }
};
const metaSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: stringField,
    icon: stringField,
    text: stringField
  }
};

const SCHEMAS = {
  hc_menu: {
    type: 'object',
    additionalProperties: true,
    properties: {
      links: { type: 'array', items: linkSchema }
    }
  },
  hc_hero: {
    type: 'object',
    additionalProperties: true,
    properties: {
      backgroundImage: nullableStringField,
      backgroundOpacity: percentField,
      eyebrow: stringField,
      titleBefore: stringField,
      titleAccent: stringField,
      titleAfter: stringField,
      text: stringField,
      primaryLabel: stringField,
      primaryHref: stringField,
      secondaryLabel: stringField,
      secondaryHref: stringField,
      stats: { type: 'array', items: statSchema }
    }
  },
  hc_departments: {
    type: 'object',
    additionalProperties: true,
    properties: {
      eyebrow: stringField,
      title: stringField,
      description: stringField,
      linkLabel: stringField,
      linkHref: stringField,
      limit: integerField
    }
  },
  hc_featured_products: {
    type: 'object',
    additionalProperties: true,
    properties: {
      eyebrow: stringField,
      title: stringField,
      description: stringField,
      linkLabel: stringField,
      linkHref: stringField,
      limit: integerField
    }
  },
  hc_differentials: {
    type: 'object',
    additionalProperties: true,
    properties: {
      eyebrow: stringField,
      title: stringField,
      items: { type: 'array', items: diffSchema }
    }
  },
  hc_cta: {
    type: 'object',
    additionalProperties: true,
    properties: {
      eyebrow: stringField,
      title: stringField,
      text: stringField,
      buttonLabel: stringField,
      buttonHref: stringField
    }
  },
  hc_location: {
    type: 'object',
    additionalProperties: true,
    properties: {
      eyebrow: stringField,
      title: stringField,
      address: stringField,
      meta: { type: 'array', items: metaSchema },
      mapsLabel: stringField,
      mapsHref: stringField,
      whatsappLabel: stringField,
      whatsappHref: stringField,
      cardTitle: stringField,
      cardLine1: stringField,
      cardLine2: nullableStringField
    }
  }
};

export default function bootstrap() {
  const previewComponent = path.join(
    themeRoot,
    'admin',
    'widgets',
    'HcBlockPreview.js'
  );

  widgets.forEach((widget) => {
    const [componentName, settingName] = COMPONENTS[widget.type] || [];
    if (!componentName || !settingName) {
      throw new Error(`Componente do widget ${widget.type} não encontrado.`);
    }

    registerWidget({
      type: widget.type,
      name: widget.name,
      description: widget.description,
      category: widget.category,
      icon: widget.icon,
      enabled: true,
      defaultSettings: widget.settings,
      schema: SCHEMAS[widget.type],
      component: path.join(
        themeRoot,
        'frontStore',
        'widgets',
        `${componentName}.js`
      ),
      settingComponent: path.join(
        themeRoot,
        'admin',
        'widgets',
        `${settingName}.js`
      ),
      previewComponent
    });
  });
}
