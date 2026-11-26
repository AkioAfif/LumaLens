// Runs the full CRUD cycle against the deployed API and saves the transcript as evidence.
//
// Usage (PowerShell):
//   $env:LUMALENS_API_URL = "https://<url-id>.lambda-url.us-east-1.on.aws"   (or an API Gateway invoke URL)
//   $env:LUMALENS_KEY = "<the key set on the Lambda>"
//   npm run test:crud                     # writes docs/evidence/crud-test.txt
//   node scripts/test-crud.mjs --out <path>
//   node scripts/test-crud.mjs --keep     # stop before DELETE so the item stays in the table
//   node scripts/test-crud.mjs --uploads  # also test POST /uploads + presigned S3 PUTs
//                                         # (or set LUMALENS_TEST_UPLOADS=1)
//
// Expected: 401 without key, POST 201, GET 200, GET list 200, PUT 200 (status fixed),
// DELETE 204, GET 404. Exits with code 1 if any step returns a different status.
//
// With --uploads, a second bug is created and: POST /uploads 201 (screenshot and log),
// S3 PUT 200 for each, PUT /bugs/{id} 200 with screenshotKey/logKey, GET 200 showing both keys.
// That bug and its two S3 objects are left in place for the evidence screenshots.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const outFile = outArg > -1 && process.argv[outArg + 1]
  ? resolve(process.argv[outArg + 1])
  : join(root, 'docs', 'evidence', 'crud-test.txt');

const keep = process.argv.includes('--keep');
const uploads = process.argv.includes('--uploads') || process.env.LUMALENS_TEST_UPLOADS === '1';
const baseUrl = (process.env.LUMALENS_API_URL ?? '').replace(/\/+$/, '');
const apiKey = process.env.LUMALENS_KEY ?? '';
if (!baseUrl || !apiKey) {
  console.error('Set LUMALENS_API_URL and LUMALENS_KEY first (see the comment at the top of this file).');
  process.exit(2);
}

const lines = [];
const log = (line = '') => {
  console.log(line);
  lines.push(line);
};

let failures = 0;

async function step(label, method, path, { body, withKey = true, expect, mask = (v) => v }) {
  const headers = { 'content-type': 'application/json' };
  if (withKey) headers['x-lumalens-key'] = apiKey;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const pass = res.status === expect;
  if (!pass) failures += 1;

  log(`### ${label}`);
  log(`> ${method} ${path}${withKey ? '  (x-lumalens-key: ***)' : '  (no x-lumalens-key header)'}`);
  if (body !== undefined) log(`> ${JSON.stringify(body)}`);
  log(`< HTTP ${res.status}  [expected ${expect}: ${pass ? 'PASS' : 'FAIL'}]`);
  let parsed;
  if (text) {
    try {
      parsed = JSON.parse(text);
      log(JSON.stringify(mask(parsed), null, 2));
    } catch {
      log(text);
    }
  }
  log();
  return parsed;
}

log('LumaLens CRUD test');
log(`Date (UTC): ${new Date().toISOString()}`);
log(`API: ${baseUrl}`);
log();

await step('1. Request without API key', 'GET', '/bugs', { withKey: false, expect: 401 });

const created = await step('2. Create bug report', 'POST', '/bugs', {
  expect: 201,
  body: {
    title: 'Buildings no longer turn see-through in build',
    description: 'Works in Play Mode; in the build the occluding building stays opaque. No console error.',
    severity: 'high',
    engine: 'unity',
    runContext: 'build',
    buildVersion: '0.3.1',
    platform: 'webgl',
    scene: 'Town',
    posX: 12.5,
    posY: 0,
    posZ: -4.25,
    coordSpace: '3d',
  },
});
const id = created?.id;
if (!id) {
  log('Create did not return an id; stopping.');
} else {
  await step('3. Get the created report', 'GET', `/bugs/${id}`, { expect: 200 });
  await step('4. List open reports for build 0.3.1', 'GET', '/bugs?status=open&buildVersion=0.3.1', { expect: 200 });
  await step('5. Mark it fixed', 'PUT', `/bugs/${id}`, { expect: 200, body: { status: 'fixed' } });
  if (keep) {
    log(`--keep: item ${id} left in the table (delete it later with DELETE /bugs/${id}).`);
    log();
  } else {
    await step('6. Delete it', 'DELETE', `/bugs/${id}`, { expect: 204 });
    await step('7. Get after delete', 'GET', `/bugs/${id}`, { expect: 404 });
  }
}

