const express = require("express");

const { withTx, withConn } = require("../db/mariadb");
const { getMongo } = require("../db/mongodb");

const student2Router = express.Router();

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

student2Router.post("/student2/sql/assign_delivery", async (req, res, next) => {
  try {
    const riderEmail = req.body?.riderEmail ? String(req.body.riderEmail) : "";
    const orderId = req.body?.orderId ? Number(req.body.orderId) : NaN;
    const deliveryStatus = req.body?.deliveryStatus ? String(req.body.deliveryStatus) : "";

    if (!riderEmail) throw badRequest("riderEmail is required");
    if (!Number.isFinite(orderId)) throw badRequest("orderId is required");
    if (!deliveryStatus) throw badRequest("deliveryStatus is required");

    const delivery = await withTx(async (conn) => {
      // I resolve the rider by email so the UI doesn't need internal IDs.
      const riders = await conn.query(
        `
        SELECT r.rider_id AS riderId, p.email AS email
        FROM rider r
        JOIN person p ON p.person_id = r.rider_id
        WHERE p.email = ?
        LIMIT 1
        `,
        [riderEmail]
      );
      if (!riders.length) throw notFound("rider not found");
      const riderId = Number(riders[0].riderId);

      const orders = await conn.query("SELECT order_id AS orderId FROM `order` WHERE order_id = ? LIMIT 1", [orderId]);
      if (!orders.length) throw notFound("order not found");

      const now = new Date();

      const existing = await conn.query(
        "SELECT delivery_id AS deliveryId, assigned_at AS assignedAt FROM delivery WHERE order_id = ? LIMIT 1",
        [orderId]
      );

      if (!existing.length) {
        await conn.query(
          "INSERT INTO delivery (order_id, rider_id, assigned_at, delivery_status) VALUES (?, ?, ?, ?)",
          [orderId, riderId, now, deliveryStatus]
        );
      } else {
        const assignedAtWasNull = existing[0].assignedAt == null;
        const assignedAt = assignedAtWasNull ? now : existing[0].assignedAt;

        await conn.query(
          "UPDATE delivery SET rider_id = ?, assigned_at = ?, delivery_status = ? WHERE order_id = ?",
          [riderId, assignedAt, deliveryStatus, orderId]
        );
      }

      const out = await conn.query(
        `
        SELECT
          d.delivery_id AS deliveryId,
          d.order_id AS orderId,
          p.email AS riderEmail,
          d.delivery_status AS deliveryStatus,
          d.assigned_at AS assignedAt
        FROM delivery d
        JOIN rider r ON r.rider_id = d.rider_id
        JOIN person p ON p.person_id = r.rider_id
        WHERE d.order_id = ?
        LIMIT 1
        `,
        [orderId]
      );

      return out[0];
    });

    res.json({ ok: true, delivery });
  } catch (e) {
    next(e);
  }
});

student2Router.get("/student2/sql/report", async (req, res, next) => {
  try {
    const riderEmail = req.query.riderEmail ? String(req.query.riderEmail) : "";
    if (!riderEmail) throw badRequest("riderEmail is required");

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const deliveryStatus = req.query.deliveryStatus ? String(req.query.deliveryStatus) : null;

    if (from && Number.isNaN(from.getTime())) throw badRequest("from must be an ISO date");
    if (to && Number.isNaN(to.getTime())) throw badRequest("to must be an ISO date");

    const params = [riderEmail];
    let whereExtra = "";

    if (from) {
      whereExtra += " AND o.created_at >= ? ";
      params.push(from);
    }
    if (to) {
      whereExtra += " AND o.created_at <= ? ";
      params.push(to);
    }
    if (deliveryStatus) {
      whereExtra += " AND d.delivery_status = ? ";
      params.push(deliveryStatus);
    }

    const rows = await withConn((conn) =>
      conn.query(
        `
        SELECT
          p.email AS riderEmail,
          p.name AS riderName,
          r.vehicle_type AS vehicleType,
          d.delivery_id AS deliveryId,
          d.delivery_status AS deliveryStatus,
          d.assigned_at AS assignedAt,
          o.order_id AS orderId,
          o.created_at AS orderCreatedAt,
          o.total_amount AS totalAmount,
          rest.name AS restaurantName
        FROM rider r
        JOIN person p ON p.person_id = r.rider_id
        JOIN delivery d ON d.rider_id = r.rider_id
        JOIN \`order\` o ON o.order_id = d.order_id
        JOIN restaurant rest ON rest.restaurant_id = o.restaurant_id
        WHERE p.email = ?
        ${whereExtra}
        ORDER BY d.assigned_at DESC
        `,
        params
      )
    );

    res.json({ ok: true, rows });
  } catch (e) {
    next(e);
  }
});

student2Router.post("/student2/mongo/assign_delivery", async (req, res, next) => {
  try {
    const riderEmail = req.body?.riderEmail ? String(req.body.riderEmail) : "";
    const orderId = req.body?.orderId ? Number(req.body.orderId) : NaN;
    const deliveryStatus = req.body?.deliveryStatus ? String(req.body.deliveryStatus) : "";

    if (!riderEmail) throw badRequest("riderEmail is required");
    if (!Number.isFinite(orderId)) throw badRequest("orderId is required");
    if (!deliveryStatus) throw badRequest("deliveryStatus is required");

    const { db } = await getMongo();

    // I resolve the rider from the 'people' collection (migrated from SQL).
    const rider = await db.collection("people").findOne({ type: "rider", email: riderEmail });
    if (!rider) throw notFound("rider not found");

    const now = new Date();

    // I first read the order so I can keep assignedAt stable if it was already set.
    const order = await db.collection("orders").findOne({ orderId });
    if (!order) throw notFound("order not found in mongo (did you migrate?)");

    const assignedAt = order.delivery?.assignedAt ?? now;

    await db.collection("orders").updateOne(
      { orderId },
      {
        $set: {
          "delivery.deliveryStatus": deliveryStatus,
          "delivery.rider": {
            personId: rider.personId,
            name: rider.name,
            email: rider.email,
            vehicleType: rider.rider?.vehicleType || null,
            rating: rider.rider?.rating ?? null
          },
          "delivery.assignedAt": assignedAt
        }
      }
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

student2Router.get("/student2/mongo/report", async (req, res, next) => {
  try {
    const riderEmail = req.query.riderEmail ? String(req.query.riderEmail) : "";
    if (!riderEmail) throw badRequest("riderEmail is required");

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const deliveryStatus = req.query.deliveryStatus ? String(req.query.deliveryStatus) : null;

    if (from && Number.isNaN(from.getTime())) throw badRequest("from must be an ISO date");
    if (to && Number.isNaN(to.getTime())) throw badRequest("to must be an ISO date");

    const { db } = await getMongo();

    const match = {
      "delivery.rider.email": riderEmail
    };

    if (deliveryStatus) match["delivery.deliveryStatus"] = deliveryStatus;
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
            riderEmail: "$delivery.rider.email",
            riderName: "$delivery.rider.name",
            vehicleType: "$delivery.rider.vehicleType",
            deliveryId: "$delivery.deliveryId",
            deliveryStatus: "$delivery.deliveryStatus",
            assignedAt: "$delivery.assignedAt",
            orderId: "$orderId",
            orderCreatedAt: "$createdAt",
            totalAmount: "$totalAmount",
            restaurantName: "$restaurant.name"
          }
        },
        { $sort: { assignedAt: -1 } }
      ])
      .toArray();

    res.json({ ok: true, rows });
  } catch (e) {
    next(e);
  }
});

module.exports = { student2Router };

