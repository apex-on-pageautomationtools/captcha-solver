// routes/api.js — 2captcha-compatible REST API
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');  // built-in — no install needed
const db      = require('../db');

function validateKey(key) {
  return db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);
}

function newTaskId() {
  return crypto.randomBytes(10).toString('hex');  // 20-char hex ID
}

// ── POST /in.php — Submit a CAPTCHA task ─────────────────────────────────────
router.post('/in.php', (req, res) => {
  const { key, method, body, googlekey, sitekey, pageurl } = req.body;

  if (!key)                return res.send('ERROR_WRONG_USER_KEY');
  const apiKey = validateKey(key);
  if (!apiKey)             return res.send('ERROR_WRONG_USER_KEY');
  if (apiKey.balance <= 0) return res.send('ERROR_ZERO_BALANCE');

  let type, data;

  if (!method || method === 'base64' || method === 'post') {
    if (!body) return res.send('ERROR_NO_SLOT_AVAILABLE');
    type = 'image';
    data = { image: body };
  } else if (method === 'userrecaptcha' || method === 'recaptcha') {
    if (!pageurl || !(googlekey || sitekey)) return res.send('ERROR_NO_SLOT_AVAILABLE');
    type = 'recaptcha';
    data = { siteKey: googlekey || sitekey, pageUrl: pageurl };
  } else if (method === 'hcaptcha') {
    type = 'hcaptcha';
    data = { siteKey: googlekey || sitekey, pageUrl: pageurl };
  } else if (method === 'turnstile') {
    type = 'turnstile';
    data = { siteKey: googlekey || sitekey, pageUrl: pageurl };
  } else if (method === 'audio') {
    // audio — either a URL or base64-encoded audio data
    const audioUrl  = req.body.audiourl  || req.body.audio_url;
    const audioData = req.body.audiodata || body;
    if (!audioUrl && !audioData) return res.send('ERROR_NO_SLOT_AVAILABLE');
    type = 'audio';
    data = audioUrl ? { audioUrl } : { audioData };
  } else {
    return res.send('ERROR_WRONG_CAPTCHA_ID');
  }

  const taskId = newTaskId();
  db.prepare(`
    INSERT INTO tasks (id, type, data, status, api_key_id)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(taskId, type, JSON.stringify(data), apiKey.id);

  // Notify any idle workers that a new task is available
  req.app.get('io').emit('new_task_available');

  res.send(`OK|${taskId}`);
});

// ── GET /res.php — Poll result / get balance / report bad ────────────────────
router.get('/res.php', (req, res) => {
  const { key, action, id } = req.query;

  if (!key) return res.send('ERROR_WRONG_USER_KEY');
  const apiKey = validateKey(key);
  if (!apiKey) return res.send('ERROR_WRONG_USER_KEY');

  // Balance check
  if (action === 'getbalance') {
    return res.send(String(apiKey.balance.toFixed(4)));
  }

  // Report wrong answer → refund
  if (action === 'reportbad' && id) {
    db.prepare("UPDATE tasks SET status='reported' WHERE id = ? AND api_key_id = ?")
      .run(id, apiKey.id);
    db.prepare('UPDATE api_keys SET balance = balance + 0.002 WHERE id = ?')
      .run(apiKey.id);
    return res.send('OK_REPORT_RECORDED');
  }

  // Poll result
  if (!id) return res.send('ERROR_NO_SLOT_AVAILABLE');
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND api_key_id = ?').get(id, apiKey.id);
  if (!task) return res.send('ERROR_WRONG_ID_FORMAT');

  if (task.status === 'pending' || task.status === 'assigned') return res.send('CAPCHA_NOT_READY');
  if (task.status === 'done')   return res.send(`OK|${task.solution}`);
  if (task.status === 'failed' || task.status === 'reported') return res.send('ERROR_CAPTCHA_UNSOLVABLE');

  res.send('ERROR_WRONG_CAPTCHA_ID');
});

module.exports = router;
