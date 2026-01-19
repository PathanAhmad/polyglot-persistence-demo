// File flow:
// - We normalize DB values into JSON-safe primitives.
// - MariaDB aggregate functions like COUNT/SUM may return JS BigInt via the mariadb driver.
// - JSON.stringify cannot serialize BigInt, so routes must convert them before res.json().

function toJsonSafeNumber(v, fieldName) {
  // We normalize DB numbers (incl. BigInt) to JSON-safe primitives.
  if ( v == null ) {
    return 0;
  }
  if ( typeof v === "bigint" ) {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if ( v > max || v < min ) {
      // We preserve precision by returning a string if it does not fit safely.
      return v.toString();
    }
    return Number(v);
  }
  if ( typeof v === "number" ) {
    if ( !Number.isFinite(v) ) {
      throw new Error(`invalid ${fieldName}`);
    }
    return v;
  }
  if ( typeof v === "string" ) {
    const n = Number(v);
    if ( !Number.isFinite(n) ) {
      throw new Error(`invalid ${fieldName}`);
    }
    return n;
  }
  throw new Error(`invalid ${fieldName}`);
}

function toMoneyString(v, fieldName) {
  const n = toJsonSafeNumber(v, fieldName);
  // If it overflowed to string, keep it as-is (still JSON-safe).
  if ( typeof n === "string" ) {
    return n;
  }
  return Number(n).toFixed(2);
}

module.exports = { toJsonSafeNumber, toMoneyString };

