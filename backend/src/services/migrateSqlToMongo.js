const { withConn } = require("../db/mariadb");
const { getMongo, ensureMongoIndexes } = require("../db/mongodb");

async function migrateSqlToMongo() {
  // I read everything from SQL, clear Mongo, then insert the transformed documents.
  // This matches the MS2 rule: no re-randomizing and no dual-write.
  const sql = await readSqlSnapshot();
  const { db } = await getMongo();

  await db.collection("restaurants").deleteMany({});
  await db.collection("people").deleteMany({});
  await db.collection("orders").deleteMany({});

  if (sql.restaurants.length) await db.collection("restaurants").insertMany(sql.restaurants);
  if (sql.people.length) await db.collection("people").insertMany(sql.people);
  if (sql.orders.length) await db.collection("orders").insertMany(sql.orders);

  await ensureMongoIndexes();

  return {
    restaurants: sql.restaurants.length,
    people: sql.people.length,
    orders: sql.orders.length
  };
}

async function readSqlSnapshot() {
  return withConn(async (conn) => {
    const restaurants = await conn.query(
      `SELECT restaurant_id AS restaurantId, name, address FROM restaurant ORDER BY restaurant_id`
    );

    const peopleBase = await conn.query(
      `
      SELECT
        p.person_id AS personId,
        p.name AS name,
        p.email AS email,
        p.phone AS phone,
        c.customer_id AS customerId,
        c.default_address AS defaultAddress,
        c.preferred_payment_method AS preferredPaymentMethod,
        r.rider_id AS riderId,
        r.vehicle_type AS vehicleType,
        r.rating AS rating
      FROM person p
      LEFT JOIN customer c ON c.customer_id = p.person_id
      LEFT JOIN rider r ON r.rider_id = p.person_id
      ORDER BY p.person_id
      `
    );

    const people = peopleBase.map((p) => {
      const type = p.riderId ? "rider" : p.customerId ? "customer" : "person";
      return {
        personId: Number(p.personId),
        type,
        name: p.name,
        email: p.email,
        phone: p.phone || null,
        customer: p.customerId
          ? {
              defaultAddress: p.defaultAddress || null,
              preferredPaymentMethod: p.preferredPaymentMethod || null
            }
          : null,
        rider: p.riderId
          ? {
              vehicleType: p.vehicleType,
              rating: p.rating == null ? null : Number(p.rating)
            }
          : null
      };
    });

    const menuItems = await conn.query(
      `
      SELECT
        menu_item_id AS menuItemId,
        restaurant_id AS restaurantId,
        name,
        description,
        price
      FROM menu_item
      ORDER BY menu_item_id
      `
    );
    const menuItemById = new Map(menuItems.map((m) => [Number(m.menuItemId), m]));

    const ordersBase = await conn.query(
      `
      SELECT
        o.order_id AS orderId,
        o.customer_id AS customerId,
        o.restaurant_id AS restaurantId,
        o.created_at AS createdAt,
        o.status AS status,
        o.total_amount AS totalAmount,
        pay.payment_id AS paymentId,
        pay.amount AS paymentAmount,
        pay.payment_method AS paymentMethod,
        pay.paid_at AS paidAt,
        d.delivery_id AS deliveryId,
        d.rider_id AS riderId,
        d.assigned_at AS assignedAt,
        d.delivery_status AS deliveryStatus
      FROM \`order\` o
      LEFT JOIN payment pay ON pay.order_id = o.order_id
      LEFT JOIN delivery d ON d.order_id = o.order_id
      ORDER BY o.order_id
      `
    );

    const orderItems = await conn.query(
      `
      SELECT
        order_id AS orderId,
        menu_item_id AS menuItemId,
        quantity,
        unit_price AS unitPrice
      FROM order_item
      ORDER BY order_item_id
      `
    );

    const personById = new Map(people.map((p) => [p.personId, p]));
    const restaurantById = new Map(restaurants.map((r) => [Number(r.restaurantId), r]));

    const itemsByOrderId = new Map();
    for (const it of orderItems) {
      const orderId = Number(it.orderId);
      if (!itemsByOrderId.has(orderId)) itemsByOrderId.set(orderId, []);
      const mi = menuItemById.get(Number(it.menuItemId));
      itemsByOrderId.get(orderId).push({
        menuItemId: Number(it.menuItemId),
        name: mi ? mi.name : null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice)
      });
    }

    const orders = ordersBase.map((o) => {
      const restaurant = restaurantById.get(Number(o.restaurantId)) || null;
      const customer = personById.get(Number(o.customerId)) || null;
      const rider = o.riderId ? personById.get(Number(o.riderId)) : null;

      return {
        orderId: Number(o.orderId),
        createdAt: o.createdAt,
        status: o.status,
        totalAmount: Number(o.totalAmount),
        restaurant: restaurant
          ? { restaurantId: Number(restaurant.restaurantId), name: restaurant.name, address: restaurant.address }
          : null,
        customer: customer ? { personId: customer.personId, name: customer.name, email: customer.email } : null,
        orderItems: itemsByOrderId.get(Number(o.orderId)) || [],
        payment: o.paymentId
          ? {
              paymentId: Number(o.paymentId),
              amount: Number(o.paymentAmount),
              method: o.paymentMethod,
              paidAt: o.paidAt || null
            }
          : null,
        delivery: o.deliveryId
          ? {
              deliveryId: Number(o.deliveryId),
              deliveryStatus: o.deliveryStatus,
              assignedAt: o.assignedAt || null,
              rider: rider
                ? {
                    personId: rider.personId,
                    name: rider.name,
                    email: rider.email,
                    vehicleType: rider.rider?.vehicleType || null,
                    rating: rider.rider?.rating ?? null
                  }
                : null
            }
          : null
      };
    });

    return { restaurants, people, orders };
  });
}

module.exports = { migrateSqlToMongo };

