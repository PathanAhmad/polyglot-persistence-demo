const express = require("express");

const { withTx, withConn } = require("../db/mariadb");
const { getMongo } = require("../db/mongodb");

const student1Router = express.Router();

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function notFound(message) {
  const e = new Error(message);
  e.status = 404;
  return e;
}

function conflict(message) {
  const e = new Error(message);
  e.status = 409;
  return e;
}

function parseIsoDateOrNull(v, fieldName) {
  if (v == null || String(v).trim() === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest(`${fieldName} must be an ISO date`);
  return d;
}

function toPositiveInt(v, fieldName) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw badRequest(`${fieldName} must be a positive integer`);
  return n;
}

function priceToCents(price, fieldName) {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${fieldName} must be a non-negative number`);
  // I compute in cents to avoid floating point accumulation errors.
  return Math.round(n * 100);
}

function centsToAmount(cents) {
  return Number((cents / 100).toFixed(2));
}

// -------------------------
// Student 1 - SQL (MariaDB)
// Use case: Place order + pay
// -------------------------

student1Router.post("/student1/sql/place_order", async (req, res, next) => {
  try {
    const customerEmail = req.body?.customerEmail ? String(req.body.customerEmail) : "";
    const restaurantName = req.body?.restaurantName ? String(req.body.restaurantName) : "";
    const items = Array.isArray(req.body?.items) ? req.body.items : null;

    if (!customerEmail) throw badRequest("customerEmail is required");
    if (!restaurantName) throw badRequest("restaurantName is required");
    if (!items || !items.length) throw badRequest("items must be a non-empty array");

    const order = await withTx(async (conn) => {
      const customers = await conn.query(
        `
        SELECT c.customer_id AS customerId, p.name AS customerName, p.email AS customerEmail
        FROM customer c
        JOIN person p ON p.person_id = c.customer_id
        WHERE p.email = ?
        LIMIT 1
        `,
        [customerEmail]
      );
      if (!customers.length) throw notFound("customer not found");
      const customerId = Number(customers[0].customerId);
      const customerName = customers[0].customerName;

      const restaurants = await conn.query(
        `SELECT restaurant_id AS restaurantId, name AS restaurantName, address AS restaurantAddress FROM restaurant WHERE name = ? LIMIT 1`,
        [restaurantName]
      );
      if (!restaurants.length) throw notFound("restaurant not found");
      const restaurantId = Number(restaurants[0].restaurantId);
      const restaurantAddress = restaurants[0].restaurantAddress;

      const now = new Date();

      // I insert the order with total 0, then update it after order items are inserted.
      const o = await conn.query(
        "INSERT INTO `order` (customer_id, restaurant_id, created_at, status, total_amount) VALUES (?, ?, ?, ?, ?)",
        [customerId, restaurantId, now, "created", 0]
      );
      const orderId = Number(o.insertId);

      let totalCents = 0;
      const insertedItems = [];

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx] || {};
        const quantity = toPositiveInt(it.quantity, `items[${idx}].quantity`);

        const menuItemIdRaw = it.menuItemId;
        const menuItemNameRaw = it.menuItemName ?? it.name; // allow either key
        const menuItemId = menuItemIdRaw != null && String(menuItemIdRaw).trim() !== "" ? Number(menuItemIdRaw) : null;
        const menuItemName =
          menuItemNameRaw != null && String(menuItemNameRaw).trim() !== "" ? String(menuItemNameRaw) : null;

        if (!Number.isFinite(menuItemId || NaN) && !menuItemName) {
          throw badRequest(`items[${idx}] must include menuItemId or menuItemName`);
        }

        let menuRow;
        if (Number.isFinite(menuItemId)) {
          const rows = await conn.query(
            `
            SELECT menu_item_id AS menuItemId, name AS menuItemName, price AS unitPrice
            FROM menu_item
            WHERE menu_item_id = ? AND restaurant_id = ?
            LIMIT 1
            `,
            [menuItemId, restaurantId]
          );
          if (!rows.length) throw notFound(`menu item not found for items[${idx}]`);
          menuRow = rows[0];
        } else {
          const rows = await conn.query(
            `
            SELECT menu_item_id AS menuItemId, name AS menuItemName, price AS unitPrice
            FROM menu_item
            WHERE restaurant_id = ? AND name = ?
            LIMIT 1
            `,
            [restaurantId, menuItemName]
          );
          if (!rows.length) throw notFound(`menu item not found for items[${idx}]`);
          menuRow = rows[0];
        }

        const resolvedMenuItemId = Number(menuRow.menuItemId);
        const resolvedMenuItemName = menuRow.menuItemName;
        const unitPrice = Number(menuRow.unitPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("invalid unit price in DB");

        const lineCents = priceToCents(unitPrice, `items[${idx}].unitPrice`) * quantity;
        totalCents += lineCents;

        await conn.query("INSERT INTO order_item (order_id, menu_item_id, quantity, unit_price) VALUES (?, ?, ?, ?)", [
          orderId,
          resolvedMenuItemId,
          quantity,
          unitPrice
        ]);

        insertedItems.push({
          menuItemId: resolvedMenuItemId,
          name: resolvedMenuItemName,
          quantity,
          unitPrice: Number(unitPrice)
        });
      }

      const totalAmount = centsToAmount(totalCents);
      await conn.query("UPDATE `order` SET total_amount = ? WHERE order_id = ?", [totalAmount, orderId]);

      return {
        orderId,
        createdAt: now,
        status: "created",
        totalAmount,
        restaurant: { name: restaurantName, address: restaurantAddress },
        customer: { name: customerName, email: customerEmail },
        orderItems: insertedItems
      };
    });

    res.json({ ok: true, order });
  } catch (e) {
    next(e);
  }
});

student1Router.post("/student1/sql/pay", async (req, res, next) => {
  try {
    const orderId = req.body?.orderId ? Number(req.body.orderId) : NaN;
    const paymentMethod = req.body?.paymentMethod ? String(req.body.paymentMethod) : "";

    if (!Number.isFinite(orderId)) throw badRequest("orderId is required");
    if (!paymentMethod) throw badRequest("paymentMethod is required");

    const payment = await withTx(async (conn) => {
      const orders = await conn.query(
        `
        SELECT order_id AS orderId, status, total_amount AS totalAmount
        FROM \`order\`
        WHERE order_id = ?
        LIMIT 1
        `,
        [orderId]
      );
      if (!orders.length) throw notFound("order not found");
      const totalAmount = Number(orders[0].totalAmount);
      if (!Number.isFinite(totalAmount)) throw new Error("invalid totalAmount in DB");

      const existing = await conn.query(
        `
        SELECT payment_id AS paymentId, paid_at AS paidAt
        FROM payment
        WHERE order_id = ?
        LIMIT 1
        `,
        [orderId]
      );

      if (existing.length && existing[0].paidAt != null) {
        throw conflict("order already paid");
      }

      const now = new Date();
      if (!existing.length) {
        await conn.query("INSERT INTO payment (order_id, amount, payment_method, paid_at) VALUES (?, ?, ?, ?)", [
          orderId,
          totalAmount,
          paymentMethod,
          now
        ]);
      } else {
        await conn.query(
          "UPDATE payment SET amount = ?, payment_method = ?, paid_at = IFNULL(paid_at, ?) WHERE order_id = ?",
          [totalAmount, paymentMethod, now, orderId]
        );
      }

      // I also move the order forward after payment (keeps the demo consistent with imported data statuses).
      await conn.query("UPDATE `order` SET status = IF(status = 'created', 'preparing', status) WHERE order_id = ?", [
        orderId
      ]);

      const out = await conn.query(
        `
        SELECT payment_id AS paymentId, order_id AS orderId, amount, payment_method AS method, paid_at AS paidAt
        FROM payment
        WHERE order_id = ?
        LIMIT 1
        `,
        [orderId]
      );
      return out[0];
    });

    res.json({ ok: true, payment });
  } catch (e) {
    next(e);
  }
});

