// Uploads backend/dist/function.zip to the existing lumalens-api Lambda.
// Needs the AWS CLI with the lab session's credentials in ~/.aws/credentials (refresh them each session),
// or run the equivalent `aws lambda update-function-code` from CloudShell (see README, Deploy step 5).
//
// Usage (PowerShell), from the repo root:
//   npm --prefix backend run build
//   npm run deploy
//
// The function itself (runtime, handler, LabRole, env vars) is created once in the console;
// this script only replaces its code.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCTION_NAME = 'lumalens-api';
const REGION = 'us-east-1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const zip = join(root, 'backend', 'dist', 'function.zip');
if (!existsSync(zip)) {
  console.error(`Missing ${zip}. Run "npm --prefix backend run build" first.`);
  process.exit(1);
}

const aws = (...args) =>
  execFileSync('aws', [...args, '--region', REGION], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

console.log(`Uploading ${zip} to ${FUNCTION_NAME} (${REGION})...`);
aws(
  'lambda', 'update-function-code',
  '--function-name', FUNCTION_NAME,
  '--zip-file', `fileb://${zip.replace(/\\/g, '/')}`,
  '--output', 'json',
);

console.log('Waiting for the update to finish...');
aws('lambda', 'wait', 'function-updated', '--function-name', FUNCTION_NAME);

const info = JSON.parse(
  aws('lambda', 'get-function-configuration', '--function-name', FUNCTION_NAME, '--output', 'json'),
);
console.log(`Deployed: runtime=${info.Runtime} handler=${info.Handler} size=${info.CodeSize} bytes`);
console.log(`Last modified: ${info.LastModified}  status: ${info.LastUpdateStatus}`);
