# Scenario 00 — Environment Setup and Teardown

**Run this first, every time.** Every later scenario assumes the stack is up and the seed
data from §4 exists.

## Preconditions

- Docker Desktop running (`docker ps` must succeed — if the daemon is down, `open -a Docker`
  and wait; containers can also disappear entirely after a Docker restart, in which case
  recreate them with `docker compose up -d` rather than `docker start`).
- Node deps installed in both `backend/` and `frontend/`.
- Ports free: **3001** (backend), **3000** (frontend), **5432** (Postgres), **6379** (Redis).

## 1. Database and cache

```bash
cd /path/to/hotel-crm
docker compose up -d postgres redis          # `docker start hotel-crm-postgres-1 hotel-crm-redis-1` if they already exist
docker exec hotel-crm-postgres-1 pg_isready -U hotelcrm   # wait for "accepting connections"
```

## 2. Migrations

```bash
cd backend
npx prisma migrate status     # expect "Database schema is up to date!"
```

**If it reports drift or pending migrations**, apply with `npx prisma migrate deploy`.
Use `npx prisma migrate reset --force --skip-seed` **only** on a throwaway dev database.

### Migration integrity check (do this after any migration change)

A cleaned-up-looking migration can silently drop statements a fresh database needs. This
exact mistake happened once (see `08-known-gaps-and-next.md` history). The only reliable
check is a fresh database:

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d postgres -c "CREATE DATABASE migcheck;"
cd backend
DATABASE_URL="postgresql://hotelcrm:dev_password@localhost:5432/migcheck?schema=public" npx prisma migrate deploy
DATABASE_URL="postgresql://hotelcrm:dev_password@localhost:5432/migcheck?schema=public" \
  npx prisma migrate diff \
  --from-url "postgresql://hotelcrm:dev_password@localhost:5432/migcheck?schema=public" \
  --to-schema-datamodel prisma/schema.prisma
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d postgres -c "DROP DATABASE migcheck;"
```

**PASS:** `No difference detected.`
**FAIL:** any listed difference — a fresh deploy (CI/prod/new dev) will be out of sync with
`schema.prisma`. Do not proceed; fix the migrations first.

## 3. Application servers

```bash
cd backend  && npm run dev > /tmp/backend.log  2>&1 &   # :3001
cd frontend && npm run dev > /tmp/frontend.log 2>&1 &   # :3000
sleep 10
curl -s http://localhost:3001/api/v1/health              # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login   # 200
```

### Feature flags (read these, don't assume)

```bash
grep -i "^FEATURE_" backend/.env
```

- `FEATURE_EMPLOYMENT_RECORD` **must be `true`** or every `/employees` route 404s and the
  whole suite is vacuous. Confirm with:
  `curl -s -H "Authorization: Bearer $T" http://localhost:3001/api/v1/employees/by-user/x`
  → a JSON envelope (not a 404 page).
- `FEATURE_RM_ROLE` is normally **absent/off**. Scenario 02 depends on knowing which state
  you are in — record it in the run log.

### Frontend/API wiring note

`NEXT_PUBLIC_API_URL` in `frontend/.env.local` is **dead and ignored** — it may say `:3000`,
which looks wrong but is harmless. The frontend calls a relative `/api/v1` and `next.config.ts`
proxies server-side to `BACKEND_INTERNAL_URL` (default `http://localhost:3001`). Do not
"fix" the env var; test through `:3000` so the httpOnly auth cookies work same-origin.

## 4. Seed data

`POST /auth/signup` always creates a `WORKER` (server-assigned; client role input is not
trusted). So the **first Admin must be created directly** via Prisma, then everything else
through the real API.

```ts
// backend/scratch-bootstrap-admin.ts  — delete after running
import bcrypt from 'bcryptjs';                 // NOTE: bcryptjs, not bcrypt
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const password_hash = await bcrypt.hash('AdminPass123!', 10);
await prisma.user.upsert({
  where: { email: 'e2e-admin@test.local' },
  update: {},
  create: { email: 'e2e-admin@test.local', password_hash, first_name: 'E2E',
            last_name: 'Admin', role: 'ADMIN', is_active: true },
});
```

Then build the world through the API (note the request shapes — these have bitten before):

```bash
T=$(curl -s -X POST http://localhost:3001/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"e2e-admin@test.local","password":"AdminPass123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

# Hotel group — billing_info is a STRING, not an object
G=$(curl -s -X POST http://localhost:3001/api/v1/crm/hotel-groups -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"name":"E2E Group","billing_info":"e2e@test.local"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

# Hotel — createHotel IGNORES hotel_group_id; assign it with a separate PATCH
H=$(curl -s -X POST http://localhost:3001/api/v1/crm/hotels -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E Hotel","address":"1 Test St","city":"Berlin","country":"Germany"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
curl -s -X PATCH http://localhost:3001/api/v1/crm/hotels/$H -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d "{\"hotel_group_id\":\"$G\"}" > /dev/null
```

Create a **second** group+hotel the same way — scenario 03's isolation tests need a
cross-boundary target.

### Users to create (via `POST /api/v1/users` as Admin)

| Purpose | Email | Role |
|---|---|---|
| Admin (bootstrapped above) | `e2e-admin@test.local` | admin |
| Active manager of E2E Hotel | `e2e-mgr@test.local` | manager |
| Regional manager of E2E Group | `e2e-rm@test.local` | regional_manager |
| Worker — fresh, no docs | `e2e-worker1@test.local` | worker |
| Worker — for isolation tests | `e2e-worker2@test.local` | worker |
| Checker | `e2e-checker@test.local` | checker |

Password `E2EPass123!` for all. Then take the manager through the **full** lifecycle
(scenario 01's steps) and `assign` them to E2E Hotel — otherwise their scope won't resolve
and scenario 03 will produce misleading empty results.

## 5. Teardown

```bash
pkill -f "tsx watch src/server.ts"; pkill -f "next dev"
docker stop hotel-crm-postgres-1 hotel-crm-redis-1
git status --short          # MUST be clean — delete any scratch-*.ts / *.mjs harnesses
```

**Always delete scratch scripts and test harnesses.** Multiple past runs left
`fix_*.py`, `check_db.*`, `configure_s3.sh`, and `e2e-*.mjs` files behind in the repo root.

## Pass criteria

- [ ] `pg_isready` reports accepting connections
- [ ] `migrate status` clean **and** the fresh-DB drift check says `No difference detected`
- [ ] Backend `/health` returns ok; frontend `/login` returns 200
- [ ] `FEATURE_EMPLOYMENT_RECORD=true` confirmed by a live request, not just the env file
- [ ] Admin login returns a token; both hotel groups and hotels exist with correct FKs
- [ ] Manager is `ACTIVE` **and** assigned (`Hotel.manager_user_id` set — verify by reading it)
- [ ] Flag states recorded in the run log
