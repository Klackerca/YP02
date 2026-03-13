CREATE TABLE IF NOT EXISTS age_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS attractions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  ticket_price DECIMAL(10,2) NOT NULL,
  age_group_code VARCHAR(40) NOT NULL,
  seats_count INT NOT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_attractions_age_group
    FOREIGN KEY (age_group_code) REFERENCES age_groups(code)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS news (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  published_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotions (
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
);

CREATE TABLE IF NOT EXISTS ticket_orders (
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
);

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO age_groups (code, title) VALUES
('0-5', '0-5 лет'),
('6-10', '6-10 лет'),
('11-14', '11-14 лет'),
('15-18', '15-18 лет'),
('18+', '18+');

INSERT IGNORE INTO attractions (name, ticket_price, age_group_code, seats_count, image_url) VALUES
('Колесо обозрения', 450, '6-10', 32, 'https://images.unsplash.com/photo-1561484930-998b6a7b22e8?auto=format&fit=crop&w=1200&q=80'),
('Американские горки', 700, '15-18', 24, 'https://images.unsplash.com/photo-1527549993586-dff825b37782?auto=format&fit=crop&w=1200&q=80'),
('Комната смеха', 300, '0-5', 18, 'https://images.unsplash.com/photo-1461354464878-ad92f492a5a0?auto=format&fit=crop&w=1200&q=80');

INSERT IGNORE INTO news (id, title, body, image_url, is_published) VALUES
(1, 'Открытие летнего сезона', 'Новые программы и скидки на семейные посещения уже доступны.', 'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=1200&q=80', 1);

INSERT IGNORE INTO promotions (id, attraction_id, title, discount_percent, starts_on, ends_on, is_active) VALUES
(1, 1, 'Семейная акция выходного дня', 15.00, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1);

-- Пример создания администратора (подставьте хеш bcrypt):
-- INSERT INTO admins(login, password_hash) VALUES ('admin', '$2b$10$...');
