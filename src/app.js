const path = require('path');
const express = require('express');
const session = require('express-session');
require('dotenv').config();
const pool = require('./db');

const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/assets', express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'unsafe_default_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

function wantsJson(req) {
  return req.xhr || req.accepts(['html', 'json']) === 'json';
}

app.use((req, res, next) => {
  const error = new Error('Страница не найдена');
  error.status = 404;
  next(error);
});

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = Number(err.status) || 500;
  const isNotFound = statusCode === 404;
  const title = isNotFound ? '404 - Страница не найдена' : '500 - Внутренняя ошибка сервера';
  const message = isNotFound
    ? 'Запрошенная страница не найдена или была перемещена.'
    : 'Произошла внутренняя ошибка сервера. Попробуйте обновить страницу позже.';

  if (wantsJson(req)) {
    return res.status(statusCode).json({
      error: {
        status: statusCode,
        message: isNotFound ? 'Not Found' : 'Internal Server Error'
      }
    });
  }

  res.status(statusCode).render('error', {
    title,
    statusCode,
    message
  });
});

const port = Number(process.env.PORT || 3000);

async function ensureExtraTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS promotions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      attraction_id INT NOT NULL,
      title VARCHAR(180) NOT NULL,
      discount_percent DECIMAL(5,2) NOT NULL,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_promotions_attraction
        FOREIGN KEY (attraction_id) REFERENCES attractions(id)
        ON UPDATE CASCADE ON DELETE CASCADE
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS ticket_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      attraction_id INT NOT NULL,
      customer_name VARCHAR(120) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      total_price DECIMAL(10,2) NOT NULL,
      visit_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_orders_attraction
        FOREIGN KEY (attraction_id) REFERENCES attractions(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
    )`
  );
}

ensureExtraTables()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server started: http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Ошибка инициализации БД:', error);
    process.exit(1);
  });