student1Router.get("/student1/sql/report", async (req, res, next) => {
  try {
    const restaurantName = req.query.restaurantName ? String(req.query.restaurantName) : "";
    if (!restaurantName) throw badRequest("restaurantName is required");

    const from = parseIsoDateOrNull(req.query.from, "from");
    const to = parseIsoDateOrNull(req.query.to, "to");

    const params = [restaurantName];
    let whereExtra = "";
    if (from) {
      whereExtra += " AND o.created_at >= ? ";
      params.push(from);
    }
    if (to) {
      whereExtra += " AND o.created_at <= ? ";
      params.push(to);
    }

    const rows = await withConn((conn) =>
      conn.query(
        `
        SELECT
          r.name AS restaurantName,
          o.order_id AS orderId,
          o.created_at AS orderCreatedAt,
          o.status AS status,
          o.total_amount AS totalAmount,
          p.email AS customerEmail,
          p.name AS customerName,
          pay.amount AS paymentAmount,
          pay.payment_method AS paymentMethod,
          pay.paid_at AS paidAt
        FROM restaurant r
        JOIN \`order\` o ON o.restaurant_id = r.restaurant_id
        JOIN customer c ON c.customer_id = o.customer_id
        JOIN person p ON p.person_id = c.customer_id
        LEFT JOIN payment pay ON pay.order_id = o.order_id
        WHERE r.name = ?
        ${whereExtra}
        ORDER BY o.created_at DESC
        `,
        params
      )
    );

    res.json({ ok: true, rows });
  } catch (e) {
    next(e);
  }
});

