const express = require("express");
const cors = require("cors");

const { config } = require("./config");
const { withConn } = require("./db/mariadb");
const { ensureMongoIndexes, getMongo } = require("./db/mongodb");

const { importRouter } = require("./routes/import");
const { student1Router } = require("./routes/student1");
const { student2Router } = require("./routes/student2");
const { migrateRouter } = require("./routes/migrate");

async function main() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));



  app.get("/api/health", async function(_req, res) {
    // I run a quick DB ping so I know the container wiring is correct.
    await withConn(function(conn) {
      return conn.query("SELECT 1");
    });
    await ensureMongoIndexes();
    const { db } = await getMongo();

    // These counts + migration info make it easy to prove "SQL -> Mongo migration" worked.
    const [restaurants, people, orders] = await Promise.all([
      db.collection("restaurants").countDocuments({}),
      db.collection("people").countDocuments({}),
      db.collection("orders").countDocuments({})
    ]);

    const migration = await db.collection("meta").findOne(
      { _id: "migration" },
      { projection: { _id: 0, source: 1, lastMigrationAt: 1, migrated: 1 } }
    );

    let activeMode;
    
    if ( Boolean(migration?.lastMigrationAt) && orders > 0 ) {
      activeMode = "mongo";
    } 
    else {
      activeMode = "sql";
    }

    res.json({
      ok: true,
      activeMode: activeMode,
      mariadb: { ok: true },
      mongo: {
        ok: true,
        counts: { restaurants, people, orders },
        migration: function() {
          if ( migration ) {
            return migration;
          } 
          else {
            return null;
          }
        }()
      }
    });
  });



  app.use("/api", importRouter);
  app.use("/api", student1Router);
  app.use("/api", student2Router);
  app.use("/api", migrateRouter);



  app.use(function(err, _req, res, _next) {
    // I always log the full stack trace so we can trace issues exactly.
    console.error(err);
    let statusValue;
    
    if ( err.status ) {
      statusValue = err.status;
    } 
    else {
      statusValue = 500;
    }
    
    const status = Number(statusValue);
    res.status(status).json({
      ok: false,
      error: function() {
        if ( err.message ) {
          return err.message;
        } 
        else {
          return "internal error";
        }
      }(),
      stack: function() {
        if ( err.stack ) {
          return err.stack;
        } 
        else {
          return null;
        }
      }()
    });
  });



  app.listen(config.port, function() {
    console.log(`Backend listening on port ${config.port}`);
  });
}

main().catch(function(error) {
  console.error(error);
  process.exit(1);
});

