with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# The exact line in verify.py has HTML entities and double-escaped Unicode
old_line = '"Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",'
new_line = '"Global R&D Discovery Registry & Feedback",'

if old_line in content:
    content = content.replace(old_line, new_line)
    print("1. Updated modules list line")
else:
    print("1. Line not found")
    idx = content.find('Leaderboard')
    if idx >= 0:
        print("Found at:", idx)
        print(repr(content[max(0,idx-50):idx+100]))

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")