// -------------------------
// Student 1 - MongoDB
// Use case: Place order + pay
// -------------------------

student1Router.post("/student1/mongo/place_order", async (req, res, next) => {
  try {
    const customerEmail = req.body?.customerEmail ? String(req.body.customerEmail) : "";
    const restaurantName = req.body?.restaurantName ? String(req.body.restaurantName) : "";
    const items = Array.isArray(req.body?.items) ? req.body.items : null;

    if (!customerEmail) throw badRequest("customerEmail is required");
    if (!restaurantName) throw badRequest("restaurantName is required");
    if (!items || !items.length) throw badRequest("items must be a non-empty array");

    const { db } = await getMongo();

    const customer = await db.collection("people").findOne({ type: "customer", email: customerEmail });
    if (!customer) throw notFound("customer not found");

    const restaurant = await db.collection("restaurants").findOne({ name: restaurantName });
    if (!restaurant) throw notFound("restaurant not found");

    let totalCents = 0;
    const normalizedItems = items.map((it, idx) => {
      const name = it?.name != null && String(it.name).trim() !== "" ? String(it.name) : null;
      const quantity = toPositiveInt(it?.quantity, `items[${idx}].quantity`);
      const unitPriceCents = priceToCents(it?.unitPrice, `items[${idx}].unitPrice`);
      const unitPrice = centsToAmount(unitPriceCents);
      if (!name) throw badRequest(`items[${idx}].name is required`);
      totalCents += unitPriceCents * quantity;
      const out = {
        menuItemId: it?.menuItemId == null ? null : Number(it.menuItemId),
        name,
        quantity,
        unitPrice
      };
      if (out.menuItemId != null && !Number.isFinite(out.menuItemId)) throw badRequest(`items[${idx}].menuItemId must be a number`);
      return out;
    });

    const totalAmount = centsToAmount(totalCents);
    const createdAt = new Date();

    // I generate a numeric orderId (compatible with migrated data) and rely on a unique index for safety.
    let insertedOrderId = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await db.collection("orders").findOne({}, { sort: { orderId: -1 }, projection: { _id: 0, orderId: 1 } });
      const nextId = (last?.orderId ? Number(last.orderId) : 0) + 1;
      if (!Number.isFinite(nextId) || nextId <= 0) throw new Error("failed to generate orderId");

      try {
        await db.collection("orders").insertOne({
          orderId: nextId,
          createdAt,
          status: "created",
          totalAmount,
          restaurant: {
            restaurantId: Number(restaurant.restaurantId),
            name: restaurant.name,
            address: restaurant.address
          },
          customer: { personId: Number(customer.personId), name: customer.name, email: customer.email },
          orderItems: normalizedItems,
          payment: null,
          delivery: null
        });
        insertedOrderId = nextId;
        break;
      } catch (e) {
        // Duplicate key on unique orderId index -> retry.
        if (e && (e.code === 11000 || String(e.message || "").includes("E11000"))) continue;
        throw e;
      }
    }

    if (!insertedOrderId) throw new Error("could not allocate a unique orderId");

    res.json({ ok: true, orderId: insertedOrderId });
  } catch (e) {
    next(e);
  }
});

