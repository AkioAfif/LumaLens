# LumaLens — sandbox deploy guide (steps 0–4)

Step-by-step walkthrough for deploying LumaLens in the **AWS Academy Cloud Foundations sandbox** and testing it. Everything goes in **us-east-1**. This is the procedure that produced the evidence in `docs/evidence/` on 26 Nov 2026.

Screenshots marked **📸** go in `docs/evidence/`. Each one should show the region (top-right of the console).

> **What the sandbox allows.** Tested on 26 Nov 2026:
> - Lambda (as LabRole), Lambda Function URLs, S3, CloudWatch and CloudFormation work.
> - **API Gateway is denied**, even for LabRole. That's why the API is exposed through a Function URL.
> - **`dynamodb:CreateTable` is denied** for the sandbox user. CloudFormation running as LabRole can create the table.
> - IAM roles can't be created. Use the existing **LabRole**.

> ⚠️ The sandbox **deletes every resource and all data when the session ends** (180-minute timer). Do steps 1–4 and take every screenshot in **one session**.

---

## Step 0 — Before the session (your PC, ~5 min)

**0.1 Build and test locally**

```powershell
cd D:\Orca\LumaLens
npm --prefix backend ci
npm --prefix backend test
```

**0.2 Generate your API key**

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Copy the output into a private note, **not** the repo. This is your `LUMALENS_KEY`.

**0.3 Make the evidence folder**

```powershell
mkdir docs\evidence
```

**0.4 Start the sandbox**

1. AWS Academy → **AWS Academy Cloud Foundations** → **Modules** → **Sandbox** → **Sandbox Lingkungan Hidup**.
2. Click **Start Lab**. Wait until the spinner on Start Lab stops (it can take ~10 minutes).
3. 📸 The sandbox page with the session timer.
4. Click **AWS** to open the console. If the browser says "You must first log out before logging into a different AWS account", log out of the other AWS account first, then click **AWS** again.
5. Top-right: check the region is **N. Virginia (us-east-1)**.

**0.5 Open CloudShell**

Click the **CloudShell** icon (bottom-left of the console). It already has the sandbox credentials. The terminal on the AWS Academy page does **not**, and its AWS CLI is too old.

📸 Run this and screenshot it:

```bash
aws sts get-caller-identity
aws configure get region; echo $AWS_REGION
```

---

## Step 1 — DynamoDB table via CloudFormation (~2 min)

In CloudShell:

```bash
cd ~ && git clone https://github.com/AkioAfif/LumaLens.git && cd LumaLens
R=$(aws iam get-role --role-name LabRole --query Role.Arn --output text)
aws cloudformation create-stack --stack-name lumalens-table \
  --template-body file://infra/dynamodb-table.yaml --role-arn $R
aws cloudformation wait stack-create-complete --stack-name lumalens-table
aws dynamodb describe-table --table-name LumaLensReports \
  --query 'Table.[TableName,TableStatus,BillingModeSummary.BillingMode]' --output text
```

Expected: `LumaLensReports ACTIVE PAY_PER_REQUEST`.

- 📸 DynamoDB → Tables → `LumaLensReports` → **Overview**: partition key `id (String)`, capacity mode **On-demand**.
- 📸 CloudFormation → Stacks → `lumalens-table`: **CREATE_COMPLETE**.

---

## Step 2 — Lambda function (~3 min)

Still in CloudShell, in `~/LumaLens`:

```bash
cd backend && npm ci && npm test && npm run build
aws lambda create-function --function-name lumalens-api --runtime nodejs20.x \
  --architectures x86_64 --handler index.handler --role $R --timeout 10 \
  --environment 'Variables={TABLE_NAME=LumaLensReports}' \
  --zip-file fileb://dist/function.zip
aws lambda wait function-active --function-name lumalens-api
```

**Add your key in the console** so it never lands in a terminal history:

1. Lambda → `lumalens-api` → **Configuration** → **Environment variables** → **Edit**.
2. **Add environment variable**: Key `LUMALENS_KEY`, Value = your key from 0.2. Keep `TABLE_NAME`.
3. **Save**.

Don't screenshot the Environment variables page: it shows the key.

---

## Step 3 — Function URL (~1 min)

```bash
aws lambda add-permission --function-name lumalens-api --statement-id FunctionUrlPublic \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE
aws lambda add-permission --function-name lumalens-api --statement-id FunctionUrlInvoke \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url
aws lambda create-function-url-config --function-name lumalens-api --auth-type NONE \
  --query FunctionUrl --output text
```

