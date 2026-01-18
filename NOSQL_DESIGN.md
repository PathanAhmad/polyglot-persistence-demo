# MongoDB (NoSQL) Design

This document describes what we actually store in MongoDB in this project, why we shaped it that way, and how we check index usage with `mongosh`.

MongoDB is used in **Mongo mode** endpoints and also as the target of our SQL -> Mongo migration (`POST /api/migrate_to_mongo`).

---

## NoSQL structure / collections

### Collection: `restaurants`
Created by migration.

```javascript
{
  _id: ObjectId,
  restaurantId: Number,
  name: String,      // unique
  address: String
}
```

What we did not store here:
- We do **not** migrate `menu_item` into MongoDB in this project. Orders store their own `orderItems` snapshots.

---

### Collection: `people`
Created by migration. We keep customers + riders in one collection with a `type` discriminator.

```javascript
{
  _id: ObjectId,
  personId: Number,
  type: "customer" | "rider" | "person",
  name: String,
  email: String,
  phone: String | null,

  customer: null | {
    defaultAddress: String | null,
    preferredPaymentMethod: String | null
  },

  rider: null | {
    vehicleType: String,
    rating: Number | null
  }
}
```

---

### Collection: `orders`
Created by migration and also written directly by Mongo mode endpoints.

```javascript
{
  _id: ObjectId,
  orderId: Number,          // unique
  createdAt: Date,
  status: String,           // e.g. "created", "preparing", ...
  totalAmount: Number,

  // we keep a snapshot for reporting
  restaurant: {
    restaurantId: Number,
    name: String,
    address: String
  } | null,

  // we keep a snapshot for reporting
  customer: {
    personId: Number,
    name: String,
    email: String
  } | null,

  // embedded because items belong to the order lifecycle
  orderItems: [
    {
      menuItemId: Number | null,
      name: String | null,
      quantity: Number,
      unitPrice: Number
    }
  ],

  // embedded 1:1 (may start as null)
  payment: null | {
    paymentId: Number | null,
    amount: Number,
    method: String,
    paidAt: Date
  },

  // embedded 1:1 (may start as null)
  delivery: null | {
    deliveryId: Number,
    deliveryStatus: String,
    assignedAt: Date | null,
    rider: {
      personId: Number,
      name: String,
      email: String,
      vehicleType: String | null,
      rating: Number | null
    } | null
  }
}
```

---

## Design notes

We have a separate `people` collection so we can quickly look up customers and riders by email. Orders and deliveries just keep a bit of extra info about people and restaurants (like their name or email) because it's often enough for showing reports or lists. This means we don't have to worry much if someone's details change later - it won't mess up existing orders.

For each order, we put everything related to it (like the items, payment, and delivery info) together inside the order document. That way, adding a payment or updating the delivery is as simple as changing one thing, and we don't have to worry about joining different collections all the time.

Basically, we put details we often need to quickly show (like restaurant name, customer email) straight into each order, so most things the app needs are right there already. This makes the system simpler, and we don't need to run complicated lookups just to get some basic info.
---

## MongoShell query syntax examples

Assume we are in the right DB:

```javascript
use ms2
```

### Look up a customer/rider by email

```javascript
db.people.findOne({ type: "customer", email: "customer1@example.com" })
db.people.findOne({ type: "rider", email: "rider1@example.com" })
```

### Student 1 report-style filter (orders by restaurant + optional date range)

```javascript
db.orders.find({
  "restaurant.name": "Plachutta",
  createdAt: { $gte: ISODate("2026-01-01"), $lte: ISODate("2026-01-31") }
}).sort({ createdAt: -1 })
```

### Student 2 report-style filter (orders by rider + optional status)

```javascript
db.orders.find({
  "delivery.rider.email": "rider1@example.com",
  "delivery.deliveryStatus": "delivered"
}).sort({ "delivery.assignedAt": -1 })
```

---

## Indexing strategy (and execution stats)

We create indexes in `backend/src/db/mongodb.js` (called on `/api/health` and after migration).

### Lookup + integrity
- `orders`: `idx_orders_orderId_unique` on `{ orderId: 1 }` (unique)
  - Used by pay/assign endpoints that target an order by `orderId`.
- `restaurants`: `idx_restaurants_name_unique` on `{ name: 1 }` (unique)
  - Used to resolve a restaurant by name.
- `people`: `idx_people_email_unique` on `{ email: 1 }` (unique)
  - Used to resolve a customer/rider by email (`db.people.findOne({ type, email })`).
- `orders`: `idx_orders_payment_lookup` on `{ orderId: 1, "payment.paidAt": 1 }`
  - Note: payment is stored as `payment.paidAt` (camelCase), so the index must match that shape.

### Reporting
- `idx_orders_student1_report` on `{ "restaurant.name": 1, createdAt: -1 }`
- `idx_orders_student2_report` on `{ "delivery.rider.email": 1, createdAt: -1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 }`
- We also create two additional "range-friendly" report indexes:
  - `idx_orders_restaurant_date` on `{ "restaurant.name": 1, createdAt: 1 }`
  - `idx_orders_rider_assignment` on `{ "delivery.rider.email": 1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 }`

### Checking index usage with `explain("executionStats")`
We don't guess performance numbers here; we verify the plan:

```javascript
db.orders.find({ orderId: 1 }).explain("executionStats")
```

What we want to see:
- `executionStages.stage` contains **`IXSCAN`** (not `COLLSCAN`)
- `totalDocsExamined` is small relative to the collection size

Student 1 report example:

```javascript
db.orders.find({
  "restaurant.name": "Plachutta"
}).sort({ createdAt: -1 }).explain("executionStats")
```

Student 2 report example:

```javascript
db.orders.find({
  "delivery.rider.email": "rider1@example.com",
  "delivery.deliveryStatus": "delivered"
}).sort({ "delivery.assignedAt": -1 }).explain("executionStats")
```
