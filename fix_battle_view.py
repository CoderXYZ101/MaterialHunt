with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the first battle view section (around line 481)
old_battle = '''<!-- ================= 2. ALLOY A VS. B BATTLE ARENA ================= -->
      <section class="view" id="view-battle">
        <div class="section-head">
          <div>
            <span class="panel-kicker">ALLOY A VS. B BATTLE ARENA</span>
            <h2>Alloy A vs. B Battle Arena</h2>
            <p>Two chemistries under identical service conditions, weighted category wins, radar overlay, per-metric winner table.</p>
          </div>
          <span class="status-pill status-cyan" id="battleStatus">STANDBY</span>
        </div>

        <div class="battle-grid">
          <article class="glass battle-card" id="battleCardA">
            <div class="battle-card-head"><span class="battle-tag tag-a">ALLOY A</span><h3 id="battleNameA">316L</h3></div>
            <label class="field-label" for="battlePresetA">Chemistry preset</label>
            <select id="battlePresetA" class="field-select">
              <option value="316L">316L</option>
              <option value="Ti64">Ti-6Al-4V</option>
              <option value="Inconel718">Inconel 718</option>
              <option value="Aermet340">Aermet 340</option>
              <option value="MaragingC300">Maraging C300</option>
              <option value="HastelloyC276">Hastelloy C-276</option>
              <option value="Haynes282">Haynes 282</option>
              <option value="Al7075">Al-7075-T6</option>
              <option value="316LVM">316LVM Surgical</option>
              <option value="custom">Custom mixture</option>
            </select>
            <label class="field-label" for="battleImportA">Import authentic designation</label>
            <select id="battleImportA" class="field-select battle-import">
              <option value="">Select designation...</option>
              <option value="Ti-6Al-4V ELI">Ti-6Al-4V ELI</option>
              <option value="Inconel 718 Plus">Inconel 718 Plus</option>
              <option value="AerMet 340">AerMet 340</option>
              <option value="Maraging C300">Maraging C300</option>
              <option value="Hastelloy C-276">Hastelloy C-276</option>
              <option value="Haynes 282">Haynes 282</option>
              <option value="Al-7075-T6">Al-7075-T6</option>
              <option value="316LVM Surgical">316LVM Surgical</option>
            </select>
            <div class="battle-custom-row">
              <input id="battleCustomA" type="text" placeholder="Custom: Fe:70, Cr:18, Ni:8." />
              <button class="btn btn-glass small" data-import-active="A">Import Active Studio Alloy</button>
            </div>
            <div class="range-head"><label for="battleTempA">Temperature</label><output id="battleTempAOut">25°C</output></div>
            <input id="battleTempA" type="range" min="-273.15" max="4500" step="1" value="25" />
            <div class="range-head"><label for="battleVelA">Velocity</label><output id="battleVelAOut">0 km/h</output></div>
            <input id="battleVelA" type="range" min="0" max="3500" step="5" value="0" />
            <div class="battle-verdict" id="battleVerdictA">Awaiting fight</div>
            <ul class="battle-stats" id="battleStatsA"></ul>
          </article>

          <div class="battle-center glass">
            <span class="battle-vs">VS</span>
            <div class="battle-winner" id="battleWinner">No result yet</div>
            <div class="battle-scoreline" id="battleScoreline">A 0 — 0 B</div>
            <button class="btn btn-glass small" id="swapBattle">Swap sides</button>
          </div>

          <article class="glass battle-card" id="battleCardB">
            <div class="battle-card-head"><span class="battle-tag tag-b">ALLOY B</span><h3 id="battleNameB">Ti-6Al-4V</h3></div>
            <label class="field-label" for="battlePresetB">Chemistry preset</label>
            <select id="battlePresetB" class="field-select">
              <option value="316L">316L</option>
              <option value="Ti64">Ti-6Al-4V</option>
              <option value="Inconel718">Inconel 718</option>
              <option value="Aermet340">Aermet 340</option>
              <option value="MaragingC300">Maraging C300</option>
              <option value="HastelloyC276">Hastelloy C-276</option>
              <option value="Haynes282">Haynes 282</option>
              <option value="Al7075">Al-7075-T6</option>
              <option value="316LVM">316LVM Surgical</option>
              <option value="custom">Custom mixture</option>
            </select>
            <label class="field-label" for="battleImportB">Import authentic designation</label>
            <select id="battleImportB" class="field-select battle-import">
              <option value="">Select designation...</option>
              <option value="Ti-6Al-4V ELI">Ti-6Al-4V ELI</option>
              <option value="Inconel 718 Plus">Inconel 718 Plus</option>
              <option value="AerMet 340">AerMet 340</option>
              <option value="Maraging C300">Maraging C300</option>
              <option value="Hastelloy C-276">Hastelloy C-276</option>
              <option value="Haynes 282">Haynes 282</option>
              <option value="Al-7075-T6">Al-7075-T6</option>
              <option value="316LVM Surgical">316LVM Surgical</option>
            </select>
            <div class="battle-custom-row">
              <input id="battleCustomB" type="text" placeholder="Custom: Ti:90, Al:6, V:4" />
              <button class="btn btn-glass small" data-import-active="B">Import Active Studio Alloy</button>
            </div>
            <div class="range-head"><label for="battleTempB">Temperature</label><output id="battleTempBOut">25°C</output></div>
            <input id="battleTempB" type="range" min="-273.15" max="4500" step="1" value="25" />
            <div class="range-head"><label for="battleVelB">Velocity</label><output id="battleVelBOut">0 km/h</output></div>
            <input id="battleVelB" type="range" min="0" max="3500" step="5" value="0" />
            <div class="battle-verdict" id="battleVerdictB">Awaiting fight</div>
            <ul class="battle-stats" id="battleStatsB"></ul>
          </article>
        </div>

        <div class="chart-box" id="battleRadar"></div>
        <div class="chart-box" id="battleBars"></div>

        <div class="table-wrap glass battle-table-wrap">
          <table class="data-table">
            <thead><tr><th>Metric</th><th>Specimen A</th><th>Specimen B</th><th>Advantage</th></tr></thead>
            <tbody id="battleResults"><tr class="empty-row"><td colspan="4">Run the arena to compare two chemistries.</td></tr></tbody>
          </table>
        </div>
      </section>'''

