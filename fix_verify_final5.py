with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix modules list - use exact match with HTML entities
old_modules = '''modules = (
        "3D Alloy & Mission Simulator",
        "Alloy A vs. B Comparative Analysis",
        "Multi-Material Pre-Screening & PDF",
        "Deep Engineering Analytics",
        "Enterprise Batch CSV & Custom Lab Data",
        "R&D ROI Calculator",
        "Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",
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
    idx = content.find('modules = (')
    if idx >= 0:
        print("Found at:", idx)
        print(content[idx:idx+500])

# 2. Fix the waiver label in the vault mint check - the API returns "VIP GRANT" but we need "ENTERPRISE ACCESS GRANT"
# The issue is that the minted pilot's waiver_label comes from the database which still has "VIP GRANT"
# We need to update the database.py but it's already updated. Let me check if there's a caching issue.

# 3. The vault mints pilot check - the API returns "VIP GRANT" in the waiver_label
# We need to update the database.py WAIVER_LABEL constant (already done)
# But the minted pilot might be using the old value from the database

# Let me also check the mint-pilot endpoint in main.py
# The mint-pilot endpoint creates a new user with billing_waived=True
# The waiver_label for the minted user comes from database.WAIVER_LABEL
# Since we updated database.py, it should be fine.

# But wait - the verify.py check for "vault mints an Enterprise Access pilot" checks:
# body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"
# But the API returns the user object with waiver_label from database.WAIVER_LABEL
# Since we updated database.py, it should return "ENTERPRISE ACCESS GRANT..."

# Let me check if the server was restarted after the database.py change

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")