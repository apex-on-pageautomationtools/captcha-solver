"""
Example 2: Solve reCAPTCHA v2 and submit a form
-------------------------------------------------
Use this when a login/signup form has a reCAPTCHA checkbox.
No browser needed — pure Python with requests.
"""
import sys
sys.path.append('..')

import requests
from captchasolve import CaptchaSolver

API_KEY  = "YOUR_API_KEY_HERE"
SITE_KEY = "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-"   # from the page HTML
PAGE_URL = "https://example.com/login"

solver = CaptchaSolver(API_KEY)

# Step 1: Solve the CAPTCHA (worker does this in their browser)
print("Solving reCAPTCHA...")
token = solver.recaptcha(SITE_KEY, PAGE_URL)

# Step 2: Submit the form with the token
session = requests.Session()
response = session.post(PAGE_URL, data={
    "username": "my_user",
    "password": "my_pass",
    "g-recaptcha-response": token,   # ← inject token here
})

print(f"Status: {response.status_code}")
print(f"Logged in: {'dashboard' in response.text}")
