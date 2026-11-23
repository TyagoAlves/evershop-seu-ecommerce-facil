import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from 'config';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// Vale para src/ e dist/: os dois ficam um nível abaixo da raiz da extensão.
const projectRoot = path.resolve(moduleDir, '..', '..', '..');
const generatedFile = path.join(projectRoot, 'config', 'generated', 'company.json');

function fromConfig(key, fallback = null) {
  try {
    return config.has(key) ? config.get(key) : fallback;
  } catch {
    return fallback;
  }
}

/** Manifesto gerado, ou null se ausente/inválido. */
export function readGeneratedCompany() {
  try {
    const parsed = JSON.parse(fs.readFileSync(generatedFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Artefato ainda não gerado; o chamador usa o fallback.
  }
  return null;
}

/** Dados efetivos: manifesto gerado sobreposto a valores reais já existentes na config. */
export function getCompanyData() {
  const generated = readGeneratedCompany();
  const logo = fromConfig('themeConfig.logo');
  const fallback = {
    domain: fromConfig('shop.homeUrl'),
    theme: fromConfig('system.theme'),
    name: logo && typeof logo === 'object' ? logo.alt ?? null : null,
    copyRight: fromConfig('themeConfig.copyRight')
  };
  return generated ? { ...fallback, ...generated } : fallback;
}
