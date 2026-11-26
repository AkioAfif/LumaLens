// End-to-end test of the Unity client against the deployed API.
//
// 1. Makes a throwaway Unity project in the OS temp folder that uses ../../unity-client from disk.
// 2. Editor run: a PlayMode test sends a manual report, a Debug.LogError and an exception (runContext "editor").
// 3. Build run: builds a Windows player and runs it headless; it sends the same three (runContext "build").
// 4. GET /bugs?buildVersion=<run id> and checks all six arrived with the right fields, then prints the
//    envSnapshot differences between the editor and build reports.
//
// Usage (PowerShell), from the repo root, with the lab session's Function URL and key:
//   $env:LUMALENS_API_URL = "https://<url-id>.lambda-url.us-east-1.on.aws"
//   $env:LUMALENS_KEY = "<the key set on the Lambda>"
//   npm run test:unity-e2e                 # writes docs/evidence/unity-e2e.txt
//
// Optional: UNITY_EDITOR (path to Unity.exe, default 6000.6.5f1 under Unity Hub), --out <file>,
// --verify-only <run id> (skip Unity, only check the API). Unity Hub must be running and signed in.
// Reports are left in the table on purpose (evidence). Exits 1 if any check fails.
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const baseUrl = (process.env.LUMALENS_API_URL ?? '').trim().replace(/\/+$/, '');
const apiKey = (process.env.LUMALENS_KEY ?? '').trim();
if (!baseUrl || !apiKey) {
  console.error('Set LUMALENS_API_URL and LUMALENS_KEY first (see the comment at the top of this file).');
  process.exit(2);
}
const unityExe = process.env.UNITY_EDITOR ?? 'C:/Program Files/Unity/Hub/Editor/6000.6.5f1/Editor/Unity.exe';
const outFile = resolve(arg('--out') ?? join(root, 'docs', 'evidence', 'unity-e2e.txt'));
const verifyOnly = arg('--verify-only');
const runId = verifyOnly ?? `e2e-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;

const STEP_TIMEOUT_MS = 15 * 60 * 1000;
const projectDir = join(tmpdir(), 'lumalens-unity-e2e');
const workDir = join(projectDir, 'e2e-output');
const lines = [];
const log = (line = '') => {
  console.log(line);
  lines.push(line);
};
const mask = (s) => s.split(apiKey).join('***');

function run(label, exe, args) {
  log(`> ${label}`);
  const env = { ...process.env, LUMALENS_API_URL: baseUrl, LUMALENS_KEY: apiKey, LUMALENS_E2E_BUILD: runId };
  return new Promise((done, fail) => {
    const child = spawn(exe, args, { env, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => child.kill(), STEP_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) done();
      else fail(new Error(`${label} ${signal ? `timed out after ${STEP_TIMEOUT_MS / 60000} min` : `exited with ${code}`}`));
    });
  });
}

async function tailLog(file, pattern) {
  try {
    const text = await readFile(file, 'utf8');
    return text.split(/\r?\n/).filter((l) => pattern.test(l)).map(mask);
  } catch {
    return [];
  }
}

async function prepareProject() {
  await mkdir(join(projectDir, 'Packages'), { recursive: true });
  await rm(join(projectDir, 'Assets', 'E2E'), { recursive: true, force: true });
  await cp(join(here, 'Assets'), join(projectDir, 'Assets'), { recursive: true });
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  const clientPath = join(root, 'unity-client').replace(/\\/g, '/');
  await writeFile(join(projectDir, 'Packages', 'manifest.json'), JSON.stringify({
    dependencies: {
      'com.lumalens.client': `file:${clientPath}`,
      'com.unity.test-framework': '1.8.0',
      'com.unity.modules.imgui': '1.0.0',
      'com.unity.modules.jsonserialize': '1.0.0',
      'com.unity.modules.unitywebrequest': '1.0.0',
    },
  }, null, 2));
}

async function editorRun() {
  const logFile = join(workDir, 'editor.log');
  const results = join(workDir, 'playmode-results.xml');
  try {
    await run('Unity editor: PlayMode test (runContext editor)', unityExe, [
      '-batchmode', '-projectPath', projectDir, '-runTests', '-testPlatform', 'PlayMode',
      '-testResults', results, '-logFile', logFile,
    ]);
  } finally {
    for (const l of await tailLog(logFile, /\[LumaLens\]|error CS|No valid Unity Editor license/)) log(`  ${l}`);
  }
}

async function buildRun() {
  const exe = join(workDir, 'player', 'LumaLensE2E.exe');
  const buildLog = join(workDir, 'build.log');
  try {
    await run('Unity editor: build Windows player', unityExe, [
      '-batchmode', '-quit', '-projectPath', projectDir, '-executeMethod', 'E2EBuild.Build', '-e2eOut', exe,
      '-logFile', buildLog,
    ]);
  } catch (err) {
    for (const l of await tailLog(buildLog, /error|failed/i)) log(`  ${l}`);
    throw err;
  }
  const playerLog = join(workDir, 'player.log');
  try {
    // Windowed with a real graphics device (not -nographics), so the envSnapshot shows the actual GPU and API.
    await run('Windows player (runContext build, small window for ~15 s)', exe, [
      '-screen-fullscreen', '0', '-screen-width', '960', '-screen-height', '540', '-logFile', playerLog,
    ]);
  } finally {
    for (const l of await tailLog(playerLog, /\[LumaLens\]/)) log(`  ${l}`);
  }
}

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures += 1;
  log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
};

async function verify() {
  log(`> GET /bugs?buildVersion=${runId}  (x-lumalens-key: ***)`);
  const res = await fetch(`${baseUrl}/bugs?buildVersion=${encodeURIComponent(runId)}`, {
    headers: { 'x-lumalens-key': apiKey },
  });
  log(`< HTTP ${res.status}`);
  check(res.status === 200, 'list returns 200');
  if (res.status !== 200) return;
  const { items } = await res.json();
  log(`  ${items.length} report(s) for this run`);

  const find = (ctx, pred) => items.find((b) => b.runContext === ctx && pred(b));
  const byCtx = {};
  for (const ctx of ['editor', 'build']) {
    log('');
    log(`runContext ${ctx}:`);
    const manual = find(ctx, (b) => b.title === 'E2E manual report');
    const error = find(ctx, (b) => b.title === 'E2E auto error');
    const exception = find(ctx, (b) => b.title?.includes('E2E auto exception'));
    byCtx[ctx] = manual;
    check(manual && manual.source === 'manual' && manual.severity === 'low' && manual.posX === 1.5 && manual.posZ === -2 && manual.coordSpace === '3d',
      'manual report: source manual, severity low, position (1.5, 0, -2) 3d');
    check(error && error.source === 'auto' && error.severity === 'medium', 'Debug.LogError: source auto, severity medium');
    check(exception && exception.source === 'auto' && exception.severity === 'high' && /InvalidOperationException/.test(exception.description ?? ''),
      'exception: source auto, severity high, stack trace in description');
    for (const b of [manual, error, exception].filter(Boolean)) {
      check(b.engine === 'unity' && b.platform === 'windows' && typeof b.envSnapshot === 'object',
        `"${b.title.slice(0, 40)}": engine unity, platform windows, envSnapshot present (id ${b.id})`);
    }
  }

  const editorEnv = byCtx.editor?.envSnapshot, buildEnv = byCtx.build?.envSnapshot;
  if (editorEnv && buildEnv) {
    log('');
    log('envSnapshot differences, editor vs build (manual reports):');
    const keys = [...new Set([...Object.keys(editorEnv), ...Object.keys(buildEnv)])].sort();
    let diffs = 0;
    for (const k of keys) {
      if (JSON.stringify(editorEnv[k]) === JSON.stringify(buildEnv[k])) continue;
      diffs += 1;
      const show = (v) => (v === undefined ? '(not set)' : JSON.stringify(v));
      log(`  ${k.padEnd(16)} editor=${show(editorEnv[k])}  build=${show(buildEnv[k])}`);
    }
    if (diffs === 0) log('  (none)');
  }
}

log('# LumaLens Unity client end-to-end test');
log(`API: ${baseUrl}`);
log(`Run id (buildVersion): ${runId}`);
log(`Started: ${new Date().toISOString()}`);
log('');
try {
  if (!verifyOnly) {
    await prepareProject();
    await editorRun();
    await buildRun();
    log('');
  }
  await verify();
} catch (err) {
  failures += 1;
  log(`ERROR: ${mask(String(err.message ?? err))}`);
}
log('');
log(failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, lines.join('\n') + '\n');
console.log(`\nSaved to ${outFile}`);
process.exit(failures === 0 ? 0 : 1);
