with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# The HTML has "Global R&D Discovery Registry & Feedback" (with & not &, no ★, Registry not Leaderboard)
# The verify.py modules list has "Global R&D Discovery Leaderboard & 0\u20135\u2605 Feedback"
# We need to update the modules list to match the HTML

# Find and replace the specific line
old_line = '"Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",'
new_line = '"Global R&D Discovery Registry & Feedback",'

if old_line in content:
    content = content.replace(old_line, new_line)
    print("1. Updated modules list line")
else:
    print("1. Line not found")
    # Try alternative
    idx = content.find('Global R&D Discovery')
    if idx >= 0:
        print("Found at:", idx)
        print(content[idx:idx+100])

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")