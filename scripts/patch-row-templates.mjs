/**
 * Deixa os ícones de templates de linha do editor fáceis de ver no admin.
 *
 * O EverShop 2.4 renderiza o toolbar com SVGs cinza-claro (#949494), sem
 * moldura, tooltip ou rótulo, no fim do editor. Em telas menores ele fica
 * abaixo da área visível e parece "não aparecer".
 *
 * O patch é idempotente e reaplicado no postinstall:
 *  - aumenta o contraste dos SVGs;
 *  - transforma cada ícone em um botão com borda e hover;
 *  - adiciona title/aria-label em pt-BR;
 *  - move o toolbar para o topo da área de edição.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const marker = '/* row-templates-patch */';
const labelMarker = '/* row-templates-labels-v1 */';
const editorMarker = '/* row-templates-editor-patch */';
const reorderMarker = '/* row-templates-editor-reorder-v5 */';
const cssMarker = '/* row-templates-css-v4 */';
const legacyPrefix = '/* ' + 'hc-row-templates';
const legacyMarkers = [
  `${legacyPrefix}-patch */`,
  `${legacyPrefix}-labels-v1 */`,
  `${legacyPrefix}-editor-patch */`,
  `${legacyPrefix}-editor-reorder-v5 */`
];
const legacyCssMarkers = [
  `${legacyPrefix}-css */`,
  `${legacyPrefix}-css-v2 */`,
  `${legacyPrefix}-css-v3 */`,
  `${legacyPrefix}-css-v4 */`
];

const titles = `{
    '1': 'Uma coluna',
    '1:1': 'Duas colunas iguais',
    '1:2': 'Uma coluna estreita e duas largas',
    '2:1': 'Duas colunas largas e uma estreita',
    '2:3': 'Duas colunas com proporção 2:3',
    '3:2': 'Duas colunas com proporção 3:2',
    '1:1:1': 'Três colunas iguais',
    '1:2:1': 'Três colunas, a central maior'
  }`;

const labels = `{
    '1': '1 coluna',
    '1:1': '2 colunas',
    '1:2': '1 + 2',
    '2:1': '2 + 1',
    '2:3': '2 : 3',
    '3:2': '3 : 2',
    '1:1:1': '3 colunas',
    '1:2:1': '1+2+1'
  }`;

const readIfExists = (file) => {
  const target = path.resolve(process.cwd(), file);
  try {
    return { target, original: readFileSync(target, 'utf8') };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.log(`[row-templates] ignorado (ausente): ${file}`);
      return null;
    }
    throw err;
  }
};

const patchJs = (file, transform, markers = [marker]) => {
  const found = readIfExists(file);
  if (!found) return;
  const { target, original } = found;
  if ([...markers, ...legacyMarkers].some((item) => original.includes(item))) {
    console.log(`[row-templates] já aplicado: ${file}`);
    return;
  }

  const patched = transform(original);
  if (patched === original) {
    throw new Error(`[row-templates] não conseguiu patchar ${file}`);
  }
  writeFileSync(target, patched);
  console.log(`[row-templates] patch aplicado: ${file}`);
};

const patchReorder = (file, normalize) => {
  const found = readIfExists(file);
  if (!found) return;
  const { target, original } = found;
  if ([reorderMarker, ...legacyMarkers.filter((m) => m.includes('reorder'))].some((item) => original.includes(item))) {
    console.log(`[row-templates] reorder já aplicado: ${file}`);
    return;
  }

  const patched = normalize(original);
  if (!patched.includes(reorderMarker)) {
    throw new Error(`[row-templates] não conseguiu reordenar ${file}`);
  }
  writeFileSync(target, patched);
  console.log(`[row-templates] reorder aplicado: ${file}`);
};

/** Move o bloco compilado do toolbar para antes do DndContext. */
const normalizeJs = (source) => {
  const lines = source.split(/\r?\n/);
  let block = null;

  // Remove todas as cópias existentes (inclusive restos de patches antigos).
  for (;;) {
    const start = lines.findIndex((line) =>
      line.includes('rowtpl-shell flex justify-center')
    );
    if (start === -1) break;

    let end = start;
    while (end < lines.length && !lines[end].includes('React.createElement(RowTemplates')) {
      end += 1;
    }
    if (end >= lines.length) {
      throw new Error('[row-templates] bloco JS incompleto');
    }
    if (block === null) block = lines.slice(start, end + 1);
    lines.splice(start, end - start + 1);
  }
  if (block === null) {
    throw new Error('[row-templates] bloco JS do toolbar não encontrado');
  }

  const dnd = lines.findIndex((line) => line.includes('React.createElement(DndContext,'));
  if (dnd === -1) {
    throw new Error('[row-templates] DndContext não encontrado');
  }
  lines.splice(dnd, 0, ...block);

  let out = lines.join('\n');
  if (out.includes(editorMarker)) {
    out = out.replace(editorMarker, `${editorMarker}\n${reorderMarker}`);
  } else {
    out = `${reorderMarker}\n${out}`;
  }
  return out;
};

