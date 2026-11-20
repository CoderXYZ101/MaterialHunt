with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Search for Leaderboard
idx = content.find('Leaderboard')
if idx >= 0:
    print('FOUND Leaderboard at', idx)
    print(repr(content[max(0,idx-50):idx+100]))
else:
    print('Leaderboard NOT FOUND in HTML')

# Search for the star character
idx = content.find('★')
if idx >= 0:
    print('FOUND ★ at', idx)
    print(repr(content[max(0,idx-50):idx+100]))
else:
    print('★ NOT FOUND in HTML')

# Search for 0–5
idx = content.find('0–5')
if idx >= 0:
    print('FOUND 0–5 at', idx)
    print(repr(content[max(0,idx-50):idx+100]))
else:
    print('0–5 NOT FOUND in HTML')