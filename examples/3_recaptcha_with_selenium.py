"""
Example 3: Solve reCAPTCHA using Selenium (real browser automation)
--------------------------------------------------------------------
Use this when you need a real browser (JavaScript-heavy sites).

Install: pip install selenium
Download chromedriver from: https://chromedriver.chromium.org/
"""
import sys
sys.path.append('..')

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from captchasolve import CaptchaSolver

API_KEY  = "YOUR_API_KEY_HERE"

# Start browser
driver = webdriver.Chrome()
driver.get("https://example.com/login")

# --- Find the sitekey from the page ---
# Option A: read from element attribute
try:
    recaptcha_el = driver.find_element(By.CLASS_NAME, "g-recaptcha")
    site_key = recaptcha_el.get_attribute("data-sitekey")
except:
    # Option B: grab from page source
    import re
    match = re.search(r'data-sitekey=["\'](.+?)["\']', driver.page_source)
    site_key = match.group(1)

print(f"Site key found: {site_key}")

# --- Solve via API ---
solver = CaptchaSolver(API_KEY)
print("Solving reCAPTCHA (worker solving now)...")
token = solver.recaptcha(site_key, driver.current_url)

# --- Inject the token into the page ---
driver.execute_script(
    f'document.getElementById("g-recaptcha-response").value = "{token}";'
)

# Also trigger the callback so the site knows it's solved
driver.execute_script("""
    try {
        var cb = Object.values(___grecaptcha_cfg.clients)[0];
        var fn = cb[Object.keys(cb).find(k => typeof cb[k] === 'function')];
        if (fn) fn(arguments[0]);
    } catch(e) {}
""", token)

# --- Fill in form and submit ---
driver.find_element(By.NAME, "username").send_keys("my_user")
driver.find_element(By.NAME, "password").send_keys("my_pass")
driver.find_element(By.CSS_SELECTOR, "button[type=submit]").click()

# Wait for page change
WebDriverWait(driver, 10).until(EC.url_changes(driver.current_url))
print(f"Done! Current page: {driver.current_url}")

driver.quit()
