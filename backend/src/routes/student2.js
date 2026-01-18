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



student2Router.post("/student2/sql/assign_delivery", async function(req, res, next) {
  try {
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
        await conn.query(
          "INSERT INTO delivery (order_id, rider_id, assigned_at, delivery_status) VALUES (?, ?, ?, ?)",
          [orderId, riderId, now, deliveryStatus]
        );
      } 
      else {
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

    const rows = await withConn(function(conn) {
      return conn.query(
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
      );
    });

    res.json({ ok: true, rows });
  } 
  catch (e) {
    next(e);
  }
});



student2Router.post("/student2/mongo/assign_delivery", async function(req, res, next) {
  try {
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

    // I resolve the rider from the 'people' collection (migrated from SQL).
    const rider = await db.collection("people").findOne({ type: "rider", email: riderEmail });
    if ( !rider ) {
      throw notFound("rider not found");
    }

    // IMPORTANT: this must be atomic. If two concurrent requests assign the same order,
    // we must preserve the first assignment time (assignedAt) and never overwrite it.
    // Using a pipeline update with $ifNull ensures assignedAt is only set if missing/null.
    const updateResult = await db.collection("orders").updateOne(
      { orderId },
      [
        {
          $set: {
            // NOTE: Some orders are created with delivery: null (see Student 1 mongo create_order).
            // Setting subfields on a null parent throws in MongoDB, so I always set the full delivery object.
            // I also ensure deliveryId exists for report output + API contract consistency.
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

