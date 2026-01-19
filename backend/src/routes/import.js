// File flow:
// - We expose endpoints to reset/import demo data into MariaDB.
// - We return simple lookup lists (riders, customers, restaurants, menu items).
// - We list orders with optional filters and a safe limit.

const express = require("express");

const { importResetMariaDb } = require("../services/importReset");
const { withConn } = require("../db/mariadb");

const importRouter = express.Router();

importRouter.post("/import_reset", async function(_req, res, next) {
  try {
    // We reset the SQL database back to a known demo state.
    const result = await importResetMariaDb();
    res.json({ ok: true, inserted: result });
  } 
  catch (e) {
    next(e);
  }
});

importRouter.get("/riders", async function(_req, res, next) {
  try {
    // We read riders joined with person so We can return name + email.
    const riders = await withConn(function(conn) {
      return conn.query(
        `
        SELECT
          r.rider_id AS riderId,
          p.name AS name,
          p.email AS email,
          r.vehicle_type AS vehicleType,
          r.rating AS rating
        FROM rider r
        JOIN person p ON p.person_id = r.rider_id
        ORDER BY p.name ASC
        `
      );
    });
    res.json({ ok: true, riders });
  } 
  catch (e) {
    next(e);
  }
});



importRouter.get("/customers", async function(_req, res, next) {
  try {
    // We read customers joined with person so We can return name + email.
    const customers = await withConn(function(conn) {
      return conn.query(
        `
        SELECT
          c.customer_id AS customerId,
          p.name AS name,
          p.email AS email,
          c.default_address AS defaultAddress
        FROM customer c
        JOIN person p ON p.person_id = c.customer_id
        ORDER BY p.name ASC
        `
      );
    });
    res.json({ ok: true, customers });
  } 
  catch (e) {
    next(e);
  }
});



importRouter.get("/restaurants", async function(_req, res, next) {
  try {
    // We list restaurants for dropdowns and filtering in the UI.
    const restaurants = await withConn(function(conn) {
      return conn.query(
        `
        SELECT
          restaurant_id AS restaurantId,
          name,
          address
        FROM restaurant
        ORDER BY name ASC
        `
      );
    });
    res.json({ ok: true, restaurants });
  } 
  catch (e) {
    next(e);
  }
});



importRouter.get("/menu_items", async function(req, res, next) {
  try {
    const restaurantName = req.query.restaurantName;
    
    if ( !restaurantName ) {
      // No restaurant selected, so We return an empty list.
      return res.json({ ok: true, menuItems: [] });
    }


    // We fetch menu items for one restaurant name.
    const menuItems = await withConn(function(conn) {
      return conn.query(
        `
        SELECT
          m.menu_item_id AS menuItemId,
          m.name,
          m.description,
          m.price,
          r.name AS restaurantName
        FROM menu_item m
        JOIN restaurant r ON r.restaurant_id = m.restaurant_id
        WHERE r.name = ?
        ORDER BY m.name ASC
        `,
        [restaurantName]
      );
    });
    res.json({ ok: true, menuItems });
  } 
  catch (e) {
    next(e);
  }
});



importRouter.get("/orders", async function(req, res, next) {
  try {
    // We parse optional filters from the query string.
    let limitValue;
    
    if ( req.query.limit ) {
      limitValue = req.query.limit;
    } 
    else {
      limitValue = 50;
    }
    
    const limit = Number(limitValue);
    let status;
    
    if ( req.query.status ) {
      status = String(req.query.status);
    } 
    else {
      status = null;
    }
    
    let riderEmail;
    
    if ( req.query.riderEmail ) {
      riderEmail = String(req.query.riderEmail);
    } 
    else {
      riderEmail = null;
    }
    
    let deliveryStatus;
    
    if ( req.query.deliveryStatus ) {
      deliveryStatus = String(req.query.deliveryStatus);
    } 
    else {
      deliveryStatus = null;
    }
    const unassigned = req.query.unassigned === 'true';
    const excludeDelivered = req.query.excludeDelivered === 'true';

    // We build the WHERE clause and parameters based on what filters are present.
    const params = [];
    const whereConditions = [];
    
    
    if ( status ) {
      whereConditions.push("o.status = ?");
      params.push(status);
    }


    if ( riderEmail ) {
      whereConditions.push("rp.email = ?");
      params.push(riderEmail);
    }


    if ( deliveryStatus ) {
      whereConditions.push("d.delivery_status = ?");
      params.push(deliveryStatus);
    }


    if ( unassigned ) {
      whereConditions.push("d.rider_id IS NULL");
    }


    if ( excludeDelivered ) {
      whereConditions.push("(d.delivery_status IS NULL OR d.delivery_status != 'delivered')");
    }

    let whereSql;
    
    if ( whereConditions.length > 0 ) {
      whereSql = "WHERE " + whereConditions.join(" AND ");
    } 
    else {
      whereSql = "";
    }
    
    let finalLimit;
    
    // We clamp the limit so one request cannot pull the whole DB.
    if ( Number.isFinite(limit) ) {
      finalLimit = Math.min(Math.max(limit, 1), 200);
    } 
    else {
      finalLimit = 50;
    }
    
    params.push(finalLimit);

    // We return recent orders, with optional rider/delivery info via LEFT JOIN.
    const orders = await withConn(function(conn) {
      return conn.query(
        `
        SELECT
          o.order_id AS orderId,
          o.created_at AS createdAt,
          o.status AS status,
          o.total_amount AS totalAmount,
          r.name AS restaurantName,
          cp.email AS customerEmail,
          d.delivery_status AS deliveryStatus,
          d.assigned_at AS assignedAt,
          rp.email AS riderEmail,
          pay.payment_method AS paymentMethod
        FROM \`order\` o
        JOIN restaurant r ON r.restaurant_id = o.restaurant_id
        JOIN customer c ON c.customer_id = o.customer_id
        JOIN person cp ON cp.person_id = c.customer_id
        LEFT JOIN delivery d ON d.order_id = o.order_id
        LEFT JOIN rider rid ON rid.rider_id = d.rider_id
        LEFT JOIN person rp ON rp.person_id = rid.rider_id
        LEFT JOIN payment pay ON pay.order_id = o.order_id
        ${whereSql}
        ORDER BY o.created_at DESC
        LIMIT ?
        `,
        params
      );
    });

    res.json({ ok: true, orders });
  } 
  catch (e) {
    next(e);
  }
});

module.exports = { importRouter };

