with open('static/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    # State variables
    ('summitMode', 'adminAccessMode'),
    ('battle', 'comparison'),
    ('leaderboard', 'discoveryRegistry'),
    ('challengeId', 'benchmarkId'),
    ('challenge', 'benchmark'),
    ('customChallenge', 'customBenchmark'),
    ('forgeXp', 'experiencePoints'),
    
    # View references
    ("view === 'battle'", "view === 'comparison'"),
    ("view === 'leaderboard'", "view === 'discovery-registry'"),
    
    # UI elements
    ('#summitBanner', '#adminAccessBanner'),
    ('summitBanner', 'adminAccessBanner'),
    ('VIP GRANT - FEE WAIVED', 'ENTERPRISE ACCESS GRANT - FEE WAIVED'),
    ('VIP GRANT — FEE WAIVED', 'ENTERPRISE ACCESS GRANT — FEE WAIVED'),
    ('VIP grant', 'Enterprise access grant'),
    ('VIP grant pilots', 'Enterprise access grant pilots'),
    ('VIP grant active', 'Enterprise access grant active'),
    ('waived_accounts', 'enterprise_access_accounts'),
    ('waived', 'enterprise_access'),
    
    # Function names
    ('summitLogin', 'adminAccessLogin'),
    ('summitBannerClose', 'adminAccessBannerClose'),
    ('pilotLaunchBtn', 'enterpriseAccessBtn'),
    ('summit_test', 'admin_access_test'),
    ('live_demo', 'live_demo'),  # keep this
    
    # Battle -> Comparison
    ('battleStatus', 'comparisonStatus'),
    ('battleCardA', 'comparisonCardA'),
    ('battleCardB', 'comparisonCardB'),
    ('battleNameA', 'comparisonNameA'),
    ('battleNameB', 'comparisonNameB'),
    ('battlePresetA', 'comparisonPresetA'),
    ('battlePresetB', 'comparisonPresetB'),
    ('battleImportA', 'comparisonImportA'),
    ('battleImportB', 'comparisonImportB'),
    ('battleCustomA', 'comparisonCustomA'),
    ('battleCustomB', 'comparisonCustomB'),
    ('battleTempA', 'comparisonTempA'),
    ('battleTempB', 'comparisonTempB'),
    ('battleVelA', 'comparisonVelA'),
    ('battleVelB', 'comparisonVelB'),
    ('battleVerdictA', 'comparisonVerdictA'),
    ('battleVerdictB', 'comparisonVerdictB'),
    ('battleStatsA', 'comparisonStatsA'),
    ('battleStatsB', 'comparisonStatsB'),
    ('battleWinner', 'comparisonWinner'),
    ('battleScoreline', 'comparisonScoreline'),
    ('battleResults', 'comparisonResults'),
    ('battleRadar', 'comparisonRadar'),
    ('battleBars', 'comparisonBars'),
    ('battleGrid', 'comparisonGrid'),
    ('battleCenter', 'comparisonCenter'),
    ('battleTag', 'comparisonTag'),
    ('battleVerdict', 'comparisonVerdict'),
    ('battleStatus', 'comparisonStatus'),
    
    # Battle functions
    ('battleRequest', 'comparisonRequest'),
    ('battleMetrics', 'comparisonMetrics'),
    ('runBattle', 'runComparison'),
    ('renderBattle', 'renderComparison'),
    ('swapBattle', 'swapComparison'),
    
    # Battle event handlers
    ('#runBattle', '#runComparison'),
    ('#swapBattle', '#swapComparison'),
    ('#battlePresetA', '#comparisonPresetA'),
    ('#battlePresetB', '#comparisonPresetB'),
    ('#battleImportA', '#comparisonImportA'),
    ('#battleImportB', '#comparisonImportB'),
    ('#battleCustomA', '#comparisonCustomA'),
    ('#battleCustomB', '#comparisonCustomB'),
    ('#battleTempA', '#comparisonTempA'),
    ('#battleTempB', '#comparisonTempB'),
    ('#battleVelA', '#comparisonVelA'),
    ('#battleVelB', '#comparisonVelB'),
    ('#battleTempAOut', '#comparisonTempAOut'),
    ('#battleTempBOut', '#comparisonTempBOut'),
    ('#battleVelAOut', '#comparisonVelAOut'),
    ('#battleVelBOut', '#comparisonVelBOut'),
    ('#battleNameA', '#comparisonNameA'),
    ('#battleNameB', '#comparisonNameB'),
    ('#battleVerdictA', '#comparisonVerdictA'),
    ('#battleVerdictB', '#comparisonVerdictB'),
    ('#battleStatsA', '#comparisonStatsA'),
    ('#battleStatsB', '#comparisonStatsB'),
    ('#battleWinner', '#comparisonWinner'),
    ('#battleScoreline', '#comparisonScoreline'),
    ('#battleResults', '#comparisonResults'),
    ('#battleRadar', '#comparisonRadar'),
    ('#battleBars', '#comparisonBars'),
    ('#battleCardA', '#comparisonCardA'),
    ('#battleCardB', '#comparisonCardB'),
    ('#battleCenter', '#comparisonCenter'),
    ('battle-fail', 'comparison-fail'),
    ('battle-import', 'comparison-import'),
    ('battle-custom-row', 'comparison-custom-row'),
    ('battle-card', 'comparison-card'),
    ('battle-grid', 'comparison-grid'),
    ('battle-center', 'comparison-center'),
    ('battle-vs', 'comparison-vs'),
    ('battle-winner', 'comparison-winner'),
    ('battle-scoreline', 'comparison-scoreline'),
    ('battle-table-wrap', 'comparison-table-wrap'),
    ('battle-verdict', 'comparison-verdict'),
    ('battle-stats', 'comparison-stats'),
    
    # Toast messages
    ('Battle arena complete', 'Comparison analysis complete'),
    ('battle arena', 'comparison analysis'),
    
    # Leaderboard -> Discovery Registry
    ('loadLeaderboard', 'loadDiscoveryRegistry'),
    ('refreshAdminLeaderboard', 'refreshAdminDiscoveryRegistry'),
    ('publishToLeaderboard', 'publishToDiscoveryRegistry'),
    ('pushBatchLeaderboard', 'pushBatchDiscoveryRegistry'),
    ('leaderboardStats', 'discoveryRegistryStats'),
    ('leaderboardBody', 'discoveryRegistryBody'),
    ('adminLeaderboard', 'adminDiscoveryRegistry'),
    ('leaderboard', 'discoveryRegistry'),
    ('Leaderboard', 'Discovery Registry'),
    ('leaderboard', 'discovery-registry'),
    ('LEADERBOARD', 'DISCOVERY REGISTRY'),
    ('Global R&D Discovery Leaderboard', 'Global R&D Discovery Registry'),
    
    # Challenge -> Benchmark
    ('challengeId', 'benchmarkId'),
    ('challenge', 'benchmark'),
    ('customChallenge', 'customBenchmark'),
    ('challengeFromUrl', 'benchmarkFromUrl'),
    ('applyChallenge', 'applyBenchmark'),
    ('runChallenge', 'runBenchmark'),
    ('renderChallengeResult', 'renderBenchmarkResult'),
    ('challengeVerdict', 'benchmarkVerdict'),
    ('challengeSelect', 'benchmarkSelect'),
    ('challengeModal', 'benchmarkModal'),
    ('challengeJson', 'benchmarkJson'),
    ('challengeTemp', 'benchmarkTemp'),
    ('challengeBurst', 'benchmarkBurst'),
    ('challengeCost', 'benchmarkCost'),
    ('challengeBanned', 'benchmarkBanned'),
    ('challengeName', 'benchmarkName'),
    ('challengeError', 'benchmarkError'),
    ('challengeRules', 'benchmarkRules'),
    ('challengeStandards', 'benchmarkStandards'),
    ('challengeBrief', 'benchmarkBrief'),
    ('challengeTag', 'benchmarkTag'),
    ('challengeTitle', 'benchmarkTitle'),
    ('forgeTempReq', 'benchmarkTempReq'),
    ('forgePressureReq', 'benchmarkPressureReq'),
    ('forgeMassReq', 'benchmarkMassReq'),
    ('forgeCostReq', 'benchmarkCostReq'),
    ('forgeSafetyReq', 'benchmarkSafetyReq'),
    ('forgeVerdictCard', 'benchmarkVerdictCard'),
    ('forgeVerdict', 'benchmarkVerdict'),
    ('forgeVerdictSub', 'benchmarkVerdictSub'),
    ('forgeFixes', 'benchmarkFixes'),
    ('forgeXpBar', 'benchmarkExperienceBar'),
    ('forgeXp', 'benchmarkExperience'),
    ('forgeBadges', 'benchmarkMilestones'),
    ('forgeStatus', 'benchmarkStatus'),
    ('forgeAutoFix', 'benchmarkAutoFix'),
    ('forgePublish', 'benchmarkPublish'),
    ('openChallengeDesigner', 'openBenchmarkDesigner'),
    ('challengeFromSliders', 'benchmarkFromSliders'),
    ('challengeApply', 'benchmarkApply'),
    ('copyChallengeLink', 'copyBenchmarkLink'),
    ('loadChallengeLink', 'loadBenchmarkLink'),
    ('challenge_designer', 'benchmark_designer'),
    ('challengeSelect', 'benchmarkSelect'),
    ('runChallenge', 'runBenchmark'),
    ('applyForgeFix', 'applyBenchmarkFix'),
    ('syncChallengeSlidersToJson', 'syncBenchmarkSlidersToJson'),
    ('parseDeclarativeChallenge', 'parseDeclarativeBenchmark'),
    ('applyChallengeDesign', 'applyBenchmarkDesign'),
    ('challengeFromUrl', 'benchmarkFromUrl'),
    ('challenge', 'benchmark'),
    ('challenges', 'benchmarks'),
    ('Challenge', 'Benchmark'),
    ('CHALLENGE', 'BENCHMARK'),
    ('challenge', 'benchmark'),
    ('CHALLENGES', 'BENCHMARKS'),
    ('Product Forge', 'Validation Benchmarks'),
    ('product forge', 'validation benchmarks'),
    ('PRODUCT FORGE', 'VALIDATION BENCHMARKS'),
    
    # Forge -> Benchmark
    ('forgeXp', 'benchmarkExperience'),
    ('forgeXpBar', 'benchmarkExperienceBar'),
    ('forgeBadges', 'benchmarkMilestones'),
    ('forgeStatus', 'benchmarkStatus'),
    ('forgeAutoFix', 'benchmarkAutoFix'),
    ('forgePublish', 'benchmarkPublish'),
    ('forgeVerdict', 'benchmarkVerdict'),
    ('forgeFixes', 'benchmarkFixes'),
    
    # Gamification -> Engagement Metrics
    ('gamificationPanel', 'engagementMetricsPanel'),
    ('gamificationStatus', 'engagementMetricsStatus'),
    ('ACHIEVEMENTS', 'MILESTONES'),
    ('Achievements', 'Milestones'),
    ('achievement', 'milestone'),
    ('ACHIEVEMENT', 'MILESTONE'),
    ('xp', 'experiencePoints'),
    ('XP', 'Experience Points'),
    ('streak', 'consecutiveDays'),
    ('Streak', 'Consecutive Days'),
    ('daily_streak', 'dailyActivity'),
    ('mh_daily_streak', 'mh_daily_activity'),
    ('mh_user_xp', 'mh_user_experience_points'),
    ('mh_user_achievements', 'mh_user_milestones'),
    
    # Tour references
    ('Tour', 'Guided Tour'),
    ('tour', 'guidedTour'),
    ('TOUR', 'GUIDED TOUR'),
    
    # Fix special chars
    ('�C', '°C'),
    ('�', '—'),
    ('?', '₹'),
]

