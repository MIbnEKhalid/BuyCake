import express from 'express';
import { engine } from 'express-handlebars';
import { query, initDB } from './database.js';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import path from "path";
import { fileURLToPath } from "url";
import session from 'express-session';
import bcrypt from 'bcrypt';






const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/', express.static(path.join(__dirname, 'public')));

// Add after other middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
  if (req.session.adminLoggedIn) {
    return next();
  }
  res.redirect('/admin/login');
};

// Middleware to handle errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).send({ error: 'Invalid request body' });
  } else {
    next(err);
  }
});
// Handlebars setup
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');
app.engine('handlebars', engine({
  defaultLayout: false, // Disable the default layout
  partialsDir: [
    path.join(__dirname, "views/templates"),
    path.join(__dirname, "views")
  ],
  helpers: {
    multiply: (a, b) => a * b,
    json: context => JSON.stringify(context),
    formatDate: date => new Date(date).toLocaleDateString(),
    calculateTotal: items => items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
    eq: (a, b) => a === b,
    calculateTotal: items => items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
    minDeliveryDate: () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    },
    add: (a, b) => a + b,
    formatCurrency: value => parseFloat(value).toFixed(2),
  }
}));


// Initialize database
await initDB();

app.use(async (req, res, next) => {
  if (!req.cookies.sessionId) {
    const sessionId = uuidv4();
    res.cookie('sessionId', sessionId, { maxAge: 86400000, httpOnly: true });
    req.sessionId = sessionId;
  } else {
    req.sessionId = req.cookies.sessionId;
  }

  // Get cart count
  const { rows } = await query(
    'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
    [req.sessionId]
  );
  res.locals.cartCount = rows[0].total || 0;

  next();
});

app.get('/', async (req, res) => {
  const { rows: cakes } = await query('SELECT * FROM cakes LIMIT 4');
  res.render('home', { cakes });
});

app.get('/gallery', async (req, res) => {
  const { rows: cakes } = await query('SELECT * FROM cakes');
  res.render('gallery', { cakes });
});

app.get('/order/:id?', async (req, res) => {
  try {
    let cake = null;
    let cartItems = [];
    let fromCart = false;

    if (req.params.id) {
      // Single cake order
      const { rows } = await query('SELECT * FROM cakes WHERE id = $1', [req.params.id]);
      cake = rows[0];
    } else {
      // Cart order - get all cart items
      const { rows } = await query(`
        SELECT cart.quantity, cakes.* 
        FROM cart 
        JOIN cakes ON cart.cake_id = cakes.id 
        WHERE cart.session_id = $1
      `, [req.sessionId]);

      cartItems = rows;
      fromCart = true;

      if (cartItems.length === 0) {
        return res.redirect('/cart');
      }
    }

    res.render('order', {
      cake,
      cartItems,
      fromCart,
      cartCount: res.locals.cartCount
    });
  } catch (err) {
    console.error('Order page error:', err);
    res.redirect('/');
  }
});

app.post('/order', async (req, res) => {
  const { customer_name, email, phone, delivery_date, message } = req.body;

  console.log('Order request received:', { customer_name, email, phone, delivery_date, message });

  // Get cart items
  const { rows: cartItems } = await query(`
    SELECT cart.quantity, cakes.* 
    FROM cart 
    JOIN cakes ON cart.cake_id = cakes.id 
    WHERE cart.session_id = $1
  `, [req.sessionId]);

  console.log('Cart items:', cartItems);

  if (cartItems.length === 0) {
    console.log('Cart is empty. Redirecting to /cart.');
    return res.redirect('/cart');
  }

  // Create order
  const { rows: [order] } = await query(
    'INSERT INTO orders (customer_name, email, phone, delivery_date, message) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [customer_name, email, phone, delivery_date, message]
  );

  console.log('Order created with ID:', order.id);

  // Add order items
  for (const item of cartItems) {
    console.log('Adding item to order:', { orderId: order.id, cakeId: item.id, quantity: item.quantity, price: item.price });
    await query(
      'INSERT INTO order_items (order_id, cake_id, quantity, price) VALUES ($1, $2, $3, $4)',
      [order.id, item.id, item.quantity, item.price]
    );
  }

  // Clear cart
  console.log('Clearing cart for session:', req.sessionId);
  await query('DELETE FROM cart WHERE session_id = $1', [req.sessionId]);

  console.log('Order completed. Redirecting to /thank-you.');
  res.redirect('/thank-you');
});

