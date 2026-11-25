# LumaLens

Engine-agnostic bug capture for game builds: a small serverless API that game builds and test scripts post bug reports to, so errors that only appear in builds (not the editor) get recorded with their engine, platform, and build context. Cloud Computing course project (AWS Learner Lab, Track C Serverless).

![LumaLens architecture](docs/architecture.png)

More detail: [docs/architecture.md](docs/architecture.md) · API contract: [docs/openapi.yaml](docs/openapi.yaml)

## Stack

- **API Gateway HTTP API** (payload format 2.0, Lambda proxy integration), `us-east-1`
- **AWS Lambda** `lumalens-api`: Node.js 20, TypeScript bundled with esbuild, handler `index.handler`, runs as the Learner Lab `LabRole`
- **DynamoDB** table `LumaLensReports` (partition key `id`, on-demand)
- **CloudWatch Logs** for request and error logs
- **zod** for validation, **AWS SDK v3** (`@aws-sdk/lib-dynamodb`) for data access, **vitest** + **aws-sdk-client-mock** for tests
- Auth: header `x-lumalens-key` must match the Lambda env var `LUMALENS_KEY`

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

Repo layout: `backend/` (Lambda source, tests, build script), `docs/` (architecture, OpenAPI, design brief, evidence), `scripts/` (deploy and CRUD test), `unity-client/` and `webgl-snippet/` (placeholders for later weeks).

## Deploy (Learner Lab)

Everything goes in **us-east-1**. Learner Lab can't create IAM roles: whenever a console wizard offers to create a role, pick **Use an existing role → LabRole**. Everything here is serverless and on-demand (no NAT Gateway), so the lab budget only pays for actual requests.

### 0. Before the lab session

```powershell
cd backend
npm ci
npm test
npm run build        # -> backend/dist/function.zip
cd ..
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # your LUMALENS_KEY
```

Keep the generated key out of the repo.

### 1. DynamoDB table

DynamoDB → **Create table**
- Table name `LumaLensReports`, partition key `id` (String), no sort key
- Table settings → **Customize settings** → Capacity mode **On-demand**

### 2. Lambda function

Lambda → **Create function** → Author from scratch
- Name `lumalens-api`, runtime **Node.js 20.x**, architecture x86_64
- Permissions → Change default execution role → **Use an existing role → LabRole**

Then on the function:
- Code → **Upload from → .zip file** → `backend/dist/function.zip`
- Code → Runtime settings → Handler `index.handler`
- Configuration → Environment variables: `TABLE_NAME` = `LumaLensReports`, `LUMALENS_KEY` = the key from step 0
- Configuration → General configuration → Timeout 10 s (the 3 s default can be tight on a cold start)

### 3. HTTP API

API Gateway → **Create API** → HTTP API → Build
- Integration: Lambda, `lumalens-api`, us-east-1 (payload format 2.0 is the default)
- API name `lumalens-http`
- Routes, all to the `lumalens-api` integration: `POST /bugs`, `GET /bugs`, `GET /bugs/{id}`, `PUT /bugs/{id}`, `DELETE /bugs/{id}`
- Stage `$default`, auto-deploy on

Then Protect → **Throttling** → edit the `$default` stage: rate **10**, burst **20**.

The integration adds the resource-based policy on the Lambda that lets API Gateway invoke it (visible under Lambda → Configuration → Permissions).

### 4. Test the deployed API

```powershell
$env:LUMALENS_API_URL = "https://<api-id>.execute-api.us-east-1.amazonaws.com"
$env:LUMALENS_KEY = "<key from step 0>"
npm run test:crud    # 401 without key, POST 201, GET 200, list 200, PUT 200, DELETE 204, GET 404
```

The transcript is saved to `docs/evidence/crud-test.txt`, with the key masked.

### 5. Redeploying code changes

Paste the Learner Lab **AWS Details → AWS CLI** credentials into `~/.aws/credentials` (they expire with each session), then:

```powershell
npm --prefix backend run build
npm run deploy       # aws lambda update-function-code for lumalens-api
```

### Evidence checklist

Save screenshots in `docs/evidence/`. Each one should show the region.

- [ ] `aws sts get-caller-identity` and `aws configure get region` output
- [ ] DynamoDB `LumaLensReports` overview: partition key `id`, on-demand capacity
- [ ] Lambda `lumalens-api` overview, and Configuration → Permissions showing LabRole and the API Gateway resource policy
- [ ] API Gateway routes attached to the Lambda integration, plus the stage throttling settings
- [ ] `npm run test:crud` terminal output (full cycle and the 401)
- [ ] DynamoDB Explore items showing a created item before deletion (`node scripts/test-crud.mjs --keep --out docs/evidence/crud-keep.txt` leaves one item in the table)
- [ ] CloudWatch log group `/aws/lambda/lumalens-api` with the test requests
- [ ] (Optional) S3 bucket `lumalens-shots-<NIU>` with Block Public Access on
- [ ] Learner Lab panel showing the remaining budget
