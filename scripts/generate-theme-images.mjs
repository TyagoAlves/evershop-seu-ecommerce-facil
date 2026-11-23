import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const outDir = path.resolve(
  'themes/loja-exemplo/public/images'
);
await mkdir(outDir, { recursive: true });

const icons = {
  droplet: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  paint: '<path d="M4 5h13v5H4z"/><path d="M7 10v8a2 2 0 0 0 4 0v-8"/><path d="M17 7h3v4h-3z"/>',
  toolbox: '<path d="M3 9h18v11H3z"/><path d="M9 9V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/><path d="M3 14h18"/>',
  wrench: '<path d="M21 4a6 6 0 0 1-8 8L5 20l-1-1 8-8a6 6 0 0 1 8-8l-4 4 2 2 3-5z"/>',
  house: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.4 1 2.5h6c0-1.1.3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  checklist: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="m3 6 2 2 3-3"/><path d="m3 12 2 2 3-3"/><path d="m3 18 2 2 3-3"/>'
};

const palettes = {
  hidraulica: ['#0c1f4d', '#116dff'],
  eletrica: ['#0b1e3d', '#3a6bff'],
  tintas: ['#101f45', '#5f8dff'],
  ferragens: ['#0d2340', '#0b52d6'],
  ferramentas: ['#101a35', '#3a6bff'],
  materiais: ['#0f203f', '#116dff'],
  coberturas: ['#0a1c3a', '#0f42a8'],
  iluminacao: ['#12204a', '#5f8dff'],
  orcamento: ['#0c1f4d', '#116dff'],
  obras: ['#101f45', '#3a6bff']
};

const items = [
  ['categoria-hidraulica', 'Hidráulica', 'droplet', 'hidraulica'],
  ['categoria-eletrica', 'Elétrica', 'bolt', 'eletrica'],
  ['categoria-tintas', 'Tintas', 'paint', 'tintas'],
  ['categoria-ferragens', 'Ferragens', 'toolbox', 'ferragens'],
  ['categoria-ferramentas', 'Ferramentas', 'wrench', 'ferramentas'],
  ['categoria-materiais', 'Materiais', 'house', 'materiais'],
  ['categoria-coberturas', 'Coberturas', 'layers', 'coberturas'],
  ['categoria-iluminacao', 'Iluminação', 'bulb', 'iluminacao'],
  ['categoria-orcamento', 'Orçamento', 'truck', 'orcamento'],
  ['produto-hidraulica', 'Linha hidráulica', 'droplet', 'hidraulica'],
  ['produto-eletrica', 'Linha elétrica', 'bolt', 'eletrica'],
  ['produto-tintas', 'Tintas e acabamento', 'paint', 'tintas'],
  ['produto-ferragens', 'Ferragens', 'toolbox', 'ferragens'],
  ['produto-ferramentas', 'Ferramentas', 'wrench', 'ferramentas'],
  ['produto-materiais', 'Materiais e coberturas', 'house', 'materiais'],
  ['produto-orcamento', 'Solicitar orçamento', 'checklist', 'orcamento'],
  ['blog-hidraulica', 'Hidráulica', 'droplet', 'hidraulica'],
  ['blog-eletrica', 'Elétrica', 'bolt', 'eletrica'],
  ['blog-tintas', 'Tintas', 'paint', 'tintas'],
  ['blog-obras', 'Obras', 'house', 'obras'],
  ['blog-coberturas', 'Coberturas', 'layers', 'coberturas'],
  ['blog-ferramentas', 'Ferramentas', 'wrench', 'ferramentas']
];

for (const [name, label, iconKey, paletteKey] of items) {
  const [dark, light] = palettes[paletteKey];
  const icon = icons[iconKey];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${dark}"/>
      <stop offset="1" stop-color="${light}"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".06"/>
    </pattern>
  </defs>
  <rect width="800" height="800" fill="url(#g)"/>
  <rect width="800" height="800" fill="url(#grid)"/>
  <circle cx="400" cy="340" r="150" fill="#fff" fill-opacity=".08"/>
  <g transform="translate(304 244) scale(8)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    ${icon}
  </g>
  <text x="400" y="590" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#fff">${label}</text>
  <text x="400" y="640" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" letter-spacing="5" fill="#bfd3ff">EXEMPLO</text>
</svg>
`;
  await writeFile(path.join(outDir, `${name}.svg`), svg, 'utf8');
}

console.log(`Gerados ${items.length} SVGs em ${outDir}`);
