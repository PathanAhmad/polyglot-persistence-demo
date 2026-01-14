const express = require("express");

const { migrateSqlToMongo } = require("../services/migrateSqlToMongo");

const migrateRouter = express.Router();

migrateRouter.post("/migrate_to_mongo", async (_req, res, next) => {
  try {
    const result = await migrateSqlToMongo();
    res.json({ ok: true, migrated: result });
  } catch (e) {
    next(e);
  }
});

module.exports = { migrateRouter };

