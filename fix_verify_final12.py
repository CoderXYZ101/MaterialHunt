with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# The exact line in the file has HTML entities (&) and the Unicode escape sequences
old_line = '        "Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",'
# But in the file it's actually:
# '        "Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",'
# Wait, the output shows: '        "Global R&D Discovery Leaderboard & 0\u20135\u2605 Feedback",'
# The & is & in the source but & in HTML

# Let me use the exact line from the modules section output
old_line_exact = '        "Global R&D Discovery Leaderboard & 0\u20135\u2605 Feedback",'

# But in the file, the \u2013 and \u2605 are actual Unicode characters or escape sequences
# Let me read the file as bytes to see the exact content

with open('verify.py', 'rb') as f:
    content_bytes = f.read()

# Find the line in bytes
idx = content_bytes.find(b'Global R&D Discovery Leaderboard')
if idx >= 0:
    line_end = content_bytes.find(b'\n', idx)
    line_bytes = content_bytes[idx:line_end]
    print("Line bytes:", line_bytes)
    print("Line repr:", repr(line_bytes.decode('utf-8')))
    
    # Now replace in the string content
    old_str = line_bytes.decode('utf-8')
    new_str = '        "Global R&D Discovery Registry & Feedback",'
    content = content.replace(old_str, new_str)
    print("Replaced!")
else:
    print("Not found in bytes")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")