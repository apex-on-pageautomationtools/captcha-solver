# ⚡ CaptchaSolve — Self-Hosted CAPTCHA Solving Service

A fully **free, open-source** clone of 2captcha with a **2captcha-compatible REST API**.

**Stack:** Node.js · Express · Socket.io · SQLite (better-sqlite3) · Vanilla JS

---

## Quick Start

```bash
cd captcha-solver
npm install
npm start
```

Then open:
- **API Docs / Landing:** http://localhost:3000
- **Worker Dashboard:** http://localhost:3000/worker
- **Admin Panel:** http://localhost:3000/admin

Your first API key is printed in the terminal on first run — save it!

---

## How It Works

1. **Client** POSTs CAPTCHA to `/in.php` → gets a `task_id`
2. **Server** stores task in SQLite, pushes to online workers via WebSocket
3. **Worker** sees CAPTCHA in their dashboard, solves it, submits answer
4. **Client** polls `GET /res.php?id=TASK_ID` every 5s → gets `OK|ANSWER`

---

## API Reference

### Submit Task — POST /in.php

| Param | Required | Description |
|-------|----------|-------------|
| `key` | ✅ | Your API key |
| `method` | | `base64` / `userrecaptcha` / `hcaptcha` / `turnstile` |
| `body` | ✅ (image) | Base64-encoded image |
| `googlekey` | ✅ (token) | Site key |
| `pageurl` | ✅ (token) | Target page URL |

**Response:** `OK|TASK_ID` or `ERROR_*`

### Poll Result — GET /res.php

| Param | Description |
|-------|-------------|
| `key` | Your API key |
| `action` | `get` / `getbalance` / `reportbad` |
| `id` | Task ID from /in.php |

**Response:** `CAPCHA_NOT_READY` → keep polling · `OK|TOKEN` → done!

---

## Python Client Example

```python
import requests, time

API = "http://localhost:3000"
KEY = "your_api_key_here"

def solve_image_captcha(base64_image):
    # Submit
    r = requests.post(f"{API}/in.php", data={
        "key": KEY, "method": "base64", "body": base64_image
    })
    if not r.text.startswith("OK"):
        raise Exception(f"Submit failed: {r.text}")
    task_id = r.text.split("|")[1]
    
    # Poll
    for _ in range(24):  # up to 2 minutes
        time.sleep(5)
        r = requests.get(f"{API}/res.php", params={
            "key": KEY, "action": "get", "id": task_id
        })
        if r.text.startswith("OK"):
            return r.text.split("|")[1]
        if r.text.startswith("ERROR"):
            raise Exception(r.text)
    raise TimeoutError("Not solved in time")

# Usage
answer = solve_image_captcha(open("captcha.png", "rb").read())
print(f"Answer: {answer}")
```

---

## Pricing Model (configurable)

| Action | Amount |
|--------|--------|
| Client charged per solve | $0.002 |
| Worker earns per solve | $0.001 |
| Server margin | $0.001 |
| Bad answer refund | $0.002 |

Adjust in `index.js` — search for `0.001` and `0.002`.

---

## Production Deployment

1. Use **PM2** to keep it running: `pm2 start index.js --name captcha-solver`
2. Put **nginx** in front for HTTPS + rate limiting
3. Set `PORT` env var: `PORT=8080 node index.js`
4. The SQLite DB (`captcha.db`) is created automatically in the project root

---

## Error Codes

| Code | Meaning |
|------|---------|
| `ERROR_WRONG_USER_KEY` | API key missing or invalid |
| `ERROR_ZERO_BALANCE` | Client balance depleted |
| `ERROR_NO_SLOT_AVAILABLE` | Required param missing |
| `CAPCHA_NOT_READY` | Still being solved — keep polling |
| `ERROR_CAPTCHA_UNSOLVABLE` | Worker couldn't solve it |
| `ERROR_WRONG_ID_FORMAT` | Task ID not found |
