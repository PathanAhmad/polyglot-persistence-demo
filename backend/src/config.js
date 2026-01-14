function mustGetEnv(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const config = {
  port: Number(process.env.PORT || 3000),

  mariadb: {
    host: mustGetEnv("MARIADB_HOST", "127.0.0.1"),
    port: Number(process.env.MARIADB_PORT || 3306),
    user: mustGetEnv("MARIADB_USER", "ms2"),
    password: mustGetEnv("MARIADB_PASSWORD", "ms2pass"),
    database: mustGetEnv("MARIADB_DATABASE", "ms2")
  },

  mongodb: {
    uri: mustGetEnv("MONGODB_URI", "mongodb://127.0.0.1:27017"),
    db: mustGetEnv("MONGODB_DB", "ms2")
  },

  schemaSqlPath: mustGetEnv("SCHEMA_SQL_PATH", "db/mariadb/schema.sql")
};

module.exports = { config };

