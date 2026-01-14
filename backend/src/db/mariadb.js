const mariadb = require("mariadb");
const { config } = require("../config");

// I keep one pool for the whole app.
const pool = mariadb.createPool({
  host: config.mariadb.host,
  port: config.mariadb.port,
  user: config.mariadb.user,
  password: config.mariadb.password,
  database: config.mariadb.database,
  connectionLimit: 10,
  multipleStatements: true
});

async function withConn(fn) {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

async function withTx(fn) {
  return withConn(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
}

module.exports = { pool, withConn, withTx };

