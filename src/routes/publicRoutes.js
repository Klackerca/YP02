const express = require('express');
const pool = require('../db');
const { normalizeFilters, buildAttractionsWhere } = require('../services/reportService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [attractions] = await pool.query(
      `SELECT a.*, ag.title AS age_group_title,
              COALESCE((
                SELECT MAX(p.discount_percent)
                FROM promotions p
                WHERE p.attraction_id = a.id
                  AND p.is_active = 1
                  AND CURDATE() BETWEEN p.starts_on AND p.ends_on
              ), 0) AS active_discount_percent,
              ROUND(a.ticket_price * (1 - COALESCE((
                SELECT MAX(p2.discount_percent)
                FROM promotions p2
                WHERE p2.attraction_id = a.id
                  AND p2.is_active = 1
                  AND CURDATE() BETWEEN p2.starts_on AND p2.ends_on
              ), 0) / 100), 2) AS final_ticket_price
       FROM attractions a
       JOIN age_groups ag ON ag.code = a.age_group_code
       ORDER BY a.created_at DESC
       LIMIT 6`
    );
    const [news] = await pool.query(
      `SELECT * FROM news
       WHERE is_published = 1
       ORDER BY published_at DESC
       LIMIT 3`
    );

    res.render('public/index', { title: 'ООО Карусель', attractions, news });
  } catch (error) {
    next(error);
  }
});

router.get('/attractions', async (req, res, next) => {
  try {
    const filters = normalizeFilters(req.query);
    const filterQuery = buildAttractionsWhere(filters);

    const [ageGroups] = await pool.query('SELECT code, title FROM age_groups ORDER BY id');
    const [attractions] = await pool.query(
      `SELECT a.*, ag.title AS age_group_title,
              COALESCE((
                SELECT MAX(p.discount_percent)
                FROM promotions p
                WHERE p.attraction_id = a.id
                  AND p.is_active = 1
                  AND CURDATE() BETWEEN p.starts_on AND p.ends_on
              ), 0) AS active_discount_percent,
              ROUND(a.ticket_price * (1 - COALESCE((
                SELECT MAX(p2.discount_percent)
                FROM promotions p2
                WHERE p2.attraction_id = a.id
                  AND p2.is_active = 1
                  AND CURDATE() BETWEEN p2.starts_on AND p2.ends_on
              ), 0) / 100), 2) AS final_ticket_price,
              ROUND((a.ticket_price * (1 - COALESCE((
                SELECT MAX(p3.discount_percent)
                FROM promotions p3
                WHERE p3.attraction_id = a.id
                  AND p3.is_active = 1
                  AND CURDATE() BETWEEN p3.starts_on AND p3.ends_on
              ), 0) / 100)) * a.seats_count, 2) AS potential_profit
       FROM attractions a
       JOIN age_groups ag ON ag.code = a.age_group_code
       ${filterQuery.clause}
       ORDER BY a.name`,
      filterQuery.params
    );

    res.render('public/attractions', {
      title: 'Аттракционы',
      attractions,
      ageGroups,
      filters
    });
  } catch (error) {
    next(error);
  }
});

router.get('/news', async (req, res, next) => {
  try {
    const [news] = await pool.query(
      `SELECT * FROM news
       WHERE is_published = 1
       ORDER BY published_at DESC`
    );

    res.render('public/news', { title: 'Новости', news });
  } catch (error) {
    next(error);
  }
});

router.get('/news/:id', async (req, res, next) => {
  try {
    const [[item]] = await pool.query(
      `SELECT * FROM news
       WHERE id = ? AND is_published = 1
       LIMIT 1`,
      [req.params.id]
    );

    if (!item) {
      return res.status(404).send('Новость не найдена');
    }

    return res.render('public/news-detail', {
      title: item.title,
      item
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/buy/:id', async (req, res, next) => {
  try {
    const [[attraction]] = await pool.query(
      `SELECT a.*, ag.title AS age_group_title,
              COALESCE((
                SELECT MAX(p.discount_percent)
                FROM promotions p
                WHERE p.attraction_id = a.id
                  AND p.is_active = 1
                  AND CURDATE() BETWEEN p.starts_on AND p.ends_on
              ), 0) AS active_discount_percent,
              ROUND(a.ticket_price * (1 - COALESCE((
                SELECT MAX(p2.discount_percent)
                FROM promotions p2
                WHERE p2.attraction_id = a.id
                  AND p2.is_active = 1
                  AND CURDATE() BETWEEN p2.starts_on AND p2.ends_on
              ), 0) / 100), 2) AS final_ticket_price
       FROM attractions a
       JOIN age_groups ag ON ag.code = a.age_group_code
       WHERE a.id = ?
       LIMIT 1`,
      [req.params.id]
    );

    if (!attraction) {
      return res.status(404).send('Аттракцион не найден');
    }

    return res.render('public/buy-ticket', {
      title: `Купить билет — ${attraction.name}`,
      attraction,
      success: req.query.success === '1'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/buy/:id', async (req, res, next) => {
  try {
    const { customer_name, phone, quantity, visit_date } = req.body;
    const qty = Math.max(1, Number(quantity || 1));

    const [[attraction]] = await pool.query(
      `SELECT a.id, a.ticket_price,
              COALESCE((
                SELECT MAX(p.discount_percent)
                FROM promotions p
                WHERE p.attraction_id = a.id
                  AND p.is_active = 1
                  AND CURDATE() BETWEEN p.starts_on AND p.ends_on
              ), 0) AS active_discount_percent
       FROM attractions a
       WHERE a.id = ?
       LIMIT 1`,
      [req.params.id]
    );

    if (!attraction) {
      return res.status(404).send('Аттракцион не найден');
    }

    const discountPercent = Number(attraction.active_discount_percent || 0);
    const unitPrice = Number(attraction.ticket_price);
    const discountedPrice = unitPrice * (1 - discountPercent / 100);
    const totalPrice = Number((discountedPrice * qty).toFixed(2));

    await pool.query(
      `INSERT INTO ticket_orders (
         attraction_id, customer_name, phone, quantity, unit_price,
         discount_percent, total_price, visit_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attraction.id,
        customer_name,
        phone,
        qty,
        unitPrice,
        discountPercent,
        totalPrice,
        visit_date
      ]
    );

    return res.redirect(`/tickets/buy/${attraction.id}?success=1`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
