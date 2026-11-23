/**
 * EverShop 2.4.0 usa `localFile.split('/').pop()` para extrair o nome do
 * arquivo de imagem do seed. No Windows o caminho gerado por `path.join`
 * usa `\\`, então o "nome" vira o caminho absoluto inteiro e o upload falha.
 * Este patch é idempotente e reaplicado no postinstall.
 */
import { readFile, writeFile } from 'fs/promises';

const file = new URL(
  '../node_modules/@evershop/evershop/dist/bin/seed/seedImages.js',
  import.meta.url
);

let source = await readFile(file, 'utf8');
let changed = false;

if (!source.includes("import { basename, join } from 'path';")) {
  source = source.replace(
    "import { join } from 'path';",
    "import { basename, join } from 'path';"
  );
  changed = true;
}

if (source.includes("localFile.split('/').pop()")) {
  source = source.replaceAll(
    "localFile.split('/').pop()",
    'basename(localFile)'
  );
  changed = true;
}

if (changed) {
  await writeFile(file, source, 'utf8');
  console.log('Patch Windows aplicado em seedImages.js');
} else {
  console.log('Patch Windows já aplicado em seedImages.js');
}

// No Windows o `swc --strip-leading-paths` não produz saída alguma quando
// recebe caminhos absolutos (o comportamento padrão do EverShop 2.4.0).
// Também serializamos as compilações por `distPath`, porque o watcher dispara
// várias compilações concorrentes para o mesmo tema.
const compileFile = new URL(
  '../node_modules/@evershop/evershop/dist/bin/lib/watch/compileSwc.js',
  import.meta.url
);
let compileSource = await readFile(compileFile, 'utf8');
const PATCH_MARKER = '// PATCH-WINDOWS: compileSwc serializado';
const LEGACY_PATCH_MARKERS = ['// PATCH-WINDOWS-' + 'HIDRO: compileSwc serializado'];

{
  const markerIndex = [PATCH_MARKER, ...LEGACY_PATCH_MARKERS]
    .map((marker) => compileSource.indexOf(marker))
    .find((index) => index !== -1) ?? -1;
  const start =
    markerIndex !== -1
      ? markerIndex
      : compileSource.indexOf('export async function compileSwc(srcPath, distPath) {');
  const end = compileSource.indexOf('//# sourceMappingURL=');
  if (start === -1 || end === -1) {
    throw new Error('Não foi localizada a função compileSwc para patch');
  }

  const patchedFunction = `${PATCH_MARKER}
const compileQueues = new Map();

function serializeByDist(distPath, task) {
  const previous = compileQueues.get(distPath) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  compileQueues.set(distPath, current);
  current.finally(() => {
    if (compileQueues.get(distPath) === current) compileQueues.delete(distPath);
  });
  return current;
}

export async function compileSwc(srcPath, distPath) {
  return serializeByDist(distPath, () => compileSwcUnlocked(srcPath, distPath));
}

async function compileSwcUnlocked(srcPath, distPath) {
  if (!fs.existsSync(srcPath)) {
    warning(\`Source path \${srcPath} does not exist.\`);
    return;
  }

  const configFile = path.resolve(CONSTANTS.LIBPATH, '../../.swcrc');
  const cwd = path.resolve(srcPath, '..');
  const execaOptions = { cwd, preferLocal: true, localDir: cwd };
  const isDirectory = fs.statSync(srcPath).isDirectory();

  // No Windows, caminhos ABSOLUTOS com --strip-leading-paths fazem o SWC
  // gerar zero arquivos. Caminhos relativos ao cwd funcionam corretamente.
  const relativeSrc = path.relative(cwd, srcPath);
  const relativeDist = path.relative(cwd, distPath);

  if (!isDirectory && !['.ts', '.js', '.tsx', '.jsx'].includes(path.extname(srcPath))) {
    try {
      await fsp.mkdir(path.dirname(distPath), { recursive: true });
      await fsp.copyFile(srcPath, distPath);
    } catch (err) {
      error(\`Error copying \${srcPath} to \${distPath}:\`);
      throw err;
    }
    return;
  }

  try {
    // O SWC grava cada arquivo diretamente em distPath; ele não apaga o
    // diretório antes, então não há rename de pasta (que falha no Windows
    // quando outra compilação do watcher está usando o mesmo destino).
    const args = isDirectory
      ? [relativeSrc, '-d', relativeDist, '--config-file', configFile, '--strip-leading-paths', '--copy-files']
      : [relativeSrc, '-o', relativeDist, '--config-file', configFile, '--strip-leading-paths'];
    await execa('swc', args, execaOptions);
  } catch (err) {
    error(\`Error compiling \${srcPath}:\`);
    throw err;
  }
}
`;

  const nextSource =
    compileSource.slice(0, start) + patchedFunction + '\n' + compileSource.slice(end);
  if (nextSource !== compileSource) {
    await writeFile(compileFile, nextSource, 'utf8');
    console.log('Patch Windows aplicado em compileSwc.js');
  } else {
    console.log('Patch Windows já aplicado em compileSwc.js');
  }
}
