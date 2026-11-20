import urllib.request, json
with urllib.request.urlopen('http://localhost:8000/api/labels') as r:
    data = json.load(r)
    with open('labels_output.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print('waiver_label:', repr(data.get('waiver_label')))
    print('leaderboard title:', repr(data.get('labels', {}).get('leaderboard', {}).get('title')))
    print('vip:', data.get('labels', {}).get('vip'))