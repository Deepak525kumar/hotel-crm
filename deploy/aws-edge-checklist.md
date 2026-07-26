# AWS Edge / DNS / SSL Setup Checklist — Hotel CRM

**Domain:** hotelcrm.app
**DNS:** AWS Route53 (optional — skip §1–§2 if the domain stays at an external registrar/DNS)
**SSL:** AWS Certificate Manager (ACM)
**Edge:** Application Load Balancer (ALB) + AWS WAF; CloudFront optional for CDN
**Region:** eu-central-1 (Frankfurt)

> Reconciled from Cloudflare to **AWS** as the single deployment platform. ACM provides TLS, the ALB terminates HTTPS, AWS WAF provides managed rules, and Route53 provides DNS (optional).

---

## 1. Route53 Hosted Zone (optional — only if migrating DNS to AWS)

- [ ] Route53 → Hosted zones → Create hosted zone → `hotelcrm.app` (public)
- [ ] Copy the four Route53 nameservers (NS record)
- [ ] Update nameservers at your domain registrar (replace existing NS records)
- [ ] Wait for nameserver propagation (up to 24h; usually < 1h)
- [ ] Confirm: `dig NS hotelcrm.app` returns the Route53 nameservers

> If the domain remains on an external DNS provider, skip this section and create the records there instead, pointing at the ALB DNS name (CNAME) or its IP via alias.

---

## 2. DNS Records

Create the following records after the ALB is provisioned (its DNS name is known).

| Type | Name | Value | Notes |
|------|------|-------|-------|
| A (alias) | `api` | ALB DNS name | Alias → ALB (Route53) |
| A (alias) | `hotelcrm.app` | ALB DNS name | Alias → ALB |
| A (alias) | `www` | ALB DNS name | Alias → ALB |
| A (alias) | `staging-api` | Staging ALB / EC2 | Alias → staging target |
| A | `status` | UptimeRobot status page IP | DNS only |

> For non-Route53 DNS, use a CNAME to the ALB DNS name instead of an alias.

- [ ] All production records created (alias to ALB)
- [ ] Staging record created
- [ ] DNS propagated: `dig api.hotelcrm.app` resolves to the ALB

---

## 3. SSL/TLS Configuration (ACM)

- [ ] ACM (region `eu-central-1`) → Request a public certificate
  - Domains: `hotelcrm.app`, `*.hotelcrm.app`
  - Validation: **DNS validation** (add the CNAME records ACM provides; auto-created if using Route53)
- [ ] Wait for status **Issued**
- [ ] Attach the ACM certificate to the ALB HTTPS (443) listener
- [ ] Configure the ALB HTTP (80) listener to redirect to HTTPS (443)
- [ ] Enable HSTS via an ALB listener rule / response header (max-age 6 months, includeSubDomains; preload only after verification)
- [ ] Confirm: `curl -I https://api.hotelcrm.app/api/v1/health` returns 200

> **No-ALB MVP alternative:** terminate TLS on Nginx on the EC2 instance using Let's Encrypt (certbot). ACM-on-ALB is the recommended path.

---

## 4. AWS WAF — Managed Rules

- [ ] WAF & Shield → Create web ACL → associate with the ALB
- [ ] Add **AWS Managed Rules — Core rule set (CRS)**
- [ ] Add **Known bad inputs** and **IP reputation** managed rule groups
- [ ] Set rule actions to **Block** for malicious matches
- [ ] AWS Shield Standard (automatic, free) provides L3/L4 DDoS protection

---

## 5. Rate Limiting (AWS WAF)

> `ADR-031` D-6: rate limiting is an edge-level control (Nginx zones for the no-ALB MVP path,
> §5 below for the ALB/WAF path) per `TREQ-AUTH-008`/`TRULE-AUTH-002` (`SPEC-AUTH-001`, Confirmed
> authority) — no rate-limiting/CAPTCHA is introduced at the application layer. IP-keyed only;
> per-account throttling is an explicit, accepted gap (`ADR-031` §10 OI-3a), not built here.
> A Cloudflare-equivalent edge rule is an acceptable substitute for AWS WAF if the deployment
> topology changes — `TREQ-AUTH-008` names Nginx/Cloudflare interchangeably.

