// File flow:
// - We expose Student 2 endpoints for assigning deliveries and reporting on deliveries.
// - We support both MariaDB and Mongo with matching output shapes.
// - We validate inputs, write safely, and return JSON for the UI.

const express = require("express");

const { withTx, withConn } = require("../db/mariadb");
const { getMongo } = require("../db/mongodb");
const { toJsonSafeNumber, toMoneyString } = require("../utils/json");

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



student2Router.post("/student2/sql/assign_delivery", async function(req, res, next) {
  try {
    // We validate inputs, then insert or update the delivery row in one transaction.
    let riderEmail;
    
    if ( req.body?.riderEmail ) {
      riderEmail = String(req.body.riderEmail);
    } 
    else {
      riderEmail = "";
    }
    
    let orderId;
    
    if ( req.body?.orderId ) {
      orderId = Number(req.body.orderId);
    } 
    else {
      orderId = NaN;
    }
    
    let deliveryStatus;
    
    if ( req.body?.deliveryStatus ) {
      deliveryStatus = String(req.body.deliveryStatus);
    } 
    else {
      deliveryStatus = "";
    }

    if ( !riderEmail ) {
      throw badRequest("riderEmail is required");
    }
    if ( !Number.isFinite(orderId) ) {
      throw badRequest("orderId is required");
    }
    if ( !deliveryStatus ) {
      throw badRequest("deliveryStatus is required");
    }

    const delivery = await withTx(async function(conn) {
      // We resolve the rider by email so the UI doesn't need internal IDs.
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
      if ( !riders.length ) {
        throw notFound("rider not found");
      }
      const riderId = Number(riders[0].riderId);

      const orders = await conn.query("SELECT order_id AS orderId FROM `order` WHERE order_id = ? LIMIT 1", [orderId]);
      if ( !orders.length ) {
        throw notFound("order not found");
      }

      const now = new Date();


      const existing = await conn.query(
        "SELECT delivery_id AS deliveryId, assigned_at AS assignedAt FROM delivery WHERE order_id = ? LIMIT 1",
        [orderId]
      );

      if ( !existing.length ) {
        // First assignment: We set assignedAt to now.
        await conn.query(
          "INSERT INTO delivery (order_id, rider_id, assigned_at, delivery_status) VALUES (?, ?, ?, ?)",
          [orderId, riderId, now, deliveryStatus]
        );
      } 
      else {
        // Re-assign: We keep assignedAt stable if it already exists.
        const assignedAtWasNull = existing[0].assignedAt == null;
        let assignedAt;
        
        if ( assignedAtWasNull ) {
          assignedAt = now;
        } 
        else {
          assignedAt = existing[0].assignedAt;
        }

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
  } 
  catch (e) {
    next(e);
  }
});



student2Router.get("/student2/sql/report", async function(req, res, next) {
  try {
    // We build analytics with KPIs and breakdowns for the rider.
    let riderEmail;
    
    if ( req.query.riderEmail ) {
      riderEmail = String(req.query.riderEmail);
    } 
    else {
      riderEmail = "";
    }
    if ( !riderEmail ) {
      throw badRequest("riderEmail is required");
    }

    let from;
    
    if ( req.query.from ) {
      from = new Date(String(req.query.from));
    } 
    else {
      from = null;
    }
    
    let to;
    
    if ( req.query.to ) {
      to = new Date(String(req.query.to));
    } 
    else {
      to = null;
    }
    
    let deliveryStatus;
    
    if ( req.query.deliveryStatus ) {
      deliveryStatus = String(req.query.deliveryStatus);
    } 
    else {
      deliveryStatus = null;
    }

    if ( from && Number.isNaN(from.getTime()) ) {
      throw badRequest("from must be an ISO date");
    }
    if ( to && Number.isNaN(to.getTime()) ) {
      throw badRequest("to must be an ISO date");
    }

    const params = [riderEmail];
    let whereExtra = "";

    if ( from ) {
      whereExtra += " AND o.created_at >= ? ";
      params.push(from);
    }
    
    if ( to ) {
      whereExtra += " AND o.created_at <= ? ";
      params.push(to);
    }
    
    if ( deliveryStatus ) {
      whereExtra += " AND d.delivery_status = ? ";
      params.push(deliveryStatus);
    }

    const result = await withConn(async function(conn) {
      // We compute summary KPIs first.
      const summaryRows = await conn.query(
        `
        SELECT
          COUNT(*) AS totalDeliveries,
          COALESCE(SUM(o.total_amount), 0) AS totalRevenue,
          COALESCE(AVG(o.total_amount), 0) AS avgOrderValue,
          SUM(CASE WHEN d.delivery_status = 'assigned' THEN 1 ELSE 0 END) AS assigned,
          SUM(CASE WHEN d.delivery_status = 'picked_up' THEN 1 ELSE 0 END) AS pickedUp,
          SUM(CASE WHEN d.delivery_status = 'delivered' THEN 1 ELSE 0 END) AS delivered
        FROM rider r
        JOIN person p ON p.person_id = r.rider_id
        JOIN delivery d ON d.rider_id = r.rider_id
        JOIN \`order\` o ON o.order_id = d.order_id
        WHERE p.email = ?
        ${whereExtra}
        `,
        params
      );

      const summary = summaryRows[0];
      const totalDeliveriesNum = Number(summary.totalDeliveries);
      const deliveredNum = Number(summary.delivered);

      const summaryData = {
        totalDeliveries: toJsonSafeNumber(summary.totalDeliveries, "summary.totalDeliveries"),
        totalRevenue: toMoneyString(summary.totalRevenue, "summary.totalRevenue"),
        avgOrderValue: toMoneyString(summary.avgOrderValue, "summary.avgOrderValue"),
        byStatus: {
          assigned: toJsonSafeNumber(summary.assigned, "summary.byStatus.assigned"),
          picked_up: toJsonSafeNumber(summary.pickedUp, "summary.byStatus.pickedUp"),
          delivered: toJsonSafeNumber(summary.delivered, "summary.byStatus.delivered")
        },
        completionRate: totalDeliveriesNum > 0 ? ((deliveredNum / totalDeliveriesNum) * 100).toFixed(1) : 0
      };

      // We compute deliveries per day.
      const byDayRows = await conn.query(
        `
        SELECT
          DATE(o.created_at) AS date,
          COUNT(*) AS deliveries
        FROM rider r
        JOIN person p ON p.person_id = r.rider_id
        JOIN delivery d ON d.rider_id = r.rider_id
        JOIN \`order\` o ON o.order_id = d.order_id
        WHERE p.email = ?
        ${whereExtra}
        GROUP BY DATE(o.created_at)
        ORDER BY date DESC
        LIMIT 30
        `,
        params
      );
      const byDay = byDayRows.map(function(r) {
        return { date: r.date, deliveries: toJsonSafeNumber(r.deliveries, "byDay.deliveries") };
      });

      // We compute top restaurants by delivery count.
      const byRestaurantRows = await conn.query(
        `
        SELECT
          rest.name AS restaurant,
          COUNT(*) AS count
        FROM rider r
        JOIN person p ON p.person_id = r.rider_id
        JOIN delivery d ON d.rider_id = r.rider_id
        JOIN \`order\` o ON o.order_id = d.order_id
        JOIN restaurant rest ON rest.restaurant_id = o.restaurant_id
        WHERE p.email = ?
        ${whereExtra}
        GROUP BY rest.restaurant_id, rest.name
        ORDER BY count DESC
        LIMIT 5
        `,
        params
      );
      const byRestaurant = byRestaurantRows.map(function(r) {
        return { restaurant: r.restaurant, count: toJsonSafeNumber(r.count, "byRestaurant.count") };
      });

      return {
        summary: summaryData,
        breakdown: {
          byDay,
          byRestaurant
        }
      };
    });

    res.json({ ok: true, ...result });
  } 
  catch (e) {
    next(e);
  }
});



student2Router.post("/student2/mongo/assign_delivery", async function(req, res, next) {
  try {
    // We assign a delivery in Mongo and make sure assignedAt is only set once.
    let riderEmail;
    
    if ( req.body?.riderEmail ) {
      riderEmail = String(req.body.riderEmail);
    } 
    else {
      riderEmail = "";
    }
    
    let orderId;
    
    if ( req.body?.orderId ) {
      orderId = Number(req.body.orderId);
    } 
    else {
      orderId = NaN;
    }
    
    let deliveryStatus;
    
    if ( req.body?.deliveryStatus ) {
      deliveryStatus = String(req.body.deliveryStatus);
    } 
    else {
      deliveryStatus = "";
    }

    if ( !riderEmail ) {
      throw badRequest("riderEmail is required");
    }
    if ( !Number.isFinite(orderId) ) {
      throw badRequest("orderId is required");
    }
    if ( !deliveryStatus ) {
      throw badRequest("deliveryStatus is required");
    }

    const { db } = await getMongo();

    // We resolve the rider from the 'people' collection (migrated from SQL).
    const rider = await db.collection("people").findOne({ type: "rider", email: riderEmail });
    if ( !rider ) {
      throw notFound("rider not found");
    }

    // We do this as a pipeline update so assignedAt is set once and never overwritten.
    const updateResult = await db.collection("orders").updateOne(
      { orderId },
      [
        {
          $set: {
            // Some orders start with delivery: null, so We always write the full delivery object.
            delivery: {
              $let: {
                vars: { existing: { $ifNull: ["$delivery", {}] } },
                in: {
                  $mergeObjects: [
                    "$$existing",
                    {
                      deliveryId: { $ifNull: ["$$existing.deliveryId", "$orderId"] },
                      deliveryStatus,
                      rider: {
                        personId: rider.personId,
                        name: rider.name,
                        email: rider.email,
                        vehicleType: function() {
                          if ( rider.rider?.vehicleType ) {
                            return rider.rider.vehicleType;
                          } 
                          else {
                            return null;
                          }
                        }(),
                        rating: function() {
                          if ( rider.rider?.rating != null ) {
                            return rider.rider.rating;
                          } 
                          else {
                            return null;
                          }
                        }()
                      },
                      assignedAt: { $ifNull: ["$$existing.assignedAt", "$$NOW"] }
                    }
                  ]
                }
              }
            }
          }
        }
      ]
    );

    if ( !updateResult.matchedCount ) {
      throw notFound("order not found in mongo (did you migrate?)");
    }

    res.json({ ok: true });
  } 
  catch (e) {
    next(e);
  }
});

student2Router.get("/student2/mongo/report", async function(req, res, next) {
  try {
    // We build analytics with KPIs and breakdowns for the rider from Mongo.
    let riderEmail;
    
    if ( req.query.riderEmail ) {
      riderEmail = String(req.query.riderEmail);
    } 
    else {
      riderEmail = "";
    }
    if ( !riderEmail ) {
      throw badRequest("riderEmail is required");
    }

    let from;
    
    if ( req.query.from ) {
      from = new Date(String(req.query.from));
    } 
    else {
      from = null;
    }
    
    let to;
    
    if ( req.query.to ) {
      to = new Date(String(req.query.to));
    } 
    else {
      to = null;
    }
    
    let deliveryStatus;
    
    if ( req.query.deliveryStatus ) {
      deliveryStatus = String(req.query.deliveryStatus);
    } 
    else {
      deliveryStatus = null;
    }

    if ( from && Number.isNaN(from.getTime()) ) {
      throw badRequest("from must be an ISO date");
    }
    if ( to && Number.isNaN(to.getTime()) ) {
      throw badRequest("to must be an ISO date");
    }

    const { db } = await getMongo();

    const match = {
      "delivery.rider.email": riderEmail
    };

    if ( deliveryStatus ) {
      match["delivery.deliveryStatus"] = deliveryStatus;
    }
    
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
          totalDeliveries: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmount" },
          avgOrderValue: { $avg: "$totalAmount" },
          assigned: {
            $sum: { $cond: [{ $eq: ["$delivery.deliveryStatus", "assigned"] }, 1, 0] }
          },
          pickedUp: {
            $sum: { $cond: [{ $eq: ["$delivery.deliveryStatus", "picked_up"] }, 1, 0] }
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$delivery.deliveryStatus", "delivered"] }, 1, 0] }
          }
        }
      }
    ]).toArray();

    const summaryRaw = summaryResult[0] || {
      totalDeliveries: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      assigned: 0,
      pickedUp: 0,
      delivered: 0
    };

    const totalDeliveries = Number(summaryRaw.totalDeliveries);
    const delivered = Number(summaryRaw.delivered);

    const summary = {
      totalDeliveries,
      totalRevenue: Number(summaryRaw.totalRevenue).toFixed(2),
      avgOrderValue: Number(summaryRaw.avgOrderValue).toFixed(2),
      byStatus: {
        assigned: Number(summaryRaw.assigned),
        picked_up: Number(summaryRaw.pickedUp),
        delivered
      },
      completionRate: totalDeliveries > 0 ? ((delivered / totalDeliveries) * 100).toFixed(1) : 0
    };

    // We compute deliveries per day.
    const byDay = await db.collection("orders").aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          deliveries: { $sum: 1 }
        }
      },
      { $project: { _id: 0, date: "$_id", deliveries: 1 } },
      { $sort: { date: -1 } },
      { $limit: 30 }
    ]).toArray();

    // We compute top restaurants by delivery count.
    const byRestaurant = await db.collection("orders").aggregate([
      { $match: match },
      {
        $group: {
          _id: "$restaurant.name",
          count: { $sum: 1 }
        }
      },
      { $project: { _id: 0, restaurant: "$_id", count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).toArray();

    res.json({
      ok: true,
      summary,
      breakdown: {
        byDay,
        byRestaurant
      }
    });
  } 
  catch (e) {
    next(e);
  }
});



// -------------------------
// Student 2 - MongoDB Orders Query
// -------------------------

student2Router.get("/student2/mongo/orders", async function(req, res, next) {
  try {
    // We query orders from Mongo, then map them into the same shape as the SQL endpoint.
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
    
    const excludeDelivered = req.query.excludeDelivered === 'true';
    
    let limit;
    
    if ( req.query.limit ) {
      limit = Number(req.query.limit);
    } 
    else {
      limit = 50;
    }

    const { db } = await getMongo();

    const filter = {};
    
    
    if ( status ) {
      filter.status = status;
    }
    
    
    if ( riderEmail ) {
      filter["delivery.rider.email"] = riderEmail;
    }
    
    
    if ( deliveryStatus ) {
      filter["delivery.deliveryStatus"] = deliveryStatus;
    }
    
    
    if ( excludeDelivered ) {
      filter.$or = [
        { "delivery.deliveryStatus": { $ne: "delivered" } },
        { "delivery.deliveryStatus": { $exists: false } },
        { delivery: null }
      ];
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

module.exports = { student2Router };

