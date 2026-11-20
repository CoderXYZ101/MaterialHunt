with open('verify.py', 'r', encoding='utf-8') as f:
    content = f.read()

# The exact line has HTML entities (&) and the Unicode is represented as \u2013 and \u2605 in the source
# But in the file, it's stored as actual characters or escaped
# Let me find the exact bytes
idx = content.find('Global R&D Discovery Leaderboard')
if idx >= 0:
    snippet = content[idx:idx+100]
    print("Found at:", idx)
    print("Snippet:", repr(snippet))
    
    # Try to replace the exact substring
    old = snippet[:snippet.find(',')+1]
    print("Old:", repr(old))
    
    new = '"Global R&D Discovery Registry & Feedback",'
    print("New:", repr(new))
    
    content = content.replace(old, new)
    print("Replaced!")
else:
    print("Not found")

with open('verify.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")