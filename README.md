# Hotel CRM - Modular Monolith Architecture

**Version**: 1.0.0 (MVP - Phase 1)  
**Status**: Release Candidate — engineering implementation complete; production architecture
reconciled with the repository. See [`deploy/release/RELEASE_SUMMARY.md`](deploy/release/RELEASE_SUMMARY.md)
for current release status and remaining operational tasks.  
**Deployment**: Backend + worker on a single EC2 instance (eu-central-1 / Frankfurt) via PM2, no
containers. Frontend deployed separately on Vercel.

## Architecture Overview

We are building a **modular monolith** — a single Express.js + TypeScript application with clearly separated internal modules. Each module is designed to be extracted into a future microservice if needed, but runs in-process for MVP simplicity and performance.

### Why Modular Monolith (Not Microservices)?

| Aspect | Microservices | Modular Monolith |
|--------|---------------|------------------|
| Deployment | 10 containers | 1 container |
| Network overhead | Inter-service HTTP calls (+50ms) | In-process calls (0ms) |
| Debugging | Distributed tracing needed | Single process, simple logs |
| Team size needed | 5-7 devs | 3-4 devs |
| Infrastructure cost | €220/month | €87/month |
| Timeline | 12-16 weeks | 4 weeks |

## Repository Structure

```
hotel-crm/
├── backend/                    # Single Express.js + TypeScript monolith
│   ├── src/
│   │   ├── server.ts          # Single entry point
│   │   ├── config/            # Environment & service configuration
│   │   ├── middleware/        # Shared middleware (auth, validation, errors)
│   │   ├── modules/           # Business logic modules (each future microservice)
│   │   │   ├── auth/          # Authentication
│   │   │   ├── crm/           # Hotels, Rooms, Tasks
│   │   │   ├── hr/            # HR & Payroll
│   │   │   ├── quality/       # Quality Verification
│   │   │   ├── calendar/      # Availability & Scheduling
│   │   │   ├── staffing/      # Worker Assignment
│   │   │   ├── notifications/ # Push/Email/In-app
│   │   │   └── analytics/     # Metrics & Reporting
│   │   ├── shared/            # Common utilities (db, cache, logger, errors)
│   │   └── types/             # Shared TypeScript definitions
│   ├── prisma/                # Prisma ORM schema & migrations
│   ├── tests/                 # Test suite
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                   # Next.js dashboard
│   ├── app/                   # App Router structure
│   └── public/
│
├── mobile/                    # React Native apps
│   ├── worker-app/            # Worker/Staff app
│   └── checker-app/           # Quality Checker app
│
├── docs/                      # Architecture & API documentation
├── docker-compose.yml         # Local development services
├── _legacy/                   # Archived files from old architecture
│   ├── backend-microservices/ # Old microservice code
│   ├── docker/                # Old Docker configs
│   └── k8s/                   # Old Kubernetes configs
│
└── README.md                  # This file
```

## Module Boundaries

Each module in `backend/src/modules/` follows this structure:

```
module/
├── routes.ts       # Express route definitions
├── controller.ts   # HTTP request handlers
├── service.ts      # Business logic & database queries
├── model.ts        # Database model (via Prisma)
└── types.ts        # TypeScript interfaces for this module
```

### Modules

- **auth**: User authentication, JWT tokens, permissions
- **crm**: Hotels, rooms, workers, task management
- **hr**: Employee records, contracts, payroll
- **quality**: Quality verification, rating system
- **calendar**: Availability tracking, scheduling
- **staffing**: Worker assignment, optimization
- **notifications**: Push, email, in-app messaging
- **analytics**: Metrics, reporting, leaderboards

## Technology Stack

### Backend
- **Runtime**: Node.js + Express.js
- **Language**: TypeScript
- **ORM**: Prisma (PostgreSQL)
- **Cache**: Redis (optional, performance layer only)
- **Validation**: Zod
- **Testing**: Jest + Supertest
- **Deployment**: Docker on AWS EC2 (image in AWS ECR)

### Frontend
- **Framework**: Next.js 14+
- **Styling**: TailwindCSS
- **Components**: shadcn/ui
- **State**: Zustand/TanStack Query

### Mobile
- **Framework**: React Native + Expo
- **Platform**: iOS & Android
- **Deployment**: Expo EAS

### Database
- **Primary**: PostgreSQL 15 (AWS RDS PostgreSQL)
- **Cache**: Redis 7 (on EC2 via Docker; AWS ElastiCache when scaling)

## Getting Started

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15 (local or via Docker)

### Local Development Setup

