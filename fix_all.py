with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace all the informal/gamey terms
replacements = [
    # Battle Arena -> Comparative Analysis
    ('Battle Arena', 'Comparative Analysis'),
    ('battle arena', 'comparative analysis'),
    ('BATTLE ARENA', 'COMPARATIVE ANALYSIS'),
    ('Battle Arena', 'Comparative Analysis'),
    
    # Fight -> Execute Analysis
    ('<button class="btn btn-primary small" id="runBattle">Fight</button>', 
     '<button class="btn btn-primary small" id="runBattle">Execute Analysis</button>'),
    
    # Awaiting fight -> Awaiting analysis
    ('Awaiting fight', 'Awaiting analysis'),
    
    # VS -> versus
    ('<span class="battle-vs">VS</span>', 
     '<span class="battle-vs">versus</span>'),
    
    # No result yet -> No result available
    ('No result yet', 'No result available'),
    
    # Swap sides -> Swap specimens
    ('Swap sides', 'Swap specimens'),
    
    # Run the arena -> Execute analysis
    ('Run the arena to compare two chemistries', 'Execute analysis to compare two chemistries'),
    ('Run two chemistries under identical conditions', 'Evaluate two chemistries under identical conditions'),
    
    # Panel kicker
    ('ALLOY A VS. B BATTLE ARENA', 'ALLOY COMPARATIVE ANALYSIS'),
    ('Alloy A vs. B Battle Arena', 'Alloy A vs. B Comparative Analysis'),
    
    # Tag labels
    ('ALLOY A', 'SPECIMEN A'),
    ('ALLOY B', 'SPECIMEN B'),
    
    # Authentic designation -> Validated designation
    ('Import authentic designation', 'Import validated designation'),
    
    # Leaderboard -> Discovery Registry
    ('Leaderboard', 'Discovery Registry'),
    ('leaderboard', 'discovery-registry'),
    ('LEADERBOARD', 'DISCOVERY REGISTRY'),
    ('Global R&D Discovery Leaderboard', 'Global R&D Discovery Registry'),
    ('Global R&D Discovery Leaderboard', 'Global R&D Discovery Registry'),
    
    # Gamification -> Engagement Metrics
    ('Gamification', 'Engagement Metrics'),
    ('gamification', 'engagement-metrics'),
    ('GAMIFICATION', 'ENGAGEMENT METRICS'),
    ('Engagement Layer', 'Engagement Metrics'),
    
    # Achievement -> Milestone
    ('Achievement', 'Milestone'),
    ('achievement', 'milestone'),
    ('ACHIEVEMENT', 'MILESTONE'),
    
    # XP -> Experience Points
    ('XP', 'Experience Points'),
    ('xp', 'experience-points'),
    
    # Streak -> Consecutive Days
    ('Streak', 'Consecutive Days'),
    ('streak', 'consecutive-days'),
    ('Daily Streak', 'Daily Activity'),
    
    # Challenge -> Benchmark
    ('Challenge', 'Benchmark'),
    ('challenge', 'benchmark'),
    ('CHALLENGE', 'BENCHMARK'),
    ('Product Forge', 'Validation Benchmarks'),
    ('Product Forge', 'Validation Benchmarks'),
    ('product forge', 'validation benchmarks'),
    
    # Summit -> Admin Panel / Access Control
    ('Summit', 'Admin Access'),
    ('summit', 'admin-access'),
    ('SUMMIT', 'ADMIN ACCESS'),
    ('VIP GRANT', 'ENTERPRISE ACCESS GRANT'),
    ('VIP GRANT — FEE WAIVED (₹0)', 'ENTERPRISE ACCESS GRANT — FEE WAIVED (₹0)'),
    
    # Fix special chars
    ('�C', '°C'),
    ('�', '—'),
]

for old, new in replacements:
    content = content.replace(old, new)

# Update meta description
content = content.replace(
    '3D alloy simulation, mission co-pilot, battle arena, enterprise pre-screening and R&D analytics',
    '3D alloy simulation, mission co-pilot, comparative analysis, enterprise pre-screening and R&D analytics'
)

# Fix footer links
content = content.replace(
    '<a href="#" data-view="battle">Alloy A vs. B Comparative Analysis</a>',
    '<a href="#" data-view="battle">Alloy A vs. B Comparative Analysis</a>'
)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("All replacements done")