/**
 * No EverShop 2.4.0 o `build/index.js` declara `import config from 'config'`
 * antes de `import './initEnvBuild.js'`. Como imports ESM são avaliados na ordem
 * das declarações, o `node-config` congela a configuração antes de
 * `ALLOW_CONFIG_MUTATIONS=true` e o bootstrap do catálogo falha ao registrar
 * `crossSell`. Este patch move a inicialização do ambiente para o topo.
 * Idempotente e reaplicado no `postinstall`.
 */
import { readFile, writeFile } from 'fs/promises';

const file = new URL(
  '../node_modules/@evershop/evershop/dist/bin/build/index.js',
  import.meta.url
);

let source = await readFile(file, 'utf8');
const nl = source.includes('\r\n') ? '\r\n' : '\n';
const lines = source.split(/\r?\n/);
const target = "import './initEnvBuild.js';";
const index = lines.findIndex((line) => line.trim() === target);

if (index > 0) {
  lines.splice(index, 1);
  lines.unshift(target);
  source = lines.join(nl);
  await writeFile(file, source, 'utf8');
  console.log('Patch build-env aplicado: initEnvBuild movido para o topo.');
} else {
  console.log('Patch build-env já aplicado.');
}
