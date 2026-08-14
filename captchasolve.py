"""
captchasolve.py — Super simple CAPTCHA solving client
Just drop this file in your project and use it in 2 lines.

INSTALL: no pip needed! Uses only Python built-ins (urllib).

USAGE:
    from captchasolve import CaptchaSolver
    solver = CaptchaSolver("YOUR_API_KEY")
    token  = solver.recaptcha("SITE_KEY", "https://target-site.com")
"""

import time
import json
import base64
import urllib.request
import urllib.parse


class CaptchaSolveError(Exception):
    pass


class CaptchaSolver:
    """
    Super simple client for CaptchaSolve API (also works with real 2captcha.com).

    Examples
    --------
    solver = CaptchaSolver("YOUR_KEY")                        # your local server
    solver = CaptchaSolver("YOUR_KEY", "https://2captcha.com")  # real 2captcha

    # reCAPTCHA v2
    token = solver.recaptcha("SITE_KEY", "https://example.com")

    # hCaptcha
    token = solver.hcaptcha("SITE_KEY", "https://example.com")

    # Image CAPTCHA (path to image file)
    text = solver.image("captcha.png")

    # Image CAPTCHA (already base64)
    text = solver.image_b64("iVBORw0KGgo...")
    """

    def __init__(self, api_key, api_url="http://localhost:3000", timeout=120, poll_interval=5):
        """
        api_key       : your API key
        api_url       : server URL (default: local server)
        timeout       : max seconds to wait for a solve (default 120)
        poll_interval : how often to poll in seconds (default 5)
        """
        self.key           = api_key
        self.url           = api_url.rstrip("/")
        self.timeout       = timeout
        self.poll_interval = poll_interval

    # ── Public methods ────────────────────────────────────────────────────────

    def recaptcha(self, site_key, page_url):
        """Solve reCAPTCHA v2. Returns the g-recaptcha-response token."""
        return self._solve("userrecaptcha", googlekey=site_key, pageurl=page_url)

    def recaptcha_v3(self, site_key, page_url, action="verify"):
        """Solve reCAPTCHA v3. Returns the token."""
        return self._solve("userrecaptcha", googlekey=site_key, pageurl=page_url,
                           version="v3", action=action, score=0.7)

    def hcaptcha(self, site_key, page_url):
        """Solve hCaptcha. Returns the h-captcha-response token."""
        return self._solve("hcaptcha", sitekey=site_key, pageurl=page_url)

    def turnstile(self, site_key, page_url):
        """Solve Cloudflare Turnstile. Returns the cf-turnstile-response token."""
        return self._solve("turnstile", sitekey=site_key, pageurl=page_url)

    def image(self, image_path):
        """Solve an image CAPTCHA from a file path. Returns the text answer."""
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        return self.image_b64(b64)

    def image_b64(self, base64_image):
        """Solve an image CAPTCHA from a base64 string. Returns the text answer."""
        return self._solve("base64", body=base64_image)

    def balance(self):
        """Check your account balance."""
        result = self._get(f"/res.php?key={self.key}&action=getbalance")
        try:
            return float(result)
        except ValueError:
            raise CaptchaSolveError(f"Balance check failed: {result}")

    def report_bad(self, task_id):
        """Report a wrong answer to get a refund."""
        self._get(f"/res.php?key={self.key}&action=reportbad&id={task_id}")

    # ── Internal ──────────────────────────────────────────────────────────────

    def _solve(self, method, **params):
        """Submit task and poll until solved."""
        task_id = self._submit(method, **params)
        return self._poll(task_id)

    def _submit(self, method, **params):
        """POST to /in.php and return the task ID."""
        data = {"key": self.key, "method": method, **params}
        result = self._post("/in.php", data)

        if result.startswith("OK|"):
            task_id = result[3:]
            print(f"  ⏳ Task submitted (ID: {task_id})")
            return task_id

        # Map server error codes to friendly messages
        errors = {
            "ERROR_WRONG_USER_KEY":      "Invalid API key — check your key",
            "ERROR_ZERO_BALANCE":        "Balance is zero — top up your account",
            "ERROR_NO_SLOT_AVAILABLE":   "Missing required parameter",
            "ERROR_WRONG_CAPTCHA_ID":    "Unknown CAPTCHA method",
        }
        raise CaptchaSolveError(errors.get(result, f"Submit failed: {result}"))

    def _poll(self, task_id):
        """Poll /res.php until done or timeout."""
        deadline = time.time() + self.timeout
        attempts = 0

        while time.time() < deadline:
            time.sleep(self.poll_interval)
            attempts += 1
            result = self._get(f"/res.php?key={self.key}&action=get&id={task_id}")

            if result.startswith("OK|"):
                token = result[3:]
                print(f"  ✅ Solved in ~{attempts * self.poll_interval}s!")
                return token

            if result == "CAPCHA_NOT_READY":
                print(f"  ⏳ Waiting... ({attempts * self.poll_interval}s)")
                continue

            if result == "ERROR_CAPTCHA_UNSOLVABLE":
                raise CaptchaSolveError("Worker couldn't solve it — try again")

            raise CaptchaSolveError(f"Poll error: {result}")

        raise CaptchaSolveError(f"Timeout after {self.timeout}s — no worker available?")

    def _post(self, path, data):
        """HTTP POST helper using only built-in urllib."""
        body    = urllib.parse.urlencode(data).encode()
        request = urllib.request.Request(self.url + path, data=body, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as resp:
                return resp.read().decode().strip()
        except Exception as e:
            raise CaptchaSolveError(f"Network error: {e}")

    def _get(self, path):
        """HTTP GET helper using only built-in urllib."""
        try:
            with urllib.request.urlopen(self.url + path, timeout=30) as resp:
                return resp.read().decode().strip()
        except Exception as e:
            raise CaptchaSolveError(f"Network error: {e}")


# ── Quick CLI test ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    print("CaptchaSolve Client — Quick Test")
    print("=" * 40)

    api_key = input("Enter your API key: ").strip()
    solver  = CaptchaSolver(api_key)

    print("\nChecking balance...")
    try:
        bal = solver.balance()
        print(f"✅ Connected! Balance: ${bal:.4f}")
    except CaptchaSolveError as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

    print("\nWhat to test?")
    print("  1. Image CAPTCHA (from file)")
    print("  2. reCAPTCHA v2")
    choice = input("Choice (1/2): ").strip()

    if choice == "1":
        path = input("Image file path: ").strip()
        print("\nSolving...")
        answer = solver.image(path)
        print(f"\n🎉 Answer: {answer}")

    elif choice == "2":
        sitekey = input("Site key: ").strip()
        pageurl = input("Page URL: ").strip()
        print("\nSolving...")
        token = solver.recaptcha(sitekey, pageurl)
        print(f"\n🎉 Token: {token[:60]}...")
