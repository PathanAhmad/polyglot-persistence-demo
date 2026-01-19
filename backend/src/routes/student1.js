// File flow:
// - We expose Student 1 endpoints for placing orders, paying, and generating reports.
// - We support both MariaDB and Mongo with the same response shape.
// - We validate inputs, write atomically, and return consistent JSON for the UI.

const express = require("express");

const { withTx, withConn } = require("../db/mariadb");
const { getMongo } = require("../db/mongodb");
const { toJsonSafeNumber, toMoneyString } = require("../utils/json");

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
  // We accept empty values as null, otherwise We enforce a real ISO date.
  if ( v == null || String(v).trim() === "" ) {
    return null;
  }
  const d = new Date(String(v));
  if ( Number.isNaN(d.getTime()) ) {
    throw badRequest(`${fieldName} must be an ISO date`);
  }
  return d;
}

function toPositiveInt(v, fieldName) {
  // We keep quantities and IDs strict so they do not silently turn into weird floats.
  const n = Number(v);
  if ( !Number.isFinite(n) || !Number.isInteger(n) || n <= 0 ) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return n;
}

function priceToCents(price, fieldName) {
  const n = Number(price);
  if ( !Number.isFinite(n) || n < 0 ) {
    throw badRequest(`${fieldName} must be a non-negative number`);
  }
  // We compute in cents to avoid floating point accumulation errors.
  return Math.round(n * 100);
}



function centsToAmount(cents) {
  return Number((cents / 100).toFixed(2));
}

// -------------------------
// Student 1 - SQL (MariaDB)
// Use case: Place order + pay
// -------------------------