new_battle = '''<!-- ================= 2. ALLOY COMPARATIVE ANALYSIS ================= -->
      <section class="view" id="view-battle">
        <div class="section-head">
          <div>
            <span class="panel-kicker">ALLOY COMPARATIVE ANALYSIS</span>
            <h2>Alloy A vs. B Comparative Analysis</h2>
            <p>Two chemistries evaluated under identical service conditions with weighted metric comparison, radar visualization, and per-metric advantage determination.</p>
          </div>
          <span class="status-pill status-cyan" id="battleStatus">STANDBY</span>
        </div>

        <div class="battle-grid">
          <article class="glass battle-card" id="battleCardA">
            <div class="battle-card-head"><span class="battle-tag tag-a">SPECIMEN A</span><h3 id="battleNameA">316L</h3></div>
            <label class="field-label" for="battlePresetA">Chemistry preset</label>
            <select id="battlePresetA" class="field-select">
              <option value="316L">316L</option>
              <option value="Ti64">Ti-6Al-4V</option>
              <option value="Inconel718">Inconel 718</option>
              <option value="Aermet340">Aermet 340</option>
              <option value="MaragingC300">Maraging C300</option>
              <option value="HastelloyC276">Hastelloy C-276</option>
              <option value="Haynes282">Haynes 282</option>
              <option value="Al7075">Al-7075-T6</option>
              <option value="316LVM">316LVM Surgical</option>
              <option value="custom">Custom mixture</option>
            </select>
            <label class="field-label" for="battleImportA">Import validated designation</label>
            <select id="battleImportA" class="field-select battle-import">
              <option value="">Select designation...</option>
              <option value="Ti-6Al-4V ELI">Ti-6Al-4V ELI</option>
              <option value="Inconel 718 Plus">Inconel 718 Plus</option>
              <option value="AerMet 340">AerMet 340</option>
              <option value="Maraging C300">Maraging C300</option>
              <option value="Hastelloy C-276">Hastelloy C-276</option>
              <option value="Haynes 282">Haynes 282</option>
              <option value="Al-7075-T6">Al-7075-T6</option>
              <option value="316LVM Surgical">316LVM Surgical</option>
            </select>
            <div class="battle-custom-row">
              <input id="battleCustomA" type="text" placeholder="Custom: Fe:70, Cr:18, Ni:8." />
              <button class="btn btn-glass small" data-import-active="A">Import Active Studio Alloy</button>
            </div>
            <div class="range-head"><label for="battleTempA">Temperature</label><output id="battleTempAOut">25°C</output></div>
            <input id="battleTempA" type="range" min="-273.15" max="4500" step="1" value="25" />
            <div class="range-head"><label for="battleVelA">Velocity</label><output id="battleVelAOut">0 km/h</output></div>
            <input id="battleVelA" type="range" min="0" max="3500" step="5" value="0" />
            <div class="battle-verdict" id="battleVerdictA">Awaiting analysis</div>
            <ul class="battle-stats" id="battleStatsA"></ul>
          </article>

          <div class="battle-center glass">
            <span class="battle-vs">versus</span>
            <div class="battle-winner" id="battleWinner">No result available</div>
            <div class="battle-scoreline" id="battleScoreline">A 0 — 0 B</div>
            <button class="btn btn-glass small" id="swapBattle">Swap specimens</button>
          </div>

          <article class="glass battle-card" id="battleCardB">
            <div class="battle-card-head"><span class="battle-tag tag-b">SPECIMEN B</span><h3 id="battleNameB">Ti-6Al-4V</h3></div>
            <label class="field-label" for="battlePresetB">Chemistry preset</label>
            <select id="battlePresetB" class="field-select">
              <option value="316L">316L</option>
              <option value="Ti64">Ti-6Al-4V</option>
              <option value="Inconel718">Inconel 718</option>
              <option value="Aermet340">Aermet 340</option>
              <option value="MaragingC300">Maraging C300</option>
              <option value="HastelloyC276">Hastelloy C-276</option>
              <option value="Haynes282">Haynes 282</option>
              <option value="Al7075">Al-7075-T6</option>
              <option value="316LVM">316LVM Surgical</option>
              <option value="custom">Custom mixture</option>
            </select>
            <label class="field-label" for="battleImportB">Import validated designation</label>
            <select id="battleImportB" class="field-select battle-import">
              <option value="">Select designation...</option>
              <option value="Ti-6Al-4V ELI">Ti-6Al-4V ELI</option>
              <option value="Inconel 718 Plus">Inconel 718 Plus</option>
              <option value="AerMet 340">AerMet 340</option>
              <option value="Maraging C300">Maraging C300</option>
              <option value="Hastelloy C-276">Hastelloy C-276</option>
              <option value="Haynes 282">Haynes 282</option>
              <option value="Al-7075-T6">Al-7075-T6</option>
              <option value="316LVM Surgical">316LVM Surgical</option>
            </select>
            <div class="battle-custom-row">
              <input id="battleCustomB" type="text" placeholder="Custom: Ti:90, Al:6, V:4" />
              <button class="btn btn-glass small" data-import-active="B">Import Active Studio Alloy</button>
            </div>
            <div class="range-head"><label for="battleTempB">Temperature</label><output id="battleTempBOut">25°C</output></div>
            <input id="battleTempB" type="range" min="-273.15" max="4500" step="1" value="25" />
            <div class="range-head"><label for="battleVelB">Velocity</label><output id="battleVelBOut">0 km/h</output></div>
            <input id="battleVelB" type="range" min="0" max="3500" step="5" value="0" />
            <div class="battle-verdict" id="battleVerdictB">Awaiting analysis</div>
            <ul class="battle-stats" id="battleStatsB"></ul>
          </article>
        </div>

        <div class="chart-box" id="battleRadar"></div>
        <div class="chart-box" id="battleBars"></div>

        <div class="table-wrap glass battle-table-wrap">
          <table class="data-table">
            <thead><tr><th>Metric</th><th>Specimen A</th><th>Specimen B</th><th>Advantage</th></tr></thead>
            <tbody id="battleResults"><tr class="empty-row"><td colspan="4">Execute analysis to compare two chemistries.</td></tr></tbody>
          </table>
        </div>
      </section>'''