The last line prints the URL, for example `https://abc123.lambda-url.us-east-1.on.aws/`. Save it.

Screenshots:

- 📸 Lambda → `lumalens-api` → function **Overview** (shows the Function URL).
- 📸 **Configuration → Permissions**: execution role **LabRole**.
- 📸 Same page, scrolled to **Resource-based policy statements** (`FunctionUrlPublic` and `FunctionUrlInvoke`).
- 📸 **Configuration → Function URL**: the URL and Auth type **NONE**.

---

## Step 4 — Test the deployed API (your PC, ~5 min)

**4.1 Set the URL and key** in the PowerShell window you'll run the test from:

```powershell
cd D:\Orca\LumaLens
$env:LUMALENS_API_URL = "https://abc123.lambda-url.us-east-1.on.aws"   # your URL, no trailing /
$env:LUMALENS_KEY = "<your key>"
```

**4.2 Run the full CRUD test**

```powershell
npm run test:crud
```

Expected, in order: **401** without the key, **POST 201**, **GET 200**, **list 200**, **PUT 200**, **DELETE 204**, **GET 404**, then `RESULT: all steps passed`. The transcript is saved to `docs/evidence/crud-test.txt` with the key masked.

📸 The terminal output.

**4.3 Leave one item in the table**

```powershell
node scripts/test-crud.mjs --keep --out docs/evidence/crud-keep.txt
```

- 📸 DynamoDB → **Explore items** → `LumaLensReports`, showing the item.
- 📸 The item opened, showing all attributes. Leave the page without saving.

**4.4 CloudWatch logs**

- 📸 CloudWatch → **Log groups** → `/aws/lambda/lumalens-api`, showing its log streams.
- 📸 The newest log stream, showing the test requests.

---

## Step 5 — Unity client end-to-end (your PC, ~10 min)

Needs Unity 6000.6.5f1 and **Unity Hub open and signed in** (batchmode gets its license from Hub). In the same PowerShell window as Step 4 (with `LUMALENS_API_URL` and `LUMALENS_KEY` set):

```powershell
npm run test:unity-e2e
```

The script builds a throwaway Unity project in your temp folder, runs a PlayMode test (`runContext: editor`), then builds and runs a small Windows player (`runContext: build`; a 960×540 window opens for ~15 s). Each sends a manual report, a `Debug.LogError` and an exception. The script then checks all six arrived through `GET /bugs?buildVersion=e2e-…` and prints the `envSnapshot` differences between editor and build. Expected: `RESULT: all checks passed`. The transcript is saved to `docs/evidence/unity-e2e.txt` with the key masked. The reports stay in the table.

- 📸 The terminal output.
- 📸 DynamoDB → **Explore items**, filtered on `buildVersion` = the run id, showing the editor and build reports.

If only the API check needs repeating: `node scripts/unity-e2e/run.mjs --verify-only <run id>`.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `not authorized to perform: dynamodb:CreateTable` | Created from the console or CLI as the sandbox user. Use the CloudFormation stack with `--role-arn` LabRole (Step 1) |
| `not authorized to perform: apigateway:POST` | API Gateway is blocked in the sandbox. Use the Function URL (Step 3) |
| `500 internal_error` on every call | Handler isn't `index.handler`, or `TABLE_NAME` is wrong or missing |
| `401` even with the key | `LUMALENS_KEY` in Lambda doesn't match your PowerShell value (watch for extra spaces) |
| `403 Forbidden` from the Function URL | One of the two `add-permission` statements is missing |
| `Unable to locate credentials` | You're in the AWS Academy page terminal. Use CloudShell |
| Timeout | Lambda timeout still at the 3 s default |

---

## Screenshot checklist

- [x] Sandbox session running
- [x] CloudShell: `aws sts get-caller-identity` and region
- [x] DynamoDB `LumaLensReports` overview (partition key `id`, on-demand)
- [x] CloudFormation stack `lumalens-table` CREATE_COMPLETE
- [x] Lambda `lumalens-api` overview
- [x] Lambda execution role LabRole
- [x] Lambda resource-based policy for the Function URL
- [x] Lambda Function URL configuration
- [x] CloudWatch log group and log events
- [ ] `npm run test:crud` terminal output
- [x] DynamoDB Explore items with the kept item, and the item detail
