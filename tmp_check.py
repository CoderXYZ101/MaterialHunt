import re, sys, json

html = open('static/index.html', encoding='utf-8').read()
js = open('static/app.js', encoding='utf-8').read()
css = open('static/style.css', encoding='utf-8').read()

ids = set(re.findall(r'id="([^"]+)"', html))
used = set(re.findall(r"\$\('#([A-Za-z0-9_-]+)'\)", js))
used |= set(re.findall(r"\$\$\('#([A-Za-z0-9_-]+)", js))
used |= set(re.findall(r'getElementById\([\'"]([A-Za-z0-9_-]+)[\'"]\)', js))
missing = sorted(u for u in used if u not in ids)
print("MISSING IDS IN HTML:", missing)
print("html ids", len(ids), "used", len(used))

# data attributes usage
print("data-shape buttons:", html.count('data-shape='))
print("data-camera buttons:", html.count('data-camera='))

# brace balance quick
for fname, text in (('app.js', js), ('style.css', css)):
    print(fname, 'len', len(text), 'braces', text.count('{'), text.count('}'), 'parens', text.count('('), text.count(')'))

# check referenced new functions exist once
for fn in ['applyChallenge', 'runChallenge', 'bindExtraEvents', 'renderHandbook', 'renderRiskRadar',
           'challengeFromUrl', 'applyUrlFormula', 'autoOptimize', 'shareSpecLink', 'downloadSpec',
           'openPeriodic', 'preloadPeriodic', 'oauthLogin', 'showTour', 'copilotAsk']:
    print(fn, js.count('function ' + fn), js.count('async function ' + fn))