if old_battle in content:
    content = content.replace(old_battle, new_battle)
    print("First battle view updated")
else:
    print("First battle view NOT found")

# Now replace the second occurrence (around line 2239)
old_battle2 = '''<!-- ================= 2. ALLOY A VS. B BATTLE ARENA ================= -->
      <section class="view" id="view-battle">
        <div class="section-head">
          <div>
            <span class="panel-kicker">ALLOY A VS. B BATTLE ARENA</span>
            <h2>Alloy A vs. B Battle Arena</h2>
            <p>Two chemistries under identical service conditions, weighted category wins, radar overlay, per-metric winner table.</p>
          </div>
          <span class="status-pill status-cyan" id="battleStatus">STANDBY</span>
        </div>

        <div class="battle-grid">
          <article class="glass battle-card" id="battleCardA">
            <div class="battle-card-head"><span class="battle-tag tag-a">ALLOY A</span><h3 id="battleNameA">316L</h3></div>
            <label class="field-label" for="battlePresetA">Chemistry preset</label>
            <select id="battlePresetA" class="field-select">
              <option value="316L">316L</option>
              <option value="Ti64">Ti-6Al-4V</option>
              <option value="Inconel718">Inconel 718</option>
              <option value="Aermet340">Aermet 340</option>
              <option value="MaragingC300">Maraging C300</option>
              <option value="HastelloyC276">Hastelloy C-276</option>
              <option value="Haynes282">Haynes 282</option>
              <option value="Al7075">Al-7075-T6</option>
              <option value="316LVM">316LVM Surgical</option>
              <option value="custom">Custom mixture</option>
            </select>
            <label class="field-label" for="battleImportA">Import authentic designation</label>
            <select id="battleImportA" class="field-select battle-import">
              <option value="">Select designation...</option>
              <option value="Ti-6Al-4V ELI">Ti-6Al-4V ELI</option>
              <option value="Inconel 718 Plus">Inconel 718 Plus</option>
              <option value="AerMet 340">AerMet 340</option>
              <option value="Maraging C300">Maraging C300</option>
              <option value="Hastelloy C-276">Hastelloy C-276</option>
              <option value="Haynes 282">Haynes 282</option>
              <option value="Al-7075-T6">Al-7075-T6</option>
              <option value="316LVM Surgical">316LVM Surgical</option>
            </select>
            <div class="battle-custom-row">
              <input id="battleCustomA" type="text" placeholder="Custom: Fe:70, Cr:18, Ni:8." />
              <button class="btn btn-glass small" data-import-active="A">Import Active Studio Alloy</button>
            </div>
            <div class="range-head"><label for="battleTempA">Temperature</label><output id="battleTempAOut">25°C</output></div>
            <input id="battleTempA" type="range" min="-273.15" max="4500" step="1" value="25" />
            <div class="range-head"><label for="battleVelA">Velocity</label><output id="battleVelAOut">0 km/h</output></div>
            <input id="battleVelA" type="range" min="0" max="3500" step="5" value="0" />
            <div class="battle-verdict" id="battleVerdictA">Awaiting fight</div>
            <ul class="battle-stats" id="battleStatsA"></ul>
          </article>

          <div class="battle-center glass">
            <span class="battle-vs">VS</span>
            <div class="battle-winner" id="battleWinner">No result yet</div>
            <div class="battle-scoreline" id="battleScoreline">A 0 — 0 B</div>
            <button class="btn btn-glass small" id="swapBattle">Swap sides</button>
          </div>

          <article class="glass battle-card" id="battleCardB">
            <div class="battle-card-head"><span class="battle-tag tag-b">ALLOY B</span><h3 id="battleNameB">Ti-6Al-4V</h3></div>
            <label class="field-label" for="battlePresetB">Chemistry preset</label>
            <select id="battlePresetB" class="field-select">
              <option value="316L">316L</option>
              <option value="Ti64">Ti-6Al-4V</option>
              <option value="Inconel718">Inconel 718</option>
              <option value="Aermet340">Aermet 340</option>
              <option value="MaragingC300">Maraging C300</option>
              <option value="HastelloyC276">Hastelloy C-276</option>
              <option value="Haynes282">Haynes 282</option>
              <option value="Al7075">Al-7075-T6</option>
              <option value="316LVM">316LVM Surgical</option>
              <option value="custom">Custom mixture</option>
            </select>
            <label class="field-label" for="battleImportB">Import authentic designation</label>
            <select id="battleImportB" class="field-select battle-import">
              <option value="">Select designation...</option>
              <option value="Ti-6Al-4V ELI">Ti-6Al-4V ELI</option>
              <option value="Inconel 718 Plus">Inconel 718 Plus</option>
              <option value="AerMet 340">AerMet 340</option>
              <option value="Maraging C300">Maraging C300</option>
              <option value="Hastelloy C-276">Hastelloy C-276</option>
              <option value="Haynes 282">Haynes 282</option>
              <option value="Al-7075-T6">Al-7075-T6</option>
              <option value="316LVM Surgical">316LVM Surgical</option>
            </select>
            <div class="battle-custom-row">
              <input id="battleCustomB" type="text" placeholder="Custom: Ti:90, Al:6, V:4" />
              <button class="btn btn-glass small" data-import-active="B">Import Active Studio Alloy</button>
            </div>
            <div class="range-head"><label for="battleTempB">Temperature</label><output id="battleTempBOut">25°C</output></div>
            <input id="battleTempB" type="range" min="-273.15" max="4500" step="1" value="25" />
            <div class="range-head"><label for="battleVelB">Velocity</label><output id="battleVelBOut">0 km/h</output></div>
            <input id="battleVelB" type="range" min="0" max="3500" step="5" value="0" />
            <div class="battle-verdict" id="battleVerdictB">Awaiting fight</div>
            <ul class="battle-stats" id="battleStatsB"></ul>
          </article>
        </div>

        <div class="chart-box" id="battleRadar"></div>
        <div class="chart-box" id="battleBars"></div>

        <div class="table-wrap glass battle-table-wrap">
          <table class="data-table">
            <thead><tr><th>Metric</th><th>Specimen A</th><th>Specimen B</th><th>Advantage</th></tr></thead>
            <tbody id="battleResults"><tr class="empty-row"><td colspan="4">Run the arena to compare two chemistries.</td></tr></tbody>
          </table>
        </div>
      </section>'''

if old_battle2 in content:
    content = content.replace(old_battle2, new_battle)
    print("Second battle view updated")
else:
    print("Second battle view NOT found")

# Replace footer link
old_footer_link = '<a href="#" data-view="battle">Alloy A vs. B Battle Arena</a>'
new_footer_link = '<a href="#" data-view="battle">Alloy A vs. B Comparative Analysis</a>'
content = content.replace(old_footer_link, new_footer_link)

# Replace other battle references in text
content = content.replace('Battle Arena + leaderboard', 'Comparative Analysis + Discovery Registry')
content = content.replace('battle arena', 'comparative analysis')
content = content.replace('battle-arena', 'comparative-analysis')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")