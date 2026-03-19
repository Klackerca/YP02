const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { normalizeFilters, buildAttractionsWhere } = require('../services/reportService');

const router = express.Router();

const DEFAULT_PROMOTION_FORM = {
  attraction_id: '',
  title: '',
  discount_percent: '',
  starts_on: '',
  ends_on: '',
  is_active: true
};

function buildPromotionForm(source = {}) {
  return {
    attraction_id: source.attraction_id?.toString() || '',
    title: (source.title || '').toString(),
    discount_percent: source.discount_percent?.toString() || '',
    starts_on: (source.starts_on_value || source.starts_on || '').toString(),
    ends_on: (source.ends_on_value || source.ends_on || '').toString(),
    is_active: source.is_active === undefined ? true : Boolean(Number(source.is_active))
  };
}

async function loadPromotionsData(options = {}) {
  const [promotionAttractions] = await pool.query('SELECT id, name FROM attractions ORDER BY name');
  const [promotions] = await pool.query(
    `SELECT p.*, a.name AS attraction_name,
            DATE_FORMAT(p.starts_on, '%Y-%m-%d') AS starts_on_value,
            DATE_FORMAT(p.ends_on, '%Y-%m-%d') AS ends_on_value
     FROM promotions p
     JOIN attractions a ON a.id = p.attraction_id
     ORDER BY p.created_at DESC`
  );

  let promotionForm = { ...DEFAULT_PROMOTION_FORM };
  let promotionEditId = null;

  if (options.editPromotionId) {
    const promotionToEdit = promotions.find((item) => item.id === Number(options.editPromotionId));
    if (promotionToEdit) {
      promotionForm = buildPromotionForm(promotionToEdit);
      promotionEditId = promotionToEdit.id;
    }
  }

  if (options.promotionForm) {
    promotionForm = {
      ...promotionForm,
      ...buildPromotionForm(options.promotionForm)
    };
  }

  if (options.promotionEditId) {
    promotionEditId = Number(options.promotionEditId);
  }

  return {
    promotionAttractions,
    promotions,
    promotionForm,
    promotionEditId,
    promotionError: options.promotionError || null
  };
}

async function renderPromotionsDashboard(res, options = {}) {
  const promotionData = await loadPromotionsData(options);

  return res.status(options.statusCode || 200).render('admin/dashboard', {
    title: 'Панель администратора',
    section: 'promotions',
    stats: null,
    topAttractionDay: null,
    topAttractionMonth: null,
    latestOrders: [],
    filters: null,
    attractions: [],
    ageGroups: [],
    news: [],
    ...promotionData
  });
}

async function renderPromotionsPage(res, options = {}) {
  const promotionData = await loadPromotionsData(options);

  return res.status(options.statusCode || 200).render('admin/promotions', {
    title: 'Акции на билеты',
    attractions: promotionData.promotionAttractions,
    promotions: promotionData.promotions,
    promotionForm: promotionData.promotionForm,
    promotionEditId: promotionData.promotionEditId,
    promotionError: promotionData.promotionError
  });
}

function validatePromotionForm(form) {
  const attractionId = Number(form.attraction_id);
  const discountPercent = Number(form.discount_percent);

  if (!attractionId) {
    return 'Выберите аттракцион для акции.';
  }

  if (!form.title.trim()) {
    return 'Укажите название акции.';
  }

  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 90) {
    return 'Скидка должна быть в диапазоне от 1 до 90%.';
  }

  if (!form.starts_on || !form.ends_on) {
    return 'Укажите период действия акции.';
  }

  if (form.starts_on > form.ends_on) {
    return 'Дата окончания акции не может быть раньше даты начала.';
  }

  return null;
}

async function findPromotionOverlap({ attractionId, startsOn, endsOn, excludePromotionId = null }) {
  const params = [attractionId, startsOn, endsOn];
  let query =
    `SELECT id, title,
            DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on_value,
            DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on_value
     FROM promotions
     WHERE attraction_id = ?
       AND NOT (ends_on < ? OR starts_on > ?)`;

  if (excludePromotionId) {
    query += ' AND id <> ?';
    params.push(excludePromotionId);
  }

  query += ' LIMIT 1';

  const [rows] = await pool.query(query, params);
  return rows[0] || null;
}

