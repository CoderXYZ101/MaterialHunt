with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix modules list - use exact match with HTML entities and double-escaped Unicode
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

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")