# LumaLens — sandbox deploy guide (steps 0–5)

Step-by-step walkthrough for deploying LumaLens in the **AWS Academy Cloud Foundations sandbox** and testing it. Everything goes in **us-east-1**. This is the procedure that produced the evidence in `docs/evidence/` on 26 Nov 2026.

Screenshots marked **📸** go in `docs/evidence/`. Each one should show the region (top-right of the console).

> **What the sandbox allows.** Tested on 26 Nov 2026:
> - Lambda (as LabRole), Lambda Function URLs, S3, CloudWatch and CloudFormation work. Creating the bucket **via CloudFormation as LabRole** and **presigned PUTs signed by LabRole** both work (verified 26 Nov 2026, see Step 5).
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

## Step 5 — S3 bucket and uploads (Week 13, ~10 min)

Adds the screenshot/log bucket `lumalens-shots-542230` and the `POST /uploads` route. Do it in the same session as steps 1–4 (or redo them first: the sandbox wipes everything at the end of a session).

> ✅ **Sandbox risks: verified on 26 Nov 2026.** Two things were unknown before Week 13 and both work:
> 1. **CloudFormation as LabRole can create the S3 bucket** (`lumalens-bucket` CREATE_COMPLETE; Block Public Access, SSE-S3, lifecycle and CORS all applied as in the template), and
> 2. **S3 accepts PUTs to URLs presigned by the Lambda's LabRole session** (`--uploads` test: both S3 PUTs 200, objects stored as `image/png` / `text/plain`, AES256).
>
> 5.1 is still a quick check, since sandbox policies can change. If it fails, use the fallback next to it.

**5.1 Quick check: create the bucket stack**

In CloudShell, in `~/LumaLens` (re-run the `R=...` line from Step 1 if CloudShell restarted):

```bash
git pull
R=$(aws iam get-role --role-name LabRole --query Role.Arn --output text)
aws cloudformation create-stack --stack-name lumalens-bucket   --template-body file://infra/s3-bucket.yaml --role-arn $R
aws cloudformation wait stack-create-complete --stack-name lumalens-bucket
aws s3api get-public-access-block --bucket lumalens-shots-542230
aws s3api get-bucket-encryption --bucket lumalens-shots-542230   --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault'
```

Expected: the wait returns without error, all four public-access flags are `true`, and the encryption is `AES256`.

**Fallback if the stack fails** (ROLLBACK_COMPLETE, or an `AccessDenied` / `not authorized to perform: s3:CreateBucket` event in the stack's **Events** tab):

1. Delete the failed stack: `aws cloudformation delete-stack --stack-name lumalens-bucket`.
2. S3 console → **Create bucket**: name `lumalens-shots-542230`, region us-east-1, Object Ownership **ACLs disabled**, **Block all public access** on, Default encryption **SSE-S3**. Create it.
3. Bucket → **Management** → **Create lifecycle rule**: name `expire-logs`, prefix `logs/`, action **Expire current versions of objects** after **30** days.
4. Bucket → **Permissions** → **Cross-origin resource sharing (CORS)** → Edit, paste:

   ```json
   [{ "AllowedMethods": ["PUT"], "AllowedOrigins": ["*"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3000 }]
   ```

   (CORS only matters for a browser build; the Windows build works without it.)
5. Note in the report that the bucket was made in the console because CloudFormation couldn't.

If even the console says you can't create buckets, stop here and report it: the upload feature can't be demoed in this sandbox.

**5.2 Deploy the new code**

```bash
cd ~/LumaLens/backend && npm ci && npm test && npm run build
aws lambda update-function-code --function-name lumalens-api --zip-file fileb://dist/function.zip
aws lambda wait function-updated --function-name lumalens-api
```

(If you're starting a fresh session, Step 2's `create-function` with this new zip does the same.)

**5.3 Add `BUCKET_NAME` in the console**

1. Lambda → `lumalens-api` → **Configuration** → **Environment variables** → **Edit**.
2. **Add environment variable**: Key `BUCKET_NAME`, Value `lumalens-shots-542230`. **Keep** `TABLE_NAME` and `LUMALENS_KEY`.
3. **Save**.

> Don't do this with `aws lambda update-function-configuration --environment ...`: it **replaces every** environment variable, so it would delete `LUMALENS_KEY` and `TABLE_NAME` unless you retype them (and then the key is in your shell history).

**5.4 Run the upload test** (your PC, same PowerShell window as Step 4)

```powershell
node scripts/test-crud.mjs --uploads --out docs/evidence/uploads-test.txt
```

Expected: the Step 4 CRUD steps, then **U1 POST 201**, **U2/U3 POST /uploads 201**, **U4/U5 S3 PUT 200**, **U6 PUT 200**, **U7 GET 200**, `Keys stored on the report: PASS`, and `RESULT: all steps passed`.

This is the second quick check. If **U4/U5 return 403**:

| S3 error in the transcript | Meaning / what to do |
|---|---|
| `SignatureDoesNotMatch` | The PUT's `Content-Type` differs from the one signed. The test script sends the right one; for your own client, send exactly `contentType` |
| `AccessDenied` | LabRole's session isn't allowed to `s3:PutObject` here (sandbox risk 2). Try `aws s3 cp` of a small file to the bucket from CloudShell (that runs as the sandbox user, not LabRole). If that works but the presigned PUT doesn't, the block is on LabRole: note it in the report: the API part (U1–U3, U6–U7) is still demonstrable |
| `ExpiredToken` / `Request has expired` | More than 300 s between U2 and U4, or the sandbox session ended. Re-run |

📸 Screenshots:

- 📸 S3 → `lumalens-shots-542230` → bucket overview (region us-east-1).
- 📸 Bucket → **Permissions** → **Block public access**: all four settings **On**.
- 📸 CloudFormation → Stacks → `lumalens-bucket`: **CREATE_COMPLETE**, and its **Outputs** tab with `BucketName` (skip if you used the console fallback; screenshot the lifecycle rule instead).
- 📸 Bucket → **Objects** → `screenshots/` and `logs/`, each showing the `<bugId>` object uploaded by U4/U5.
- 📸 The terminal output of the upload test.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `not authorized to perform: dynamodb:CreateTable` | Created from the console or CLI as the sandbox user. Use the CloudFormation stack with `--role-arn` LabRole (Step 1) |
| `not authorized to perform: apigateway:POST` | API Gateway is blocked in the sandbox. Use the Function URL (Step 3) |
| `500 internal_error` on every call | Handler isn't `index.handler`, or `TABLE_NAME` is wrong or missing |
| `500 internal_error` only on `POST /uploads` | `BUCKET_NAME` is missing (CloudWatch shows `BUCKET_NAME env var is not set`) |
| `404 not_found` on `POST /uploads` | The `bugId` doesn't exist in the table |
| S3 PUT `403 SignatureDoesNotMatch` | Wrong `Content-Type` on the PUT |
| Bucket stack ROLLBACK_COMPLETE | LabRole can't create the bucket via CloudFormation, or the name is taken. Use the Step 5.1 fallback |
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
- [x] S3 bucket `lumalens-shots-542230` overview
- [x] S3 Block Public Access (all four on)
- [x] CloudFormation stack `lumalens-bucket` CREATE_COMPLETE + Outputs (or the console fallback's lifecycle rule)
- [x] S3 objects under `screenshots/` and `logs/` after the upload test
- [x] Upload test terminal output
