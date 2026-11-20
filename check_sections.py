with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

import re
sections = re.findall(r'<section class="view"[^>]*id="view-([^"]+)"[^>]*>.*?<h2[^>]*>(.*?)</h2>', content, re.DOTALL)
for v_id, h2 in sections:
    h2_clean = re.sub(r'<[^>]+>', '', h2).strip()
    print(f'{v_id}: {h2_clean[:80].encode("ascii", "replace").decode()}')