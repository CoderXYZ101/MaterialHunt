with open('verify.py', 'rb') as f:
    content_bytes = f.read()

# The exact line has & (HTML entity for &)
old_bytes = b'Leaderboard & 0\\u20135\\u2605 Feedback",\r'
new_bytes = b'Registry & Feedback",\r'

if old_bytes in content_bytes:
    content_bytes = content_bytes.replace(old_bytes, new_bytes)
    print("Replaced in bytes!")
else:
    print("Not found in bytes")

with open('verify.py', 'wb') as f:
    f.write(content_bytes)

print("Done")