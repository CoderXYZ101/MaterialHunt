with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix waiver label check
old_waiver = '''check("waiver label is VIP GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90" if isinstance(body, dict) else False,
          str(body.get("waiver_label") if isinstance(body, dict) else ""))'''

new_waiver = '''check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90" if isinstance(body, dict) else False,
          str(body.get("waiver_label") if isinstance(body, dict) else ""))'''

if old_waiver in content:
    content = content.replace(old_waiver, new_waiver)
    print("1. Updated waiver check")
else:
    print("1. Waiver check not found")

# 2. Fix vault mints pilot check
old_vault = '''check("vault mints an Enterprise Access pilot",
          status == 200 and minted.get("tier") == "enterprise" and minted.get("billing_waived") is True
          and body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)",
          f"HTTP {status} \u2009 {minted.get('email')}")'''

new_vault = '''check("vault mints an Enterprise Access pilot",
          status == 200 and minted.get("tier") == "enterprise" and minted.get("billing_waived") is True
          and body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",
          f"HTTP {status} \u2009 {minted.get('email')}")'''

if old_vault in content:
    content = content.replace(old_vault, new_vault)
    print("2. Updated vault check")
else:
    print("2. Vault check not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")