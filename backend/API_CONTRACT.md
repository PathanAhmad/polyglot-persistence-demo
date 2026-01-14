# Backend API Contract (MS2)

This is the minimal contract the frontend can call. I keep it simple and explicit (no ORM magic).

## Base

- Base URL: `/api`
- All responses are JSON.

## Health

### GET `/api/health`

**200**

```json
{ "ok": true }
```

## Import / Reset (MariaDB)

### POST `/api/import_reset`

I delete existing relational data and generate fresh randomized data for demos/testing.

**200**

```json
{
  "ok": true,
  "inserted": {
    "restaurants": 10,
    "menuItems": 60,
    "customers": 20,
    "riders": 10,
    "orders": 30,
    "orderItems": 90,
    "payments": 30,
    "deliveries": 18
  }
}
```

## Dropdown / selection data

### GET `/api/riders`

**200**

```json
{
  "ok": true,
  "riders": [
    { "riderId": 1, "name": "Alice Rider", "email": "alice.rider@example.com", "vehicleType": "bike", "rating": 4.7 }
  ]
}
```

### GET `/api/orders`

Query params:
- `status` (optional): e.g. `created`, `preparing`, `ready`
- `limit` (optional, default 50)

**200**

```json
{
  "ok": true,
  "orders": [
    { "orderId": 101, "createdAt": "2026-01-14T10:00:00.000Z", "status": "created", "totalAmount": 24.5, "restaurantName": "Pasta Place" }
  ]
}
```

## Student 2 — SQL (MariaDB)

### POST `/api/student2/sql/assign_delivery`

I assign a rider to an order’s delivery (create delivery if missing) and update the delivery status.

Request body:

```json
{
  "riderEmail": "alice.rider@example.com",
  "orderId": 101,
  "deliveryStatus": "assigned"
}
```

**200**

```json
{
  "ok": true,
  "delivery": {
    "deliveryId": 55,
    "orderId": 101,
    "riderEmail": "alice.rider@example.com",
    "deliveryStatus": "assigned",
    "assignedAt": "2026-01-14T10:05:00.000Z"
  }
}
```

**400** (bad input)

```json
{ "ok": false, "error": "orderId is required" }
```

**404** (unknown order or rider)

```json
{ "ok": false, "error": "rider not found" }
```

### GET `/api/student2/sql/report`

Query params:
- `riderEmail` (required)
- `from` (optional ISO date)
- `to` (optional ISO date)
- `deliveryStatus` (optional)

**200**

```json
{
  "ok": true,
  "rows": [
    {
      "riderEmail": "alice.rider@example.com",
      "riderName": "Alice Rider",
      "vehicleType": "bike",
      "deliveryId": 55,
      "deliveryStatus": "assigned",
      "assignedAt": "2026-01-14T10:05:00.000Z",
      "orderId": 101,
      "orderCreatedAt": "2026-01-14T10:00:00.000Z",
      "totalAmount": 24.5,
      "restaurantName": "Pasta Place"
    }
  ]
}
```

## Migration (SQL → MongoDB)

### POST `/api/migrate_to_mongo`

I clear MongoDB collections and migrate the current MariaDB data into MongoDB documents (no re-randomizing).

**200**

```json
{
  "ok": true,
  "migrated": {
    "restaurants": 10,
    "people": 30,
    "orders": 30
  }
}
```

## Student 2 — MongoDB

### POST `/api/student2/mongo/assign_delivery`

Same JSON body as the SQL endpoint.

**200**

```json
{ "ok": true }
```

### GET `/api/student2/mongo/report`

Same query params and same output shape as the SQL report (as close as practical).

