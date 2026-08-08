const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'order_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const processedCache = new Set();

app.post('/order', async (req, res) => {
    const { order_id, fail_at } = req.body;

    if (!order_id) {
        return res.status(400).json({ error: 'order_id is required' });
    }

    if (fail_at === 'CREATE_ORDER') {
        return res.status(500).json({ error: 'Intentional failure at order service' });
    }

    if (processedCache.has(order_id)) {
        return res.status(200).json({ message: 'Order already processed (Idempotent)' });
    }

    try {
        const [rows] = await pool.query('SELECT status FROM processed_orders WHERE order_id = ?', [order_id]);
        if (rows.length > 0 && rows[0].status === 'CREATED') {
            processedCache.add(order_id);
            return res.status(200).json({ message: 'Order already processed (Idempotent)' });
        }

        await pool.query(
            'INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [order_id, 'CREATED']
        );
        
        processedCache.add(order_id);
        return res.status(200).json({ message: 'Order created successfully' });

    } catch (error) {
        console.error(`[Order Service] Error creating order ${order_id}:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/order/undo', async (req, res) => {
    const { order_id, comp_fail_at } = req.body;

    if (!order_id) {
        return res.status(400).json({ error: 'order_id is required' });
    }

    if (comp_fail_at === 'CANCEL_ORDER') {
        return res.status(500).json({ error: 'Intentional undo failure at order service' });
    }

    try {
        await pool.query(
            'INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [order_id, 'CANCELLED']
        );
        
        processedCache.delete(order_id);
        return res.status(200).json({ message: 'Order cancelled successfully' });
    } catch (error) {
        console.error(`[Order Service] Error undoing order ${order_id}:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Order Service running on port ${PORT}`);
});
