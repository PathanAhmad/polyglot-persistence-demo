/*
  What this file does:
  We keep MongoDB access in one place. We open a single MongoClient lazily (first call wins)
  and then reuse it for the lifetime of the Node process. We also create the indexes our
  API depends on so common lookups and reports stay fast, and so a few fields are truly unique.
*/

const { MongoClient } = require("mongodb");
const { config } = require("../config");

let client;

async function getMongo() {
  if ( !client ) {
    /*
      We only create/connect the client once.
      Everything else in the app should call `getMongo()` and reuse this connection.
    */
    client = new MongoClient(config.mongodb.uri);
    await client.connect();
  }

  const db = client.db(config.mongodb.db);
  return { client, db };
}

async function ensureMongoIndexes() {
  const { db } = await getMongo();

  /*
    Uniqueness guarantees:
    We enforce uniqueness in Mongo itself (not just in application code) so we can't end up
    with duplicate IDs/emails even under concurrency.
  */
  await db.collection("orders").createIndex({ orderId: 1 }, { name: "idx_orders_orderId_unique", unique: true });

  /*
    Quick login/lookup by email:
    We store both customers and riders in `people`, so email needs to be fast and unique there.
  */
  await db.collection("people").createIndex({ email: 1 }, { name: "idx_people_email_unique", unique: true });

  /*
    Student 1 (orders + report):
    We index by restaurant name and creation time because the UI/report filters by restaurant
    and tends to show newest orders first.
  */
  await db.collection("orders").createIndex(
    { "restaurant.name": 1, createdAt: -1 },
    { name: "idx_orders_student1_report" }
  );

  /*
    Payment lookup:
    `orderId` is already unique, but We keep a named index we can rely on (and evolve) that matches
    how the payment flow queries orders.
  */
  try {
    // If an old/previously-named index exists, We remove it so reruns don’t error.
    await db.collection("orders").dropIndex("idx_orders_payment_lookup");
  } catch (_e) {
    // It's fine if the index doesn't exist yet.
  }
  await db.collection("orders").createIndex(
    { orderId: 1, "payment.paidAt": 1 },
    { name: "idx_orders_payment_lookup" }
  );

  /*
    Student 2 (delivery + report):
    We index by rider email + timestamps + delivery status because assignment/reporting filters on those.
  */
  try {
    // We clean up earlier index variants to keep the names consistent across runs.
    await db.collection("orders").dropIndex("idx_orders_delivery_rider_date_status");
  } catch (_e) {
    // It's fine if it never existed (leftover from earlier iterations).
  }

  await db.collection("orders").createIndex(
    { "delivery.rider.email": 1, createdAt: -1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 },
    { name: "idx_orders_student2_report" }
  );

  /*
    Restaurant lookup:
    We keep restaurant names unique and fast to query because ordering/menu endpoints look them up by name.
  */
  await db.collection("restaurants").createIndex(
    { name: 1 },
    { name: "idx_restaurants_name_unique", unique: true }
  );

  /*
    Extra reporting support:
    These are more “general” indexes that help date-range reporting patterns.
  */
  await db.collection("orders").createIndex(
    { "restaurant.name": 1, createdAt: 1 },
    { name: "idx_orders_restaurant_date" }
  );

  // Rider assignment/report queries are built around rider + status + assignedAt.
  try {
    await db.collection("orders").dropIndex("idx_orders_rider_assignment");
  } catch (_e) {
    // It's fine if it doesn't exist yet.
  }
  await db.collection("orders").createIndex(
    { "delivery.rider.email": 1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 },
    { name: "idx_orders_rider_assignment" }
  );
}

module.exports = { getMongo, ensureMongoIndexes };