student1Router.post("/student1/mongo/pay", async (req, res, next) => {
  try {
    const orderId = req.body?.orderId ? Number(req.body.orderId) : NaN;
    const paymentMethod = req.body?.paymentMethod ? String(req.body.paymentMethod) : "";

    if (!Number.isFinite(orderId)) throw badRequest("orderId is required");
    if (!paymentMethod) throw badRequest("paymentMethod is required");

    const { db } = await getMongo();

    // I keep paidAt immutable: only set it if missing/null.
    const result = await db.collection("orders").updateOne(
      { orderId },
      [
        {
          $set: {
            status: { $cond: [{ $eq: ["$status", "created"] }, "preparing", "$status"] },
            payment: {
              paymentId: { $ifNull: ["$payment.paymentId", null] },
              amount: "$totalAmount",
              method: { $ifNull: ["$payment.method", paymentMethod] },
              paidAt: { $ifNull: ["$payment.paidAt", "$$NOW"] }
            }
          }
        }
      ]
    );

    if (!result.matchedCount) throw notFound("order not found in mongo (did you migrate?)");

    const updated = await db
      .collection("orders")
      .findOne({ orderId }, { projection: { _id: 0, orderId: 1, payment: 1, status: 1, totalAmount: 1 } });

    if (updated?.payment?.paidAt == null) throw new Error("payment update failed");

    res.json({ ok: true, orderId: updated.orderId, status: updated.status, payment: updated.payment });
  } catch (e) {
    next(e);
  }
});

student1Router.get("/student1/mongo/report", async (req, res, next) => {
  try {
    const restaurantName = req.query.restaurantName ? String(req.query.restaurantName) : "";
    if (!restaurantName) throw badRequest("restaurantName is required");

    const from = parseIsoDateOrNull(req.query.from, "from");
    const to = parseIsoDateOrNull(req.query.to, "to");

    const { db } = await getMongo();

    const match = { "restaurant.name": restaurantName };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const rows = await db
      .collection("orders")
      .aggregate([
        { $match: match },
        {
          $project: {
            _id: 0,
            restaurantName: "$restaurant.name",
            orderId: "$orderId",
            orderCreatedAt: "$createdAt",
            status: "$status",
            totalAmount: "$totalAmount",
            customerEmail: "$customer.email",
            customerName: "$customer.name",
            paymentAmount: "$payment.amount",
            paymentMethod: "$payment.method",
            paidAt: "$payment.paidAt"
          }
        },
        { $sort: { orderCreatedAt: -1 } }
      ])
      .toArray();

    res.json({ ok: true, rows });
  } catch (e) {
    next(e);
  }
});

// -------------------------
// Student 1 - MongoDB Orders Query
// -------------------------

student1Router.get("/student1/mongo/orders", async (req, res, next) => {
  try {
    const customerEmail = req.query.customerEmail ? String(req.query.customerEmail) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const { db } = await getMongo();

    const filter = {};
    if (customerEmail) {
      filter["customer.email"] = customerEmail;
    }

    const orders = await db
      .collection("orders")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .toArray();

    // Transform MongoDB documents to match SQL format for consistency
    const transformedOrders = orders.map(order => ({
      orderId: order.orderId,
      createdAt: order.createdAt,
      status: order.status,
      totalAmount: order.totalAmount,
      restaurantName: order.restaurant?.name || null,
      customerEmail: order.customer?.email || null,
      deliveryStatus: order.delivery?.deliveryStatus || null,
      assignedAt: order.delivery?.assignedAt || null,
      riderEmail: order.delivery?.rider?.email || null,
      paymentMethod: order.payment?.paymentMethod || null
    }));

    res.json({ ok: true, orders: transformedOrders });
  } catch (e) {
    next(e);
  }
});

module.exports = { student1Router };