```bash
# Clone repository
git clone <repo-url>
cd hotel-crm

# Install workspace dependencies
npm install

# Start local services (PostgreSQL, Redis, Adminer, MailHog)
docker-compose up -d

# Setup database
cd backend
npx prisma migrate dev
npx prisma db seed

# Start backend development server
npm run dev

# In another terminal, start frontend
cd ../frontend
npm run dev

# Access:
# - Backend API: http://localhost:3001
# - Frontend: http://localhost:3000
# - Database UI (Adminer): http://localhost:8082
# - Email UI (MailHog): http://localhost:8025
```

## Development Workflow

### Adding a New Module

1. Create folder: `backend/src/modules/module-name/`
2. Create files: `routes.ts`, `controller.ts`, `service.ts`, `model.ts`, `types.ts`
3. Update Prisma schema in `backend/prisma/schema.prisma`
4. Register routes in `backend/src/server.ts`
5. Add tests in `backend/tests/`

### Making Database Changes

```bash
cd backend

# Create migration
npx prisma migrate dev --name add_feature_name

# Reset (local only)
npx prisma migrate reset
```

### Running Tests

```bash
cd backend
npm test                    # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
```

## Architecture Decisions

### Modular Monolith vs Microservices
✅ **Chosen**: Modular Monolith (Phase 1)
- Single deployment, simple debugging, low ops cost
- Modules are designed for future microservice extraction
- Revisit in Phase 2 if scaling demands it

### Database
✅ **Chosen**: PostgreSQL + Prisma
- AWS RDS PostgreSQL (same db engine in dev/prod)
- Prisma ORM for type-safe queries
- No Supabase (avoid vendor lock-in)

### Caching
✅ **Chosen**: Redis as optional performance layer
- Cache is NOT source of truth
- App must work if Redis is unavailable
- Falls back to PostgreSQL queries

### Deployment
✅ **Chosen and implemented**: AWS (backend) + Vercel (frontend)
- Backend + worker: single EC2 instance, eu-central-1 (Frankfurt) region (EU compliance)
- **No containers** — PM2 process manager runs the built Node.js output directly
  (`ecosystem.config.js`: `hotel-crm-api` on port 3001, `hotel-crm-worker` for the notification
  outbox, no HTTP port). This supersedes an earlier planned Docker/ECR path that was never built.
- RDS PostgreSQL for the database, S3 for uploads/documents
- Frontend: deployed separately on Vercel, not part of the EC2/PM2 stack
- Scale horizontally behind an Application Load Balancer when needed (not yet provisioned — see
  `deploy/aws-edge-checklist.md`)

## Migration Path to Microservices (Phase 2+)

When traffic demands it:
1. Copy module folder into its own service
2. Add Express wrapper + Dockerfile
3. Replace in-process function calls with HTTP client calls
4. Deploy as separate container
5. Update reverse proxy routing

**Zero refactoring needed** — code is already organized for this.

## Environment Variables

Create `.env.local` in the `backend/` directory:

```env
# Database
DATABASE_URL="postgresql://hotelcrm:password@localhost:5432/hotelcrm_dev?schema=public"

# Redis
REDIS_URL="redis://:dev_password@localhost:6379"

# JWT
JWT_SECRET="your-secret-key-min-32-chars"

# Environment
NODE_ENV="development"
LOG_LEVEL="debug"

# AWS (production only)
AWS_REGION="eu-central-1"
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
S3_BUCKET=""
```

## API Standards

All endpoints must follow these rules:

1. **Response Format**:
   ```json
   {
     "success": true,
     "data": { /* payload */ },
     "error": null
   }
   ```

2. **Error Format**:
   ```json
   {
     "success": false,
     "data": null,
     "error": {
       "code": "INVALID_REQUEST",
       "message": "User-friendly message",
       "details": {}
     }
   }
   ```

3. **Validation**: Use Zod for all request bodies
4. **Auth**: JWT token in `Authorization: Bearer <token>` header
5. **Permissions**: Role-based access control (RBAC)

## RBAC & Permissions

All endpoints must check permissions. See `RBAC_PERMISSION_MATRIX.md` in `/docs/` for detailed permission matrix.

## Monitoring & Logging

- **Logs**: Structured JSON logs via Winston
- **Monitoring**: AWS CloudWatch (metrics, logs, alarms)
- **Tracing**: OpenTelemetry (Phase 2)
- **Alerts**: Uptime monitoring (Phase 2)

## Security & GDPR

### Required
- JWT authentication
- Role-based permissions
- Hotel-scoped data access
- Audit logging for HR/payroll
- GDPR-compliant deletion/export
- Encrypted HR documents
- Encrypted payroll data

### Never
- Expose payroll broadly
- Allow payroll deletion
- Bypass permission middleware
- Store sensitive data unencrypted

