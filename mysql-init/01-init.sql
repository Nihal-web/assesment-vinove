CREATE DATABASE IF NOT EXISTS coordinator_db;
CREATE DATABASE IF NOT EXISTS order_db;
CREATE DATABASE IF NOT EXISTS inventory_db;
CREATE DATABASE IF NOT EXISTS payment_db;
CREATE DATABASE IF NOT EXISTS shipping_db;
CREATE DATABASE IF NOT EXISTS notification_db;

-- Coordinator DB setup
USE coordinator_db;
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) UNIQUE NOT NULL,
    sku VARCHAR(50) NOT NULL,
    qty INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    fail_at VARCHAR(50),
    comp_fail_at VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE saga_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    service_name VARCHAR(20) NOT NULL,
    action VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    retries INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_step (order_id, service_name, action)
);

-- Order DB setup
USE order_db;
CREATE TABLE processed_orders (
    order_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory DB setup
USE inventory_db;
CREATE TABLE inventory (
    sku VARCHAR(50) PRIMARY KEY,
    available_qty INT NOT NULL
);

CREATE TABLE processed_orders (
    order_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment DB setup
USE payment_db;
CREATE TABLE processed_orders (
    order_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shipping DB setup
USE shipping_db;
CREATE TABLE processed_orders (
    order_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notification DB setup
USE notification_db;
CREATE TABLE notifications (
    order_id VARCHAR(50) PRIMARY KEY,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