- [ ] In the web ACL, add a **rate-based rule**:
  - Name: `auth-strict-rate-limit`
  - Scope-down statement: URI path is exactly `/api/v1/auth/login` or `/api/v1/auth/password-reset/confirm`
  - Rate: **100 requests per 5 minutes per IP** (AWS WAF's minimum evaluation rate is 100/5min, so this is the closest floor to Nginx's stricter `auth_strict` zone — 1r/s, ~300/5min with bursting — not an exact match; the WAF rule is a coarser backstop, not a substitute for the Nginx zone on the no-ALB path)
  - Action: Block
- [ ] Add a second rate-based rule:
  - Name: `auth-rate-limit`
  - Scope-down statement: URI path starts with `/api/v1/auth` **and does not match** `auth-strict-rate-limit`'s scope-down (WAF evaluates rules in order; a request already blocked/rate-limited by `auth-strict-rate-limit` should not double-count here) — covers `signup`, `refresh`, `password-reset`
  - Rate: 300 requests per 5 minutes per IP — deliberately looser than `auth-strict-rate-limit`'s 100/5min floor, preserving the same two-tier intent as the Nginx zones (`auth_strict` 1r/s vs `auth` 2r/s) even though WAF's evaluation floor prevents an exact numeric match
  - Action: Block
- [ ] Add a broader API rate-based rule (e.g. 2000 req / 5 min per IP) as a safety net

---

## 6. Origin Protection

- [ ] EC2 security group: allow 3001/3000 **only** from the ALB security group (no direct internet access to the origin)
- [ ] ALB security group: allow 443 (and 80 for redirect) from `0.0.0.0/0`
- [ ] (Optional) Restrict the ALB to CloudFront via a custom header + WAF rule if CloudFront is added

---

## 7. CloudFront / Caching (optional CDN)

- [ ] (Optional) Create a CloudFront distribution with the ALB as origin
  - Behavior `/api/*` → cache disabled (API responses must not be cached)
  - Behavior `/_next/static/*` → cache enabled, TTL 1 month
  - Attach the ACM certificate (must be in `us-east-1` for CloudFront)

---

## 8. Monitoring

- [ ] CloudWatch → confirm ALB metrics (RequestCount, TargetResponseTime, HTTPCode_Target_5XX) are visible
- [ ] WAF → enable logging to CloudWatch Logs / S3; bookmark the blocked-requests dashboard for weekly review
- [ ] CloudWatch alarm on ALB 5XX rate and unhealthy target count

---

## 9. Failover DNS (DR Preparation)

When a region failover to eu-west-1 is needed:

```
1. Provision a replacement ALB + EC2 in eu-west-1
2. In Route53, update the alias records:
   api.hotelcrm.app → eu-west-1 ALB
   hotelcrm.app     → eu-west-1 ALB
3. Use a low record TTL (60s) for fast propagation
```

- [ ] eu-west-1 ALB DNS name is documented in the DR runbook before it is needed
- [ ] (Optional) Route53 health check + failover routing policy configured for automatic failover

---

## 10. Post-Launch Verification

- [ ] `https://api.hotelcrm.app/api/v1/health` → 200 OK
- [ ] `https://hotelcrm.app` → loads frontend
- [ ] `https://www.hotelcrm.app` → redirects to `https://hotelcrm.app`
- [ ] `http://api.hotelcrm.app` → redirects to `https://`
- [ ] SSL Labs test: `https://www.ssllabs.com/ssltest/` → grade A or A+
- [ ] Security headers check: `https://securityheaders.com/` → grade A
- [ ] WAF web ACL shows traffic and blocked requests in CloudWatch
</content>
