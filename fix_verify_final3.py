with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# The file has HTML entities like & and & - match them exactly
# Let me use a different approach - find and replace the specific lines

# 1. Fix modules list - replace "Global R&D Discovery Leaderboard" with "Global R&D Discovery Registry"
content = content.replace(
    '"Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",',
    '"Global R&D Discovery Registry & 0\\u20135\\u2605 Feedback",'
)
print("1. Updated modules list")

# 2. Fix views check - leaderboard -> discovery-registry
content = content.replace(
    '{"simulator", "battle", "dashboard", "analytics", "batch", "roi",\n                         "leaderboard", "pricing", "admin"}',
    '{"simulator", "battle", "dashboard", "analytics", "batch", "roi",\n                         "discovery-registry", "pricing", "admin"}'
)
print("2. Updated views check")

# 3. Fix nav check - leaderboard -> discovery-registry
content = content.replace(
    '{"simulator", "battle", "dashboard", "analytics", "batch", "roi", "leaderboard", "pricing"}',
    '{"simulator", "battle", "dashboard", "analytics", "batch", "roi", "discovery-registry", "pricing"}'
)
print("3. Updated nav check")

# 4. Fix controllers check - runBattle -> runComparison, loadLeaderboard -> loadDiscoveryRegistry
content = content.replace(
    '"runMissionSearch", "runBattle", "runBatch", "loadLeaderboard",',
    '"runMissionSearch", "runComparison", "runBatch", "loadDiscoveryRegistry",'
)
print("4. Updated controllers check")

# 5. Fix pilot commercial labels returned
content = content.replace(
    'body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"',
    'body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"'
)
print("5. Updated pilot check")

# 6. Fix waiver label check
content = content.replace(
    'body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90"',
    'body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90"'
)
print("6. Updated waiver check")

# 7. Fix vault mints pilot check
content = content.replace(
    'check("vault mints an Enterprise VIP pilot",',
    'check("vault mints an Enterprise Access pilot",'
)
print("7. Updated vault check")

# 8. Fix labels expose fee-waived grant + KYB badge - need to be more careful
content = content.replace(
    'body.get("waiver_label") == "VIP GRANT \u2014 FEE WAIVED (\u20b90)"\n          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"',
    'body.get("waiver_label") == "ENTERPRISE ACCESS GRANT \u2014 FEE WAIVED (\u20b90)"\n          and body.get("kyb_badge") == "ENTERPRISE VIP \u00b7 KYB VERIFIED"'
)
print("8. Updated labels check")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done fixing all remaining checks")