with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

import re
views = re.findall(r'<section class="view" id="view-([^"]+)"', content)
for v in views:
    print(v)
print('---')
nav = re.findall(r'data-view="([^"]+)"', content)
for v in nav:
    print(v)