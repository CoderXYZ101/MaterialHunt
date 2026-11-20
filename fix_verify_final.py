with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Update all the remaining VIP GRANT references to ENTERPRISE ACCESS GRANT
replacements = [
    # Commercial label pack exposed
    ('body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"\n          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"',
     'body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"\n          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"'),
    
    # Pilot commercial labels returned
    ('check("pilot commercial labels returned",\n          pilot_billing == "VIP GRANT \u2014 FEE WAIVED (\u20b90")',
     'check("pilot commercial labels returned",\n          pilot_billing == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90")'),
    
    # Waiver label check
    ('check("waiver label is VIP GRANT \u2014 FEE WAIVED (\u20b90)",\n          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90"',
     'check("waiver label is ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)",\n          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90"'),
    
    # Vault mints Enterprise VIP pilot
    ('check("vault mints an Enterprise VIP pilot",',
     'check("vault mints an Enterprise Access pilot",'),
    
    # Labels expose fee-waived grant + KYB badge
    ('check("labels expose fee-waived grant \u2014 KYB badge",\n          body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"\n          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"',
     'check("labels expose fee-waived grant \u2014 KYB badge",\n          body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"\n          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"'),
    
    # Leaderboard uses commercial title
    ('check("leaderboard uses the commercial title",\n          body.get("title") == "Global R&D Discovery Leaderboard"',
     'check("discovery registry uses the commercial title",\n          body.get("title") == "Global R&D Discovery Registry"'),
]

for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        print("Replaced one")
    else:
        print("Not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")