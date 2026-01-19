// File flow:
// - We recreate the schema, wipe old rows, then insert fresh demo data into MariaDB.
// - We keep the data deterministic when SEED is set.
// - After the SQL reset, We also clear Mongo so the app does not use stale migrated data.

const { withTx } = require("../db/mariadb");
const { config } = require("../config");
const { readSchemaSql } = require("../utils/schema");
const { getMongo } = require("../db/mongodb");

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(rng, arr) {
  if ( !Array.isArray(arr) || arr.length === 0 ) {
    // We fail loudly so empty-pick bugs are always traceable.
    throw new Error("pick() called with empty array");
  }
  return arr[randInt(rng, 0, arr.length - 1)];
}

function makeRng(seedNumber) {
  // We use a tiny deterministic RNG so demos are reproducible when SEED is set.
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
  // We delete in FK-safe order because TRUNCATE can fail when FKs are involved.
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

  for ( const t of deleteOrder ) {
    await conn.query(`DELETE FROM ${t}`);
  }

  // We reset auto-increment counters so IDs start from 1 again after reset.
  const autoIncTables = ["person", "restaurant", "menu_item", "category", "`order`", "order_item", "payment", "delivery"];
  for ( const t of autoIncTables ) {
    await conn.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`);
  }
}

async function clearMongoAfterSqlReset() {
  const { db } = await getMongo();

  // After We reset SQL, We also clear Mongo and the migration marker so the UI does not read stale data.
  await Promise.all([
    db.collection("restaurants").deleteMany({}),
    db.collection("people").deleteMany({}),
    db.collection("orders").deleteMany({}),
    db.collection("meta").deleteOne({ _id: "migration" })
  ]);
}

async function importResetMariaDb() {
  const inserted = await withTx(async function(conn) {
    // We (1) ensure schema exists, (2) clear old data, then (3) insert fresh randomized data.
    await recreateSchema(conn);
    await clearAll(conn);

    const rng = makeRng(12345); // Fixed seed for consistent randomization of orders/addresses only

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

    // Fixed menu items for each restaurant - no randomization
    const restaurantMenus = {
      "Figlmueller": [
        { name: "Wiener Schnitzel", price: 18.50, categories: ["main"] },
        { name: "Tafelspitz", price: 22.00, categories: ["main"] },
        { name: "Apfelstrudel", price: 6.50, categories: ["dessert"] },
        { name: "Kaiserschmarrn", price: 8.00, categories: ["dessert"] },
        { name: "Beer", price: 4.50, categories: ["drink"] },
        { name: "Mineral Water", price: 3.00, categories: ["drink"] }
      ],
      "Plachutta": [
        { name: "Tafelspitz Classic", price: 24.00, categories: ["main"] },
        { name: "Zwiebelrostbraten", price: 26.50, categories: ["main"] },
        { name: "Beef Broth", price: 5.50, categories: ["starter"] },
        { name: "Sachertorte", price: 7.00, categories: ["dessert"] },
        { name: "Wine", price: 5.50, categories: ["drink"] },
        { name: "Coffee", price: 3.50, categories: ["drink"] }
      ],
      "Cafe Central": [
        { name: "Melange", price: 4.80, categories: ["drink"] },
        { name: "Cappuccino", price: 4.50, categories: ["drink"] },
        { name: "Sachertorte", price: 6.50, categories: ["dessert"] },
        { name: "Apfelstrudel", price: 6.00, categories: ["dessert"] },
        { name: "Breakfast Platter", price: 12.50, categories: ["main"] },
        { name: "Club Sandwich", price: 11.00, categories: ["main"] }
      ],
      "Zum Schwarzen Kameel": [
        { name: "Open Sandwich", price: 9.50, categories: ["starter"] },
        { name: "Beef Tartare", price: 14.00, categories: ["starter"] },
        { name: "Schnitzel", price: 19.00, categories: ["main"] },
        { name: "Fish of the Day", price: 21.00, categories: ["main"] },
        { name: "Champagne", price: 12.00, categories: ["drink"] },
        { name: "Espresso", price: 3.00, categories: ["drink"] }
      ],
      "Lugeck": [
        { name: "Gulasch", price: 16.50, categories: ["main"] },
        { name: "Schweinsbraten", price: 18.00, categories: ["main"] },
        { name: "Knödel Variety", price: 13.50, categories: ["main"] },
        { name: "Caesar Salad", price: 11.00, categories: ["starter"] },
        { name: "Palatschinken", price: 7.50, categories: ["dessert"] },
        { name: "Cola", price: 3.50, categories: ["drink"] }
      ],
      "Steirereck": [
        { name: "Tasting Menu", price: 145.00, categories: ["main"] },
        { name: "Venison", price: 42.00, categories: ["main"] },
        { name: "Trout", price: 38.00, categories: ["main"] },
        { name: "Amuse Bouche", price: 18.00, categories: ["starter"] },
        { name: "Cheese Selection", price: 16.00, categories: ["dessert"] },
        { name: "Wine Pairing", price: 85.00, categories: ["drink"] }
      ],
      "NENI am Naschmarkt": [
        { name: "Hummus Platter", price: 11.50, categories: ["starter", "vegan"] },
        { name: "Falafel Bowl", price: 14.00, categories: ["main", "vegan"] },
        { name: "Shawarma", price: 15.50, categories: ["main"] },
        { name: "Lamb Kebab", price: 18.00, categories: ["main"] },
        { name: "Baklava", price: 6.00, categories: ["dessert"] },
        { name: "Mint Tea", price: 3.50, categories: ["drink"] }
      ],
      "Gasthaus Poeschel": [
        { name: "Backhendl", price: 16.00, categories: ["main"] },
        { name: "Leberkäs with Egg", price: 9.50, categories: ["main"] },
        { name: "Potato Soup", price: 5.50, categories: ["starter"] },
        { name: "Spätzle", price: 8.00, categories: ["main"] },
        { name: "Marillenknödel", price: 7.50, categories: ["dessert"] },
        { name: "Beer", price: 4.00, categories: ["drink"] }
      ],
      "Schnitzelwirt": [
        { name: "Classic Schnitzel", price: 14.50, categories: ["main"] },
        { name: "Cordon Bleu", price: 16.50, categories: ["main"] },
        { name: "Chicken Schnitzel", price: 13.50, categories: ["main"] },
        { name: "French Fries", price: 4.50, categories: ["starter"] },
        { name: "Mixed Salad", price: 5.50, categories: ["starter"] },
        { name: "Lemonade", price: 3.50, categories: ["drink"] }
      ],
      "Vapiano Wien Mitte": [
        { name: "Margherita Pizza", price: 9.90, categories: ["main"] },
        { name: "Carbonara", price: 11.90, categories: ["main"] },
        { name: "Bolognese", price: 11.50, categories: ["main"] },
        { name: "Caprese Salad", price: 8.50, categories: ["starter"] },
        { name: "Tiramisu", price: 5.90, categories: ["dessert"] },
        { name: "Iced Tea", price: 3.50, categories: ["drink"] }
      ]
    };

    // Restaurants
    const restaurantIds = [];
    for ( let i = 0; i < 10; i++ ) {
      let name;
      
      if ( restaurantNames[i] ) {
        name = restaurantNames[i];
      } 
      else {
        name = `Restaurant ${i + 1}`;
      }
      const address = makeViennaAddress(rng);
      const r = await conn.query("INSERT INTO restaurant (name, address) VALUES (?, ?)", [name, address]);
      restaurantIds.push(Number(r.insertId));
    }

    // Categories
    const categoryIdByName = new Map();
    for ( const c of categories ) {
      const r = await conn.query("INSERT INTO category (name) VALUES (?)", [c]);
      categoryIdByName.set(c, Number(r.insertId));
    }

    // Menu items - fixed per restaurant
    const menuItemIds = [];
    const itemsByRestaurantId = new Map(restaurantIds.map(function(rid) {
      return [rid, []];
    }));

    for ( let i = 0; i < restaurantNames.length; i++ ) {
      const restaurantName = restaurantNames[i];
      const restaurantId = restaurantIds[i];
      const menuItems = restaurantMenus[restaurantName];

      for ( const item of menuItems ) {
        const r = await conn.query(
          "INSERT INTO menu_item (restaurant_id, name, description, price) VALUES (?, ?, ?, ?)",
          [restaurantId, item.name, `Delicious ${item.name.toLowerCase()}`, item.price]
        );
        const menuItemId = Number(r.insertId);
        const mi = { menuItemId, restaurantId, price: item.price };
        menuItemIds.push(mi);
        itemsByRestaurantId.get(restaurantId).push(mi);

        // Add categories for this item
        for ( const categoryName of item.categories ) {
          const categoryId = categoryIdByName.get(categoryName);
          if ( categoryId ) {
            await conn.query("INSERT INTO menu_item_category (menu_item_id, category_id) VALUES (?, ?)", [
              menuItemId,
              categoryId
            ]);
          }
        }
      }
    }

    // People: customers + riders
    const customerIds = [];
    for ( let i = 0; i < 20; i++ ) {
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
    for ( let i = 0; i < 10; i++ ) {
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
    for ( const riderId of riderIds ) {
      const r1 = pick(rng, restaurantIds);
      await conn.query("INSERT INTO rider_works_for (rider_id, restaurant_id) VALUES (?, ?)", [riderId, r1]);
      if ( rng() < 0.5 ) {
        const r2 = pick(rng, restaurantIds);
        if ( r2 !== r1 ) {
          await conn.query("INSERT INTO rider_works_for (rider_id, restaurant_id) VALUES (?, ?)", [riderId, r2]);
        }
      }
    }

    // Orders + order items + payment + delivery
    let insertedOrders = 0;
    let insertedOrderItems = 0;
    let insertedPayments = 0;
    let insertedDeliveries = 0;

    for ( let i = 0; i < 30; i++ ) {
      const restaurantId = pick(rng, restaurantIds);
      const customerId = pick(rng, customerIds);

      const createdAt = new Date(Date.now() - randInt(rng, 0, 14) * 24 * 60 * 60 * 1000);
      const status = pick(rng, ["created", "preparing", "ready", "completed"]);

      // We insert the order first with total 0, then update it after We add order items.
      const o = await conn.query(
        "INSERT INTO `order` (customer_id, restaurant_id, created_at, status, total_amount) VALUES (?, ?, ?, ?, ?)",
        [customerId, restaurantId, createdAt, status, 0]
      );
      const orderId = Number(o.insertId);
      insertedOrders++;

      const itemsForRestaurantRaw = itemsByRestaurantId.get(restaurantId);
      let itemsForRestaurant;
      
      if ( itemsForRestaurantRaw ) {
        itemsForRestaurant = itemsForRestaurantRaw;
      } 
      else {
        itemsForRestaurant = [];
      }
      if ( !itemsForRestaurant.length ) {
        throw new Error(`No menu items exist for restaurantId=${restaurantId} (demo data invariant violated)`);
      }
      const itemCount = randInt(rng, 1, 5);

      let total = 0;
      for ( let j = 0; j < itemCount; j++ ) {
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
      if ( rng() < 0.6 ) {
        const deliveryStatus = pick(rng, ["created", "assigned", "picked_up", "delivered"]);
        const isAssigned = deliveryStatus !== "created";
        let riderId;
        
        if ( isAssigned ) {
          riderId = pick(rng, riderIds);
        } 
        else {
          riderId = null;
        }
        
        let assignedAt;
        
        if ( isAssigned ) {
          assignedAt = new Date(paidAt.getTime() + randInt(rng, 5, 45) * 60 * 1000);
        } 
        else {
          assignedAt = null;
        }

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