## Testing

- **Unit**: 80%+ coverage required
- **Integration**: Real database tests
- **E2E**: Cypress/Playwright (Phase 2)

## Deployment

**This section previously described a planned Docker/ECR deployment path. That was never built.**
The actual, current, production-verified deployment is PM2-on-EC2 with no containers, plus the
frontend deployed separately on Vercel. See `deploy/release/DEPLOYMENT_GUIDE.md` for the full,
current, evidence-verified procedure. Summary:

### Development
```bash
docker-compose up -d   # local Postgres/Redis/Adminer/MailHog only — dev-only, not used in prod
npm run dev
```

### Production

Backend + worker: automated via `.github/workflows/deploy.yml` on push to `main` (path-filtered
to backend changes) — SSHes into the EC2 host and runs `deploy.sh` (repository root), which pulls
the latest code, runs `prisma migrate deploy`, builds, and reloads both PM2 processes
(`hotel-crm-api`, `hotel-crm-worker`) via `ecosystem.config.js`. See
`deploy/release/DEPLOYMENT_GUIDE.md` for the exact sequence and manual-deploy fallback.

Frontend: deployed separately via Vercel's own pipeline — not part of this repository's CI/CD.

## Troubleshooting

### Database connection refused
- Check PostgreSQL is running: `docker-compose ps`
- Verify `DATABASE_URL` in `.env.local`
- Reset: `npx prisma migrate reset`

### Redis connection refused
- Check Redis is running: `docker-compose ps`
- Clear Redis: `redis-cli -a dev_password FLUSHALL`

### Type errors in modules
- Regenerate Prisma types: `npx prisma generate`
- Rebuild TypeScript: `tsc --noEmit`

## Contributing

1. Create feature branch from `main`
2. Follow module structure for new features
3. Write tests (80%+ coverage)
4. Update documentation
5. Submit PR with description of changes

## Phase 1 - MVP Scope

This section previously listed "Daily operations" as included and "Geolocation tracking" as
deferred — both were wrong as of the current codebase and have been corrected below.

### Included (implemented and shipped)
- Authentication, RBAC/permission matrix
- Hotels, hotel-groups, employment records
- Job dispatch (assignments, broadcast offers, calendar direct-assignments)
- Quality verification and rating system, leaderboard
- HR (contracts, documents, payslip requests — payslip fulfillment sub-feature check pending,
  see `deploy/release/KNOWN_LIMITATIONS.md`)
- Notifications (push + email via a transactional outbox)
- Worker geolocation check-in (`backend-geo` — implemented, not deferred)
- Consent and compliance (subject-rights export) — implemented; compliance's governance-report
  interface specifically remains deferred, see Post-MVP backlog
- Retention (audit log, eligibility, scheduled sweep) — implemented, spec still under review

### Explicitly out of MVP scope

The full, current list (with reasons) lives in `deploy/release/POST_MVP_BACKLOG.md` — do not
duplicate it here. Notable items: AI chatbot (zero code, `.placeholder` only, deliberately
deferred), Regional Manager role rollout (code complete, held on a promotion-script risk
decision), frontend automated test coverage, offline-first sync, compliance governance report,
advanced analytics beyond what's shipped, multi-region deployment, Kubernetes/microservices
(this MVP is a modular monolith by design — see "Migration Path to Microservices" above).

## Documentation

The six files previously listed here (`MASTER_ARCHITECTURE.md`, `CLAUDE_CONTEXT.md`, and four
files under `/docs/`) do not exist in this repository and were never created — corrected below to
point at what actually exists:

- [`HANDOFF.md`](HANDOFF.md) — current project handoff: what's done, what's left, operating rules
- [`deploy/release/`](deploy/release/) — the full release package: execution plan, launch
  checklist, UAT checklist, deployment/rollback guides, known limitations, post-MVP backlog,
  release summary
- [`docs/05-execution/`](docs/05-execution/) — release status and execution dashboard
- [`docs/03-modules/`](docs/03-modules/) — per-module specifications
- [`docs/14-governance/architecture-decisions/`](docs/14-governance/architecture-decisions/) —
  ADRs
- [`.claude/knowledge/`](.claude/knowledge/) — module registry and knowledge graph
- [`.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`](.claude/governance/SPECIFICATION_ISSUES_REGISTER.md)
  — tracked specification issues

## License

Proprietary - Zirove/Hotel CRM Project

## Support

For questions about architecture or implementation, refer to:
1. MASTER_ARCHITECTURE.md (decisions & rationale)
2. CLAUDE_CONTEXT.md (operational context)
3. Module README files in each service folder
