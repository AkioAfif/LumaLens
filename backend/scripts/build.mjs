// Bundles src/handler.ts into dist/index.js and zips it into dist/function.zip.
// Lambda handler setting: index.handler (Node.js 20). @aws-sdk/* is provided by the runtime.
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const outFile = join(distDir, 'index.js');
const zipFile = join(distDir, 'function.zip');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'handler.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@aws-sdk/*'],
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

await new Promise((resolve, reject) => {
  const output = createWriteStream(zipFile);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  output.on('close', resolve);
  archive.on('error', reject);
  archive.pipe(output);
  archive.file(outFile, { name: 'index.js' });
  archive.finalize();
});

const { size } = await stat(zipFile);
console.log(`Wrote ${zipFile} (${(size / 1024).toFixed(1)} KiB)`);
