# Version Control — internal app distribution

Upload an `.ipa` or `.apk`, choose whether it is a development or production
build, then drag it into a platform box to make it the version workers and
checkers install. Runs as a third process alongside `hotel-crm-api` and
`hotel-crm-worker`.

| Surface | URL | Auth |
|---|---|---|
| Upload, history, account | `https://hotelcrm.app/version-control` | operator login |
| Production board | `https://hotelcrm.app/version-control/production` | operator login |
| Development board | `https://hotelcrm.app/version-control/development` | operator login |
| Install page for workers | `https://hotelcrm.app/install` | **public** |
| One build's install page | `https://hotelcrm.app/install/<slug>` | **public** |

## How a release reaches a phone

1. **Upload.** The operator drops an `.ipa`/`.apk` on `/version-control` and is
   asked whether it is a *development* or *production* build. There is no
   default — that answer decides which board it appears on.
2. **Parse.** The file streams to a temp path, is hashed, and is parsed for app
   name, bundle id, version, build number and minimum OS. It is then uploaded to
   S3 and the temp file is deleted. A row is written to `ReleaseHistory` at this
   point and is never deleted.
3. **Promote.** Uploading publishes nothing. On the production board the
   operator drags the build into the iOS or Android box. Only then does
   `/install` change.
4. **Install.** Workers open `/install` (or scan its QR code), pick their
   platform, and install. iOS goes through `itms-services://` + a manifest;
   Android downloads the APK directly.

Taking a build offline, or deleting it, empties that platform's box immediately.

## Why promotion is a separate step

The public URL is printed on things and pasted into onboarding emails, so it has
to be stable. If "newest upload wins", then uploading a build to get a test link
would silently change what every worker installs. Promotion makes that a
deliberate act with an audit row (`PromotionEvent`) naming who did it and when.

## Security posture

This service accepts file uploads and serves anonymous pages on the same origin
as the CRM, which makes it the most exposed process on the box. The isolation is
therefore explicit:

- **Cookies.** The CRM's `access_token`/`refresh_token` are set with `path=/` and
  no `Domain`, so a browser would attach them to `/install` too. nginx rewrites
  the `Cookie` header for these locations so only `vc_session` is forwarded —
  CRM tokens never reach port 3002. See the `map $http_cookie` block in
  `nginx/hotelcrm.conf`.
- **Database.** A dedicated `hotelcrm_vc` role owning only the `version_control`
  schema, with every privilege on `public` revoked. It cannot read CRM tables
  even with a valid connection. See `scripts/provision-db.sql`.
- **S3.** A dedicated IAM user scoped to `hotelcrm-uploads/app-builds/*`. It
  cannot read the CRM's documents or payslips, and cannot touch the backups
  bucket. See `scripts/iam-policy.json`. Objects are private; binaries stream
  through this service rather than via public or presigned URLs.
- **Process config.** The PM2 entry deliberately does not inherit the CRM's
  `--env-file=./backend/.env`, so this process never holds the CRM's database
  URL, JWT secret or API keys.
- **Sessions.** Its own cookie (`vc_session`), scoped to the admin path, signed
  with its own secret, algorithm-pinned. Changing a password bumps `tokenVersion`
  and immediately invalidates every other session.
- **Accounts.** Self-registration is off in production; operators are created
  with `npm run user:create`.
- **CSP.** `default-src 'none'` with no inline script anywhere, so an injected
  string cannot become a script that calls CRM APIs from the shared origin.
- **Rate limits.** Tiered per surface in `src/lib/rateLimits.ts`, plus nginx
  `limit_req` zones. Failed logins and 404s are counted; successful traffic is
  not, because a hotel floor shares one NAT address.

### Residual risk, stated plainly

The process runs as `ubuntu` like the other two, so it can still reach the EC2
instance metadata endpoint and assume the instance role, which *does* have broad
`hotelcrm-uploads` access. Closing that means running this service as its own
Unix user and blocking `169.254.169.254` for that uid. Worth doing; not done.

## Local development

```bash
docker compose up -d postgres        # from the repo root
./scripts/use-env.sh local
npm install
npm run prisma:migrate
npm run dev
```

Then open http://localhost:3002/version-control and register an account
(registration is open locally).

**iOS OTA installs cannot be tested locally.** `itms-services://` requires the
manifest and IPA to be served over HTTPS with a CA-signed certificate — a
self-signed cert fails silently, and `installd` sends no cookies or auth headers.
The Android download path works locally over plain HTTP.

## Production

```bash
./scripts/use-env.sh production      # writes .env from .env.production.local
./scripts/deploy.sh                  # install, migrate, build, reload, health-check
```

One-time host setup, in order:

1. `sudo -u postgres psql -d hotelcrm_dev -v vc_password="'<pw>'" -f scripts/provision-db.sql`
2. Create `.env.production.local` with `PUBLIC_BASE_URL`, `DATABASE_URL`,
   `SESSION_SECRET`, the IAM user's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`,
   and `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` for password-reset email.
3. `nginx -t && sudo systemctl reload nginx` after the new locations are in place.
4. `npm run user:create` to issue the first operator account.

## Environment

| Variable | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Origin for every link, QR code and iOS manifest. Required in production, must be https. |
| `ADMIN_PATH` / `INSTALL_PATH` | Mount paths. Must match the nginx locations. |
| `DATABASE_URL` | Postgres, pointed at the `version_control` schema. |
| `SESSION_SECRET` | Signs this service's session cookie. Must differ from the CRM's `JWT_SECRET`. |
| `STORAGE_DRIVER` | `s3` in production, `local` for development. |
| `S3_BUCKET` / `S3_PREFIX` / `AWS_REGION` | Object storage location. |
| `ALLOW_REGISTRATION` | `0` in production. |
| `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` | Password-reset delivery. Without them, reset requests still report success and the failure is logged. |
| `MAX_UPLOAD_BYTES` | Upload ceiling, default 1 GiB. Keep the nginx `client_max_body_size` at least as large. |

## Data model

- `Build` — the live catalogue. Soft-deleted when its binary is removed.
- `ReleaseSlot` — one row per (channel, platform); what `/install` serves.
- `PromotionEvent` — append-only audit of every promotion and rollback.
- `ReleaseHistory` — append-only record of every version ever published:
  filename, version, build number, size, SHA-256, who uploaded it, and if and
  when the binary was deleted. **Never deleted**, so the record outlives the file.
- `PasswordResetToken` — single-use, one hour, stored only as a SHA-256 hash.
