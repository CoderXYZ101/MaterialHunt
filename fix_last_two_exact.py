with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix waiver check
idx = content.find('waiver label is VIP GRANT')
if idx >= 0:
    end_idx = content.find('str(body.get("waiver_label") if isinstance(body, dict) else ""))', idx)
    if end_idx >= 0:
        end_idx += len('str(body.get("waiver_label") if isinstance(body, dict) else ""))')
        old = content[idx:end_idx]
        with open('old_waiver.txt', 'w', encoding='utf-8') as f:
            f.write(old)
        
        new = old.replace('VIP GRANT \u2014 FEE WAIVED (\u20b90)', 'ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)')
        new = new.replace('waiver label is VIP GRANT', 'waiver label is ENTERPRISE ACCESS GRANT')
        content = content[:idx] + new + content[end_idx:]
        print("1. Updated waiver check")
    else:
        print("Waiver check end not found")
else:
    print("Waiver check not found")

# 2. Vault check
idx = content.find('vault mints an Enterprise Access pilot')
if idx >= 0:
    end_idx = content.find('f"HTTP {status}', idx)
    if end_idx >= 0:
        end_idx = content.find('")', end_idx) + 2
        old = content[idx:end_idx]
        with open('old_vault.txt', 'w', encoding='utf-8') as f:
            f.write(old)
        
        new = old.replace('VIP GRANT \u2014 FEE WAIVED (\u20b90)', 'ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)')
        content = content[:idx] + new + content[end_idx:]
        print("2. Updated vault check")
    else:
        print("Vault check end not found")
else:
    print("Vault check not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")