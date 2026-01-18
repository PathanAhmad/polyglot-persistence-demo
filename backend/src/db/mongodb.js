const { MongoClient } = require("mongodb");
const { config } = require("../config");

let client;

async function getMongo() {
  if (!client) {
    // I keep a single MongoClient for the whole app.
    client = new MongoClient(config.mongodb.uri);
    await client.connect();
  }

  const db = client.db(config.mongodb.db);
  return { client, db };
}

async function ensureMongoIndexes() {
  const { db } = await getMongo();

  // ===== UNIQUE CONSTRAINTS =====
  // Enforce orderId uniqueness so Student 1 can safely allocate numeric order IDs
  await db.collection("orders").createIndex({ orderId: 1 }, { name: "idx_orders_orderId_unique", unique: true });

  // People collection: quick lookup by email for both customers and riders.
  // (We store both roles in `people`, not in separate `customers` / `riders` collections.)
  await db.collection("people").createIndex({ email: 1 }, { name: "idx_people_email_unique", unique: true });

  // ===== STUDENT 1 INDEXES (Order Management & Reports) =====
  // Place Order & Report: Filter by restaurant name, sort by creation date
  await db.collection("orders").createIndex(
    { "restaurant.name": 1, createdAt: -1 },
    { name: "idx_orders_student1_report" }
  );

  // Pay Order: Look up order by orderId for payment.
  // Already covered by unique constraint above, but keep a composite index aligned to our document shape.
  try {
    await db.collection("orders").dropIndex("idx_orders_payment_lookup");
  } catch (_e) {
    // ignore: index might not exist / might already be correct
  }
  await db.collection("orders").createIndex(
    { orderId: 1, "payment.paidAt": 1 },
    { name: "idx_orders_payment_lookup" }
  );

  // ===== STUDENT 2 INDEXES (Delivery Management & Reports) =====
  // Assign & Report: Filter by rider email, date range, and delivery status
  try {
    await db.collection("orders").dropIndex("idx_orders_delivery_rider_date_status");
  } catch (_e) {
    // ignore: index might not exist (cleanup from earlier iterations)
  }

  await db.collection("orders").createIndex(
    { "delivery.rider.email": 1, createdAt: -1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 },
    { name: "idx_orders_student2_report" }
  );

  // Restaurants collection: Quick lookup by name for menu and ordering
  await db.collection("restaurants").createIndex(
    { name: 1 },
    { name: "idx_restaurants_name_unique", unique: true }
  );

  // ===== REPORTING INDEXES =====
  // Student 1: Orders by restaurant and date range (supports date filtering)
  await db.collection("orders").createIndex(
    { "restaurant.name": 1, createdAt: 1 },
    { name: "idx_orders_restaurant_date" }
  );

  // Student 2: Orders by rider and date range (supports date and status filtering)
  try {
    await db.collection("orders").dropIndex("idx_orders_rider_assignment");
  } catch (_e) {
    // ignore
  }
  await db.collection("orders").createIndex(
    { "delivery.rider.email": 1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 },
    { name: "idx_orders_rider_assignment" }
  );
}

module.exports = { getMongo, ensureMongoIndexes };

