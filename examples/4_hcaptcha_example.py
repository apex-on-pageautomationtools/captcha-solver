"""
Example 4: Solve hCaptcha (used on Discord, Cloudflare sites)
--------------------------------------------------------------
Same pattern as reCAPTCHA — inject h-captcha-response instead.
"""
import sys
sys.path.append('..')

import requests
from captchasolve import CaptchaSolver

API_KEY  = "YOUR_API_KEY_HERE"
SITE_KEY = "a5f74b19-9e45-40e0-b45d-47ff91b7a6dd"   # from page HTML data-sitekey
PAGE_URL = "https://discord.com/register"

solver = CaptchaSolver(API_KEY)

print("Solving hCaptcha...")
token = solver.hcaptcha(SITE_KEY, PAGE_URL)
print(f"Token: {token[:50]}...")

# Submit form with token
response = requests.post(PAGE_URL, json={
    "username":          "my_user",
    "email":             "user@email.com",
    "password":          "mypassword",
    "h-captcha-response": token,   # ← inject here (some sites use captcha_token)
})
print(f"Status: {response.status_code}")
