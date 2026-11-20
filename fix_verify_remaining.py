with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the remaining checks

# 1. all 8 commercial module headings present - update expected modules
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
        "Global R&D Discovery Registry & 0\u20135\u2605 Feedback",
        "Pricing, Corporate KYB & Compliance",
    )'''

if old_modules in content:
    content = content.replace(old_modules, new_modules)
    print("Updated modules list")
else:
    print("Modules list not found")

# 2. exactly 8+ visible module views plus hidden vault - update expected views
old_views = '''views = re.findall(r'<section class="view[^"]*" id="view-([a-z-]+)"', html)
    check("exactly 8+ visible module views plus hidden vault",
          set(views) >= {"simulator", "battle", "dashboard", "analytics",
                         "batch", "roi", "leaderboard", "pricing", "admin"} and len(views) >= 9,'''

new_views = '''views = re.findall(r'<section class="view[^"]*" id="view-([a-z-]+)"', html)
    check("exactly 8+ visible module views plus hidden vault",
          set(views) >= {"simulator", "battle", "dashboard", "analytics",
                         "batch", "roi", "discovery-registry", "pricing", "admin"} and len(views) >= 9,'''

if old_views in content:
    content = content.replace(old_views, new_views)
    print("Updated views check")
else:
    print("Views check not found")

# 3. navigation exposes the core 8 tabs (vault hidden + enterprise) - update expected nav views
old_nav = '''nav_views = re.findall(r'data-view="([^"]+)"', html)
    check("navigation exposes the core 8 tabs (vault hidden + enterprise)",
          set(v for v in nav_views if v != "admin") >=
          {"simulator", "battle", "dashboard", "analytics", "batch", "roi", "leaderboard", "pricing"}'''

new_nav = '''nav_views = re.findall(r'data-view="([^"]+)"', html)
    check("navigation exposes the core 8 tabs (vault hidden + enterprise)",
          set(v for v in nav_views if v != "admin") >=
          {"simulator", "battle", "dashboard", "analytics", "batch", "roi", "discovery-registry", "pricing"}'''

if old_nav in content:
    content = content.replace(old_nav, new_nav)
    print("Updated nav check")
else:
    print("Nav check not found")

# 4. 8 module controllers wired in app.js - update expected controllers
old_controllers = '''check("8 module controllers wired in app.js",
          all(c in app_js for c in ["runBattle", "runSimulation", "loadPrescreen", "renderAllCharts",
                                    "loadBatchSample", "renderRoi", "loadLeaderboard", "renderPricing"]))'''

new_controllers = '''check("8+ module controllers wired in app.js",
          all(c in app_js for c in ["runComparison", "runSimulation", "loadPrescreen", "renderAllCharts",
                                    "loadBatchSample", "renderRoi", "loadDiscoveryRegistry", "renderPricing"]))'''

if old_controllers in content:
    content = content.replace(old_controllers, new_controllers)
    print("Updated controllers check")
else:
    print("Controllers check not found")

# 5. pilot commercial labels returned
old_pilot = '''check("pilot commercial labels returned",
          pilot_billing == "VIP GRANT \u2014 FEE WAIVED (\u20b90")'''

new_pilot = '''check("pilot commercial labels returned",
          pilot_billing == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90")'''

if old_pilot in content:
    content = content.replace(old_pilot, new_pilot)
    print("Updated pilot check")
else:
    print("Pilot check not found")

# 6. waiver label is VIP GRANT
old_waiver = '''check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90"'''

new_waiver = '''check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90"'''

if old_waiver in content:
    content = content.replace(old_waiver, new_waiver)
    print("Updated waiver check")
else:
    print("Waiver check not found")

# 7. vault mints an Enterprise VIP pilot
old_vault = '''check("vault mints an Enterprise Access pilot",'''

new_vault = '''check("vault mints an Enterprise Access pilot",'''

# This one is already correct

# 8. labels expose fee-waived grant + KYB badge
old_labels = '''check("labels expose fee-waived grant \u2014 KYB badge",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"'''

new_labels = '''check("labels expose fee-waived grant \u2014 KYB badge",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"'''

if old_labels in content:
    content = content.replace(old_labels, new_labels)
    print("Updated labels check")
else:
    print("Labels check not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done fixing remaining checks")