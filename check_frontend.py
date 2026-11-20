with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Check for nav links
import re
nav_links = re.findall(r'data-view="([^"]+)"', content)
print('Nav links:')
for link in nav_links:
    print(f'  {link}')

# Check for module headings in HTML
print()
print('Module headings in HTML:')
for term in ['Global R&D Discovery Leaderboard', 'Global R&D Discovery Registry', 'Leaderboard', 'Discovery Registry']:
    idx = content.find(term)
    if idx >= 0:
        print(f'  FOUND: {term} at {idx}')
        print(f'    Context: ...{content[max(0,idx-50):idx+100]}...')
    else:
        print(f'  NOT FOUND: {term}')