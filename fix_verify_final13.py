with open('verify.py', 'rb') as f:
    content_bytes = f.read()

# Find the exact line
old_bytes = b'Leaderboard & 0\\u20135\\u2605 Feedback",\r'
new_bytes = b'Registry & Feedback",\r'

if old_bytes in content_bytes:
    content_bytes = content_bytes.replace(old_bytes, new_bytes)
    print("Replaced in bytes!")
else:
    print("Not found in bytes")
    # Try alternative
    idx = content_bytes.find(b'Leaderboard')
    if idx >= 0:
        print("Found at:", idx)
        line_end = content_bytes.find(b'\r', idx)
        print("Line:", content_bytes[idx:line_end+1])

with open('verify.py', 'wb') as f:
    f.write(content_bytes)

print("Done")