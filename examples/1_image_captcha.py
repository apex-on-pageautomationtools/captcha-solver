"""
Example 1: Solve a simple image CAPTCHA
----------------------------------------
Use this when a site shows a distorted text image you have to type.
"""
import sys
sys.path.append('..')

from captchasolve import CaptchaSolver

solver = CaptchaSolver("YOUR_API_KEY_HERE")

# From a file
answer = solver.image("captcha.png")
print(f"Answer: {answer}")

# From base64 string (if you downloaded the image with requests)
# import requests, base64
# img_bytes = requests.get("https://example.com/captcha.png").content
# b64 = base64.b64encode(img_bytes).decode()
# answer = solver.image_b64(b64)
