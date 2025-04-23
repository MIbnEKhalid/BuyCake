import path from "path";
import bcrypt from 'bcrypt';
import { validateSession, checkRolePermission, validateSessionAndRole, getUserData } from "mbkauthe";
import express from 'express';
import { query, initDB } from './database.js';
import dotenv from 'dotenv';
import { fileURLToPath } from "url";
import  mbkautheroutes from "mbkauthe";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(mbkautheroutes);
// Admin routes
// Update the admin dashboard route
app.get('/admin', validateSessionAndRole("Any"), async (req, res) => {
    try {
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];

        // Fetch all stats in parallel
        const [
            todayOrders,
            totalCakes,
            pendingOrders,
            recentOrders,
            popularCakes,
            revenueStats
        ] = await Promise.all([
            // Today's orders
            query(`
          SELECT COUNT(*) as count 
          FROM orders 
          WHERE DATE(created_at) = $1
        `, [today]),

            // Total cakes
            query('SELECT COUNT(*) as count FROM cakes'),

            // Pending orders
            query(`
          SELECT COUNT(*) as count 
          FROM orders 
          WHERE status = 'Pending'
        `),

            // Recent orders (last 5)
            query(`
          SELECT o.id, o.customer_name, o.created_at, 
                 SUM(oi.quantity * oi.price) as total
          FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          GROUP BY o.id
          ORDER BY o.created_at DESC
          LIMIT 5
        `),

            // Popular cakes (top 5)
            query(`
          SELECT c.id, c.name, c.image_url, 
                 SUM(oi.quantity) as total_ordered
          FROM order_items oi
          JOIN cakes c ON oi.cake_id = c.id
          GROUP BY c.id
          ORDER BY total_ordered DESC
          LIMIT 5
        `),

            // Revenue stats (last 30 days)
            query(`
          SELECT 
            DATE(created_at) as date,
            SUM(total) as daily_revenue
          FROM (
            SELECT o.created_at, 
                   SUM(oi.quantity * oi.price) as total
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            WHERE o.created_at >= NOW() - INTERVAL '30 days'
            GROUP BY o.id
          ) as order_totals
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at) ASC
        `)
        ]);

        // Format the data for the template
        const stats = {
            todayOrders: todayOrders.rows[0].count,
            totalCakes: totalCakes.rows[0].count,
            pendingOrders: pendingOrders.rows[0].count,
            recentOrders: recentOrders.rows,
            popularCakes: popularCakes.rows,
            revenueStats: JSON.stringify(revenueStats.rows.map(row => ({
                date: row.date,
                revenue: parseFloat(row.daily_revenue)
            }))),
            revenueTotal: revenueStats.rows.reduce((sum, row) => sum + parseFloat(row.daily_revenue), 0)
        };

        res.render('admin/dashboard', {
            stats,
            active: { dashboard: true }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.render('admin/dashboard', {
            stats: {},
            error: 'Failed to load dashboard data',
            active: { dashboard: true }
        });
    }
});

app.get('/admin/login', (req, res) => {
    res.render('admin/login');
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const { rows } = await query('SELECT * FROM admin_users WHERE username = $1', [username]);

        if (rows.length === 0) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, rows[0].password_hash);
        if (!validPassword) {
            return res.render('admin/login', { error: 'Invalid credentials' });
        }

        req.session.adminLoggedIn = true;
        res.redirect('/admin');
    } catch (err) {
        console.error('Login error:', err);
        res.render('admin/login', { error: 'Login failed' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Admin cake management
app.get('/admin/cakes', validateSessionAndRole("Any"), async (req, res) => {
    const { rows: cakes } = await query('SELECT * FROM cakes');
    res.render('admin/cakes', { cakes, active: { cakes: true } });
});

app.get('/admin/cakes/add', validateSessionAndRole("Any"), (req, res) => {
    res.render('admin/cake-form', { cake: null, active: { cakes: true } });
});

app.post('/admin/cakes/save', validateSessionAndRole("Any"), async (req, res) => {
    const { id, name, description, price, image_url } = req.body;

    try {
        if (id) {
            await query(
                'UPDATE cakes SET name = $1, description = $2, price = $3, image_url = $4 WHERE id = $5',
                [name, description, price, image_url, id]
            );
        } else {
            await query(
                'INSERT INTO cakes (name, description, price, image_url) VALUES ($1, $2, $3, $4)',
                [name, description, price, image_url]
            );
        }
        res.redirect('/admin/cakes');
    } catch (err) {
        console.error('Save cake error:', err);
        res.render('admin/cake-form', {
            cake: { id, name, description, price, image_url },
            error: 'Failed to save cake'
        });
    }
});

app.get('/admin/cakes/edit/:id', validateSessionAndRole("Any"), async (req, res) => {
    const { rows } = await query('SELECT * FROM cakes WHERE id = $1', [req.params.id]);
    res.render('admin/cake-form', { cake: rows[0], active: { cakes: true }  });
});

app.post('/admin/cakes/delete/:id', validateSessionAndRole("Any"), async (req, res) => {
    await query('DELETE FROM cakes WHERE id = $1', [req.params.id]);
    res.redirect('/admin/cakes');
});

// Admin order management
app.get('/admin/orders', validateSessionAndRole("Any"), async (req, res) => {
    const { rows: orders } = await query(`
      SELECT o.*, 
        (SELECT SUM(oi.quantity * oi.price) 
        FROM order_items oi 
        WHERE oi.order_id = o.id) as total
      FROM orders o
      ORDER BY o.created_at DESC
    `);
    res.render('admin/orders', { orders, active: { orders: true }  });
});

app.get('/admin/orders/view/:id', validateSessionAndRole("Any"), async (req, res) => {
    const { rows: [order] } = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const { rows: items } = await query(`
      SELECT oi.*, c.name, c.image_url
      FROM order_items oi
      JOIN cakes c ON oi.cake_id = c.id
      WHERE oi.order_id = $1
    `, [req.params.id]);

    res.render('admin/order-details', { order, items, active: { orders: true } });
});

app.post('/admin/orders/update-status/:id', validateSessionAndRole("Any"), async (req, res) => {
    const { status } = req.body;
    await query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.redirect(`/admin/orders/view/${req.params.id}`);
});


export default app;