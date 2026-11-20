with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the modules list specifically
idx = content.find('modules = (')
if idx >= 0:
    # Find the Leaderboard line within the modules list
    end_idx = content.find(')', idx) + 1
    modules_section = content[idx:end_idx]
    print("Modules section:")
    print(modules_section)
    print("---")
    
    # Replace in the modules section only
    old = '"Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",'
    new = '"Global R&D Discovery Registry & Feedback",'
    
    if old in modules_section:
        modules_section = modules_section.replace(old, new)
        content = content[:idx] + modules_section + content[end_idx:]
        print("Replaced in modules list!")
    else:
        print("Old string not found in modules section")
        print("Looking for:", repr(old))
        # Try alternative
        old2 = '"Global R&D Discovery Leaderboard & 0\\u20135\\u2605 Feedback",'
        if old2 in modules_section:
            modules_section = modules_section.replace(old2, '"Global R&D Discovery Registry & Feedback",')
            content = content[:idx] + modules_section + content[end_idx:]
            print("Replaced with HTML entities!")
        else:
            print("Old2 not found either")
            # Print the modules section to see the exact format
            for line in modules_section.split('\n'):
                if 'Leaderboard' in line or 'Registry' in line:
                    print("Line:", repr(line))
else:
    print("modules = ( not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")