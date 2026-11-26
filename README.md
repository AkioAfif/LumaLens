# LumaLens

Engine-agnostic bug capture for game builds: a small serverless API that game builds and test scripts post bug reports to, so errors that only appear in builds (not the editor) get recorded with their engine, platform, and build context. Cloud Computing course project (AWS Academy sandbox, Track C Serverless).

![LumaLens architecture](docs/architecture.png)

More detail: [docs/architecture.md](docs/architecture.md) · API contract: [docs/openapi.yaml](docs/openapi.yaml)

## Stack

- **Lambda Function URL** (HTTPS endpoint, auth type `NONE`, payload format 2.0), `us-east-1`
- **AWS Lambda** `lumalens-api`: Node.js 20, TypeScript bundled with esbuild, handler `index.handler`, runs as the lab's `LabRole`
- **DynamoDB** table `LumaLensReports` (partition key `id`, on-demand), created with CloudFormation ([`infra/dynamodb-table.yaml`](infra/dynamodb-table.yaml))
- **CloudWatch Logs** for request and error logs
- **zod** for validation, **AWS SDK v3** (`@aws-sdk/lib-dynamodb`) for data access, **vitest** + **aws-sdk-client-mock** for tests
- Auth: header `x-lumalens-key` must match the Lambda env var `LUMALENS_KEY`

### Why a Function URL instead of API Gateway

The design targets **API Gateway HTTP API** in front of the Lambda. The AWS Academy **Cloud Foundations sandbox** used for this project blocks it: `apigateway:POST` is denied both for the sandbox user and for LabRole. It also denies `dynamodb:CreateTable` for the user, although CloudFormation running as LabRole can create the table.

