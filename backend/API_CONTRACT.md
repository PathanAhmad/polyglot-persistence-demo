# Backend API Contract (MS2)

This is the minimal contract the frontend can call. We keep it simple and explicit (no ORM magic).

## Base

- Base URL: `/api`
- All responses are JSON.

## Health

### GET `/api/health`

**200**

```json
{
  "ok": true,
  "activeMode": "sql",
  "mariadb": { "ok": true },
  "mongo": {
    "ok": true,
    "counts": { "restaurants": 10, "people": 30, "orders": 30 },
    "migration": {
      "source": "mariadb",
      "lastMigrationAt": "2026-01-18T12:00:00.000Z",
      "migrated": { "restaurants": 10, "people": 30, "orders": 30 }
    }
  }
}
```

## Import / Reset (MariaDB)

### POST `/api/import_reset`

We delete existing relational data and generate fresh randomized data for demos/testing.

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
    { "orderId": 101, "createdAt": "2026-01-14T10:00:00.000Z", "status": "created", "totalAmount": 24.5, "restaurantName": "Plachutta" }
  ]
}
```

## Student 1 - SQL (MariaDB)

### POST `/api/student1/sql/place_order`

We create a new order for a customer at a restaurant, insert multiple order items (weak entity), and update the order total.

Request body:

```json
{
  "customerEmail": "customer1@example.com",
  "restaurantName": "Plachutta",
  "items": [
    { "menuItemId": 1, "quantity": 2 },
    { "menuItemName": "Wiener Schnitzel", "quantity": 1 }
  ]
}
```

**200**

```json
{
  "ok": true,
  "order": {
    "orderId": 101,
    "createdAt": "2026-01-14T10:00:00.000Z",
    "status": "created",
    "totalAmount": 24.5,
    "restaurant": { "name": "Plachutta", "address": "Kaerntner Strasse 10, 1010 Wien" },
    "customer": { "name": "Customer 1", "email": "customer1@example.com" },
    "orderItems": [
      { "menuItemId": 1, "name": "Tafelspitz", "quantity": 2, "unitPrice": 9.5 }
    ]
  }
}
```

### POST `/api/student1/sql/pay`

We create (or finalize) the payment for an order and update the order status from `created` -> `preparing`.

Request body:

```json
{
  "orderId": 101,
  "paymentMethod": "card"
}
```

**200**

```json
{
  "ok": true,
  "payment": {
    "paymentId": 55,
    "orderId": 101,
    "amount": 24.5,
    "method": "card",
    "paidAt": "2026-01-14T10:05:00.000Z"
  }
}
```

### GET `/api/student1/sql/report`

Query params:
- `restaurantName` (required)
- `from` (optional ISO date)
- `to` (optional ISO date)

**200**

```json
{
  "ok": true,
  "rows": [
    {
      "restaurantName": "Plachutta",
      "orderId": 101,
      "orderCreatedAt": "2026-01-14T10:00:00.000Z",
      "status": "preparing",
      "totalAmount": 24.5,
      "customerEmail": "customer1@example.com",
      "customerName": "Customer 1",
      "paymentAmount": 24.5,
      "paymentMethod": "card",
      "paidAt": "2026-01-14T10:05:00.000Z"
    }
  ]
}
```

## Student 1 - MongoDB

### POST `/api/student1/mongo/place_order`

Same intent as the SQL endpoint, but writes to MongoDB.

Request body:

```json
{
  "customerEmail": "customer1@example.com",
  "restaurantName": "Plachutta",
  "items": [
    { "menuItemId": 1, "name": "Gulasch", "quantity": 2, "unitPrice": 9.5 }
  ]
}
```

**200**

```json
{ "ok": true, "orderId": 101 }
```

### POST `/api/student1/mongo/pay`

Same JSON body as the SQL endpoint.

**200**

```json
{ "ok": true, "orderId": 101, "status": "preparing", "payment": { "amount": 24.5, "method": "card", "paidAt": "2026-01-14T10:05:00.000Z" } }
```

### GET `/api/student1/mongo/report`

Same query params and same output shape as the SQL report (as close as practical).

## Student 2 - SQL (MariaDB)

### POST `/api/student2/sql/assign_delivery`

We assign a rider to an order's delivery (create delivery if missing) and update the delivery status.

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
      "restaurantName": "Plachutta"
    }
  ]
}
```

## Migration (SQL -> MongoDB)

### POST `/api/migrate_to_mongo`

We clear MongoDB collections and migrate the current MariaDB data into MongoDB documents (no re-randomizing).

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

## Student 2 - MongoDB

### POST `/api/student2/mongo/assign_delivery`

Same JSON body as the SQL endpoint.

**200**

```json
{ "ok": true }
```

### GET `/api/student2/mongo/report`

Same query params and same output shape as the SQL report (as close as practical).

