with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact waiver check
idx = content.find('waiver label is')
if idx >= 0:
    with open('waiver_check.txt', 'w', encoding='utf-8') as f:
        f.write(content[idx:idx+300])
    print('WAIVER written to file')

# Find the exact vault check
idx = content.find('vault mints an Enterprise')
if idx >= 0:
    with open('vault_check.txt', 'w', encoding='utf-8') as f:
        f.write(content[idx:idx+300])
    print('VAULT written to file')