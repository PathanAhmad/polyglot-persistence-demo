// File flow:
// - We expose one endpoint to trigger SQL -> Mongo migration.
// - We call the migration service and return the counts inserted.

const express = require("express");

const { migrateSqlToMongo } = require("../services/migrateSqlToMongo");

const migrateRouter = express.Router();

migrateRouter.post("/migrate_to_mongo", async function(_req, res, next) {
  try {
    // We move the current SQL snapshot into Mongo so the student endpoints can run on Mongo.
    const result = await migrateSqlToMongo();
    res.json({ ok: true, migrated: result });
  } 
  catch (e) {
    next(e);
  }
});

module.exports = { migrateRouter };

