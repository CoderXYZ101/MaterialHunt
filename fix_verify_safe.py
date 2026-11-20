with open('verify.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the modules tuple and replace the specific line
in_modules = False
for i, line in enumerate(lines):
    if 'modules = (' in line:
        in_modules = True
    if in_modules:
        if 'Global R&D Discovery Leaderboard' in line and '&' in line:
            # Replace this line
            lines[i] = '        "Global R&D Discovery Registry & Feedback",\n'
            print(f"Replaced line {i+1}: {line.strip()} -> {lines[i].strip()}")
            in_modules = False
        elif ')' in line and 'modules' not in line:
            in_modules = False

with open('verify.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Done")