/** Move o bloco JSX do toolbar para antes do DndContext. */
const normalizeTsx = (source) => {
  const lines = source.split(/\r?\n/);
  let block = null;

  for (;;) {
    let start = lines.findIndex((line) =>
      line.includes('rowtpl-shell flex justify-center')
    );
    if (start === -1) break;

    // Inclui a abertura condicional e eventuais linhas em branco acima dela.
    while (start > 0) {
      const previous = lines[start - 1].trim();
      if (previous === '' || previous === '{columnToolbar && (') start -= 1;
      else break;
    }

    let end = start;
    let sawRowTemplate = false;
    let closes = 0;
    while (end < lines.length) {
      const trimmed = lines[end].trim();
      if (trimmed.includes('<RowTemplates')) sawRowTemplate = true;
      if (sawRowTemplate && trimmed === '</div>') closes += 1;
      if (sawRowTemplate && closes >= 2) {
        if (lines[end + 1]?.trim() === ')}') end += 1;
        break;
      }
      end += 1;
    }
    if (end >= lines.length) {
      throw new Error('[row-templates] bloco TSX incompleto');
    }
    if (block === null) {
      block = lines
        .slice(start, end + 1)
        .filter(
          (line, index, all) =>
            !(
              line.trim() === '' &&
              all[index - 1]?.trim() === '{columnToolbar && ('
            )
        );
    }
    lines.splice(start, end - start + 1);
  }
  if (block === null) {
    throw new Error('[row-templates] bloco TSX do toolbar não encontrado');
  }

  const dnd = lines.findIndex((line) => line.includes('<DndContext'));
  if (dnd === -1) {
    throw new Error('[row-templates] DndContext não encontrado no TSX');
  }
  lines.splice(dnd, 0, ...block);

  let out = lines.join('\n');
  if (out.includes(editorMarker)) {
    out = out.replace(editorMarker, `${editorMarker}\n${reorderMarker}`);
  } else {
    out = `${reorderMarker}\n${out}`;
  }
  return out;
};

patchJs(
  'node_modules/@evershop/evershop/dist/components/common/form/editor/RowTemplates.js',
  (source) => {
    let out = source.replace(
      'function RowTemplates({ addRow }) {',
      `${marker}\nfunction RowTemplates({ addRow }) {`
    );
    out = out.replace(
      '    };\n    return (React.createElement("div", { className: "row-templates',
      `    };\n    const templateTitles = ${titles};\n    return (React.createElement("div", { className: "row-templates`
    );
    out = out.replace(
      'React.createElement("a", { key: key, href: "#", onClick: (e) => {',
      'React.createElement("a", { key: key, href: "#", title: templateTitles[key], "aria-label": templateTitles[key], className: "rowtpl-btn", onClick: (e) => {'
    );
    out = out.replaceAll('fill: "#949494"', 'fill: "#475569"');
    return out;
  }
);

patchJs(
  'node_modules/@evershop/evershop/src/components/common/form/editor/RowTemplates.tsx',
  (source) => {
    let out = source.replace(
      'function RowTemplates({ addRow }: { addRow: (row: any) => void }) {',
      `${marker}\nfunction RowTemplates({ addRow }: { addRow: (row: any) => void }) {`
    );
    out = out.replace(
      '  };\n  return (\n    <div className="row-templates',
      `  };\n  const templateTitles: Record<string, string> = ${titles};\n  return (\n    <div className="row-templates`
    );
    out = out.replace(
      '        <a\n          key={key}\n          href="#"\n          onClick={(e) => {',
      '        <a\n          key={key}\n          href="#"\n          title={templateTitles[key]}\n          aria-label={templateTitles[key]}\n          className="rowtpl-btn"\n          onClick={(e) => {'
    );
    out = out.replaceAll('fill="#949494"', 'fill="#475569"');
    return out;
  }
);

patchJs(
  'node_modules/@evershop/evershop/dist/components/common/form/editor/RowTemplates.js',
  (source) => {
    let out = source.replace(
      '    return (React.createElement("div", { className: "row-templates',
      `    const templateLabels = ${labels};\n${labelMarker}\n    return (React.createElement("div", { className: "row-templates`
    );
    out = out.replace(
      'templates[key]()',
      'React.createElement(React.Fragment, null, templates[key](), React.createElement("span", { className: "rowtpl-btn__label" }, templateLabels[key]))'
    );
    return out;
  },
  [labelMarker]
);