student1Router.post("/student1/sql/place_order", async function(req, res, next) {
  try {
    // We read and validate the request body before We touch the DB.
    let customerEmail;
    
    if ( req.body?.customerEmail ) {
      customerEmail = String(req.body.customerEmail);
    } 
    else {
      customerEmail = "";
    }
    
    let restaurantName;
    
    if ( req.body?.restaurantName ) {
      restaurantName = String(req.body.restaurantName);
    } 
    else {
      restaurantName = "";
    }
    
    let items;
    
    if ( Array.isArray(req.body?.items) ) {
      items = req.body.items;
    } 
    else {
      items = null;
    }

    if ( !customerEmail ) {
      throw badRequest("customerEmail is required");
    }
    if ( !restaurantName ) {
      throw badRequest("restaurantName is required");
    }
    if ( !items || !items.length ) {
      throw badRequest("items must be a non-empty array");
    }

    const order = await withTx(async function(conn) {
      // We do everything in one transaction so an order never ends up half-written.
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
      if ( !customers.length ) {
        throw notFound("customer not found");
      }
      const customerId = Number(customers[0].customerId);
      const customerName = customers[0].customerName;

      const restaurants = await conn.query(
        `SELECT restaurant_id AS restaurantId, name AS restaurantName, address AS restaurantAddress FROM restaurant WHERE name = ? LIMIT 1`,
        [restaurantName]
      );
      if ( !restaurants.length ) {
        throw notFound("restaurant not found");
      }
      const restaurantId = Number(restaurants[0].restaurantId);
      const restaurantAddress = restaurants[0].restaurantAddress;

      const now = new Date();

      // We insert the order with total 0, then update it after order items are inserted.
      const o = await conn.query(
        "INSERT INTO `order` (customer_id, restaurant_id, created_at, status, total_amount) VALUES (?, ?, ?, ?, ?)",
        [customerId, restaurantId, now, "created", 0]
      );
      const orderId = Number(o.insertId);

      let totalCents = 0;
      const insertedItems = [];


      for ( let idx = 0; idx < items.length; idx++ ) {
        // For each item, We resolve the menu item, compute the line total, and insert the row.
        let it;
        
        if ( items[idx] ) {
          it = items[idx];
        } 
        else {
          it = {};
        }
        const quantity = toPositiveInt(it.quantity, `items[${idx}].quantity`);

        const menuItemIdRaw = it.menuItemId;
        let menuItemNameRaw;
        
        if ( it.menuItemName != null ) {
          menuItemNameRaw = it.menuItemName;
        } 
        else {
          menuItemNameRaw = it.name; // allow either key
        }
        let menuItemId;
        
        if ( menuItemIdRaw != null && String(menuItemIdRaw).trim() !== "" ) {
          menuItemId = Number(menuItemIdRaw);
        } 
        else {
          menuItemId = null;
        }
        
        let menuItemName;
        
        if ( menuItemNameRaw != null && String(menuItemNameRaw).trim() !== "" ) {
          menuItemName = String(menuItemNameRaw);
        } 
        else {
          menuItemName = null;
        }

        let menuItemIdForCheck;
        
        if ( menuItemId ) {
          menuItemIdForCheck = menuItemId;
        } 
        else {
          menuItemIdForCheck = NaN;
        }
        
        if ( !Number.isFinite(menuItemIdForCheck) && !menuItemName ) {
          throw badRequest(`items[${idx}] must include menuItemId or menuItemName`);
        }

        let menuRow;
        
        if ( Number.isFinite(menuItemId) ) {
          const rows = await conn.query(
            `
            SELECT menu_item_id AS menuItemId, name AS menuItemName, price AS unitPrice
            FROM menu_item
            WHERE menu_item_id = ? AND restaurant_id = ?
            LIMIT 1
            `,
            [menuItemId, restaurantId]
          );
          if ( !rows.length ) {
            throw notFound(`menu item not found for items[${idx}]`);
          }
          menuRow = rows[0];
        } 
        else {
          const rows = await conn.query(
            `
            SELECT menu_item_id AS menuItemId, name AS menuItemName, price AS unitPrice
            FROM menu_item
            WHERE restaurant_id = ? AND name = ?
            ORDER BY menu_item_id ASC
            LIMIT 2
            `,
            [restaurantId, menuItemName]
          );
          if ( !rows.length ) {
            throw notFound(`menu item not found for items[${idx}]`);
          }
          if ( rows.length > 1 ) {
            throw badRequest(`menu item name is not unique for items[${idx}] (use menuItemId instead)`);
          }
          menuRow = rows[0];
        }

        const resolvedMenuItemId = Number(menuRow.menuItemId);
        const resolvedMenuItemName = menuRow.menuItemName;
        const unitPrice = Number(menuRow.unitPrice);
        if ( !Number.isFinite(unitPrice) || unitPrice < 0 ) {
          throw new Error("invalid unit price in DB");
        }

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
      // We update the order total after inserting items so it matches the final computed sum.
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
  } 
  catch (e) {
    next(e);
  }
});

// Place + Pay in one step (atomic)
// This prevents creating unpaid orders when the user cancels the payment modal.
student1Router.post("/student1/sql/place_and_pay", async function(req, res, next) {
  try {
    // We read and validate the request body before We touch the DB.
    let customerEmail;
    
    if ( req.body?.customerEmail ) {
      customerEmail = String(req.body.customerEmail);
    } 
    else {
      customerEmail = "";
    }
    
    let restaurantName;
    
    if ( req.body?.restaurantName ) {
      restaurantName = String(req.body.restaurantName);
    } 
    else {
      restaurantName = "";
    }
    
    let paymentMethod;
    
    if ( req.body?.paymentMethod ) {
      paymentMethod = String(req.body.paymentMethod);
    } 
    else {
      paymentMethod = "";
    }
    
    let items;
    
    if ( Array.isArray(req.body?.items) ) {
      items = req.body.items;
    } 
    else {
      items = null;
    }

    if ( !customerEmail ) {
      throw badRequest("customerEmail is required");
    }
    if ( !restaurantName ) {
      throw badRequest("restaurantName is required");
    }
    if ( !paymentMethod ) {
      throw badRequest("paymentMethod is required");
    }
    if ( !items || !items.length ) {
      throw badRequest("items must be a non-empty array");
    }

    const result = await withTx(async function(conn) {
      // We do everything in one transaction: create order + items + payment + status update.
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
      if ( !customers.length ) {
        throw notFound("customer not found");
      }
      const customerId = Number(customers[0].customerId);
      const customerName = customers[0].customerName;

      const restaurants = await conn.query(
        `SELECT restaurant_id AS restaurantId, name AS restaurantName, address AS restaurantAddress FROM restaurant WHERE name = ? LIMIT 1`,
        [restaurantName]
      );
      if ( !restaurants.length ) {
        throw notFound("restaurant not found");
      }
      const restaurantId = Number(restaurants[0].restaurantId);
      const restaurantAddress = restaurants[0].restaurantAddress;

      const now = new Date();

      // We insert the order with total 0, then update it after order items are inserted.
      const o = await conn.query(
        "INSERT INTO `order` (customer_id, restaurant_id, created_at, status, total_amount) VALUES (?, ?, ?, ?, ?)",
        [customerId, restaurantId, now, "created", 0]
      );
      const orderId = Number(o.insertId);

      let totalCents = 0;
      const insertedItems = [];

      for ( let idx = 0; idx < items.length; idx++ ) {
        let it;
        
        if ( items[idx] ) {
          it = items[idx];
        } 
        else {
          it = {};
        }
        const quantity = toPositiveInt(it.quantity, `items[${idx}].quantity`);

        const menuItemIdRaw = it.menuItemId;
        let menuItemNameRaw;
        
        if ( it.menuItemName != null ) {
          menuItemNameRaw = it.menuItemName;
        } 
        else {
          menuItemNameRaw = it.name; // allow either key
        }
        let menuItemId;
        
        if ( menuItemIdRaw != null && String(menuItemIdRaw).trim() !== "" ) {
          menuItemId = Number(menuItemIdRaw);
        } 
        else {
          menuItemId = null;
        }
        
        let menuItemName;
        
        if ( menuItemNameRaw != null && String(menuItemNameRaw).trim() !== "" ) {
          menuItemName = String(menuItemNameRaw);
        } 
        else {
          menuItemName = null;
        }

        let menuItemIdForCheck;
        
        if ( menuItemId ) {
          menuItemIdForCheck = menuItemId;
        } 
        else {
          menuItemIdForCheck = NaN;
        }
        
        if ( !Number.isFinite(menuItemIdForCheck) && !menuItemName ) {
          throw badRequest(`items[${idx}] must include menuItemId or menuItemName`);
        }

        let menuRow;
        
        if ( Number.isFinite(menuItemId) ) {
          const rows = await conn.query(
            `
            SELECT menu_item_id AS menuItemId, name AS menuItemName, price AS unitPrice
            FROM menu_item
            WHERE menu_item_id = ? AND restaurant_id = ?
            LIMIT 1
            `,
            [menuItemId, restaurantId]
          );
          if ( !rows.length ) {
            throw notFound(`menu item not found for items[${idx}]`);
          }
          menuRow = rows[0];
        } 
        else {
          const rows = await conn.query(
            `
            SELECT menu_item_id AS menuItemId, name AS menuItemName, price AS unitPrice
            FROM menu_item
            WHERE restaurant_id = ? AND name = ?
            ORDER BY menu_item_id ASC
            LIMIT 2
            `,
            [restaurantId, menuItemName]
          );
          if ( !rows.length ) {
            throw notFound(`menu item not found for items[${idx}]`);
          }
          if ( rows.length > 1 ) {
            throw badRequest(`menu item name is not unique for items[${idx}] (use menuItemId instead)`);
          }
          menuRow = rows[0];
        }

        const resolvedMenuItemId = Number(menuRow.menuItemId);
        const resolvedMenuItemName = menuRow.menuItemName;
        const unitPrice = Number(menuRow.unitPrice);
        if ( !Number.isFinite(unitPrice) || unitPrice < 0 ) {
          throw new Error("invalid unit price in DB");
        }

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

      // We create the payment and advance the order status in the same transaction.
      await conn.query("INSERT INTO payment (order_id, amount, payment_method, paid_at) VALUES (?, ?, ?, ?)", [
        orderId,
        totalAmount,
        paymentMethod,
        now
      ]);
      await conn.query("UPDATE `order` SET status = IF(status = 'created', 'preparing', status) WHERE order_id = ?", [
        orderId
      ]);

      const paymentRow = await conn.query(
        `
        SELECT payment_id AS paymentId, order_id AS orderId, amount, payment_method AS method, paid_at AS paidAt
        FROM payment
        WHERE order_id = ?
        LIMIT 1
        `,
        [orderId]
      );

      const order = {
        orderId,
        createdAt: now,
        status: "preparing",
        totalAmount,
        restaurant: { name: restaurantName, address: restaurantAddress },
        customer: { name: customerName, email: customerEmail },
        orderItems: insertedItems,
        paymentMethod
      };

      return { order, payment: paymentRow[0] };
    });

    res.json({ ok: true, ...result });
  } 
  catch (e) {
    next(e);
  }
});



student1Router.post("/student1/sql/pay", async function(req, res, next) {
  try {
    // We validate the request and then either insert or update the payment record.
    let orderId;
    
    if ( req.body?.orderId ) {
      orderId = Number(req.body.orderId);
    } 
    else {
      orderId = NaN;
    }
    
    let paymentMethod;
    
    if ( req.body?.paymentMethod ) {
      paymentMethod = String(req.body.paymentMethod);
    } 
    else {
      paymentMethod = "";
    }

    if ( !Number.isFinite(orderId) ) {
      throw badRequest("orderId is required");
    }
    if ( !paymentMethod ) {
      throw badRequest("paymentMethod is required");
    }

    const payment = await withTx(async function(conn) {
      // We keep the payment write + status update in one transaction.
      const orders = await conn.query(
        `
        SELECT order_id AS orderId, status, total_amount AS totalAmount
        FROM \`order\`
        WHERE order_id = ?
        LIMIT 1
        `,
        [orderId]
      );
      if ( !orders.length ) {
        throw notFound("order not found");
      }
      const totalAmount = Number(orders[0].totalAmount);
      if ( !Number.isFinite(totalAmount) ) {
        throw new Error("invalid totalAmount in DB");
      }

      const existing = await conn.query(
        `
        SELECT payment_id AS paymentId, paid_at AS paidAt
        FROM payment
        WHERE order_id = ?
        LIMIT 1
        `,
        [orderId]
      );


      if ( existing.length && existing[0].paidAt != null ) {
        throw conflict("order already paid");
      }


      const now = new Date();
      
      if ( !existing.length ) {
        await conn.query("INSERT INTO payment (order_id, amount, payment_method, paid_at) VALUES (?, ?, ?, ?)", [
          orderId,
          totalAmount,
          paymentMethod,
          now
        ]);
      } 
      else {
        await conn.query(
          "UPDATE payment SET amount = ?, payment_method = ?, paid_at = IFNULL(paid_at, ?) WHERE order_id = ?",
          [totalAmount, paymentMethod, now, orderId]
        );
      }

      // We also move the order forward after payment (keeps the demo consistent with imported data statuses).
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
  } 
  catch (e) {
    next(e);
  }
});



student1Router.get("/student1/sql/report", async function(req, res, next) {
  try {
    // We build analytics with KPIs and breakdowns for the restaurant.
    let restaurantName;
    
    if ( req.query.restaurantName ) {
      restaurantName = String(req.query.restaurantName);
    } 
    else {
      restaurantName = "";
    }
    if ( !restaurantName ) {
      throw badRequest("restaurantName is required");
    }

    const from = parseIsoDateOrNull(req.query.from, "from");
    const to = parseIsoDateOrNull(req.query.to, "to");

    const params = [restaurantName];
    let whereExtra = "";
    
    if ( from ) {
      whereExtra += " AND o.created_at >= ? ";
      params.push(from);
    }
    
    if ( to ) {
      whereExtra += " AND o.created_at <= ? ";
      params.push(to);
    }

    const result = await withConn(async function(conn) {
      // We compute summary KPIs first.
      const summaryRows = await conn.query(
        `
        SELECT
          COUNT(*) AS totalOrders,
          COALESCE(SUM(o.total_amount), 0) AS totalRevenue,
          COALESCE(AVG(o.total_amount), 0) AS avgOrderValue,
          SUM(CASE WHEN pay.paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paidOrders,
          SUM(CASE WHEN pay.paid_at IS NULL THEN 1 ELSE 0 END) AS unpaidOrders
        FROM restaurant r
        JOIN \`order\` o ON o.restaurant_id = r.restaurant_id
        LEFT JOIN payment pay ON pay.order_id = o.order_id
        WHERE r.name = ?
        ${whereExtra}
        `,
        params
      );

      const summary = summaryRows[0];
      const totalOrders = Number(summary.totalOrders);
      const paidOrders = Number(summary.paidOrders);

      const summaryData = {
        totalOrders,
        totalRevenue: Number(summary.totalRevenue).toFixed(2),
        avgOrderValue: Number(summary.avgOrderValue).toFixed(2),
        paidOrders,
        unpaidOrders: Number(summary.unpaidOrders),
        paymentRate: totalOrders > 0 ? ((paidOrders / totalOrders) * 100).toFixed(1) : 0
      };

      // We compute orders by status.
      const byStatusRows = await conn.query(
        `
        SELECT
          o.status,
          COUNT(*) AS count
        FROM restaurant r
        JOIN \`order\` o ON o.restaurant_id = r.restaurant_id
        WHERE r.name = ?
        ${whereExtra}
        GROUP BY o.status
        ORDER BY count DESC
        `,
        params
      );
      const byStatus = byStatusRows.map(function(r) {
        return { status: r.status, count: toJsonSafeNumber(r.count, "byStatus.count") };
      });

      // We compute orders per day for trend.
      const byDayRows = await conn.query(
        `
        SELECT
          DATE(o.created_at) AS date,
          COUNT(*) AS orders,
          COALESCE(SUM(o.total_amount), 0) AS revenue
        FROM restaurant r
        JOIN \`order\` o ON o.restaurant_id = r.restaurant_id
        WHERE r.name = ?
        ${whereExtra}
        GROUP BY DATE(o.created_at)
        ORDER BY date DESC
        LIMIT 30
        `,
        params
      );
      const byDay = byDayRows.map(function(r) {
        return {
          date: r.date,
          orders: toJsonSafeNumber(r.orders, "byDay.orders"),
          revenue: toMoneyString(r.revenue, "byDay.revenue")
        };
      });

      // We compute payment method breakdown.
      const byPaymentMethodRows = await conn.query(
        `
        SELECT
          pay.payment_method AS method,
          COUNT(*) AS count,
          COALESCE(SUM(pay.amount), 0) AS total
        FROM restaurant r
        JOIN \`order\` o ON o.restaurant_id = r.restaurant_id
        JOIN payment pay ON pay.order_id = o.order_id
        WHERE r.name = ? AND pay.paid_at IS NOT NULL
        ${whereExtra}
        GROUP BY pay.payment_method
        ORDER BY total DESC
        `,
        params
      );
      const byPaymentMethod = byPaymentMethodRows.map(function(r) {
        return {
          method: r.method,
          count: toJsonSafeNumber(r.count, "byPaymentMethod.count"),
          total: toMoneyString(r.total, "byPaymentMethod.total")
        };
      });

      // We compute top 5 menu items sold.
      const topItemsRows = await conn.query(
        `
        SELECT
          m.name AS itemName,
          SUM(oi.quantity) AS totalQuantity,
          COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS totalRevenue
        FROM restaurant r
        JOIN \`order\` o ON o.restaurant_id = r.restaurant_id
        JOIN order_item oi ON oi.order_id = o.order_id
        JOIN menu_item m ON m.menu_item_id = oi.menu_item_id
        WHERE r.name = ?
        ${whereExtra}
        GROUP BY m.menu_item_id, m.name
        ORDER BY totalQuantity DESC
        LIMIT 5
        `,
        params
      );
      const topItems = topItemsRows.map(function(r) {
        return {
          itemName: r.itemName,
          totalQuantity: toJsonSafeNumber(r.totalQuantity, "topItems.totalQuantity"),
          totalRevenue: toMoneyString(r.totalRevenue, "topItems.totalRevenue")
        };
      });

      return {
        summary: summaryData,
        breakdown: {
          byStatus,
          byDay,
          byPaymentMethod,
          topItems
        }
      };
    });

    res.json({ ok: true, ...result });
  } 
  catch (e) {
    next(e);
  }
});



// -------------------------
// Student 1 - MongoDB
// Use case: Place order + pay
// -------------------------

student1Router.post("/student1/mongo/place_order", async function(req, res, next) {
  try {
    // We validate inputs, normalize items, then insert one order document into Mongo.
    let customerEmail;
    
    if ( req.body?.customerEmail ) {
      customerEmail = String(req.body.customerEmail);
    } 
    else {
      customerEmail = "";
    }
    
    let restaurantName;
    
    if ( req.body?.restaurantName ) {
      restaurantName = String(req.body.restaurantName);
    } 
    else {
      restaurantName = "";
    }
    
    let items;
    
    if ( Array.isArray(req.body?.items) ) {
      items = req.body.items;
    } 
    else {
      items = null;
    }

    if ( !customerEmail ) {
      throw badRequest("customerEmail is required");
    }
    if ( !restaurantName ) {
      throw badRequest("restaurantName is required");
    }
    if ( !items || !items.length ) {
      throw badRequest("items must be a non-empty array");
    }

    const { db } = await getMongo();

    const customer = await db.collection("people").findOne({ type: "customer", email: customerEmail });
    if ( !customer ) {
      throw notFound("customer not found");
    }

    const restaurant = await db.collection("restaurants").findOne({ name: restaurantName });
    if ( !restaurant ) {
      throw notFound("restaurant not found");
    }

    let totalCents = 0;
    const normalizedItems = items.map(function(it, idx) {
      // We normalize each item and compute the running total in cents.
      let name;
      
      if ( it?.name != null && String(it.name).trim() !== "" ) {
        name = String(it.name);
      } 
      else {
        name = null;
      }
      const quantity = toPositiveInt(it?.quantity, `items[${idx}].quantity`);
      const unitPriceCents = priceToCents(it?.unitPrice, `items[${idx}].unitPrice`);
      const unitPrice = centsToAmount(unitPriceCents);
      if ( !name ) {
        throw badRequest(`items[${idx}].name is required`);
      }
      totalCents += unitPriceCents * quantity;
      const out = {
        menuItemId: function() {
          if ( it?.menuItemId == null ) {
            return null;
          } 
          else {
            return Number(it.menuItemId);
          }
        }(),
        name,
        quantity,
        unitPrice
      };
      if ( out.menuItemId != null && !Number.isFinite(out.menuItemId) ) {
        throw badRequest(`items[${idx}].menuItemId must be a number`);
      }
      return out;
    });

    const totalAmount = centsToAmount(totalCents);
    const createdAt = new Date();

    // We generate a numeric orderId (compatible with migrated data) and rely on a unique index for safety.
    let insertedOrderId = null;
    
    for ( let attempt = 0; attempt < 5; attempt++ ) {
      const last = await db.collection("orders").findOne({}, { sort: { orderId: -1 }, projection: { _id: 0, orderId: 1 } });
      let baseId;
      
      if ( last?.orderId ) {
        baseId = Number(last.orderId);
      } 
      else {
        baseId = 0;
      }
      
      const nextId = baseId + 1;
      if ( !Number.isFinite(nextId) || nextId <= 0 ) {
        throw new Error("failed to generate orderId");
      }

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
      } 
      catch (e) {
        // Duplicate key on unique orderId index -> retry.
        let errorMessage;
        
        if ( e.message ) {
          errorMessage = String(e.message);
        } 
        else {
          errorMessage = "";
        }
        
        if ( e && (e.code === 11000 || errorMessage.includes("E11000")) ) {
          continue;
        }
        throw e;
      }
    }

    if ( !insertedOrderId ) {
      throw new Error("could not allocate a unique orderId");
    }

    // Return the same structure as SQL for consistency
    const order = {
      orderId: insertedOrderId,
      createdAt,
      status: "created",
      totalAmount,
      restaurant: {
        name: restaurant.name,
        address: restaurant.address
      },
      customer: {
        name: customer.name,
        email: customer.email
      },
      orderItems: normalizedItems
    };

    res.json({ ok: true, order });
  } 
  catch (e) {
    next(e);
  }
});

// Place + Pay in one step (prevents creating unpaid orders)
student1Router.post("/student1/mongo/place_and_pay", async function(req, res, next) {
  try {
    let customerEmail;
    
    if ( req.body?.customerEmail ) {
      customerEmail = String(req.body.customerEmail);
    } 
    else {
      customerEmail = "";
    }
    
    let restaurantName;
    
    if ( req.body?.restaurantName ) {
      restaurantName = String(req.body.restaurantName);
    } 
    else {
      restaurantName = "";
    }
    
    let paymentMethod;
    
    if ( req.body?.paymentMethod ) {
      paymentMethod = String(req.body.paymentMethod);
    } 
    else {
      paymentMethod = "";
    }
    
    let items;
    
    if ( Array.isArray(req.body?.items) ) {
      items = req.body.items;
    } 
    else {
      items = null;
    }

    if ( !customerEmail ) {
      throw badRequest("customerEmail is required");
    }
    if ( !restaurantName ) {
      throw badRequest("restaurantName is required");
    }
    if ( !paymentMethod ) {
      throw badRequest("paymentMethod is required");
    }
    if ( !items || !items.length ) {
      throw badRequest("items must be a non-empty array");
    }

    const { db } = await getMongo();

    const customer = await db.collection("people").findOne({ type: "customer", email: customerEmail });
    if ( !customer ) {
      throw notFound("customer not found");
    }

    const restaurant = await db.collection("restaurants").findOne({ name: restaurantName });
    if ( !restaurant ) {
      throw notFound("restaurant not found");
    }

    let totalCents = 0;
    const normalizedItems = items.map(function(it, idx) {
      let name;
      
      if ( it?.name != null && String(it.name).trim() !== "" ) {
        name = String(it.name);
      } 
      else {
        name = null;
      }
      const quantity = toPositiveInt(it?.quantity, `items[${idx}].quantity`);
      const unitPriceCents = priceToCents(it?.unitPrice, `items[${idx}].unitPrice`);
      const unitPrice = centsToAmount(unitPriceCents);
      if ( !name ) {
        throw badRequest(`items[${idx}].name is required`);
      }
      totalCents += unitPriceCents * quantity;
      const out = {
        menuItemId: function() {
          if ( it?.menuItemId == null ) {
            return null;
          } 
          else {
            return Number(it.menuItemId);
          }
        }(),
        name,
        quantity,
        unitPrice
      };
      if ( out.menuItemId != null && !Number.isFinite(out.menuItemId) ) {
        throw badRequest(`items[${idx}].menuItemId must be a number`);
      }
      return out;
    });

    const totalAmount = centsToAmount(totalCents);
    const createdAt = new Date();
    const paidAt = createdAt;

    // We generate a numeric orderId (compatible with migrated data) and rely on a unique index for safety.
    let insertedOrderId = null;
    
    for ( let attempt = 0; attempt < 5; attempt++ ) {
      const last = await db.collection("orders").findOne({}, { sort: { orderId: -1 }, projection: { _id: 0, orderId: 1 } });
      let baseId;
      
      if ( last?.orderId ) {
        baseId = Number(last.orderId);
      } 
      else {
        baseId = 0;
      }
      
      const nextId = baseId + 1;
      if ( !Number.isFinite(nextId) || nextId <= 0 ) {
        throw new Error("failed to generate orderId");
      }

      try {
        await db.collection("orders").insertOne({
          orderId: nextId,
          createdAt,
          status: "preparing",
          totalAmount,
          restaurant: {
            restaurantId: Number(restaurant.restaurantId),
            name: restaurant.name,
            address: restaurant.address
          },
          customer: { personId: Number(customer.personId), name: customer.name, email: customer.email },
          orderItems: normalizedItems,
          payment: {
            paymentId: null,
            amount: totalAmount,
            method: paymentMethod,
            paidAt
          },
          delivery: null
        });
        insertedOrderId = nextId;
        break;
      } 
      catch (e) {
        let errorMessage;
        
        if ( e.message ) {
          errorMessage = String(e.message);
        } 
        else {
          errorMessage = "";
        }
        
        if ( e && (e.code === 11000 || errorMessage.includes("E11000")) ) {
          continue;
        }
        throw e;
      }
    }

    if ( !insertedOrderId ) {
      throw new Error("could not allocate a unique orderId");
    }

    const order = {
      orderId: insertedOrderId,
      createdAt,
      status: "preparing",
      totalAmount,
      restaurant: {
        name: restaurant.name,
        address: restaurant.address
      },
      customer: {
        name: customer.name,
        email: customer.email
      },
      orderItems: normalizedItems,
      paymentMethod
    };

    res.json({
      ok: true,
      order,
      payment: { paymentId: null, orderId: insertedOrderId, amount: totalAmount, method: paymentMethod, paidAt }
    });
  } 
  catch (e) {
    next(e);
  }
});



student1Router.post("/student1/mongo/pay", async function(req, res, next) {
  try {
    // We update payment and status atomically with a pipeline update.
    let orderId;
    
    if ( req.body?.orderId ) {
      orderId = Number(req.body.orderId);
    } 
    else {
      orderId = NaN;
    }
    
    let paymentMethod;
    
    if ( req.body?.paymentMethod ) {
      paymentMethod = String(req.body.paymentMethod);
    } 
    else {
      paymentMethod = "";
    }

    if ( !Number.isFinite(orderId) ) {
      throw badRequest("orderId is required");
    }
    if ( !paymentMethod ) {
      throw badRequest("paymentMethod is required");
    }

    const { db } = await getMongo();

    // We keep paidAt immutable: only set it if missing/null.
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

    if ( !result.matchedCount ) {
      throw notFound("order not found in mongo (did you migrate?)");
    }

    const updated = await db
      .collection("orders")
      .findOne({ orderId }, { projection: { _id: 0, orderId: 1, payment: 1, status: 1, totalAmount: 1 } });

    if ( updated?.payment?.paidAt == null ) {
      throw new Error("payment update failed");
    }

    res.json({ ok: true, orderId: updated.orderId, status: updated.status, payment: updated.payment });
  } catch (e) {
    next(e);
  }
});

student1Router.get("/student1/mongo/report", async function(req, res, next) {
  try {
    // We build analytics with KPIs and breakdowns for the restaurant from Mongo.
    let restaurantName;
    
    if ( req.query.restaurantName ) {
      restaurantName = String(req.query.restaurantName);
    } 
    else {
      restaurantName = "";
    }
    if ( !restaurantName ) {
      throw badRequest("restaurantName is required");
    }

    const from = parseIsoDateOrNull(req.query.from, "from");
    const to = parseIsoDateOrNull(req.query.to, "to");

    const { db } = await getMongo();

    const match = { "restaurant.name": restaurantName };
    
    if ( from || to ) {
      match.createdAt = {};
      
      if ( from ) {
        match.createdAt.$gte = from;
      }
      
      if ( to ) {
        match.createdAt.$lte = to;
      }
    }

    // We compute summary KPIs.
    const summaryResult = await db.collection("orders").aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmount" },
          avgOrderValue: { $avg: "$totalAmount" },
          paidOrders: {
            $sum: { $cond: [{ $ne: ["$payment.paidAt", null] }, 1, 0] }
          },
          unpaidOrders: {
            $sum: { $cond: [{ $eq: ["$payment.paidAt", null] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const summaryRaw = summaryResult[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      paidOrders: 0,
      unpaidOrders: 0
    };

    const totalOrders = Number(summaryRaw.totalOrders);
    const paidOrders = Number(summaryRaw.paidOrders);

    const summary = {
      totalOrders,
      totalRevenue: Number(summaryRaw.totalRevenue).toFixed(2),
      avgOrderValue: Number(summaryRaw.avgOrderValue).toFixed(2),
      paidOrders,
      unpaidOrders: Number(summaryRaw.unpaidOrders),
      paymentRate: totalOrders > 0 ? ((paidOrders / totalOrders) * 100).toFixed(1) : 0
    };

    // We compute orders by status.
    const byStatus = await db.collection("orders").aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      },
      { $project: { _id: 0, status: "$_id", count: 1 } },
      { $sort: { count: -1 } }
    ]).toArray();

    // We compute orders per day.
    const byDay = await db.collection("orders").aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$totalAmount" }
        }
      },
      { $project: { _id: 0, date: "$_id", orders: 1, revenue: 1 } },
      { $sort: { date: -1 } },
      { $limit: 30 }
    ]).toArray();

    // We compute payment method breakdown.
    const byPaymentMethod = await db.collection("orders").aggregate([
      { $match: { ...match, "payment.paidAt": { $ne: null } } },
      {
        $group: {
          _id: "$payment.method",
          count: { $sum: 1 },
          total: { $sum: "$payment.amount" }
        }
      },
      { $project: { _id: 0, method: "$_id", count: 1, total: 1 } },
      { $sort: { total: -1 } }
    ]).toArray();

    // We compute top 5 menu items sold.
    const topItems = await db.collection("orders").aggregate([
      { $match: match },
      { $unwind: "$orderItems" },
      {
        $group: {
          _id: "$orderItems.name",
          totalQuantity: { $sum: "$orderItems.quantity" },
          totalRevenue: {
            $sum: { $multiply: ["$orderItems.quantity", "$orderItems.unitPrice"] }
          }
        }
      },
      { $project: { _id: 0, itemName: "$_id", totalQuantity: 1, totalRevenue: 1 } },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 }
    ]).toArray();

    res.json({
      ok: true,
      summary,
      breakdown: {
        byStatus,
        byDay,
        byPaymentMethod,
        topItems
      }
    });
  } 
  catch (e) {
    next(e);
  }
});



// -------------------------
// Student 1 - MongoDB Orders Query
// -------------------------

student1Router.get("/student1/mongo/orders", async function(req, res, next) {
  try {
    // We query orders from Mongo, then map them into the same shape as the SQL endpoint.
    let customerEmail;
    
    if ( req.query.customerEmail ) {
      customerEmail = String(req.query.customerEmail);
    } 
    else {
      customerEmail = null;
    }
    
    let limit;
    
    if ( req.query.limit ) {
      limit = Number(req.query.limit);
    } 
    else {
      limit = 50;
    }

    const { db } = await getMongo();

    const filter = {};
    
    if ( customerEmail ) {
      filter["customer.email"] = customerEmail;
    }

    let finalLimit = Math.max(limit, 1);
    finalLimit = Math.min(finalLimit, 200);
    
    const orders = await db
      .collection("orders")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(finalLimit)
      .toArray();

    // Transform MongoDB documents to match SQL format for consistency
    const transformedOrders = orders.map(function(order) {
      return {
      orderId: order.orderId,
      createdAt: order.createdAt,
      status: order.status,
      totalAmount: order.totalAmount,
      restaurantName: function() {
        if ( order.restaurant?.name ) {
          return order.restaurant.name;
        } 
        else {
          return null;
        }
      }(),
      customerEmail: function() {
        if ( order.customer?.email ) {
          return order.customer.email;
        } 
        else {
          return null;
        }
      }(),
      deliveryStatus: function() {
        if ( order.delivery?.deliveryStatus ) {
          return order.delivery.deliveryStatus;
        } 
        else {
          return null;
        }
      }(),
      assignedAt: function() {
        if ( order.delivery?.assignedAt ) {
          return order.delivery.assignedAt;
        } 
        else {
          return null;
        }
      }(),
      riderEmail: function() {
        if ( order.delivery?.rider?.email ) {
          return order.delivery.rider.email;
        } 
        else {
          return null;
        }
      }(),
      paymentMethod: function() {
        if ( order.payment?.method ) {
          return order.payment.method;
        } 
        else {
          return null;
        }
      }()
      };
    });

    res.json({ ok: true, orders: transformedOrders });
  } 
  catch (e) {
    next(e);
  }
});

module.exports = { student1Router };

