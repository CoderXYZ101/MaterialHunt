with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix modules list - Global R&D Discovery Leaderboard -> Global R&D Discovery Registry
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
    print("1. Updated modules list")
else:
    print("1. Modules list not found")

# 2. Fix views check - leaderboard -> discovery-registry
old_views = '''check("exactly 8+ visible module views plus hidden vault",
          set(views) >= {"simulator", "battle", "dashboard", "analytics", "batch", "roi",
                         "leaderboard", "pricing", "admin"} and len(views) >= 9,'''

new_views = '''check("exactly 8+ visible module views plus hidden vault",
          set(views) >= {"simulator", "battle", "dashboard", "analytics", "batch", "roi",
                         "discovery-registry", "pricing", "admin"} and len(views) >= 9,'''

if old_views in content:
    content = content.replace(old_views, new_views)
    print("2. Updated views check")
else:
    print("2. Views check not found")

# 3. Fix nav check - leaderboard -> discovery-registry
old_nav = '''check("navigation exposes the core 8 tabs (vault hidden + enterprise)",
          set(v for v in nav_views if v != "admin") >=
          {"simulator", "battle", "dashboard", "analytics", "batch", "roi", "leaderboard", "pricing"}'''

new_nav = '''check("navigation exposes the core 8 tabs (vault hidden + enterprise)",
          set(v for v in nav_views if v != "admin") >=
          {"simulator", "battle", "dashboard", "analytics", "batch", "roi", "discovery-registry", "pricing"}'''

if old_nav in content:
    content = content.replace(old_nav, new_nav)
    print("3. Updated nav check")
else:
    print("3. Nav check not found")

# 4. Fix controllers check - runBattle -> runComparison, loadLeaderboard -> loadDiscoveryRegistry
old_controllers = '''check("8 module controllers wired in app.js",
          all(symbol in (STATIC_DIR / "app.js").read_text(encoding="utf-8") for symbol in (
              "runMissionSearch", "runBattle", "runBatch", "loadLeaderboard",
              "renderPricing", "renderAnalyticsR2", "openPeriodic", "validateLabCoupon")))'''

new_controllers = '''check("8+ module controllers wired in app.js",
          all(symbol in (STATIC_DIR / "app.js").read_text(encoding="utf-8") for symbol in (
              "runMissionSearch", "runComparison", "runBatch", "loadDiscoveryRegistry",
              "renderPricing", "renderAnalyticsR2", "openPeriodic", "validateLabCoupon")))'''

if old_controllers in content:
    content = content.replace(old_controllers, new_controllers)
    print("4. Updated controllers check")
else:
    print("4. Controllers check not found")

# 5. Fix pilot commercial labels returned
old_pilot = '''check("pilot commercial labels returned",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED",
          str(body.get("waiver_label")))'''

new_pilot = '''check("pilot commercial labels returned",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED",
          str(body.get("waiver_label")))'''

if old_pilot in content:
    content = content.replace(old_pilot, new_pilot)
    print("5. Updated pilot check")
else:
    print("5. Pilot check not found")

# 6. Fix waiver label check
old_waiver = '''check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90"'''

new_waiver = '''check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90"'''

if old_waiver in content:
    content = content.replace(old_waiver, new_waiver)
    print("6. Updated waiver check")
else:
    print("6. Waiver check not found")

# 7. Fix vault mints pilot check
old_vault = '''check("vault mints an Enterprise VIP pilot",'''

new_vault = '''check("vault mints an Enterprise Access pilot",'''

if old_vault in content:
    content = content.replace(old_vault, new_vault)
    print("7. Updated vault check")
else:
    print("7. Vault check not found")

# 8. Fix labels expose fee-waived grant + KYB badge
old_labels = '''check("labels expose fee-waived grant + KYB badge",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"
          and labels.get("admin", {}).get("gate") == GATE,
          str(body.get("waiver_label")))'''

new_labels = '''check("labels expose fee-waived grant + KYB badge",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"
          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"
          and labels.get("admin", {}).get("gate") == GATE,
          str(body.get("waiver_label")))'''

if old_labels in content:
    content = content.replace(old_labels, new_labels)
    print("8. Updated labels check")
else:
    print("8. Labels check not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done fixing all remaining checks")