patchJs(
  'node_modules/@evershop/evershop/src/components/common/form/editor/RowTemplates.tsx',
  (source) => {
    let out = source.replace(
      '  return (\n    <div className="row-templates',
      `  const templateLabels: Record<string, string> = ${labels};\n${labelMarker}\n  return (\n    <div className="row-templates`
    );
    out = out.replace(
      '          {templates[key]()}\n        </a>',
      '          {templates[key]()}\n          <span className="rowtpl-btn__label">{templateLabels[key]}</span>\n        </a>'
    );
    return out;
  },
  [labelMarker]
);

patchJs(
  'node_modules/@evershop/evershop/dist/components/common/form/Editor.js',
  (source) => {
    let out = source.replace(
      '    return (React.createElement(Field, { className: "editor form-field-container gap-2" },',
      `${editorMarker}\n    return (React.createElement(Field, { className: "editor form-field-container gap-2" },`
    );
    out = out.replace(
      'React.createElement("div", { className: "flex justify-center" },\n                React.createElement("div", { className: "flex justify-center flex-col mt-5" },',
      'React.createElement("div", { className: "rowtpl-shell flex justify-center" },\n                React.createElement("div", { className: "flex justify-center flex-col mt-5" },'
    );
    return out;
  },
  [editorMarker]
);

patchJs(
  'node_modules/@evershop/evershop/src/components/common/form/Editor.tsx',
  (source) => {
    let out = source.replace(
      'export const Editor: React.FC<EditorProps> = ({',
      `${editorMarker}\nexport const Editor: React.FC<EditorProps> = ({`
    );
    out = out.replace(
      '          <div className="flex justify-center">\n            <div className="flex justify-center flex-col mt-5">',
      '          <div className="rowtpl-shell flex justify-center">\n            <div className="flex justify-center flex-col mt-5">'
    );
    return out;
  },
  [editorMarker]
);

patchReorder(
  'node_modules/@evershop/evershop/dist/components/common/form/Editor.js',
  normalizeJs
);
patchReorder(
  'node_modules/@evershop/evershop/src/components/common/form/Editor.tsx',
  normalizeTsx
);

const cssFile = path.resolve(
  process.cwd(),
  'node_modules/@evershop/evershop/dist/modules/base/pages/admin/all/shadcn.css'
);
let css;
try { css = readFileSync(cssFile, 'utf8'); } catch (err) { if (err && err.code === 'ENOENT') { console.log('[row-templates] CSS ignorado (ausente)'); process.exit(0); } throw err; }
if ([cssMarker, ...legacyCssMarkers].some((item) => css.includes(item))) {
  console.log('[row-templates] CSS já aplicado');
} else {
  writeFileSync(
    cssFile,
    `${css}\n\n${cssMarker}\n.rowtpl-shell {\n  padding: 8px !important;\n  margin-bottom: 8px !important;\n  background: #ffffff !important;\n  border: 1px solid #e2e8f0 !important;\n  border-radius: 8px !important;\n  box-shadow: 0 1px 6px rgb(15 23 42 / 0.05) !important;\n}\n\n.rowtpl-btn {\n  display: inline-flex !important;\n  flex-direction: column !important;\n  align-items: center !important;\n  justify-content: center !important;\n  gap: 4px !important;\n  width: auto !important;\n  min-width: 66px !important;\n  height: auto !important;\n  padding: 6px 8px !important;\n  border: 1px solid #d7dee8 !important;\n  border-radius: 7px !important;\n  background: #ffffff !important;\n  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease !important;\n}\n\n.rowtpl-btn:hover,\n.rowtpl-btn:focus-visible {\n  border-color: #116dff !important;\n  background: #eef4ff !important;\n  transform: translateY(-1px);\n}\n\n.rowtpl-btn svg {\n  width: 28px !important;\n  height: 22px !important;\n  fill: #475569 !important;\n}\n\n.rowtpl-btn__label {\n  font-size: 11px !important;\n  font-weight: 600 !important;\n  line-height: 1 !important;\n  color: #475569 !important;\n  text-align: center !important;\n  white-space: nowrap !important;\n}\n\n.rowtpl-btn:hover .rowtpl-btn__label,\n.rowtpl-btn:focus-visible .rowtpl-btn__label {\n  color: #0b52d6 !important;\n}\n`
  );
  console.log('[row-templates] CSS aplicado');
}