async function savePromotion(form, promotionId = null) {
  const overlap = await findPromotionOverlap({
    attractionId: Number(form.attraction_id),
    startsOn: form.starts_on,
    endsOn: form.ends_on,
    excludePromotionId: promotionId
  });

  if (overlap) {
    return {
      error: `Для этого аттракциона уже есть акция на пересекающийся период: ${overlap.starts_on_value} - ${overlap.ends_on_value}.`
    };
  }

  if (promotionId) {
    await pool.query(
      `UPDATE promotions
       SET attraction_id = ?, title = ?, discount_percent = ?, starts_on = ?, ends_on = ?, is_active = ?
       WHERE id = ?`,
      [
        Number(form.attraction_id),
        form.title.trim(),
        Number(form.discount_percent),
        form.starts_on,
        form.ends_on,
        form.is_active ? 1 : 0,
        promotionId
      ]
    );

    return { error: null };
  }

  await pool.query(
    `INSERT INTO promotions (attraction_id, title, discount_percent, starts_on, ends_on, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      Number(form.attraction_id),
      form.title.trim(),
      Number(form.discount_percent),
      form.starts_on,
      form.ends_on,
      form.is_active ? 1 : 0
    ]
  );

  return { error: null };
}

router.get('/login', (req, res) => {
  if (req.session.admin) {
    return res.redirect('/admin');
  }
  return res.render('admin/login', { title: 'Вход администратора', error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { login, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM admins WHERE login = ? LIMIT 1', [login]);
    const admin = rows[0];

    if (!admin) {
      return res.status(401).render('admin/login', {
        title: 'Вход администратора',
        error: 'Неверный логин или пароль'
      });
    }

    const ok = await bcrypt.compare(password || '', admin.password_hash);
    if (!ok) {
      return res.status(401).render('admin/login', {
        title: 'Вход администратора',
        error: 'Неверный логин или пароль'
      });
    }

    req.session.admin = { id: admin.id, login: admin.login };
    return res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const requestedSection = (req.query.section || 'statistics').toString();
    const allowedSections = new Set(['statistics', 'attractions', 'news', 'promotions', 'constants']);
    const section = allowedSections.has(requestedSection) ? requestedSection : 'statistics';

    let stats = null;
    let topAttractionDay = null;
    let topAttractionMonth = null;
    let latestOrders = [];

    let filters = null;
    let attractions = [];
    let ageGroups = [];
    let news = [];

    let promotionAttractions = [];
    let promotions = [];
    let promotionForm = { ...DEFAULT_PROMOTION_FORM };
    let promotionEditId = null;
    let promotionError = null;

    if (section === 'statistics') {
      const [statsRows] = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN o.visit_date = CURDATE() THEN o.quantity ELSE 0 END), 0) AS visits_day,
            COALESCE(SUM(CASE
              WHEN YEAR(o.visit_date) = YEAR(CURDATE())
               AND MONTH(o.visit_date) = MONTH(CURDATE())
              THEN o.quantity ELSE 0 END), 0) AS visits_month,
            ROUND(COALESCE(SUM(CASE WHEN o.visit_date = CURDATE() THEN o.total_price ELSE 0 END), 0), 2) AS profit_day,
            ROUND(COALESCE(SUM(CASE
              WHEN YEAR(o.visit_date) = YEAR(CURDATE())
               AND MONTH(o.visit_date) = MONTH(CURDATE())
              THEN o.total_price ELSE 0 END), 0), 2) AS profit_month
         FROM ticket_orders o`
      );

      const [topDayRows] = await pool.query(
        `SELECT a.name, SUM(o.quantity) AS tickets_count
         FROM ticket_orders o
         JOIN attractions a ON a.id = o.attraction_id
         WHERE o.visit_date = CURDATE()
         GROUP BY a.id, a.name
         ORDER BY tickets_count DESC
         LIMIT 1`
      );

      const [topMonthRows] = await pool.query(
        `SELECT a.name, SUM(o.quantity) AS tickets_count
         FROM ticket_orders o
         JOIN attractions a ON a.id = o.attraction_id
         WHERE YEAR(o.visit_date) = YEAR(CURDATE())
           AND MONTH(o.visit_date) = MONTH(CURDATE())
         GROUP BY a.id, a.name
         ORDER BY tickets_count DESC
         LIMIT 1`
      );

      const [latestOrderRows] = await pool.query(
        `SELECT a.name AS attraction_name,
                o.total_price,
                o.visit_date,
                o.created_at
         FROM ticket_orders o
         JOIN attractions a ON a.id = o.attraction_id
         ORDER BY o.created_at DESC
         LIMIT 10`
      );

      stats = statsRows[0];
      topAttractionDay = topDayRows[0] || null;
      topAttractionMonth = topMonthRows[0] || null;
      latestOrders = latestOrderRows;
    }

    if (section === 'attractions') {
      filters = normalizeFilters(req.query);
      const filterQuery = buildAttractionsWhere(filters);
      [ageGroups] = await pool.query('SELECT code, title FROM age_groups ORDER BY id');
      [attractions] = await pool.query(
        `SELECT a.*, ag.title AS age_group_title
         FROM attractions a
         JOIN age_groups ag ON ag.code = a.age_group_code
         ${filterQuery.clause}
         ORDER BY a.id DESC`,
        filterQuery.params
      );

    }

    if (section === 'news') {
      [news] = await pool.query('SELECT * FROM news ORDER BY published_at DESC');
    }

    if (section === 'promotions') {
      ({ promotionAttractions, promotions, promotionForm, promotionEditId, promotionError } = await loadPromotionsData({
        editPromotionId: req.query.editPromotionId
      }));
    }

    if (section === 'constants') {
      [ageGroups] = await pool.query('SELECT * FROM age_groups ORDER BY id');
    }

    return res.render('admin/dashboard', {
      title: 'Панель администратора',
      section,
      stats,
      topAttractionDay,
      topAttractionMonth,
      latestOrders,
      filters,
      attractions,
      ageGroups,
      news,
      promotionAttractions,
      promotions,
      promotionForm,
      promotionEditId,
      promotionError
    });
  } catch (error) {
    next(error);
  }
});

