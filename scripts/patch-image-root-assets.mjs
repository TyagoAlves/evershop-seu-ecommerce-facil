/**
 * O admin do EverShop 2.4 pede assets como `/favicon.svg`, mas o otimizador
 * `/images` só aceita caminhos começando com `media/`, `public/` ou
 * `themes/<tema>/public/`. Além disso, no Windows `path.normalize('/favicon.svg')`
 * devolve `\favicon.svg`, deixando uma barra inicial após a conversão para `/`,
 * e o código original sobrescrevia o caminho resolvido com `src = normalizedPath`.
 *
 * Este patch:
 *  - remove barras iniciais residuais do normalizedPath;
 *  - resolve assets da raiz contra `public/` e `themes/<tema>/public/`;
 *  - preserva o caminho resolvido até a leitura do arquivo.
 *
 * Idempotente e reaplicado no `postinstall`.
 */
import { readFile, writeFile } from 'fs/promises';

const file = new URL(
  '../node_modules/@evershop/evershop/dist/modules/cms/services/imageProcessor.js',
  import.meta.url
);

const marker = 'Root-level assets (e.g. `/favicon.svg`';
let source = await readFile(file, 'utf8');

if (source.includes(marker) && source.includes('src = relativePath;')) {
  console.log('Patch image-root-assets já aplicado.');
} else {
  const blockPattern = /(        \/\/ Now continue with regular path validation\n)[\s\S]*?(        src = normalizedPath;\n)/;
  const match = source.match(blockPattern);
  if (!match) {
    throw new Error('Não foi possível localizar o bloco de validação em imageProcessor.js');
  }

  const replacement = `        // Now continue with regular path validation
        // Remove leading slash if present for consistent handling
        const normalized = path.normalize(src);
        const cleanPath = normalized.startsWith('/')
            ? normalized.substring(1)
            : normalized;
        // Normalize to forward slashes and strip any remaining leading separators.
        // On Windows \`path.normalize('/favicon.svg')\` returns '\\\\favicon.svg', so the
        // slash conversion alone would leave a leading '/' and break the allowlist.
        const normalizedPath = cleanPath.replace(/\\\\/g, '/').replace(/^\\/+/, '');
        // Prevent directory traversal attacks
        if (normalizedPath.includes('..') || normalizedPath.includes('\\0')) {
            throw new Error('Invalid characters in image path');
        }
        // Only allow specific directories from project root
        const allowedPaths = ['media/', 'public/'];
        // Only allow the currently active theme's public directory (if any),
        // not all existing theme folders.
        if (activeTheme) {
            allowedPaths.push(\`themes/\${activeTheme}/public/\`);
        }
        let isAllowedPath = allowedPaths.some((allowedPath) => normalizedPath.startsWith(allowedPath));
        let relativePath = normalizedPath;
        // Root-level assets (e.g. \`/favicon.svg\`, requested by the admin UI) are served
        // from \`public/\` or the active theme's \`public/\` directory, but the directory
        // allowlist only accepts explicit prefixes. Resolve them against those roots
        // when the file actually exists.
        if (!isAllowedPath) {
            const candidates = [];
            if (activeTheme) {
                candidates.push(\`themes/\${activeTheme}/public/\${normalizedPath}\`);
            }
            candidates.push(\`public/\${normalizedPath}\`);
            for (const candidate of candidates) {
                try {
                    await fs.access(path.join(CONSTANTS.ROOTPATH, candidate));
                    relativePath = candidate;
                    isAllowedPath = true;
                    break;
                }
                catch (_e) {
                    // Try the next root.
                }
            }
        }
        if (!isAllowedPath) {
            throw new Error('Image source must be from media/, public/, or themes/<themename>/public/ directories at project root');
        }
        // Update src to use the resolved relative path (keep it relative to project root)
        src = relativePath;
`;

  await writeFile(file, source.replace(blockPattern, replacement), 'utf8');
  console.log('Patch image-root-assets aplicado.');
}
