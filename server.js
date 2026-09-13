'use strict';

const express  = require('express');
const path     = require('path');
const { randomUUID } = require('crypto');
const { DatabaseSync: Database } = require('node:sqlite');
const XLSX     = require('xlsx');

const PORT     = process.env.PORT     || 3001;
const PASSWORD = process.env.APP_PASSWORD;
const DB_PATH  = process.env.DB_PATH  || path.join(__dirname, 'suivi.db');

// ── Base de données ──────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS batches (
    id                 TEXT PRIMARY KEY,
    logged_at          TEXT NOT NULL,
    cigarettes         INTEGER NOT NULL DEFAULT 0,
    alcohol_units      REAL    NOT NULL DEFAULT 0,
    situation          TEXT,
    emotion            TEXT,
    automatic_thoughts TEXT,
    behavior           TEXT,
    coping_shown       INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS coping_strategies (
    id          TEXT PRIMARY KEY,
    title       TEXT    NOT NULL,
    description TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Serveur ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  if (!PASSWORD || req.headers['x-password'] !== PASSWORD) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
};

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/verify', (req, res) => {
  if (!PASSWORD) return res.status(500).json({ error: 'APP_PASSWORD non configuré' });
  if (req.body.password !== PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ ok: true });
});

// ── Batches ───────────────────────────────────────────────────────────────────
app.get('/api/batches', auth, (req, res) => {
  const { from, to } = req.query;
  let q = 'SELECT * FROM batches';
  const params = [];
  if (from && to) {
    q += ' WHERE logged_at >= ? AND logged_at <= ?';
    params.push(from, to);
  } else if (from) {
    q += ' WHERE logged_at >= ?';
    params.push(from);
  }
  q += ' ORDER BY logged_at DESC';
  res.json(db.prepare(q).all(...params));
});

app.post('/api/batches', auth, (req, res) => {
  const { logged_at, cigarettes, alcohol_units, situation, emotion,
          automatic_thoughts, behavior, coping_shown } = req.body;
  if (!logged_at) return res.status(400).json({ error: 'Date/heure requise' });
  const id = randomUUID();
  db.prepare(`
    INSERT INTO batches
      (id, logged_at, cigarettes, alcohol_units, situation, emotion,
       automatic_thoughts, behavior, coping_shown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, logged_at,
    Number(cigarettes)    || 0,
    Number(alcohol_units) || 0,
    situation?.trim()          || null,
    emotion?.trim()            || null,
    automatic_thoughts?.trim() || null,
    behavior?.trim()           || null,
    coping_shown ? 1 : 0,
  );
  res.status(201).json({ id });
});

app.delete('/api/batches/:id', auth, (req, res) => {
  const { changes } = db.prepare('DELETE FROM batches WHERE id = ?').run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Non trouvé' });
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const { period = 'week', date } = req.query;

  if (period === 'month') {
    const month = (date || new Date().toISOString()).slice(0, 7);
    const rows = db.prepare(`
      SELECT substr(logged_at, 1, 10) AS day,
             SUM(cigarettes)    AS cigarettes,
             SUM(alcohol_units) AS alcohol_units,
             COUNT(*)           AS batches
      FROM batches
      WHERE substr(logged_at, 1, 7) = ?
      GROUP BY day ORDER BY day
    `).all(month);
    return res.json({ period: 'month', month, rows });
  }

  // Semaine : calcul du lundi de la semaine de référence
  const refDay = (date || new Date().toISOString()).slice(0, 10);
  const d      = new Date(refDay + 'T12:00:00');
  const dow    = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const from = monday.toISOString().slice(0, 10);
  const to   = sunday.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT substr(logged_at, 1, 10) AS day,
           SUM(cigarettes)    AS cigarettes,
           SUM(alcohol_units) AS alcohol_units,
           COUNT(*)           AS batches
    FROM batches
    WHERE substr(logged_at, 1, 10) BETWEEN ? AND ?
    GROUP BY day ORDER BY day
  `).all(from, to);
  res.json({ period: 'week', from, to, rows });
});

// ── Coping strategies ─────────────────────────────────────────────────────────
app.get('/api/coping', auth, (req, res) => {
  const q = req.query.all === '1'
    ? 'SELECT * FROM coping_strategies ORDER BY active DESC, created_at DESC'
    : 'SELECT * FROM coping_strategies WHERE active = 1 ORDER BY RANDOM() LIMIT 3';
  res.json(db.prepare(q).all());
});

app.post('/api/coping', auth, (req, res) => {
  const title = req.body.title?.trim();
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  const id = randomUUID();
  db.prepare('INSERT INTO coping_strategies (id, title, description) VALUES (?, ?, ?)')
    .run(id, title, req.body.description?.trim() || null);
  res.status(201).json({ id });
});

app.patch('/api/coping/:id', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM coping_strategies WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Non trouvé' });
  }
  const { title, description, active } = req.body;
  if (title       !== undefined) db.prepare('UPDATE coping_strategies SET title       = ? WHERE id = ?').run(title, req.params.id);
  if (description !== undefined) db.prepare('UPDATE coping_strategies SET description = ? WHERE id = ?').run(description, req.params.id);
  if (active      !== undefined) db.prepare('UPDATE coping_strategies SET active      = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/coping/:id', auth, (req, res) => {
  const { changes } = db.prepare('DELETE FROM coping_strategies WHERE id = ?').run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Non trouvé' });
  res.json({ ok: true });
});

// ── Export ────────────────────────────────────────────────────────────────────
app.get('/api/export', auth, (req, res) => {
  const batches  = db.prepare('SELECT * FROM batches ORDER BY logged_at ASC').all();
  const monthly  = db.prepare(`
    SELECT substr(logged_at, 1, 7) AS mois,
           SUM(cigarettes)              AS total_cigarettes,
           ROUND(SUM(alcohol_units), 1) AS total_alcool,
           COUNT(*)                     AS nb_entrees
    FROM batches GROUP BY mois ORDER BY mois ASC
  `).all();
  const coping   = db.prepare('SELECT * FROM coping_strategies ORDER BY created_at ASC').all();

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(batches.map((b, i) => ({
    '#': i + 1,
    'Date': b.logged_at.replace('T', ' ').slice(0, 16),
    'Cigarettes': b.cigarettes,
    'Alcool (unités standardisées)': b.alcohol_units,
    'Situation': b.situation || '',
    'Émotion': b.emotion || '',
    'Pensées automatiques': b.automatic_thoughts || '',
    'Comportement': b.behavior || '',
    'Dérivatif proposé': b.coping_shown ? 'Oui' : 'Non',
  }))), 'Consommations');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly.map((r, i) => ({
    '#': i + 1,
    'Mois': r.mois,
    'Total cigarettes': r.total_cigarettes,
    'Total alcool (unités)': r.total_alcool,
    "Nombre d'entrées": r.nb_entrees,
  }))), 'Résumé mensuel');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coping.map((s, i) => ({
    '#': i + 1,
    'Titre': s.title,
    'Description': s.description || '',
    'Actif': s.active ? 'Oui' : 'Non',
    'Ajouté le': s.created_at.slice(0, 10),
  }))), 'Stratégies coping');

  const buf   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="suivi-conso-${today}.xlsx"`);
  res.send(buf);
});

app.listen(PORT, () => {
  console.log(`Suivi conso → http://localhost:${PORT}`);
  if (!PASSWORD) console.warn("⚠  APP_PASSWORD non défini — définissez la variable d'environnement");
});
