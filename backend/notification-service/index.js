const express = require('express');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const app = express();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'notification_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// run every 15 mins
cron.schedule('*/15 * * * *', async () => {
    console.log('running notification job...');
    try {
        const response = await axios.get('http://localhost:3000/api/orders?status=SHIPPED');
        const shippedOrders = response.data.orders || [];

        for (const order of shippedOrders) {
            const order_id = order.order_id;
            
            const [rows] = await pool.query('SELECT sent_at FROM notifications WHERE order_id = ?', [order_id]);
            
            if (rows.length === 0) {
                console.log(`sending notification for order: ${order_id}`);
                await pool.query('INSERT INTO notifications (order_id) VALUES (?)', [order_id]);
            }
        }
    } catch (error) {
        console.error('notification cron err:', error.message);
    }
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log(`Notification Service running on port ${PORT} (Cron job scheduled every 15 mins)`);
});
