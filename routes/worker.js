// routes/worker.js — Worker auth + admin REST endpoints
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + ':captcha_salt_v1').digest('hex');
}

// ── Worker: Register ──────────────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)  return res.json({ error: 'Username and password required' });
  if (username.length < 3)     return res.json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6)     return res.json({ error: 'Password must be at least 6 characters' });

  try {
    const r = db.prepare('INSERT INTO workers (username, password_hash) VALUES (?, ?)').run(username, hashPw(password));
    const w = db.prepare('SELECT id, username, balance, solved_count FROM workers WHERE id = ?').get(r.lastInsertRowid);
    res.json({ success: true, worker: w });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ error: 'Username already taken' });
    res.json({ error: 'Registration failed' });
  }
});

// ── Worker: Login ─────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  const w = db.prepare(
    'SELECT id, username, balance, solved_count FROM workers WHERE username = ? AND password_hash = ?'
  ).get(username, hashPw(password));

  if (!w) return res.json({ error: 'Invalid credentials' });
  res.json({ success: true, worker: w });
});

// ── Worker: Stats ─────────────────────────────────────────────────────────────
router.get('/stats/:id', (req, res) => {
  const w = db.prepare('SELECT id, username, balance, solved_count FROM workers WHERE id = ?').get(req.params.id);
  if (!w) return res.json({ error: 'Not found' });
  res.json(w);
});

// ════════════════════════════════════════════════════════════════════════════════
//  Admin routes (no auth for MVP — protect with nginx/reverse proxy in prod)
// ════════════════════════════════════════════════════════════════════════════════

// List API keys
router.get('/admin/keys', (_req, res) => {
  res.json(db.prepare('SELECT id, key, label, balance, created_at FROM api_keys ORDER BY created_at DESC').all());
});

// Create API key
router.post('/admin/keys', (req, res) => {
  const { label, balance } = req.body;
  const key = 'cap_' + crypto.randomBytes(20).toString('hex');
  db.prepare('INSERT INTO api_keys (key, label, balance) VALUES (?, ?, ?)').run(key, label || 'New Key', balance || 10.0);
  res.json({ success: true, key });
});

// Update balance
router.patch('/admin/keys/:id', (req, res) => {
  db.prepare('UPDATE api_keys SET balance = ? WHERE id = ?').run(req.body.balance, req.params.id);
  res.json({ success: true });
});

// Delete key
router.delete('/admin/keys/:id', (req, res) => {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// List workers
router.get('/admin/workers', (_req, res) => {
  res.json(db.prepare('SELECT id, username, balance, solved_count, created_at FROM workers ORDER BY solved_count DESC').all());
});

// System stats
router.get('/admin/stats', (_req, res) => {
  res.json({
    tasks: {
      pending:  db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='pending'").get().c,
      assigned: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='assigned'").get().c,
      done:     db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='done'").get().c,
      failed:   db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='failed'").get().c,
      reported: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='reported'").get().c,
    },
    workers:      db.prepare('SELECT COUNT(*) AS c FROM workers').get().c,
    api_keys:     db.prepare('SELECT COUNT(*) AS c FROM api_keys').get().c,
    total_earned: db.prepare("SELECT COALESCE(SUM(0.001),0) AS s FROM tasks WHERE status='done'").get().s,
  });
});

// ── Worker: Relay token from bookmarklet (called from external site) ──────────
router.post('/relay-token', (req, res) => {
  // Allow cross-origin so bookmarklet running on any site can POST here
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  const { workerId, token } = req.body;
  if (!workerId || !token) return res.json({ error: 'workerId and token required' });

  const wid = parseInt(workerId);
  const task = db.prepare(
    "SELECT * FROM tasks WHERE status='assigned' AND worker_id=? ORDER BY created_at DESC LIMIT 1"
  ).get(wid);

  if (!task) return res.json({ error: 'No active task assigned to this worker. Make sure you have a task open in your dashboard.' });

  // Mark task solved
  db.prepare(
    "UPDATE tasks SET status='done', solution=?, solved_at=CURRENT_TIMESTAMP WHERE id=?"
  ).run(token, task.id);

  // Credit worker $0.001
  db.prepare('UPDATE workers SET balance=balance+0.001, solved_count=solved_count+1 WHERE id=?').run(wid);

  // Charge client $0.002
  db.prepare('UPDATE api_keys SET balance=balance-0.002 WHERE id=(SELECT api_key_id FROM tasks WHERE id=?)').run(task.id);

  const updated = db.prepare('SELECT balance, solved_count FROM workers WHERE id=?').get(wid);

  // Notify worker's socket — credit + push next task
  const io     = req.app.get('io');
  const online = req.app.get('online');
  for (const [sid, w] of online) {
    if (w.workerId === wid) {
      const socket = io.sockets.sockets.get(sid);
      if (socket) {
        socket.emit('worker:credited', { taskId: task.id, balance: updated.balance, solved: updated.solved_count });
        // Push next pending task immediately
        const next = db.prepare("SELECT * FROM tasks WHERE status='pending' ORDER BY created_at ASC LIMIT 1").get();
        if (next) {
          db.prepare("UPDATE tasks SET status='assigned', worker_id=? WHERE id=?").run(wid, next.id);
          socket.emit('worker:task', { id: next.id, type: next.type, data: JSON.parse(next.data) });
        } else {
          socket.emit('worker:idle');
        }
      }
      break;
    }
  }

  // Also broadcast updated stats to admin
  req.app.get('io').to('admin').emit('stats', {
    pending:  db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='pending'").get().c,
    assigned: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='assigned'").get().c,
    done:     db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='done'").get().c,
    failed:   db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='failed'").get().c,
    online:   online.size,
  });

  res.json({ ok: true, message: '✓ Token accepted! Task marked as solved.' });
});

// OPTIONS preflight for bookmarklet CORS
router.options('/relay-token', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// ── Recent tasks (last 60)
router.get('/admin/tasks', (_req, res) => {
  res.json(db.prepare(`
    SELECT t.id, t.type, t.status, t.created_at, t.solved_at,
           a.label AS client, w.username AS worker
    FROM tasks t
    LEFT JOIN api_keys a ON t.api_key_id = a.id
    LEFT JOIN workers  w ON t.worker_id  = w.id
    ORDER BY t.created_at DESC LIMIT 60
  `).all());
});

module.exports = router;
