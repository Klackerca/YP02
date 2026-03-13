function normalizeFilters(query) {
  return {
    name: (query.name || '').trim(),
    ageGroup: (query.ageGroup || '').trim(),
    minPrice: query.minPrice ? Number(query.minPrice) : null,
    maxPrice: query.maxPrice ? Number(query.maxPrice) : null,
    minSeats: query.minSeats ? Number(query.minSeats) : null
  };
}

function buildAttractionsWhere(filters) {
  const where = [];
  const params = [];

  if (filters.name) {
    where.push('a.name LIKE ?');
    params.push(`%${filters.name}%`);
  }
  if (filters.ageGroup) {
    where.push('a.age_group_code = ?');
    params.push(filters.ageGroup);
  }
  if (filters.minPrice !== null && Number.isFinite(filters.minPrice)) {
    where.push('a.ticket_price >= ?');
    params.push(filters.minPrice);
  }
  if (filters.maxPrice !== null && Number.isFinite(filters.maxPrice)) {
    where.push('a.ticket_price <= ?');
    params.push(filters.maxPrice);
  }
  if (filters.minSeats !== null && Number.isFinite(filters.minSeats)) {
    where.push('a.seats_count >= ?');
    params.push(filters.minSeats);
  }

  return {
    clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

module.exports = {
  normalizeFilters,
  buildAttractionsWhere
};
