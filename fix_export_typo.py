with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the "Eexperience-pointsort" typo back to "Export"
content = content.replace('Eexperience-pointsort', 'Export')
content = content.replace('eexperience-pointsort', 'export')
content = content.replace('eexperience-pointsort', 'export')

# Fix the duplicate "Discovery" in discovery-registry
content = content.replace('Global R&D Discovery Discovery Registry', 'Global R&D Discovery Registry')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed export typo and duplicate Discovery")