// 1x1 transparent PNG.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** PUT a file to a presigned S3 URL. The query string (signature, session token) is never logged. */
async function s3Put(label, uploadUrl, contentType, data) {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: data });
  const text = await res.text();
  const pass = res.status === 200;
  if (!pass) failures += 1;
  const u = new URL(uploadUrl);
  log(`### ${label}`);
  log(`> PUT ${u.origin}${u.pathname}?<presigned query: ***>`);
  log(`> Content-Type: ${contentType}, ${data.length} bytes`);
  log(`< HTTP ${res.status}  [expected 200: ${pass ? 'PASS' : 'FAIL'}]`);
  if (!pass && text) log(text);
  log();
}

/** The API response minus the presigned URL, which carries a temporary credential. */
const maskTicket = (t) => (t?.uploadUrl ? { ...t, uploadUrl: '<presigned, masked>' } : t);

async function uploadSteps() {
  log('## Uploads (--uploads)');
  log();
  const bug = await step('U1. Create bug report for uploads', 'POST', '/bugs', {
    expect: 201,
    body: {
      title: 'Upload test: screenshot and log attached',
      severity: 'low',
      engine: 'unity',
      runContext: 'build',
      buildVersion: '0.3.1',
      platform: 'windows',
    },
  });
  const bugId = bug?.id;
  if (!bugId) {
    log('Create did not return an id; skipping upload steps.');
    return false;
  }

  const shot = await step('U2. Presign screenshot upload', 'POST', '/uploads', {
    expect: 201,
    body: { bugId, kind: 'screenshot' },
    mask: maskTicket,
  });
  const logT = await step('U3. Presign log upload', 'POST', '/uploads', {
    expect: 201,
    body: { bugId, kind: 'log' },
    mask: maskTicket,
  });
  if (!shot?.uploadUrl || !logT?.uploadUrl) {
    log('Presign failed; skipping S3 PUTs.');
    return false;
  }

  await s3Put('U4. PUT screenshot to S3', shot.uploadUrl, shot.contentType, PNG_1PX);
  await s3Put(
    'U5. PUT log to S3',
    logT.uploadUrl,
    logT.contentType,
    Buffer.from(`LumaLens upload test ${new Date().toISOString()}
`, 'utf8'),
  );

  await step('U6. Attach the keys to the report', 'PUT', `/bugs/${bugId}`, {
    expect: 200,
    body: { screenshotKey: shot.key, logKey: logT.key },
  });
  const after = await step('U7. Get the report with its keys', 'GET', `/bugs/${bugId}`, { expect: 200 });
  const keysOk = after?.screenshotKey === shot.key && after?.logKey === logT.key;
  if (!keysOk) failures += 1;
  log(`Keys stored on the report: ${keysOk ? 'PASS' : 'FAIL'} (${shot.key}, ${logT.key})`);
  log(`Bug ${bugId} and both S3 objects were left in place for the evidence screenshots.`);
  log();
  return true;
}

let uploadsOk = true;
if (uploads) uploadsOk = await uploadSteps();

const allOk = failures === 0 && id && uploadsOk;
log(allOk ? 'RESULT: all steps passed' : `RESULT: ${failures} step(s) failed`);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`\nSaved transcript to ${outFile}`);
process.exit(allOk ? 0 : 1);