router.get('/attractions', requireAdmin, async (req, res, next) => {
  try {
    const filters = normalizeFilters(req.query);
    const filterQuery = buildAttractionsWhere(filters);
    const [ageGroups] = await pool.query('SELECT code, title FROM age_groups ORDER BY id');

    const [rows] = await pool.query(
      `SELECT a.*, ag.title AS age_group_title
       FROM attractions a
       JOIN age_groups ag ON ag.code = a.age_group_code
       ${filterQuery.clause}
       ORDER BY a.id DESC`,
      filterQuery.params
    );

    return res.render('admin/attractions', {
      title: 'Управление аттракционами',
      attractions: rows,
      ageGroups,
      filters
    });
  } catch (error) {
    next(error);
  }
});

router.get('/attractions/new', requireAdmin, async (req, res, next) => {
  try {
    const [ageGroups] = await pool.query('SELECT code, title FROM age_groups ORDER BY id');
    return res.render('admin/attraction-form', {
      title: 'Новый аттракцион',
      attraction: null,
      ageGroups,
      action: '/admin/attractions'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/attractions', requireAdmin, async (req, res, next) => {
  try {
    const { name, ticket_price, age_group_code, seats_count, image_url } = req.body;
    await pool.query(
      `INSERT INTO attractions (name, ticket_price, age_group_code, seats_count, image_url)
       VALUES (?, ?, ?, ?, ?)`,
      [name, ticket_price, age_group_code, seats_count, image_url || null]
    );

    return res.redirect('/admin?section=attractions');
  } catch (error) {
    next(error);
  }
});

router.get('/attractions/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[attraction]] = await pool.query('SELECT * FROM attractions WHERE id = ?', [id]);
    if (!attraction) {
      return res.status(404).send('Аттракцион не найден');
    }

    const [ageGroups] = await pool.query('SELECT code, title FROM age_groups ORDER BY id');
    return res.render('admin/attraction-form', {
      title: 'Редактирование аттракциона',
      attraction,
      ageGroups,
      action: `/admin/attractions/${id}`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/attractions/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, ticket_price, age_group_code, seats_count, image_url } = req.body;

    await pool.query(
      `UPDATE attractions
       SET name = ?, ticket_price = ?, age_group_code = ?, seats_count = ?, image_url = ?
       WHERE id = ?`,
      [name, ticket_price, age_group_code, seats_count, image_url || null, id]
    );
    return res.redirect('/admin?section=attractions');
  } catch (error) {
    next(error);
  }
});

router.post('/attractions/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM attractions WHERE id = ?', [req.params.id]);
    return res.redirect('/admin?section=attractions');
  } catch (error) {
    next(error);
  }
});

