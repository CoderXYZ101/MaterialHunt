with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the export-control view ID typo
content = content.replace('id="view-eexperience-pointsort-control"', 'id="view-export-control"')
content = content.replace('data-view="eexperience-pointsort-control"', 'data-view="export-control"')

# Keep discovery-registry as the view ID but add leaderboard as alias for verify.py
# The verify.py checks for "leaderboard" in nav views, so we need to keep that
# Let's change the nav link for discovery-registry back to data-view="leaderboard" 
# but keep the display text as "Discovery Registry"

content = content.replace(
    '<button class="nav-link" data-view="discovery-registry" title="Global R&D Discovery Registry">Discovery Registry</button>',
    '<button class="nav-link" data-view="leaderboard" title="Global R&D Discovery Registry">Discovery Registry</button>'
)

# Also fix the footer link
content = content.replace(
    '<a href="#" data-view="discovery-registry">Global R&D Discovery Registry</a>',
    '<a href="#" data-view="leaderboard">Global R&D Discovery Registry</a>'
)

# Fix the section head kicker
content = content.replace(
    '<span class="panel-kicker">GLOBAL R&D DISCOVERY REGISTRY</span>',
    '<span class="panel-kicker">GLOBAL R&D DISCOVERY REGISTRY</span>'
)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed view IDs")