for old, new in replacements:
    content = content.replace(old, new)

# Fix specific strings that need more careful handling
# Battle status text
content = content.replace(
    "if (status) { status.textContent = 'FIGHTING'; status.className = 'status-pill status-amber'; }",
    "if (status) { status.textContent = 'ANALYZING'; status.className = 'status-pill status-amber'; }"
)

content = content.replace(
    "toast('Battle arena complete.', 'success', 3000);",
    "toast('Comparison analysis complete.', 'success', 3000);"
)

# Tour step 3
content = content.replace(
    "The 3D specimen glows blackbody-hot, ripples above liquidus and bursts below a safety factor of 1.0.",
    "The 3D specimen exhibits blackbody thermal emission, fluid ripples above liquidus, and fracture initiation below a safety factor of 1.0."
)
content = content.replace(
    "Switch crystal, nozzle, blade, sphere and dogbone shapes.",
    "Toggle between crystal lattice, nozzle, blade, sphere, and tensile dogbone geometries."
)
content = content.replace(
    "Use camera presets for atomic close-up or stress cross-section.",
    "Utilize camera presets for atomic-resolution or stress cross-section views."
)

# Step 4
content = content.replace(
    "Product Forge challenges score your part.",
    "Validation benchmarks evaluate your design."
)
content = content.replace(
    "Copy a share link for WhatsApp, LinkedIn or Slack.",
    "Share a specification link via WhatsApp, LinkedIn, or Slack."
)

