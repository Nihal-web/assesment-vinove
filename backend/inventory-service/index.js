const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const processedCache = new Set();

// Seed inventory on startup
async function seedInventory() {
    try {
        const [rows] = await pool.query('SELECT COUNT(*) as count FROM inventory');
        if (rows[0].count === 0) {
            console.log('Seeding inventory from CSV...');
            const csvPath = path.resolve(__dirname, '../../sample_inventory.csv');
            if (fs.existsSync(csvPath)) {
                fs.createReadStream(csvPath)
                    .pipe(csv())
                    .on('data', async (row) => {
                        await pool.query('INSERT IGNORE INTO inventory (sku, available_qty) VALUES (?, ?)', [row.sku, parseInt(row.available_qty)]);
                    })
                    .on('end', () => {
                        console.log('Inventory seeded successfully.');
                    });
            } else {
                console.warn('sample_inventory.csv not found. Skipping seed.');
            }
        }
    } catch (err) {
        console.error('Error seeding inventory (ensure DB is running):', err.message);
    }
}
seedInventory();

app.post('/inventory', async (req, res) => {
    const { order_id, sku, qty, fail_at } = req.body;
    
    if (fail_at === 'RESERVE_INVENTORY') return res.status(500).json({ error: 'Intentional failure' });
    if (processedCache.has(order_id)) return res.status(200).json({ message: 'Idempotent' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [rows] = await connection.query('SELECT status FROM processed_orders WHERE order_id = ?', [order_id]);
        if (rows.length > 0 && rows[0].status === 'RESERVED') {
            await connection.commit();
            processedCache.add(order_id);
            return res.status(200).json({ message: 'Idempotent' });
        }

        const [inv] = await connection.query('SELECT available_qty FROM inventory WHERE sku = ? FOR UPDATE', [sku]);
        if (inv.length === 0 || inv[0].available_qty < qty) {
            await connection.rollback();
            return res.status(400).json({ error: 'Insufficient stock' });
        }

        await connection.query('UPDATE inventory SET available_qty = available_qty - ? WHERE sku = ?', [qty, sku]);
        await connection.query('INSERT INTO processed_orders (order_id, status) VALUES (?, ?)', [order_id, 'RESERVED']);
        
        await connection.commit();
        processedCache.add(order_id);
        return res.status(200).json({ message: 'Stock reserved' });
    } catch (error) {
        await connection.rollback();
        return res.status(500).json({ error: 'Internal error' });
    } finally {
        connection.release();
    }
});

app.post('/inventory/undo', async (req, res) => {
    const { order_id, sku, qty, comp_fail_at } = req.body;
    
    if (comp_fail_at && comp_fail_at.includes('INVENTORY')) return res.status(500).json({ error: 'Intentional undo failure' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        const [rows] = await connection.query('SELECT status FROM processed_orders WHERE order_id = ?', [order_id]);
        if (rows.length > 0 && rows[0].status === 'RETURNED') {
            await connection.commit();
            return res.status(200).json({ message: 'Idempotent undo' });
        }

        await connection.query('UPDATE inventory SET available_qty = available_qty + ? WHERE sku = ?', [qty, sku]);
        await connection.query('INSERT INTO processed_orders (order_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)', [order_id, 'RETURNED']);
        
        await connection.commit();
        processedCache.delete(order_id);
        return res.status(200).json({ message: 'Stock returned' });
    } catch (error) {
        await connection.rollback();
        return res.status(500).json({ error: 'Internal error' });
    } finally {
        connection.release();
    }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Inventory Service running on port ${PORT}`);
});
