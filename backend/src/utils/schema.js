const fs = require("fs");

function readSchemaSql(schemaSqlPath) {
  // I read the schema from a file so it's easy to keep the DB definition in one place.
  return fs.readFileSync(schemaSqlPath, "utf8");
}

module.exports = { readSchemaSql };

