with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the remaining VIP GRANT references

# 1. Pilot commercial labels returned
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
    print("1. Updated pilot check")
else:
    print("1. Pilot check not found")

# 2. Waiver label check
old_waiver = '''check("waiver label is VIP GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90"'''

new_waiver = '''check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90"'''

if old_waiver in content:
    content = content.replace(old_waiver, new_waiver)
    print("2. Updated waiver check")
else:
    print("2. Waiver check not found")

# 3. Vault mints pilot check
old_vault = '''check("vault mints an Enterprise VIP pilot",'''

new_vault = '''check("vault mints an Enterprise Access pilot",'''

if old_vault in content:
    content = content.replace(old_vault, new_vault)
    print("3. Updated vault check")
else:
    print("3. Vault check not found")

# 4. Labels expose fee-waived grant + KYB badge
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
    print("4. Updated labels check")
else:
    print("4. Labels check not found")

# 5. Module headings - need to check the frontend HTML for "Global R&D Discovery Leaderboard"
# The frontend HTML still has "Global R&D Discovery Leaderboard" in the nav
# But verify.py checks the HTML for the module headings
# The module headings check looks for "Global R&D Discovery Leaderboard & 0\u20135\u2605 Feedback" in the HTML
# We need to update the frontend HTML to use "Global R&D Discovery Registry & 0\u20135\u2605 Feedback"
# This is in the footer and nav - but we already did that
# The issue might be that the HTML entities are different

print("Done fixing verify.py")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")