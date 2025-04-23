import express from 'express';
import { engine } from 'express-handlebars';
import { query, initDB } from './routes/database.js';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import path from "path";
import { fileURLToPath } from "url";
import adminRoutes from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/', express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).send({ error: 'Invalid request body' });
  } else {
    next(err);
  }
});

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
    encodeURIComponent: (str) => {
      return encodeURIComponent(str);
    },
  }
}));

await initDB();

app.use(async (req, res, next) => {
  if (!req.cookies.sessionIdd) {
    const sessionIdd = uuidv4();
    res.cookie('sessionIdd', sessionIdd, { maxAge: 86400000, httpOnly: true });
    req.sessionIdd = sessionIdd;
  } else {
    req.sessionIdd = req.cookies.sessionIdd;
  }

  // Get cart count
  const { rows } = await query(
    'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
    [req.sessionIdd]
  );
  res.locals.cartCount = rows[0].total || 0;

  next();
});

app.get('/', async (req, res) => {
  const { rows: cakes } = await query('SELECT * FROM cakes LIMIT 4');
  res.render('main/home.handlebars', { cakes });
});

app.get('/gallery', async (req, res) => {
  const { rows: cakes } = await query('SELECT * FROM cakes');
  res.render('main/gallery.handlebars', { cakes });
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
      `, [req.sessionIdd]);

      cartItems = rows;
      fromCart = true;

      if (cartItems.length === 0) {
        return res.redirect('/cart');
      }
    }

    res.render('main/order.handlebars', {
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
  `, [req.sessionIdd]);

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
  console.log('Clearing cart for session:', req.sessionIdd);
  await query('DELETE FROM cart WHERE session_id = $1', [req.sessionIdd]);

  console.log('Order completed. Redirecting to /thank-you.');
  res.redirect('/thank-you');
});

app.post('/cart/add', async (req, res) => {
  const { cakeId } = req.body;

  // Check if already in cart
  const { rows } = await query(
    'SELECT * FROM cart WHERE session_id = $1 AND cake_id = $2',
    [req.sessionIdd, cakeId]
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
      [req.sessionIdd, cakeId]
    );
  }

  // Get updated cart count
  const { rows: countRows } = await query(
    'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
    [req.sessionIdd]
  );

  res.json({ success: true, count: countRows[0].total || 0 });
});

app.post('/cart/update/:cartId', async (req, res) => {
  try {
    const { action } = req.body;
    const { cartId } = req.params;

    // Get current quantity
    const { rows } = await query(
      'SELECT quantity FROM cart WHERE id = $1 AND session_id = $2',
      [cartId, req.sessionIdd]
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
      [req.sessionIdd]
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

app.post('/cart/remove/:cartId', async (req, res) => {
  try {
    const { cartId } = req.params;

    await query(
      'DELETE FROM cart WHERE id = $1 AND session_id = $2',
      [cartId, req.sessionIdd]
    );

    // Get updated cart count
    const { rows: countRows } = await query(
      'SELECT SUM(quantity) as total FROM cart WHERE session_id = $1',
      [req.sessionIdd]
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
  `, [req.sessionIdd]);

  // Calculate total
  let total = 0;
  cartItems.forEach(item => {
    total += item.price * item.quantity;
  });

  res.render('main/cart.handlebars', { cartItems, total });
});

app.get('/about', (req, res) => {
  res.render('main/about.handlebars');
});

app.get('/thank-you', (req, res) => {
  res.render('main/thank-you.handlebars');
});

app.get('/contact', (req, res) => {
  res.render('main/contact.handlebars');
});

app.use(adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});