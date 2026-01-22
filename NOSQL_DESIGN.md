# MongoDB (NoSQL) Design

## Overview

This document explains how the SQL schema is represented in MongoDB after migration, and why specific embedding/denormalization choices were made.

The goal of the MongoDB model is a **read-optimized shape** for the API endpoints and reports, while keeping **historical order data accurate**.

---

## How We Organized the Data

### Restaurants Collection

During migration from SQL, we copy the restaurant’s stable attributes (ID, name, address).

We intentionally do **not** use the SQL `menu_item` table as a first-class MongoDB collection for the API. Menu prices change over time; if orders referenced “live” menu items, historical orders could display the wrong unit prices. Instead, we snapshot item details into each order at creation time so order history remains consistent.

**Example structure:**

```javascript
{
  _id: ObjectId,
  restaurantId: Number,
  name: String,      // unique restaurant name
  address: String
}
```

---

### People Collection

Customers and riders are stored in a single `people` collection with a discriminator field (`type`).

This keeps common fields (name/email/phone) in one place and simplifies lookups (for example, finding a person by email). Role-specific attributes are nested under `customer` or `rider`.

**Example structure:**

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

### Orders Collection

Each order document contains everything required to render an order and run reports without joins:

- embedded `orderItems`
- embedded `payment`
- embedded `delivery` (including the assigned rider snapshot)
- snapshots of `restaurant` and `customer` at order time

Snapshotting is important: if a restaurant name/address changes or a customer updates contact details, historical orders should still show the original state at the time the order was placed.

**Example structure:**

```javascript
{
  _id: ObjectId,
  orderId: Number,          // unique identifier
  createdAt: Date,
  status: String,           // like "created", "preparing", etc.
  totalAmount: Number,

  // snapshot of restaurant info at order time
  restaurant: {
    restaurantId: Number,
    name: String,
    address: String
  } | null,

  // snapshot of customer info at order time
  customer: {
    personId: Number,
    name: String,
    email: String
  } | null,

  // all items in this order
  orderItems: [
    {
      menuItemId: Number | null,
      name: String | null,
      quantity: Number,
      unitPrice: Number
    }
  ],

  // payment details (added when payment is made)
  payment: null | {
    paymentId: Number | null,
    amount: Number,
    method: String,
    paidAt: Date
  },

  // delivery details (added when delivery is assigned)
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

## Key Design Decisions

**Denormalization (copying data):** In MongoDB we duplicate a small amount of data to avoid repeated joins/lookups for read-heavy endpoints. In this project, restaurant/customer snapshots inside orders make common queries and reporting straightforward.

**Embedding vs. referencing:** Order-related entities (items, payment, delivery) are embedded because they are tightly coupled to the order lifecycle. People and restaurants remain separate collections because they are independently queried.

**Historical accuracy:** Snapshots preserve what actually happened at order time (prices, restaurant/customer identity), which is important for order history and reports.

---

## Query Examples

**Looking up a person by email:**

```javascript
db.people.findOne({ type: "customer", email: "customer1@example.com" })
db.people.findOne({ type: "rider", email: "rider1@example.com" })
```

**Finding orders for a specific restaurant (with optional date filter):**

```javascript
db.orders.find({
  "restaurant.name": "Plachutta",
  createdAt: { $gte: ISODate("2026-01-01"), $lte: ISODate("2026-01-31") }
}).sort({ createdAt: -1 })
```

**Finding orders for a specific rider:**

```javascript
db.orders.find({
  "delivery.rider.email": "rider1@example.com",
  "delivery.deliveryStatus": "delivered"
}).sort({ "delivery.assignedAt": -1 })
```

---

## Performance & Indexing

### Why indexes matter

Without indexes, MongoDB must scan documents to satisfy filters. Indexes make lookups and report queries scale by allowing MongoDB to jump to the relevant subset.

### What we indexed

We created indexes that match the application’s query patterns:

**Basic lookups:**
- orders by order ID (used by payment and delivery operations)
- restaurants by name
- people by email

These are unique indexes to also prevent duplicates.

**Reporting queries:**
- orders by restaurant name
- orders by rider email and delivery status

### How we verify index usage

MongoDB’s `explain()` shows whether a query uses an index (IXSCAN) or scans the full collection (COLLSCAN).

```javascript
db.orders.find({ "restaurant.name": "Plachutta" }).explain("executionStats")
```

---

## Migration tracking

After migrating data from SQL to MongoDB, the system stores a small metadata document that records when migration happened and how many documents were migrated. The `/api/health` endpoint returns this info, and the frontend uses it to automatically display the active data source.

---

## Notes on tooling

AI tooling was used only for light language editing; the design decisions and implementation were made and verified by the authors.
