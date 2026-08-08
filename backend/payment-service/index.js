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
    database: process.env.DB_NAME || 'payment_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const processedCache = new Set();

app.post('/payment', async (req, res) => {
    const { order_id, amount, fail_at } = req.body;

    if (fail_at === 'CHARGE_PAYMENT') {
        return res.status(500).json({ error: 'Intentional failure at payment service' });
    }

    if (processedCache.has(order_id)) {
        return res.status(200).json({ message: 'Idempotent' });
    }

    try {
        const [rows] = await pool.query('SELECT status FROM processed_orders WHERE order_id = ?', [order_id]);
        if (rows.length > 0 && rows[0].status === 'CHARGED') {
            processedCache.add(order_id);
            return res.status(200).json({ message: 'Idempotent' });
        }


        await pool.query(
            'INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [order_id, 'CHARGED']
        );
        
        processedCache.add(order_id);
        return res.status(200).json({ message: 'Payment charged successfully' });
    } catch (error) {
        console.error(`payment undo err ${order_id}:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/payment/undo', async (req, res) => {
    const { order_id, comp_fail_at } = req.body;

    if (comp_fail_at === 'REFUND_PAYMENT') {
        return res.status(500).json({ error: 'Intentional undo failure at payment service' });
    }

    try {
        await pool.query(
            'INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)',
            [order_id, 'REFUNDED']
        );
        
        processedCache.delete(order_id);
        return res.status(200).json({ message: 'Payment refunded successfully' });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
    console.log(`Payment Service running on port ${PORT}`);
});
