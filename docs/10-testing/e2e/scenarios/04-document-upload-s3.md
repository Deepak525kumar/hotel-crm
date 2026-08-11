# Scenario 04 — Document Upload, S3 Storage, and Retrieval

Verifies the real multipart upload path end-to-end: browser/API → validation → malware seam →
S3 → metadata row → presigned retrieval. This is the path a real applicant uses first.

**Preconditions:** Scenario 00 complete. **Working AWS credentials** for the dev bucket
(`aws sts get-caller-identity` must succeed) and `S3_BUCKET` set in `backend/.env`.

> **If credentials are unavailable, record that this scenario could not run.** Do **not**
> substitute direct Prisma inserts and report a pass — the entire point is exercising the real
> storage path. Direct inserts are acceptable *only* to unblock other scenarios, and must be
> disclosed.

## Expected bucket posture (per the deployment guide)

```bash
for B in hotelcrm-uploads hotelcrm-backups; do
  aws s3api get-bucket-versioning --bucket $B --query Status --output text
  aws s3api get-public-access-block --bucket $B --query 'PublicAccessBlockConfiguration.RestrictPublicBuckets' --output text
  aws s3api get-bucket-encryption --bucket $B \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text
  aws s3api get-bucket-lifecycle-configuration --bucket $B --query 'Rules[].ID' --output text
done
```

**PASS:** uploads bucket — versioning `Enabled`, public access blocked `True`, `AES256`,
lifecycle `ExpireNoncurrentVersions30Days`. Backups bucket — exists, blocked, `AES256`,
IA→Glacier lifecycle. Region `eu-central-1`.

**Beware near-duplicate bucket names.** A `hotel-crm-uploads` (hyphenated) once existed
alongside the configured `hotelcrm-uploads`; every repo config uses the **unhyphenated** form.
`aws s3 ls | grep -i hotel` should show exactly the two expected buckets.

---

## Step 1 — Upload succeeds and the object really lands in S3

```bash
printf '%%PDF-1.4\ntest\n%%%%EOF\n' > /tmp/e2e-doc.pdf
curl -s -X POST http://localhost:3001/api/v1/documents/workers/<WORKER_USER>/documents \
  -H "Authorization: Bearer $T" \
  -F "category=TAX_NUMBER" -F "original_filename=tax.pdf" -F "mime_type=application/pdf" \
  -F "file=@/tmp/e2e-doc.pdf;type=application/pdf" | python3 -m json.tool
```

Then **verify in S3 directly** — do not trust the API response:

```bash
aws s3 ls s3://hotelcrm-uploads/ --recursive | grep <worker_id>
aws s3api head-object --bucket hotelcrm-uploads --key "<s3_key from the response>"
```

**PASS:** object exists; `ContentLength` matches the real file size; the DB row's
`file_size_bytes` equals the actual byte count (it is derived server-side from `req.file.size` —
try sending a bogus `file_size_bytes` field and confirm it is ignored).

