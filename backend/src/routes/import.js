const express = require("express");

const { importResetMariaDb } = require("../services/importReset");
const { withConn } = require("../db/mariadb");

const importRouter = express.Router();

importRouter.post("/import_reset", async (_req, res, next) => {
  try {
    const result = await importResetMariaDb();
    res.json({ ok: true, inserted: result });
  } catch (e) {
    next(e);
  }
});

importRouter.get("/riders", async (_req, res, next) => {
  try {
    const riders = await withConn((conn) =>
      conn.query(
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
      )
    );
    res.json({ ok: true, riders });
  } catch (e) {
    next(e);
  }
});

importRouter.get("/orders", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit || 50);
    const status = req.query.status ? String(req.query.status) : null;

    const params = [];
    let whereSql = "";
    if (status) {
      whereSql = "WHERE o.status = ?";
      params.push(status);
    }

    params.push(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50);

    const orders = await withConn((conn) =>
      conn.query(
        `
        SELECT
          o.order_id AS orderId,
          o.created_at AS createdAt,
          o.status AS status,
          o.total_amount AS totalAmount,
          r.name AS restaurantName
        FROM \`order\` o
        JOIN restaurant r ON r.restaurant_id = o.restaurant_id
        ${whereSql}
        ORDER BY o.created_at DESC
        LIMIT ?
        `,
        params
      )
    );

    res.json({ ok: true, orders });
  } catch (e) {
    next(e);
  }
});

module.exports = { importRouter };