# Copilot chips
content = content.replace(
    "const COPILOT_CHIPS = ['Why did it melt?', 'Make it cheaper', 'Explain liquidus', 'Fix failing alloy', 'Is it safe at 80 MPa?'];",
    "const COPILOT_CHIPS = ['Why did it melt?', 'Reduce cost', 'Explain liquidus', 'Remediate failing alloy', 'Is it safe at 80 MPa?'];"
)

# Forge/Challenge references in copilot
content = content.replace(
    "Open Product Forge in the simulator and pick a blueprint. I will score PASS, MELT, BURST or OVERWEIGHT against its rules.",
    "Open Validation Benchmarks in the simulator and select a benchmark. I will score PASS, MELT, BURST, or OVERWEIGHT against its criteria."
)

# Risk radar
content = content.replace(
    "Explain the supply-chain risk and Indian alternatives",
    "Explain the supply-chain risk and Indian alternatives"
)

# Hardcoded strings in render functions
content = content.replace(
    "Awaiting fight",
    "Awaiting analysis"
)
content = content.replace(
    "No result yet",
    "No result available"
)
content = content.replace(
    "Swap sides",
    "Swap specimens"
)
content = content.replace(
    "Run the arena to compare two chemistries",
    "Execute analysis to compare two chemistries"
)