app.post('/cart/add', async (req, res) => {
  const { cakeId } = req.body;

  // Check if already in cart
  const { rows } = await query(
    'SELECT * FROM cart WHERE session_id = $1 AND cake_id = $2',
    [req.sessionId, cakeId]
  );

  if (rows.length > 0) {
    // Update quantity
    await query(
      'UPDATE cart SET quantity = quantity + 1 WHERE id = $1',
      [rows[0].id]
    );
  } else {
    // Add new item
    await query(
      'INSERT INTO cart (session_id, cake_id) VALUES ($1, $2)',
      [req.sessionId, cakeId]
    );
  }

  // Get updated cart count
  const { rows: countRows } = await query(
    'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
    [req.sessionId]
  );

  res.json({ success: true, count: countRows[0].total || 0 });
});

// Update cart quantity
app.post('/cart/update/:cartId', async (req, res) => {
  try {
    const { action } = req.body;
    const { cartId } = req.params;

    // Get current quantity
    const { rows } = await query(
      'SELECT quantity FROM cart WHERE id = $1 AND session_id = $2',
      [cartId, req.sessionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    let newQuantity = rows[0].quantity;
    if (action === 'increase') {
      newQuantity += 1;
    } else if (action === 'decrease') {
      newQuantity -= 1;
    }

    if (newQuantity < 1) {
      return res.json({ success: false, message: 'Quantity cannot be less than 1' });
    }

    // Update quantity
    await query(
      'UPDATE cart SET quantity = $1 WHERE id = $2',
      [newQuantity, cartId]
    );

    // Get updated cart count
    const { rows: countRows } = await query(
      'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
      [req.sessionId]
    );

    res.json({
      success: true,
      quantity: newQuantity,
      count: countRows[0].total || 0
    });
  } catch (err) {
    console.error('Update cart error:', err);
    res.status(500).json({ success: false, message: 'Failed to update cart' });
  }
});

// Remove item from cart
app.post('/cart/remove/:cartId', async (req, res) => {
  try {
    const { cartId } = req.params;

    await query(
      'DELETE FROM cart WHERE id = $1 AND session_id = $2',
      [cartId, req.sessionId]
    );

    // Get updated cart count
    const { rows: countRows } = await query(
      'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
      [req.sessionId]
    );

    res.json({
      success: true,
      count: countRows[0].total || 0
    });
  } catch (err) {
    console.error('Remove from cart error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove item' });
  }
});


app.get('/cart', async (req, res) => {
  const { rows: cartItems } = await query(`
    SELECT cart.id as cart_id, cart.quantity, cakes.* 
    FROM cart 
    JOIN cakes ON cart.cake_id = cakes.id 
    WHERE cart.session_id = $1
  `, [req.sessionId]);

  // Calculate total
  let total = 0;
  cartItems.forEach(item => {
    total += item.price * item.quantity;
  });

  res.render('cart', { cartItems, total });
});

app.get('/about', (req, res) => {
  res.render('about');
});


// Add thank-you route
app.get('/thank-you', (req, res) => {
  res.render('thank-you');
});

app.get('/contact', (req, res) => {
  res.render('contact');
});










// Admin routes
// Update the admin dashboard route
app.get('/admin', requireAdmin, async (req, res) => {
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
app.get('/admin/cakes', requireAdmin, async (req, res) => {
  const { rows: cakes } = await query('SELECT * FROM cakes');
  res.render('admin/cakes', { cakes });
});

app.get('/admin/cakes/add', requireAdmin, (req, res) => {
  res.render('admin/cake-form', { cake: null });
});

app.post('/admin/cakes/save', requireAdmin, async (req, res) => {
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

app.get('/admin/cakes/edit/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT * FROM cakes WHERE id = $1', [req.params.id]);
  res.render('admin/cake-form', { cake: rows[0] });
});

app.post('/admin/cakes/delete/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM cakes WHERE id = $1', [req.params.id]);
  res.redirect('/admin/cakes');
});

// Admin order management
app.get('/admin/orders', requireAdmin, async (req, res) => {
  const { rows: orders } = await query(`
    SELECT o.*, 
      (SELECT SUM(oi.quantity * oi.price) 
      FROM order_items oi 
      WHERE oi.order_id = o.id) as total
    FROM orders o
    ORDER BY o.created_at DESC
  `);
  res.render('admin/orders', { orders });
});

app.get('/admin/orders/view/:id', requireAdmin, async (req, res) => {
  const { rows: [order] } = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  const { rows: items } = await query(`
    SELECT oi.*, c.name, c.image_url
    FROM order_items oi
    JOIN cakes c ON oi.cake_id = c.id
    WHERE oi.order_id = $1
  `, [req.params.id]);

  res.render('admin/order-details', { order, items });
});

app.post('/admin/orders/update-status/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
  res.redirect(`/admin/orders/view/${req.params.id}`);
});








const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});