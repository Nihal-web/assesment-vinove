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
    database: process.env.DB_NAME || 'shipping_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const processedCache = new Set();

app.post('/shipping', async (req, res) => {
    const { order_id, fail_at } = req.body;

    if (fail_at === 'CREATE_SHIPMENT') {
        return res.status(500).json({ error: 'Intentional failure at shipping service' });
    }

    if (processedCache.has(order_id)) {
        return res.status(200).json({ message: 'Idempotent' });
    }

    try {
        const [rows] = await pool.query('SELECT status FROM processed_orders WHERE order_id = ?', [order_id]);
        if (rows.length > 0 && rows[0].status === 'ARRANGED') {
            processedCache.add(order_id);
            return res.status(200).json({ message: 'Idempotent' });
        }

        await pool.query(
            'INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [order_id, 'ARRANGED']
        );
        
        processedCache.add(order_id);
        return res.status(200).json({ message: 'Shipping arranged successfully' });
    } catch (error) {
        console.error(`shipping err ${order_id}:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/shipping/undo', async (req, res) => {
    const { order_id, comp_fail_at } = req.body;

    if (comp_fail_at === 'CANCEL_SHIPMENT') {
        return res.status(500).json({ error: 'Intentional undo failure at shipping service' });
    }

    try {
        await pool.query(
            'INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [order_id, 'CANCELLED']
        );
        
        processedCache.delete(order_id);
        return res.status(200).json({ message: 'Shipping cancelled successfully' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
    console.log(`Shipping Service running on port ${PORT}`);
});
