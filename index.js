// index.js — Main server: Express + Socket.io + SQLite
const express   = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const cors      = require('cors');
const db        = require('./db');
const apiRoutes    = require('./routes/api');
const workerRoutes = require('./routes/worker');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Make io available in route handlers
app.set('io', io);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/',           apiRoutes);
app.use('/worker-api', workerRoutes);

app.get('/worker', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'worker', 'index.html')));
app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.get('/guide', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'guide.html')));
app.get('/test', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'test.html')));

// ── Track connected workers { socketId → { workerId, username } } ─────────────
const online = new Map();
app.set('online', online); // expose to route handlers for relay-token

// ── Helpers ───────────────────────────────────────────────────────────────────
function liveStats() {
  return {
    pending:  db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='pending'").get().c,
    assigned: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='assigned'").get().c,
    done:     db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='done'").get().c,
    failed:   db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status='failed'").get().c,
    online:   online.size,
  };
}

function pushTask(socket, workerId) {
  const task = db.prepare(
    "SELECT * FROM tasks WHERE status='pending' ORDER BY created_at ASC LIMIT 1"
  ).get();

  if (!task) {
    socket.emit('worker:idle');
    return;
  }

  db.prepare("UPDATE tasks SET status='assigned', worker_id=? WHERE id=?")
    .run(workerId, task.id);

  socket.emit('worker:task', {
    id:   task.id,
    type: task.type,
    data: JSON.parse(task.data),
  });
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  // ── Worker connects ──────────────────────────────────────────────────────
  socket.on('worker:join', ({ workerId, username }) => {
    online.set(socket.id, { workerId, username });
    socket.join('workers');
    pushTask(socket, workerId);
    io.to('admin').emit('stats', liveStats());
  });

  // Worker explicitly requests next task
  socket.on('worker:ready', () => {
    const w = online.get(socket.id);
    if (w) pushTask(socket, w.workerId);
  });

  // Worker submits solution
  socket.on('worker:solution', ({ taskId, solution }) => {
    const w = online.get(socket.id);
    if (!w) return;

    const task = db.prepare("SELECT * FROM tasks WHERE id=? AND status='assigned'").get(taskId);
    if (!task) {
      socket.emit('worker:error', 'Task not found or already closed');
      return;
    }

    // Save solution
    db.prepare(`
      UPDATE tasks SET status='done', solution=?, worker_id=?, solved_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(solution, w.workerId, taskId);

    // Credit worker $0.001 per solve
    db.prepare('UPDATE workers SET balance = balance + 0.001, solved_count = solved_count + 1 WHERE id=?')
      .run(w.workerId);

    // Charge client $0.002 per solve
    db.prepare('UPDATE api_keys SET balance = balance - 0.002 WHERE id=(SELECT api_key_id FROM tasks WHERE id=?)')
      .run(taskId);

    const updated = db.prepare('SELECT balance, solved_count FROM workers WHERE id=?').get(w.workerId);
    socket.emit('worker:credited', { taskId, balance: updated.balance, solved: updated.solved_count });

    // Auto-push next task immediately
    pushTask(socket, w.workerId);
    io.to('admin').emit('stats', liveStats());
  });

  // Worker marks task as unsolvable
  socket.on('worker:skip', ({ taskId }) => {
    db.prepare("UPDATE tasks SET status='failed', worker_id=NULL WHERE id=?").run(taskId);
    const w = online.get(socket.id);
    if (w) pushTask(socket, w.workerId);
  });

  // Admin joins live dashboard
  socket.on('admin:join', () => {
    socket.join('admin');
    socket.emit('stats', liveStats());
  });

  // A new task was submitted via REST — wake idle workers
  socket.on('new_task_available', () => {
    for (const [sid, w] of online) {
      pushTask(io.sockets.sockets.get(sid), w.workerId);
      break; // only wake one idle worker
    }
  });

  // Disconnect — release any assigned tasks back to pending
  socket.on('disconnect', () => {
    const w = online.get(socket.id);
    if (w) {
      db.prepare("UPDATE tasks SET status='pending', worker_id=NULL WHERE status='assigned' AND worker_id=?")
        .run(w.workerId);
      online.delete(socket.id);
      io.to('admin').emit('stats', liveStats());
    }
  });
});

// Also wake idle workers when REST API submits a task
app.use((req, _res, next) => {
  req.app.set('wakeWorkers', () => {
    for (const [sid, w] of online) {
      pushTask(io.sockets.sockets.get(sid), w.workerId);
      break;
    }
  });
  next();
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n✅  Captcha Solver running on http://localhost:${PORT}`);
  console.log(`    Worker Dashboard → http://localhost:${PORT}/worker`);
  console.log(`    Admin Panel      → http://localhost:${PORT}/admin`);
  console.log(`    API Docs         → http://localhost:${PORT}/\n`);
});
