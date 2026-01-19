// File flow:
// - We read the SQL schema from disk.
// - We return it as a string so MariaDB can execute it.

const fs = require("fs");

function readSchemaSql(schemaSqlPath) {
  // We read the schema from a file so it's easy to keep the DB definition in one place.
  return fs.readFileSync(schemaSqlPath, "utf8");
}

module.exports = { readSchemaSql };