Repeat for **all seven** categories (`TAX_NUMBER`, `SOCIAL_SECURITY_NUMBER`,
`HEALTH_INSURANCE`, `ID_CARD`, `PASSPORT`, `ADDRESS`, `WORK_PERMIT`) and at least two MIME
types from `ALLOWED_MIME_TYPES` (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`).

**Regression note:** the upload validator once hardcoded `z.enum(['ID_CARD','WORK_PERMIT'])`,
so four of the seven categories were **impossible to upload** while the completeness gate
demanded them. It now uses `z.nativeEnum(DocumentCategory)`. Verify an invalid category still
422s.

## Step 2 — Retrieval and presigned URL

```bash
curl -s http://localhost:3001/api/v1/documents/documents/<DOC_ID> -H "Authorization: Bearer $T"
curl -s "<presigned_url>" -o /tmp/dl.pdf -w "%{http_code}\n"   # GET, not HEAD
cmp /tmp/e2e-doc.pdf /tmp/dl.pdf && echo "bytes identical"
```

**PASS:** `200` and byte-identical content.
**Note:** the presigned URL is signed for `GET` only — a `curl -I` (HEAD) returning `403` is
**correct**, not a defect.

Also exercise `GET /documents/workers/:id/documents` (list) and `.../documents/export`.

## Step 3 — Rejections leave no orphans

For each case, assert **both** the HTTP status **and** that nothing was persisted (no S3
object, no `WorkerDocument` row):

| Case | Expected |
|---|---|
| Disallowed MIME (`text/plain`, `.exe`) | 422, rejected by multer `fileFilter` |
| Over `MAX_FILE_SIZE_BYTES` (11 MB) | 422 "File exceeds the maximum size of 10485760 bytes" |
| Invalid `category` | 422 Zod enum error |
| No `file` attached | 422 "A file is required" |
| Worker uploading for **another** worker | 403 (self-scoped) |

## Step 4 — S3 failure must not leave a DB row

Point `S3_BUCKET` at a nonexistent bucket (or revoke creds), restart the backend, then upload.

**PASS:** request fails (500 `NoSuchBucket`/credentials error) and **no `WorkerDocument` row
exists**. This works because `storage.upload()` runs *before* the DB transaction.

**Known inverse risk — check and report:** because S3 precedes the transaction and there is
**no compensating `storage.delete()`**, a DB/audit failure *after* a successful upload leaves an
**orphaned S3 object**. Try to induce it if you can; at minimum confirm the gap still exists and
note it. Restore `.env` and confirm `git status` is clean afterwards.

## Step 5 — Stub-mode danger (config edge case)

With `S3_BUCKET` **unset**, the storage client is a no-op stub *but the metadata row is still
persisted* (see the comment in `documents/service.ts`).

**Assert and report:** in stub mode, documents appear "complete" and can satisfy the onboarding
gate while **no bytes exist anywhere**. Fine as a dev posture; dangerous if it ever reached a
real deployment. Verify prod/staging always sets `S3_BUCKET`.

## Step 6 — Malware-scan seam (ADR-066)

The seam is wired but the default scanner is a **pass-through no-op** — real control flow, not
real detection. Do not report "uploads are scanned".

```bash
cd backend && npx jest src/__tests__/documents-upload.test.ts
```

**PASS:** the `malware-scan hook (OD-DOC-016/ADR-066)` cases pass — detection rejects with no
S3 object, no metadata row, no audit row; clean passes through; the scanner receives the
**actual** parsed bytes (guards against `ADR-044`'s own `Buffer.alloc(0)` failure mode).

If a real scanner vendor has since been selected, add a live end-to-end case here using the
EICAR test string.

## Step 7 — Cleanup

```bash
aws s3 rm s3://hotelcrm-uploads/ --recursive --exclude "*" --include "*<test_worker_id>*"
```

Delete objects you created and note any test rows left in the DB.

---

## Pass criteria summary

- [ ] Bucket posture matches the deployment guide (versioning, block, SSE, lifecycle, region)
- [ ] All seven categories upload successfully; object verified **in S3**, not just in the response
- [ ] `file_size_bytes` server-derived and not client-spoofable
- [ ] Presigned URL fetches byte-identical content (GET; HEAD 403 is expected)
- [ ] All five rejection cases 422/403 with no orphaned row or object
- [ ] S3 failure leaves no DB row
- [ ] Inverse orphan risk (DB fail after S3 success) checked and reported
- [ ] Stub-mode behaviour understood and prod config confirmed
- [ ] Malware-seam tests pass; no claim of real detection

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| 4 of 7 categories impossible to upload | Validator hardcoded the old two-value enum |
| Malware seam absent on this path | `OD-DOC-016` deferred; resolved by `ADR-066` Option A |
| Accidental second S3 bucket created | `.env` name didn't match the pre-existing bucket |
