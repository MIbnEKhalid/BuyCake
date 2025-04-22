import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.NEON_POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export const query = (text, params) => pool.query(text, params);

export const initDB = async () => {
  try {
    await query(`
        CREATE TABLE IF NOT EXISTS cakes (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT,
          price DECIMAL(10, 2) NOT NULL,
          image_url VARCHAR(255)
        )  -- Closing parenthesis added here
      `);

    await query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          customer_name VARCHAR(100) NOT NULL,
          email VARCHAR(100) NOT NULL,
          phone VARCHAR(20) NOT NULL,
          cake_id INTEGER REFERENCES cakes(id),
          delivery_date DATE NOT NULL,
          message TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )  -- Closing parenthesis added here
      `);
    await query(`
        CREATE TABLE IF NOT EXISTS cart (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) NOT NULL,
          cake_id INTEGER REFERENCES cakes(id),
          quantity INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT NOW())
      `);

    await query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INT NOT NULL,
            cake_id INT NOT NULL,
            quantity INT NOT NULL,
            price NUMERIC(10, 2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (cake_id) REFERENCES cakes(id) ON DELETE CASCADE
        );
    `);
    // Add admin table
    await query(`
          CREATE TABLE IF NOT EXISTS admin_users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);

    // Create default admin if none exists
    const { rows } = await query('SELECT COUNT(*) FROM admin_users');
    if (rows[0].count === '0') {
      const defaultUsername = 'support';
      const defaultPassword = '4552525'; // Change this in production!
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await query(
        'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
        [defaultUsername, hashedPassword]
      );
      console.log('Default admin user created');
    }

    console.log('Database initialized');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
};