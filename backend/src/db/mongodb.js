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

  // I index the fields my Student 2 report filters on.
  // I also clean up an older index name from earlier iterations so explain output is less confusing.
  try {
    await db.collection("orders").dropIndex("idx_orders_delivery_rider_date_status");
  } catch (_e) {
    // ignore: index might not exist
  }

  await db.collection("orders").createIndex(
    { "delivery.rider.email": 1, createdAt: -1, "delivery.deliveryStatus": 1, "delivery.assignedAt": -1 },
    { name: "idx_orders_student2_report" }
  );
}

module.exports = { getMongo, ensureMongoIndexes };

