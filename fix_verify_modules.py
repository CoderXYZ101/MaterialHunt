with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# The file has HTML entities - replace the specific line
old = '"Global R&D Discovery Leaderboard & 0\u20135\u2605 Feedback",'
new = '"Global R&D Discovery Registry & 0\u20135\u2605 Feedback",'

if old in content:
    content = content.replace(old, new)
    with open('verify.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Modules updated")
else:
    print("OLD STRING NOT FOUND")
    idx = content.find('Global R&D Discovery')
    if idx >= 0:
        print("Found at:", idx)
        print(content[idx:idx+100])