# Footer text
content = content.replace(
    "VIP GRANT - WAIVED",
    "ENTERPRISE ACCESS GRANT - WAIVED"
)

# PDF export error
content = content.replace(
    "PDF reports require Pro Lab or Enterprise. VIP grant pilots are fee-waived.",
    "PDF reports require Pro Lab or Enterprise. Enterprise access grant pilots are fee-waived."
)

# Star ratings captions
content = content.replace(
    "const STAR_CAPTIONS = ['0? - blocking issue', 'Needs serious work', 'Below expectations', 'Solid - usable', 'Excellent - impressed', 'Flawless - category leader'];",
    "const STAR_CAPTIONS = ['0 - Critical issue', '1 - Needs significant improvement', '2 - Below expectations', '3 - Acceptable', '4 - Exceeds expectations', '5 - Industry benchmark'];"
)

# Admin overview
content = content.replace(
    "['Waived', fmt(overview.waived_accounts || 0), 'VIP grant ?0'],",
    "['Enterprise Access', fmt(overview.enterprise_access_accounts || 0), 'Access grant - Fee waived'],"
)

# Pilot minted toast
content = content.replace(
    "toast(`Pilot minted: ${result.user.email} \\u2009 VIP GRANT - FEE WAIVED (?0)`, 'success', 6000);",
    "toast(`Enterprise access granted: ${result.user.email} \\u2009 ENTERPRISE ACCESS GRANT - FEE WAIVED (₹0)`, 'success', 6000);"
)

# Track challenge function
content = content.replace(
    "function trackChallenge(verdict) {",
    "function trackBenchmark(verdict) {"
)
content = content.replace(
    "const challenges = JSON.parse(localStorage.getItem('mh_challenge_history') || '[]');",
    "const benchmarks = JSON.parse(localStorage.getItem('mh_benchmark_history') || '[]');"
)
content = content.replace(
    "challenges.filter(c => c.verdict === 'PASS').length",
    "benchmarks.filter(b => b.verdict === 'PASS').length"
)
content = content.replace(
    "challenges.length > 0 ? ((challengesPassed/challenges.length)*100).toFixed(0) : 0",
    "benchmarks.length > 0 ? ((benchmarksPassed/benchmarks.length)*100).toFixed(0) : 0"
)
content = content.replace(
    "challengesPassed",
    "benchmarksPassed"
)
content = content.replace(
    "challenges.slice(-5)",
    "benchmarks.slice(-5)"
)
content = content.replace(
    "item.type === 'simulation' ? '?? Simulation' : '?? Challenge'",
    "item.type === 'simulation' ? 'Simulation' : 'Benchmark'"
)
content = content.replace(
    "item.formula || item.challenge",
    "item.formula || item.benchmark"
)
content = content.replace(
    "item.challenge",
    "item.benchmark"
)

