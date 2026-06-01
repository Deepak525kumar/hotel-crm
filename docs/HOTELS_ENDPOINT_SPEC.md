# Hotels Endpoint Specification

**Module**: CRM / Hotels  
**Base URL**: `/api/v1/crm/hotels`  
**Auth**: All endpoints require `Authorization: Bearer <access_token>`

---

## Endpoints

---

### `GET /api/v1/crm/hotels`

List hotels accessible to the caller.

**Roles**: Manager, Admin  
**Manager scope**: Only hotels in `user.hotel_ids`, `is_active = true`  
**Admin scope**: All hotels, optional filters

#### Query Parameters

| Name | Type | Required | Constraints | Notes |
|------|------|----------|-------------|-------|
| `limit` | integer | No | 1–100, default 20 | Page size |
| `cursor` | string | No | cuid | Last hotel id from previous page |
| `country` | string | No | — | Admin only (silently ignored for managers) |
| `is_active` | boolean | No | true/false | Admin only (silently ignored for managers) |

#### Success Response `200`

```json
{
  "success": true,
  "data": {
    "hotels": [
      {
        "id": "clxxxxxxxxxxxxxxxxxxxxxxx",
        "name": "Hotel München Mitte",
        "city": "Munich",
        "country": "Germany",
        "address": "Bahnhofstr. 12, 80335 München",
        "timezone": "Europe/Berlin",
        "is_active": true,
        "created_at": "2026-01-15T08:00:00.000Z",
        "updated_at": "2026-05-20T14:30:00.000Z"
      }
    ],
    "pagination": {
      "next_cursor": "clxxxxxxxxxxxxxxxxxxxxxxx",
      "has_more": true,
      "total": 3
    }
  },
  "error": null
}
```

#### Error Responses

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Role is Worker or Checker |
| 400 | `INVALID_REQUEST` | `limit` out of range |

---

### `POST /api/v1/crm/hotels`

Create a new hotel.

**Roles**: Admin only

#### Request Body

```json
{
  "name": "Hotel Frankfurt Zentrum",
  "city": "Frankfurt",
  "country": "Germany",
  "address": "Kaiserstr. 5, 60311 Frankfurt",
  "timezone": "Europe/Berlin"
}
```

#### Field Constraints

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 2–100 chars, trimmed |
| `city` | string | Yes | 2–100 chars, trimmed |
| `country` | string | No | 2–100 chars, default `"Germany"` |
| `address` | string | Yes | 5–255 chars, trimmed |
| `timezone` | string | No | Valid IANA tz, default `"Europe/Berlin"` |

#### Success Response `201`

```json
{
  "success": true,
  "data": {
    "hotel": {
      "id": "clxxxxxxxxxxxxxxxxxxxxxxx",
      "name": "Hotel Frankfurt Zentrum",
      "city": "Frankfurt",
      "country": "Germany",
      "address": "Kaiserstr. 5, 60311 Frankfurt",
      "timezone": "Europe/Berlin",
      "is_active": true,
      "created_at": "2026-06-01T10:00:00.000Z",
      "updated_at": "2026-06-01T10:00:00.000Z"
    }
  },
  "error": null
}
```

#### Error Responses

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_REQUEST` | Missing/invalid fields |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Role is not Admin |

---

### `GET /api/v1/crm/hotels/:hotel_id`

Get a single hotel by ID.

**Roles**: Manager (own hotel only), Admin (any)

#### Path Parameters

| Name | Type | Required |
|------|------|----------|
| `hotel_id` | string (cuid) | Yes |

#### Success Response `200`

```json
{
  "success": true,
  "data": {
    "hotel": {
      "id": "clxxxxxxxxxxxxxxxxxxxxxxx",
      "name": "Hotel München Mitte",
      "city": "Munich",
      "country": "Germany",
      "address": "Bahnhofstr. 12, 80335 München",
      "timezone": "Europe/Berlin",
      "is_active": true,
      "created_at": "2026-01-15T08:00:00.000Z",
      "updated_at": "2026-05-20T14:30:00.000Z"
    }
  },
  "error": null
}
```

#### Error Responses

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Not in manager's hotel_ids, or hotel inactive |
| 404 | `NOT_FOUND` | Hotel ID does not exist |

---

### `PUT /api/v1/crm/hotels/:hotel_id`

Update hotel fields.

**Roles**: Manager (own hotel, limited fields), Admin (any hotel, all fields)

#### Path Parameters

| Name | Type | Required |
|------|------|----------|
| `hotel_id` | string (cuid) | Yes |

#### Request Body

All fields optional; at least one must be present.

```json
{
  "name": "Hotel München Mitte — Updated",
  "address": "Maximilianstr. 1, 80539 München",
  "is_active": false
}
```

#### Field Constraints

| Field | Type | Admin | Manager | Constraints |
|-------|------|-------|---------|-------------|
| `name` | string | ✅ | ✅ | 2–100 chars |
| `city` | string | ✅ | ✅ | 2–100 chars |
| `country` | string | ✅ | ✅ | 2–100 chars |
| `address` | string | ✅ | ✅ | 5–255 chars |
| `timezone` | string | ✅ | ✅ | Valid IANA tz |
| `is_active` | boolean | ✅ | ❌ (403) | Deactivate/reactivate |

#### Success Response `200`

```json
{
  "success": true,
  "data": {
    "hotel": {
      "id": "clxxxxxxxxxxxxxxxxxxxxxxx",
      "name": "Hotel München Mitte — Updated",
      "city": "Munich",
      "country": "Germany",
      "address": "Maximilianstr. 1, 80539 München",
      "timezone": "Europe/Berlin",
      "is_active": false,
      "created_at": "2026-01-15T08:00:00.000Z",
      "updated_at": "2026-06-01T10:00:00.000Z"
    }
  },
  "error": null
}
```

#### Error Responses

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_REQUEST` | Validation fails or no fields provided |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Not manager's hotel; manager sending is_active |
| 404 | `NOT_FOUND` | Hotel does not exist |

---

### `DELETE /api/v1/crm/hotels/:hotel_id`

Not supported in Phase 1.

#### Response `405`

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "METHOD_NOT_SUPPORTED",
    "message": "Hotels cannot be deleted. Use is_active=false to deactivate.",
    "details": {}
  }
}
```

---

## Middleware Chain (per request)

```
Request
  → Rate limiter (100 req/min per IP)
  → authenticateJWT          ← validates Bearer token
  → requireRole(['MANAGER', 'ADMIN'])   ← for all hotel routes
  → validateRequest(schema)  ← Zod validation (body or query)
  → requireHotelScope()      ← for /:hotel_id routes
  → controller
  → globalErrorHandler
```

---

## Audit Log Triggers

| Endpoint | Logged? | Action |
|----------|---------|--------|
| `GET /hotels` | ❌ | — |
| `GET /hotels/:id` | ❌ | — |
| `POST /hotels` | ✅ | `CREATE` |
| `PUT /hotels/:id` | ✅ | `MODIFY` |
| `PUT /hotels/:id` with `is_active` | ✅ | `MODIFY` (includes before/after in details) |
