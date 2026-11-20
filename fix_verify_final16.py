with open('verify.py', 'rb') as f:
    content_bytes = f.read()

# Construct the exact old bytes from hex
# Leaderboard & 0\u20135\u2605 Feedback",\r
# Hex: 4c6561646572626f6172642026616d703b20305c7532303133355c753236303520466565646261636b222c0d
old_bytes = bytes.fromhex('4c6561646572626f6172642026616d703b20305c7532303133355c753236303520466565646261636b222c0d')

# New: Registry & Feedback",\r
# "Registry & Feedback",\r
# 52 65 67 69 73 74 72 79 20 26 20 46 65 65 64 62 61 63 6b 22 2c 0d
new_bytes = bytes.fromhex('5265676973747279202620466565646261636b222c0d')

print("Old bytes:", old_bytes)
print("New bytes:", new_bytes)

if old_bytes in content_bytes:
    content_bytes = content_bytes.replace(old_bytes, new_bytes)
    print("Replaced in bytes!")
else:
    print("Not found in bytes")

with open('verify.py', 'wb') as f:
    f.write(content_bytes)

print("Done")