function mustGetEnv(name, fallback) {
  let v;
  
  if ( process.env[name] != null ) {
    v = process.env[name];
  } 
  else {
    v = fallback;
  }
  
  if ( v === undefined || v === null || String(v).trim() === "" ) {
    throw new Error(`Missing required env var: ${name}`);
  }
  
  return v;
}

let portValue;
if ( process.env.PORT ) {
  portValue = process.env.PORT;
} 
else {
  portValue = 3000;
}

let mariadbPortValue;
if ( process.env.MARIADB_PORT ) {
  mariadbPortValue = process.env.MARIADB_PORT;
} 
else {
  mariadbPortValue = 3306;
}

const config = {
  port: Number(portValue),

  mariadb: {
    host: mustGetEnv("MARIADB_HOST", "127.0.0.1"),
    port: Number(mariadbPortValue),
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

