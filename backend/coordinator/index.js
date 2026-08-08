const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { processOrder, retryUndo, recoverIncompleteOrders, pool } = require('./saga');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// run recovery after short delay
setTimeout(recoverIncompleteOrders, 2000);

app.get('/api/orders', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status; // Optional filter
    const offset = (page - 1) * limit;

    try {
        let countQuery = 'SELECT COUNT(*) as total FROM orders';
        let dataQuery = 'SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?';
        let params = [limit, offset];

        if (status) {
            countQuery = 'SELECT COUNT(*) as total FROM orders WHERE status = ?';
            dataQuery = 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params = [status, limit, offset];
        }

        const [countResult] = await pool.query(countQuery, status ? [status] : []);
        const total = countResult[0].total;

        const [orders] = await pool.query(dataQuery, params);
        
        res.json({
            orders,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/orders/stats', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT status, COUNT(*) as count FROM orders GROUP BY status');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/orders/:order_id', async (req, res) => {
    const order_id = req.params.order_id;
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
        if (orders.length === 0) return res.status(404).json({ error: 'Not found' });
        
        const [steps] = await pool.query('SELECT * FROM saga_steps WHERE order_id = ? ORDER BY created_at ASC', [order_id]);
        
        res.json({ order: orders[0], steps });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/process-csv', upload.single('file'), (req, res) => {
    let csvPath;
    let isTempFile = false;
    
    if (req.file) {
        csvPath = req.file.path;
        isTempFile = true;
    } else {
        csvPath = path.resolve(__dirname, '../../orders_bulk.csv');
    }
    
    const BATCH_SIZE = 50; 
    let activeWorkers = 0;
    let isFinishedReading = false;
    
    res.json({ message: 'Bulk processing started in background' });
    console.log('started processing csv');
    
    if(!fs.existsSync(csvPath)) {
        console.error(`CSV file not found at ${csvPath}`);
        return;
    }

    const stream = fs.createReadStream(csvPath).pipe(csv());
    
    stream.on('data', async (row) => {
        // Pause stream if we have too many active workers (backpressure)
        if (activeWorkers >= BATCH_SIZE) {
            stream.pause();
        }

        activeWorkers++;
        try {
            await processOrder(row);
        } catch (e) {
            console.error(`Error processing ${row.order_id}:`, e);
        } finally {
            activeWorkers--;
            // Resume stream if we have capacity
            if (activeWorkers < BATCH_SIZE) {
                stream.resume();
            }
        }
    });

    stream.on('end', () => {
        isFinishedReading = true;
        console.log('csv fully read into memory');
        if (isTempFile) {
            fs.unlink(csvPath, (err) => {
                if (err) console.error('Failed to delete temp csv:', err);
            });
        }
    });
});

app.post('/api/orders/:order_id/mark-shipped', async (req, res) => {
    const order_id = req.params.order_id;
    try {
        await pool.query('UPDATE orders SET status = ? WHERE order_id = ? AND status = ?', ['SHIPPED', order_id, 'PLACED']);
        res.json({ message: 'Marked as shipped' });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/orders/:order_id/retry', async (req, res) => {
    const order_id = req.params.order_id;
    try {
        const result = await retryUndo(order_id);
        if (result.error) return res.status(400).json(result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Coordinator Service running on port ${PORT}`);
});
