// Bundles src/handler.ts into dist/index.js and zips it into dist/function.zip.
// Lambda handler setting: index.handler (Node.js 20).
// The AWS SDK is bundled, not marked external: @aws-sdk/s3-request-presigner is not in the
// Lambda Node.js 20 runtime, and bundling all of @aws-sdk/* keeps client-s3, the presigner and
// their shared @smithy/* packages on the same versions as in package-lock.json.
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

const { metafile } = await build({
  entryPoints: [join(root, 'src', 'handler.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  metafile: true,
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

// Fail the build if the presigner or an SDK client was left out of the bundle.
const inputs = Object.keys(metafile.inputs).join('\n');
for (const pkg of ['client-s3', 's3-request-presigner', 'client-dynamodb', 'lib-dynamodb']) {
  if (!inputs.includes(`node_modules/@aws-sdk/${pkg}/`)) {
    throw new Error(`@aws-sdk/${pkg} is not bundled into dist/index.js`);
  }
}

const { size } = await stat(zipFile);
console.log(`Wrote ${zipFile} (${(size / 1024).toFixed(1)} KiB)`);