A **Lambda Function URL** sends the same payload format 2.0 event (`rawPath`, `requestContext.http.method`, headers, query string) that an HTTP API would, so the handler runs unchanged behind either. What the Function URL lacks is API Gateway's stage throttling. The API key check still applies, and the Lambda's 10 s timeout caps runaway calls. Moving to API Gateway later only means creating the HTTP API with the 5 routes (see [Intended: API Gateway](#intended-api-gateway-http-api)). No code changes.

## BugReport

| Field | Type | Rules |
|---|---|---|
| `id` | string | UUID, set by the server |
| `title` | string | required, 1–120 chars |
| `description` | string | optional, max 2000 chars |
| `severity` | enum | `low`, `medium`, `high`, `crash` (required) |
| `status` | enum | `open`, `in_progress`, `fixed`, `wontfix`; default `open` |
| `source` | enum | `manual`, `auto`; default `manual` |
| `engine` | enum | `unity`, `godot`, `unreal`, `web` (required) |
| `runContext` | enum | `editor`, `build` (required) |
| `buildVersion` | string | required, max 32 chars |
| `platform` | enum | `windows`, `webgl`, `android`, `linux`, `mac` (required) |
| `scene` | string | optional, max 120 chars |
| `posX`, `posY`, `posZ` | number | optional |
| `coordSpace` | enum | `2d`, `3d`; optional |
| `envSnapshot` | object | optional, free-form |
| `logKey`, `screenshotKey` | string | optional |
| `createdAt`, `updatedAt` | string | ISO 8601, set by the server |

Create bodies are strict: unknown fields and client-sent `id`/`createdAt`/`updatedAt` are rejected. Updates accept only `status`, `severity` and `description`, and need at least one of them.

## Routes

Every route requires the `x-lumalens-key` header (401 if missing or wrong).

| Method | Path | Success | Errors |
|---|---|---|---|
| `POST` | `/bugs` | 201 + created item | 400 `invalid_json` / `validation_failed` |
| `GET` | `/bugs` | 200 `{ items, count }`, newest first, max 500. Optional `?status=` and `?buildVersion=` filters | 400 `validation_failed` |
| `GET` | `/bugs/{id}` | 200 item | 404 `not_found` |
| `PUT` | `/bugs/{id}` | 200 updated item | 400, 404 |
| `DELETE` | `/bugs/{id}` | 204, empty body | 404 |

Unknown routes return 404. Unexpected errors return 500 `{"error":"internal_error"}` and are logged to CloudWatch.

## Local setup

Requires Node.js 20 or newer. Run from PowerShell (or any shell):

```powershell
cd backend
npm ci
npm test            # vitest unit tests (DynamoDB is mocked, no AWS calls)
npm run typecheck   # tsc --noEmit, strict
npm run build       # -> backend/dist/index.js and backend/dist/function.zip
```

From the repo root:

```powershell
npm ci
npm run lint:openapi   # validate docs/openapi.yaml
npm run test:crud      # CRUD cycle against the deployed API (see Deploy, step 4)
npm run deploy         # upload function.zip to lumalens-api (see Deploy, step 5)
```

Repo layout: `backend/` (Lambda source, tests, build script), `infra/` (CloudFormation template for the table), `docs/` (architecture, OpenAPI, design brief, lab guide, evidence), `scripts/` (deploy and CRUD test), `unity-client/` and `webgl-snippet/` (placeholders for later weeks).

## Deploy (AWS Academy sandbox)

Everything goes in **us-east-1**, in the Cloud Foundations course → Modules → Sandbox → **Sandbox Lingkungan Hidup**. Step-by-step with screenshots to take: [docs/lab-guide.md](docs/lab-guide.md).

- The sandbox **deletes every resource when the session ends** (180-minute timer), so deploy, test and capture evidence in one session.
- You can't create IAM roles: anything that needs a role uses the existing **LabRole**.
- Everything is serverless and on-demand (no NAT Gateway), so the budget only pays for actual requests.
- Run the AWS CLI from **CloudShell** in the console (it already has the sandbox credentials). The built-in terminal on the sandbox page has none.

### 0. Before the session

```powershell
cd backend
npm ci
npm test
npm run build        # -> backend/dist/function.zip
cd ..
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # your LUMALENS_KEY
```

Keep the generated key out of the repo.

### 1. DynamoDB table (CloudFormation as LabRole)

The sandbox user can't call `dynamodb:CreateTable`, so create the table with CloudFormation running as LabRole. In CloudShell:

```bash
git clone https://github.com/AkioAfif/LumaLens.git && cd LumaLens
R=$(aws iam get-role --role-name LabRole --query Role.Arn --output text)
aws cloudformation create-stack --stack-name lumalens-table \
  --template-body file://infra/dynamodb-table.yaml --role-arn $R
aws cloudformation wait stack-create-complete --stack-name lumalens-table
```

Result: `LumaLensReports`, partition key `id` (String), on-demand.

### 2. Lambda function

Build in CloudShell (Node.js 20 is preinstalled), then create the function as LabRole:

```bash
cd backend && npm ci && npm test && npm run build
aws lambda create-function --function-name lumalens-api --runtime nodejs20.x \
  --architectures x86_64 --handler index.handler --role $R --timeout 10 \
  --environment 'Variables={TABLE_NAME=LumaLensReports}' \
  --zip-file fileb://dist/function.zip
```

Then add the key yourself in the console, so it never appears in a terminal history: Lambda → `lumalens-api` → Configuration → **Environment variables** → Edit → add `LUMALENS_KEY` = the key from step 0 (keep `TABLE_NAME`).

### 3. Function URL

```bash
aws lambda add-permission --function-name lumalens-api --statement-id FunctionUrlPublic \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE
aws lambda add-permission --function-name lumalens-api --statement-id FunctionUrlInvoke \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url
aws lambda create-function-url-config --function-name lumalens-api --auth-type NONE
```

The last command prints the URL, `https://<url-id>.lambda-url.us-east-1.on.aws/`. Auth type `NONE` means AWS doesn't sign requests; the Lambda still rejects any request without the right `x-lumalens-key`.

### 4. Test the deployed API

```powershell
$env:LUMALENS_API_URL = "https://<url-id>.lambda-url.us-east-1.on.aws"   # no trailing /
$env:LUMALENS_KEY = "<key from step 0>"
npm run test:crud    # 401 without key, POST 201, GET 200, list 200, PUT 200, DELETE 204, GET 404
node scripts/test-crud.mjs --keep --out docs/evidence/crud-keep.txt   # same, but leaves one item
```

Transcripts are saved to `docs/evidence/`, with the key masked.

### 5. Redeploying code changes

From CloudShell, in the cloned repo:

```bash
git pull && cd backend && npm ci && npm run build
aws lambda update-function-code --function-name lumalens-api --zip-file fileb://dist/function.zip
```

Or locally with `npm run deploy`, after putting the session's AWS CLI credentials in `~/.aws/credentials`.

### Intended: API Gateway HTTP API

Where API Gateway is allowed (for example a full Learner Lab), put an HTTP API in front of the same Lambda instead of the Function URL:

- API Gateway → **Create API** → HTTP API → Build. Integration: Lambda `lumalens-api` (payload format 2.0). API name `lumalens-http`.
- Routes, all to that integration: `POST /bugs`, `GET /bugs`, `GET /bugs/{id}`, `PUT /bugs/{id}`, `DELETE /bugs/{id}`. Stage `$default`, auto-deploy on.
- Protect → **Throttling** → `$default` stage: rate **10**, burst **20**.

The handler needs no changes; point `LUMALENS_API_URL` at the HTTP API's invoke URL.

### Evidence

Captured on 26 Nov 2026 in `docs/evidence/`, each screenshot showing us-east-1:

| File | Shows |
|---|---|
| `00-sandbox-session.jpg` | Sandbox session running, time remaining |
| `01-cloudshell-identity-region.jpg` | `aws sts get-caller-identity`, region `us-east-1`, CloudFormation stacks |
| `02-dynamodb-table-overview.jpg` | `LumaLensReports`: partition key `id`, on-demand, active |
| `03-cloudformation-table-stack.jpg` | Stack `lumalens-table`, CREATE_COMPLETE |
| `04-lambda-overview.jpg` | `lumalens-api` with its Function URL |
| `05-lambda-execution-role-labrole.jpg` | Execution role LabRole |
| `06-lambda-resource-policy.jpg` | Resource policy allowing Function URL invokes |
| `07-lambda-function-url.jpg` | Function URL, auth type NONE |
| `08-cloudwatch-log-group.jpg` | Log group `/aws/lambda/lumalens-api` |
| `09-cloudwatch-log-events.jpg` | Log events from the CRUD test run |
| `10-test-crud-terminal.png` | `npm run test:crud` terminal output |
| `11-dynamodb-explore-items.jpg` | Table scan with the item kept by `--keep` |
| `12-dynamodb-item-detail.jpg` | All attributes of that item |
| `crud-test.txt`, `crud-keep.txt` | Full CRUD transcripts (key masked): every step passed |
