with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix modules list - Global R&D Discovery Leaderboard -> Global R&D Discovery Registry
# Also fix the star character
old_modules = '''modules = (
        "3D Alloy & Mission Simulator",
        "Alloy A vs. B Comparative Analysis",
        "Multi-Material Pre-Screening & PDF",
        "Deep Engineering Analytics",
        "Enterprise Batch CSV & Custom Lab Data",
        "R&D ROI Calculator",
        "Global R&D Discovery Leaderboard & 0\u20135\u2605 Feedback",
        "Pricing, Corporate KYB & Compliance",
    )'''

new_modules = '''modules = (
        "3D Alloy & Mission Simulator",
        "Alloy A vs. B Comparative Analysis",
        "Multi-Material Pre-Screening & PDF",
        "Deep Engineering Analytics",
        "Enterprise Batch CSV & Custom Lab Data",
        "R&D ROI Calculator",
        "Global R&D Discovery Registry & Feedback",
        "Pricing, Corporate KYB & Compliance",
    )'''

if old_modules in content:
    content = content.replace(old_modules, new_modules)
    print("1. Updated modules list")
else:
    print("1. Modules list not found")

# 2. Fix nav regex to match hyphens
old_nav_regex = '''nav_views = re.findall(r'class="nav-link[^"]*" data-view="([a-z]+)"', html)'''

new_nav_regex = '''nav_views = re.findall(r'class="nav-link[^"]*" data-view="([a-z-]+)"', html)'''

if old_nav_regex in content:
    content = content.replace(old_nav_regex, new_nav_regex)
    print("2. Updated nav regex")
else:
    print("2. Nav regex not found")

# 3. Fix the waiver label check in the vault - the API returns "VIP GRANT" but we want "ENTERPRISE ACCESS GRANT"
# The issue is that the API still returns "VIP GRANT" in the waiver_label field
# We need to update the database.py to return "ENTERPRISE ACCESS GRANT" instead of "VIP GRANT"
# But that's already done. The issue might be that the minted pilot's waiver_label is from the database
# Let me check the mint-pilot endpoint

# 4. The vault mints pilot check - the API returns "VIP GRANT" in the waiver_label
# We need to update the database.py WAIVER_LABEL constant (already done)
# But the minted pilot might be using the old value

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done fixing verify.py")