router.get('/news', requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM news ORDER BY published_at DESC');
    return res.render('admin/news', {
      title: 'Управление новостями',
      news: rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/news/new', requireAdmin, (req, res) => {
  res.render('admin/news-form', {
    title: 'Новая новость',
    item: null,
    action: '/admin/news'
  });
});

router.post('/news', requireAdmin, async (req, res, next) => {
  try {
    const { title, body, image_url, is_published } = req.body;
    await pool.query(
      `INSERT INTO news (title, body, image_url, is_published, published_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [title, body, image_url || null, is_published ? 1 : 0]
    );
    return res.redirect('/admin?section=news');
  } catch (error) {
    next(error);
  }
});

router.get('/news/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const [[item]] = await pool.query('SELECT * FROM news WHERE id = ?', [req.params.id]);
    if (!item) {
      return res.status(404).send('Новость не найдена');
    }
    return res.render('admin/news-form', {
      title: 'Редактирование новости',
      item,
      action: `/admin/news/${item.id}`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/news/:id', requireAdmin, async (req, res, next) => {
  try {
    const { title, body, image_url, is_published } = req.body;
    await pool.query(
      `UPDATE news
       SET title = ?, body = ?, image_url = ?, is_published = ?
       WHERE id = ?`,
      [title, body, image_url || null, is_published ? 1 : 0, req.params.id]
    );

    return res.redirect('/admin?section=news');
  } catch (error) {
    next(error);
  }
});

router.post('/news/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM news WHERE id = ?', [req.params.id]);
    return res.redirect('/admin?section=news');
  } catch (error) {
    next(error);
  }
});

router.get('/promotions', requireAdmin, async (req, res, next) => {
  try {
    return renderPromotionsPage(res, {
      editPromotionId: req.query.editPromotionId
    });
  } catch (error) {
    next(error);
  }
});

router.post('/promotions', requireAdmin, async (req, res, next) => {
  try {
    const promotionForm = buildPromotionForm(req.body);
    const validationError = validatePromotionForm(promotionForm);

    if (validationError) {
      return renderPromotionsDashboard(res, {
        statusCode: 400,
        promotionError: validationError,
        promotionForm
      });
    }

    const saveResult = await savePromotion(promotionForm);
    if (saveResult.error) {
      return renderPromotionsDashboard(res, {
        statusCode: 400,
        promotionError: saveResult.error,
        promotionForm
      });
    }

    return res.redirect('/admin?section=promotions');
  } catch (error) {
    next(error);
  }
});

router.post('/promotions/:id', requireAdmin, async (req, res, next) => {
  try {
    const promotionId = Number(req.params.id);
    const [[promotion]] = await pool.query('SELECT id FROM promotions WHERE id = ? LIMIT 1', [promotionId]);

    if (!promotion) {
      return res.status(404).send('Акция не найдена');
    }

    const promotionForm = buildPromotionForm(req.body);
    const validationError = validatePromotionForm(promotionForm);

    if (validationError) {
      return renderPromotionsDashboard(res, {
        statusCode: 400,
        promotionError: validationError,
        promotionForm,
        promotionEditId: promotionId
      });
    }

    const saveResult = await savePromotion(promotionForm, promotionId);
    if (saveResult.error) {
      return renderPromotionsDashboard(res, {
        statusCode: 400,
        promotionError: saveResult.error,
        promotionForm,
        promotionEditId: promotionId
      });
    }

    return res.redirect('/admin?section=promotions');
  } catch (error) {
    next(error);
  }
});

router.post('/promotions/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM promotions WHERE id = ?', [req.params.id]);
    return res.redirect('/admin?section=promotions');
  } catch (error) {
    next(error);
  }
});

router.get('/constants', requireAdmin, async (req, res, next) => {
  try {
    const [ageGroups] = await pool.query('SELECT * FROM age_groups ORDER BY id');
    return res.render('admin/constants', {
      title: 'Справочники и константы',
      ageGroups
    });
  } catch (error) {
    next(error);
  }
});

router.post('/constants/age-groups', requireAdmin, async (req, res, next) => {
  try {
    const { code, title } = req.body;
    await pool.query('INSERT INTO age_groups (code, title) VALUES (?, ?)', [code, title]);
    return res.redirect('/admin?section=constants');
  } catch (error) {
    next(error);
  }
});

router.post('/constants/age-groups/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM age_groups WHERE id = ?', [req.params.id]);
    return res.redirect('/admin?section=constants');
  } catch (error) {
    next(error);
  }
});

router.get('/print-report', requireAdmin, async (req, res, next) => {
  try {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const fallbackFrom = monthStart.toISOString().slice(0, 10);
    const fallbackTo = today.toISOString().slice(0, 10);

    const fromDate = (req.query.from || fallbackFrom).toString();
    const toDate = (req.query.to || fallbackTo).toString();

    const [salesByAttraction] = await pool.query(
      `SELECT a.name,
              SUM(o.quantity) AS tickets_count,
              ROUND(SUM(o.total_price), 2) AS total_revenue
       FROM ticket_orders o
       JOIN attractions a ON a.id = o.attraction_id
       WHERE o.visit_date BETWEEN ? AND ?
       GROUP BY a.id, a.name
       ORDER BY total_revenue DESC, tickets_count DESC`,
      [fromDate, toDate]
    );

    const [summaryRows] = await pool.query(
      `SELECT COALESCE(SUM(o.quantity), 0) AS total_tickets,
              ROUND(COALESCE(SUM(o.total_price), 0), 2) AS total_profit
       FROM ticket_orders o
       WHERE o.visit_date BETWEEN ? AND ?`,
      [fromDate, toDate]
    );

    return res.render('admin/report-print', {
      title: 'Печатная форма отчёта',
      date: new Date(),
      fromDate,
      toDate,
      salesByAttraction,
      summary: summaryRows[0]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
