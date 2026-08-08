const axios = require('axios');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'coordinator_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const SERVICES = {
    order: 'http://localhost:3001/order',
    inventory: 'http://localhost:3002/inventory',
    payment: 'http://localhost:3003/payment',
    shipping: 'http://localhost:3004/shipping'
};

const MAX_RETRIES = 3;

async function callService(url, payload, action = 'DO') {
    let attempts = 0;
    while (attempts < MAX_RETRIES) {
        try {
            const response = await axios.post(url, payload, { timeout: 3000 });
            return { success: true, data: response.data };
        } catch (error) {
            attempts++;
            console.error(`saga err ${url} (try ${attempts}):`, error.message);
            if (attempts >= MAX_RETRIES) {
                return { success: false, error: error.message };
            }
            await new Promise(r => setTimeout(r, 500 * attempts));
        }
    }
}

async function processOrder(order) {
    const { order_id, sku, qty, amount, fail_at, comp_fail_at } = order;

    const [existing] = await pool.query('SELECT status FROM orders WHERE order_id = ?', [order_id]);
    if (existing.length > 0 && ['PLACED', 'CANCELLED', 'SHIPPED'].includes(existing[0].status)) {
        return; 
    }

    if (existing.length === 0) {
        await pool.query(
            'INSERT INTO orders (order_id, sku, qty, amount, fail_at, comp_fail_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [order_id, sku, qty, amount, fail_at, comp_fail_at, 'IN_PROGRESS']
        );
    } else {
        await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', ['IN_PROGRESS', order_id]);
    }

    const payload = { order_id, sku, qty, amount, fail_at, comp_fail_at };

    for (const svc of Object.keys(SERVICES)) {
        await pool.query(
            'INSERT IGNORE INTO saga_steps (order_id, service_name, action, status) VALUES (?, ?, ?, ?)',
            [order_id, svc, 'DO', 'PENDING']
        );
    }

    // Call all 4 services AT THE SAME TIME (Parallel)
    const promises = Object.keys(SERVICES).map(async (svc) => {
        const result = await callService(SERVICES[svc], payload, 'DO');
        return { service: svc, result };
    });

    const results = await Promise.all(promises);
    let anyFailed = false;
    const successfulServices = [];

    // Evaluate results
    for (const res of results) {
        if (res.result.success) {
            await pool.query('UPDATE saga_steps SET status = ? WHERE order_id = ? AND service_name = ? AND action = ?', ['SUCCESS', order_id, res.service, 'DO']);
            successfulServices.push(res.service);
        } else {
            await pool.query('UPDATE saga_steps SET status = ? WHERE order_id = ? AND service_name = ? AND action = ?', ['FAILED', order_id, res.service, 'DO']);
            anyFailed = true;
        }
    }

    if (!anyFailed) {
        // All succeeded -> PLACED
        await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', ['PLACED', order_id]);
        console.log(`Order ${order_id} PLACED.`);
    } else {
        console.log(`Order ${order_id} FAILED. Starting compensating transactions...`);
        let needsAttention = false;

        for (const svc of successfulServices) {
            await pool.query(
                'INSERT IGNORE INTO saga_steps (order_id, service_name, action, status) VALUES (?, ?, ?, ?)',
                [order_id, svc, 'UNDO', 'PENDING']
            );
            
            const undoUrl = `${SERVICES[svc]}/undo`;
            const undoResult = await callService(undoUrl, payload, 'UNDO');
            
            if (undoResult.success) {
                await pool.query('UPDATE saga_steps SET status = ? WHERE order_id = ? AND service_name = ? AND action = ?', ['SUCCESS', order_id, svc, 'UNDO']);
            } else {
                await pool.query('UPDATE saga_steps SET status = ? WHERE order_id = ? AND service_name = ? AND action = ?', ['FAILED', order_id, svc, 'UNDO']);
                needsAttention = true; // An undo failed after max retries
            }
        }

        const finalStatus = needsAttention ? 'NEEDS_ATTENTION' : 'CANCELLED';
        await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', [finalStatus, order_id]);
        console.log(`Order ${order_id} finished as ${finalStatus}.`);
    }
}


async function retryUndo(order_id) {
    const [steps] = await pool.query('SELECT * FROM saga_steps WHERE order_id = ? AND action = ? AND status = ?', [order_id, 'UNDO', 'FAILED']);
    
    let stillNeedsAttention = false;
    
    const [orderRows] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (orderRows.length === 0) return { error: 'Order not found' };
    const order = orderRows[0];
    // Omit comp_fail_at during manual retry so the intentional failure doesn't trigger again
    const payload = { order_id, sku: order.sku, qty: order.qty, amount: order.amount, fail_at: order.fail_at };

    for (const step of steps) {
        const undoUrl = `${SERVICES[step.service_name]}/undo`;
        const undoResult = await callService(undoUrl, payload, 'UNDO');
        
        if (undoResult.success) {
            await pool.query('UPDATE saga_steps SET status = ? WHERE id = ?', ['SUCCESS', step.id]);
        } else {
            console.error(`Retry undo failed for ${step.service_name}:`, undoResult.error);
            stillNeedsAttention = true;
        }
    }

    if (!stillNeedsAttention) {
        await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', ['CANCELLED', order_id]);
        return { message: 'Order successfully cancelled after manual retry.' };
    } else {
        return { error: 'Some undo steps still failed.' };
    }
}

async function recoverIncompleteOrders() {
    console.log('checking for stuck orders to recover...');
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE status = ?', ['IN_PROGRESS']);
        
        if (orders.length > 0) {
            console.log(`[Saga] Found ${orders.length} incomplete orders. Resuming...`);
            for (const order of orders) {
                // idempotent so we can just run it again
                await processOrder(order);
            }
        } else {
            console.log('[Saga] No incomplete sagas found.');
        }
    } catch(e) {
        console.error('[Saga] Could not recover incomplete orders (ensure DB is running).');
    }
}

module.exports = {
    processOrder,
    retryUndo,
    recoverIncompleteOrders,
    pool
};
