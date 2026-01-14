-- MariaDB schema for MS2 (Food Delivery)
-- I keep this explicit and close to the ER diagram.

CREATE TABLE IF NOT EXISTS person (
  person_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  phone VARCHAR(40) NULL
);

-- IS-A: Customer, Rider (same PK as Person)
CREATE TABLE IF NOT EXISTS customer (
  customer_id INT PRIMARY KEY,
  default_address VARCHAR(255) NULL,
  preferred_payment_method VARCHAR(50) NULL,
  CONSTRAINT fk_customer_person FOREIGN KEY (customer_id) REFERENCES person(person_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rider (
  rider_id INT PRIMARY KEY,
  vehicle_type VARCHAR(30) NOT NULL,
  rating DECIMAL(2,1) NULL,
  CONSTRAINT fk_rider_person FOREIGN KEY (rider_id) REFERENCES person(person_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS restaurant (
  restaurant_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL
);

-- Rider works for Restaurant (M:N)
CREATE TABLE IF NOT EXISTS rider_works_for (
  rider_id INT NOT NULL,
  restaurant_id INT NOT NULL,
  PRIMARY KEY (rider_id, restaurant_id),
  CONSTRAINT fk_rwf_rider FOREIGN KEY (rider_id) REFERENCES rider(rider_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_rwf_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurant(restaurant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS menu_item (
  menu_item_id INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_menuitem_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurant(restaurant_id)
    ON DELETE CASCADE
);

-- Categories (M:N) for MenuItem (matches ER's "Categorizes")
CREATE TABLE IF NOT EXISTS category (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS menu_item_category (
  menu_item_id INT NOT NULL,
  category_id INT NOT NULL,
  PRIMARY KEY (menu_item_id, category_id),
  CONSTRAINT fk_mic_item FOREIGN KEY (menu_item_id) REFERENCES menu_item(menu_item_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_mic_cat FOREIGN KEY (category_id) REFERENCES category(category_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `order` (
  order_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  restaurant_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  status VARCHAR(40) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customer(customer_id),
  CONSTRAINT fk_order_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurant(restaurant_id)
);

-- Weak entity: OrderItem depends on Order (existence-dependent)
CREATE TABLE IF NOT EXISTS order_item (
  order_item_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_orderitem_order FOREIGN KEY (order_id) REFERENCES `order`(order_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_orderitem_menuitem FOREIGN KEY (menu_item_id) REFERENCES menu_item(menu_item_id)
);

CREATE TABLE IF NOT EXISTS payment (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  paid_at DATETIME NULL,
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES `order`(order_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delivery (
  delivery_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  rider_id INT NULL,
  assigned_at DATETIME NULL,
  delivery_status VARCHAR(40) NOT NULL,
  CONSTRAINT fk_delivery_order FOREIGN KEY (order_id) REFERENCES `order`(order_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_delivery_rider FOREIGN KEY (rider_id) REFERENCES rider(rider_id)
);

