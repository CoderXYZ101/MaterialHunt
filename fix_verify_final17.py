with open('verify.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Fix line 228 (modules list)
lines[227] = '        "Global R&D Discovery Registry & Feedback",\n'
print(f"Fixed line 228: {lines[227].strip()}")

# Fix line 163 (API check)
lines[162] = '          labels.get("leaderboard", {}).get("title") == "Global R&D Discovery Registry")\n'
print(f"Fixed line 163: {lines[162].strip()}")

# Fix line 739 (section header)
lines[738] = '    section("14. Global R&D Discovery Registry")\n'
print(f"Fixed line 739: {lines[738].strip()}")

# Fix line 743 (title check)
lines[742] = '          body.get("title") == "Global R&D Discovery Registry", str(body.get("title")))\n'
print(f"Fixed line 743: {lines[742].strip()}")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Done")