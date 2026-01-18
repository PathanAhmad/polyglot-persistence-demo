const { withTx } = require("../db/mariadb");
const { config } = require("../config");
const { readSchemaSql } = require("../utils/schema");
const { getMongo } = require("../db/mongodb");

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(rng, arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    // I fail loudly (with stack) so empty-pick bugs are always traceable.
    throw new Error("pick() called with empty array");
  }
  return arr[randInt(rng, 0, arr.length - 1)];
}

function makeRng(seedNumber) {
  // I use a tiny deterministic RNG so demos are reproducible when SEED is set.
  // This is a standard LCG.
  let state = seedNumber >>> 0;
  return function rng() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function recreateSchema(conn) {
  const schemaSql = readSchemaSql(config.schemaSqlPath);
  await conn.query(schemaSql);
}

async function clearAll(conn) {
  // Root cause note:
  // MariaDB/InnoDB can reject TRUNCATE for parent tables that are referenced by FKs.
  // So I use DELETE (DML) in FK-safe order, then reset AUTO_INCREMENT where relevant.
  const deleteOrder = [
    "menu_item_category",
    "rider_works_for",
    "order_item",
    "payment",
    "delivery",
    "`order`",
    "menu_item",
    "category",
    "restaurant",
    "customer",
    "rider",
    "person"
  ];

  for (const t of deleteOrder) {
    await conn.query(`DELETE FROM ${t}`);
  }

  // I reset auto-increment counters so IDs start from 1 again after reset.
  const autoIncTables = ["person", "restaurant", "menu_item", "category", "`order`", "order_item", "payment", "delivery"];
  for (const t of autoIncTables) {
    await conn.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`);
  }
}

async function clearMongoAfterSqlReset() {
  const { db } = await getMongo();

  // Root cause fix:
  // Import/Reset refreshes MariaDB, so we must clear any previous "migration happened"
  // marker in Mongo. Otherwise /api/health would keep reporting activeMode="mongo"
  // and the UI would keep calling Mongo endpoints with stale data.
  await Promise.all([
    db.collection("restaurants").deleteMany({}),
    db.collection("people").deleteMany({}),
    db.collection("orders").deleteMany({}),
    db.collection("meta").deleteOne({ _id: "migration" })
  ]);
}

async function importResetMariaDb() {
  const inserted = await withTx(async (conn) => {
    // I (1) ensure schema exists, (2) clear old data, then (3) insert fresh randomized data.
    await recreateSchema(conn);
    await clearAll(conn);

    const seed = process.env.SEED ? Number(process.env.SEED) : Date.now();
    const rng = makeRng(Number.isFinite(seed) ? seed : Date.now());

    // Vienna-based demo data (restaurants + realistic Vienna-style addresses)
    const restaurantNames = [
      "Figlmueller",
      "Plachutta",
      "Cafe Central",
      "Zum Schwarzen Kameel",
      "Lugeck",
      "Steirereck",
      "NENI am Naschmarkt",
      "Gasthaus Poeschel",
      "Schnitzelwirt",
      "Vapiano Wien Mitte"
    ];

    const viennaAddressPool = [
      { street: "Kaerntner Strasse", postcode: "1010" },
      { street: "Rotenturmstrasse", postcode: "1010" },
      { street: "Mariahilfer Strasse", postcode: "1060" },
      { street: "Waehringer Strasse", postcode: "1090" },
      { street: "Praterstrasse", postcode: "1020" },
      { street: "Landstrasser Hauptstrasse", postcode: "1030" },
      { street: "Favoritenstrasse", postcode: "1040" },
      { street: "Schoenbrunner Strasse", postcode: "1050" },
      { street: "Thaliastrasse", postcode: "1160" },
      { street: "Donaufelder Strasse", postcode: "1210" }
    ];

    function makeViennaAddress(rng) {
      const a = pick(rng, viennaAddressPool);
      const houseNo = randInt(rng, 1, 200);
      return `${a.street} ${houseNo}, ${a.postcode} Wien`;
    }
    const vehicles = ["bike", "scooter", "car"];
    const payMethods = ["card", "cash", "paypal"];
    const categories = ["vegan", "spicy", "dessert", "drink", "starter", "main"];

    // Restaurants
    const restaurantIds = [];
    for (let i = 0; i < 10; i++) {
      const name = restaurantNames[i] || `Restaurant ${i + 1}`;
      const address = makeViennaAddress(rng);
      const r = await conn.query("INSERT INTO restaurant (name, address) VALUES (?, ?)", [name, address]);
      restaurantIds.push(Number(r.insertId));
    }

    // Categories
    const categoryIdByName = new Map();
    for (const c of categories) {
      const r = await conn.query("INSERT INTO category (name) VALUES (?)", [c]);
      categoryIdByName.set(c, Number(r.insertId));
    }

    // Menu items
    // Root cause fix:
    // If menu items are assigned to restaurants purely at random, a restaurant can (rarely) end up
    // with zero items. Order generation later picks a menu item for the chosen restaurant, so
    // we guarantee every restaurant gets at least 1 menu item.
    const menuItemTotal = 60;
    if (restaurantIds.length > menuItemTotal) {
      throw new Error(`Cannot generate menu items: ${restaurantIds.length} restaurants but only ${menuItemTotal} items`);
    }

    const menuItemIds = [];
    const itemsByRestaurantId = new Map(restaurantIds.map((rid) => [rid, []]));

    for (let i = 0; i < menuItemTotal; i++) {
      // First N items cover all restaurants; remaining items are randomized.
      const restaurantId = i < restaurantIds.length ? restaurantIds[i] : pick(rng, restaurantIds);
      const name = `Item ${i + 1}`;
      const description = `Tasty ${name.toLowerCase()}`;
      const price = (randInt(rng, 500, 2500) / 100).toFixed(2);
      const r = await conn.query(
        "INSERT INTO menu_item (restaurant_id, name, description, price) VALUES (?, ?, ?, ?)",
        [restaurantId, name, description, price]
      );
      const menuItemId = Number(r.insertId);
      const mi = { menuItemId, restaurantId, price: Number(price) };
      menuItemIds.push(mi);
      itemsByRestaurantId.get(restaurantId).push(mi);

      // 1-2 categories per item
      const c1 = pick(rng, categories);
      await conn.query("INSERT INTO menu_item_category (menu_item_id, category_id) VALUES (?, ?)", [
        menuItemId,
        categoryIdByName.get(c1)
      ]);
      if (rng() < 0.3) {
        const c2 = pick(rng, categories);
        if (c2 !== c1) {
          await conn.query("INSERT INTO menu_item_category (menu_item_id, category_id) VALUES (?, ?)", [
            menuItemId,
            categoryIdByName.get(c2)
          ]);
        }
      }
    }

    // People: customers + riders
    const customerIds = [];
    for (let i = 0; i < 20; i++) {
      const name = `Customer ${i + 1}`;
      const email = `customer${i + 1}@example.com`;
      const phone = `+43 1 ${randInt(rng, 1000000, 9999999)}`;
      const p = await conn.query("INSERT INTO person (name, email, phone) VALUES (?, ?, ?)", [name, email, phone]);
      const personId = Number(p.insertId);
      await conn.query("INSERT INTO customer (customer_id, default_address, preferred_payment_method) VALUES (?, ?, ?)", [
        personId,
        makeViennaAddress(rng),
        pick(rng, payMethods)
      ]);
      customerIds.push(personId);
    }

    const riderIds = [];
    for (let i = 0; i < 10; i++) {
      const name = `Rider ${i + 1}`;
      const email = `rider${i + 1}@example.com`;
      const phone = `+43 1 ${randInt(rng, 1000000, 9999999)}`;
      const p = await conn.query("INSERT INTO person (name, email, phone) VALUES (?, ?, ?)", [name, email, phone]);
      const personId = Number(p.insertId);
      await conn.query("INSERT INTO rider (rider_id, vehicle_type, rating) VALUES (?, ?, ?)", [
        personId,
        pick(rng, vehicles),
        (randInt(rng, 30, 50) / 10).toFixed(1)
      ]);
      riderIds.push(personId);
    }

    // Riders work for restaurants (1-2 each)
    for (const riderId of riderIds) {
      const r1 = pick(rng, restaurantIds);
      await conn.query("INSERT INTO rider_works_for (rider_id, restaurant_id) VALUES (?, ?)", [riderId, r1]);
      if (rng() < 0.5) {
        const r2 = pick(rng, restaurantIds);
        if (r2 !== r1) {
          await conn.query("INSERT INTO rider_works_for (rider_id, restaurant_id) VALUES (?, ?)", [riderId, r2]);
        }
      }
    }

    // Orders + order items + payment + delivery
    let insertedOrders = 0;
    let insertedOrderItems = 0;
    let insertedPayments = 0;
    let insertedDeliveries = 0;

    for (let i = 0; i < 30; i++) {
      const restaurantId = pick(rng, restaurantIds);
      const customerId = pick(rng, customerIds);

      const createdAt = new Date(Date.now() - randInt(rng, 0, 14) * 24 * 60 * 60 * 1000);
      const status = pick(rng, ["created", "preparing", "ready", "completed"]);

      // I insert the order first with total 0, then update it after I add order items.
      const o = await conn.query(
        "INSERT INTO `order` (customer_id, restaurant_id, created_at, status, total_amount) VALUES (?, ?, ?, ?, ?)",
        [customerId, restaurantId, createdAt, status, 0]
      );
      const orderId = Number(o.insertId);
      insertedOrders++;

      const itemsForRestaurant = itemsByRestaurantId.get(restaurantId) || [];
      if (!itemsForRestaurant.length) {
        throw new Error(`No menu items exist for restaurantId=${restaurantId} (demo data invariant violated)`);
      }
      const itemCount = randInt(rng, 1, 5);

      let total = 0;
      for (let j = 0; j < itemCount; j++) {
        const mi = pick(rng, itemsForRestaurant);
        const qty = randInt(rng, 1, 3);
        const unitPrice = mi.price;
        total += qty * unitPrice;
        await conn.query(
          "INSERT INTO order_item (order_id, menu_item_id, quantity, unit_price) VALUES (?, ?, ?, ?)",
          [orderId, mi.menuItemId, qty, unitPrice]
        );
        insertedOrderItems++;
      }

      total = Math.round(total * 100) / 100;
      await conn.query("UPDATE `order` SET total_amount = ? WHERE order_id = ?", [total, orderId]);

      // Payment: 1:1 with order
      const paidAt = new Date(createdAt.getTime() + randInt(rng, 5, 60) * 60 * 1000);
      await conn.query("INSERT INTO payment (order_id, amount, payment_method, paid_at) VALUES (?, ?, ?, ?)", [
        orderId,
        total,
        pick(rng, payMethods),
        paidAt
      ]);
      insertedPayments++;

      // Delivery: exists for some orders, and some are unassigned (so Student 2 can assign).
      if (rng() < 0.6) {
        const deliveryStatus = pick(rng, ["created", "assigned", "picked_up", "delivered"]);
        const isAssigned = deliveryStatus !== "created";
        const riderId = isAssigned ? pick(rng, riderIds) : null;
        const assignedAt = isAssigned ? new Date(paidAt.getTime() + randInt(rng, 5, 45) * 60 * 1000) : null;

        await conn.query(
          "INSERT INTO delivery (order_id, rider_id, assigned_at, delivery_status) VALUES (?, ?, ?, ?)",
          [orderId, riderId, assignedAt, deliveryStatus]
        );
        insertedDeliveries++;
      }
    }

    return {
      restaurants: restaurantIds.length,
      menuItems: menuItemIds.length,
      customers: customerIds.length,
      riders: riderIds.length,
      orders: insertedOrders,
      orderItems: insertedOrderItems,
      payments: insertedPayments,
      deliveries: insertedDeliveries
    };
  });

  try {
    await clearMongoAfterSqlReset();
  } catch (e) {
    // Preserve the original stack trace but add context.
    e.message = `Import/Reset succeeded for MariaDB but failed to clear Mongo migration state: ${e.message}`;
    throw e;
  }

  return inserted;
}

module.exports = { importResetMariaDb };