# Render gamification
content = content.replace(
    "const ACHIEVEMENTS = [",
    "const MILESTONES = ["
)
content = content.replace(
    "ACHIEVEMENTS.forEach(a => {",
    "MILESTONES.forEach(m => {"
)
content = content.replace(
    "const a = ACHIEVEMENTS.find(x => x.id === id);",
    "const m = MILESTONES.find(x => x.id === id);"
)
content = content.replace(
    "a?.xp || 0",
    "m?.xp || 0"
)
content = content.replace(
    "achievement-card",
    "milestone-card"
)
content = content.replace(
    "achievement-icon",
    "milestone-icon"
)
content = content.replace(
    "achievement-name",
    "milestone-name"
)
content = content.replace(
    "achievement-desc",
    "milestone-desc"
)
content = content.replace(
    "achievement-xp",
    "milestone-xp"
)
content = content.replace(
    "achievement.unlocked",
    "m.unlocked"
)
content = content.replace(
    "a.unlocked",
    "m.unlocked"
)
content = content.replace(
    "a.id",
    "m.id"
)
content = content.replace(
    "a.name",
    "m.name"
)
content = content.replace(
    "a.desc",
    "m.desc"
)
content = content.replace(
    "a.xp",
    "m.xp"
)

content = content.replace(
    "achievement-grid",
    "milestone-grid"
)
content = content.replace(
    "achievement-card.unlocked",
    "milestone-card.unlocked"
)
content = content.replace(
    "achievement-card.locked",
    "milestone-card.locked"
)
content = content.replace(
    "streak-fire",
    "activity-fire"
)
content = content.replace(
    "streak-count",
    "activity-count"
)
content = content.replace(
    "streak-label",
    "activity-label"
)
content = content.replace(
    "daily-streak",
    "daily-activity"
)

content = content.replace(
    "streak.count > 0 ? '??' : '??'",
    "activity.count > 0 ? '●' : '○'"
)
content = content.replace(
    "streak.count",
    "activity.count"
)
content = content.replace(
    "streak.last",
    "activity.last"
)
content = content.replace(
    "streak = JSON.parse(localStorage.getItem('mh_daily_streak') || '{\"count\":0,\"last\":null}')",
    "activity = JSON.parse(localStorage.getItem('mh_daily_activity') || '{\"count\":0,\"last\":null}')"
)
content = content.replace(
    "streak.last !== today",
    "activity.last !== today"
)
content = content.replace(
    "streak.last === yesterday",
    "activity.last === yesterday"
)
content = content.replace(
    "streak.count = streak.count + 1",
    "activity.count = activity.count + 1"
)
content = content.replace(
    "streak.count = 1",
    "activity.count = 1"
)
content = content.replace(
    "streak.last = today",
    "activity.last = today"
)
content = content.replace(
    "localStorage.setItem('mh_daily_streak', JSON.stringify(streak))",
    "localStorage.setItem('mh_daily_activity', JSON.stringify(activity))"
)

content = content.replace(
    "mh_user_xp",
    "mh_user_experience_points"
)
content = content.replace(
    "mh_user_achievements",
    "mh_user_milestones"
)
content = content.replace(
    "userXP",
    "userExperiencePoints"
)
content = content.replace(
    "userAchievements",
    "userMilestones"
)
content = content.replace(
    "totalXP",
    "totalExperiencePoints"
)

content = content.replace(
    "a?.xp || 0",
    "m?.experiencePoints || 0"
)

content = content.replace(
    "mh_challenge_history",
    "mh_benchmark_history"
)
content = content.replace(
    "mh_daily_streak",
    "mh_daily_activity"
)

with open('static/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("All app.js replacements done")