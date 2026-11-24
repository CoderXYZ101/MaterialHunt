/* ==========================================================================
   MATERIALHUNT — practical tools layer
   Closest-grade + ₹ price matcher, manufacturability badges, plain-English verdict,
   Failure Doctor, BOM cost-down scanner, 1-page RFQ / NABL test sheet, design challenge.
   Loaded after app.js. All figures are indicative screening values, not certified data.
   ========================================================================== */
'use strict';

(function () {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (value, digits = 0) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rupee = (v) => `₹${num(v)}`;
  const mid = (range) => (range[0] + range[1]) / 2;
  const notify = (msg, type = 'info', ms) => { if (typeof toast === 'function') toast(msg, type, ms); };

  /* ------------------------------------------------------------------ */
  /* Commercial grade library (nominal composition, typical properties)  */
  /* y = yield MPa (typical supplied condition), t = max continuous      */
  /* service °C, d = density g/cm³, price = indicative ₹/kg stockist     */
  /* range, av = stock | order | import, m = machinability, w = weld,    */
  /* am = metal 3D-printing, c = corrosion resistance 0-3                */
  /* ------------------------------------------------------------------ */
  const grade = (id, name, family, comp, props) => {
    const c = { ...comp };
    if (c.bal) {
      const sum = Object.entries(c).filter(([k]) => k !== 'bal').reduce((a, [, v]) => a + v, 0);
      c[c.bal] = Math.round((100 - sum) * 100) / 100;
      delete c.bal;
    }
    return { id, name, family, comp: c, ...props };
  };
  const GRADES = [
    // ---- Carbon & low-alloy steels
    grade('e250', 'Mild steel E250', 'Carbon steel', { C: 0.2, Mn: 0.8, Si: 0.2, bal: 'Fe' }, { al: ['e250', 'mildsteel', 'ms', 'a36', 'is2062', 'structuralsteel'], y: 250, uts: 410, t: 400, d: 7.85, price: [55, 75], av: 'stock', std: { astm: 'A36', is: 'IS 2062 E250', en: 'S235 / S275' }, m: 'easy', w: 'good', am: 'possible', c: 0, s: 'BCC', cryo: false }),
    grade('e350', 'Structural steel E350', 'Carbon steel', { C: 0.22, Mn: 1.4, Si: 0.3, bal: 'Fe' }, { al: ['e350', 'a572', 'is2062e350'], y: 350, uts: 490, t: 400, d: 7.85, price: [60, 80], av: 'stock', std: { astm: 'A572 Gr 50', is: 'IS 2062 E350', en: 'S355' }, m: 'easy', w: 'good', am: 'possible', c: 0, s: 'BCC', cryo: false }),
    grade('en8', 'Medium-carbon steel EN8', 'Carbon steel', { C: 0.45, Mn: 0.8, Si: 0.25, bal: 'Fe' }, { al: ['en8', '1045', 'c45', '45c8', '080m40', 'aisi1045'], y: 450, uts: 700, t: 400, d: 7.85, price: [70, 95], av: 'stock', std: { astm: 'AISI 1045', is: 'IS 1570 45C8', en: 'EN8 / C45' }, m: 'easy', w: 'fair', am: 'possible', c: 0, s: 'BCC', cryo: false }),
    grade('en19', 'Chrome-moly steel EN19 (4140)', 'Low-alloy steel', { C: 0.4, Mn: 0.9, Cr: 1.0, Mo: 0.2, Si: 0.25, bal: 'Fe' }, { al: ['en19', '4140', 'aisi4140', '709m40', '42crmo4', 'cromoly'], y: 900, uts: 1000, t: 450, d: 7.85, price: [95, 135], av: 'stock', std: { astm: 'AISI 4140', is: 'IS 1570 (40Cr1Mo28)', en: 'EN19 / 42CrMo4' }, m: 'moderate', w: 'fair', am: 'possible', c: 0, s: 'BCC', cryo: false }),
    grade('en24', 'Nickel-chrome-moly steel EN24 (4340)', 'Low-alloy steel', { C: 0.4, Mn: 0.7, Cr: 0.8, Ni: 1.8, Mo: 0.25, Si: 0.25, bal: 'Fe' }, { al: ['en24', '4340', 'aisi4340', '817m40', '34crnimo6'], y: 1000, uts: 1200, t: 450, d: 7.85, price: [140, 190], av: 'stock', std: { astm: 'AISI 4340', is: 'IS 1570', en: 'EN24 / 34CrNiMo6' }, m: 'moderate', w: 'poor', am: 'possible', c: 0, s: 'BCC', cryo: false }),
    grade('ni9', '9% nickel steel (cryogenic)', 'Low-alloy steel', { C: 0.1, Mn: 0.6, Ni: 9, bal: 'Fe' }, { al: ['9ni', '9nickel', 'a553', 'a353'], y: 585, uts: 690, t: 300, d: 7.85, price: [220, 300], av: 'order', std: { astm: 'A553 Type I', is: '-', en: 'X7Ni9' }, m: 'moderate', w: 'fair', am: 'no', c: 0, s: 'BCC', cryo: true }),
    grade('d2', 'Tool steel D2', 'Tool steel', { C: 1.55, Cr: 12, Mo: 0.8, V: 0.9, bal: 'Fe' }, { al: ['d2', 'tooldsteel', 'hcr', 'x153crmov12', '12379'], y: 1500, uts: 1900, t: 425, d: 7.7, price: [250, 380], av: 'stock', std: { astm: 'AISI D2', is: 'IS 3748 (T 160 Cr12 Mo1)', en: '1.2379' }, m: 'hard', w: 'poor', am: 'possible', c: 1, s: 'BCC', cryo: false }),
    grade('h13', 'Hot-work tool steel H13', 'Tool steel', { C: 0.4, Cr: 5.2, Mo: 1.4, V: 1.0, Si: 1.0, bal: 'Fe' }, { al: ['h13', 'hotworksteel', '12344'], y: 1300, uts: 1500, t: 540, d: 7.8, price: [260, 400], av: 'stock', std: { astm: 'AISI H13', is: '-', en: '1.2344' }, m: 'moderate', w: 'poor', am: 'proven', c: 1, s: 'BCC', cryo: false }),
    grade('maraging', 'Maraging steel 18Ni300', 'Specialty steel', { Ni: 18, Co: 9, Mo: 5, Ti: 0.7, Al: 0.1, bal: 'Fe' }, { al: ['maraging', '18ni300', 'm300', 'maraging300'], y: 1900, uts: 2000, t: 400, d: 8.0, price: [4000, 6500], av: 'import', std: { astm: 'AMS 6514', is: '-', en: '1.2709' }, m: 'moderate', w: 'fair', am: 'proven', c: 1, s: 'BCC', cryo: false }),
    grade('greyci', 'Grey cast iron FG260', 'Cast iron', { C: 3.3, Si: 2.0, Mn: 0.7, bal: 'Fe' }, { al: ['fg260', 'greycastiron', 'castiron', 'ci', 'fg200', 'a48'], y: 200, uts: 260, t: 350, d: 7.1, price: [60, 90], av: 'stock', std: { astm: 'A48 Class 40', is: 'IS 210 FG 260', en: 'EN-GJL-250' }, m: 'easy', w: 'poor', am: 'no', c: 1, s: 'BCC', cryo: false }),
    // ---- Stainless steels
    grade('ss304', 'Stainless steel 304', 'Stainless steel', { C: 0.04, Cr: 18.5, Ni: 9, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['ss304', '304', 's30400', '18/8', '18-8', '04cr18ni10'], y: 215, uts: 505, t: 870, d: 8.0, price: [220, 290], av: 'stock', std: { astm: 'A240 / UNS S30400', is: 'IS 6911 04Cr18Ni10', en: '1.4301' }, m: 'moderate', w: 'good', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('ss304l', 'Stainless steel 304L', 'Stainless steel', { C: 0.02, Cr: 18.5, Ni: 9.5, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['ss304l', '304l', 's30403', '02cr19ni10'], y: 170, uts: 485, t: 870, d: 8.0, price: [230, 300], av: 'stock', std: { astm: 'A240 / UNS S30403', is: 'IS 6911 02Cr19Ni10', en: '1.4307' }, m: 'moderate', w: 'good', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('ss316', 'Stainless steel 316', 'Stainless steel', { C: 0.04, Cr: 17, Ni: 12, Mo: 2.5, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['ss316', '316', 's31600', '04cr17ni12mo2'], y: 205, uts: 515, t: 870, d: 8.0, price: [330, 420], av: 'stock', std: { astm: 'A240 / UNS S31600', is: 'IS 6911 04Cr17Ni12Mo2', en: '1.4401' }, m: 'moderate', w: 'good', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('ss316l', 'Stainless steel 316L', 'Stainless steel', { C: 0.02, Cr: 17, Ni: 12, Mo: 2.5, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['ss316l', '316l', 's31603', '02cr17ni12mo2'], y: 200, uts: 485, t: 870, d: 8.0, price: [340, 430], av: 'stock', std: { astm: 'A240 / UNS S31603', is: 'IS 6911 02Cr17Ni12Mo2', en: '1.4404' }, m: 'moderate', w: 'good', am: 'proven', c: 2, s: 'FCC', cryo: true }),
    grade('ss321', 'Stainless steel 321', 'Stainless steel', { C: 0.04, Cr: 17.5, Ni: 9.5, Ti: 0.4, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['ss321', '321', 's32100'], y: 205, uts: 515, t: 900, d: 8.0, price: [300, 380], av: 'stock', std: { astm: 'A240 / UNS S32100', is: 'IS 6911 04Cr18Ni10Ti20', en: '1.4541' }, m: 'moderate', w: 'good', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('ss310', 'Stainless steel 310S (heat resistant)', 'Stainless steel', { C: 0.06, Cr: 25, Ni: 20, Mn: 1.5, Si: 0.7, bal: 'Fe' }, { al: ['ss310', '310', '310s', 's31008'], y: 205, uts: 515, t: 1100, d: 7.9, price: [450, 600], av: 'order', std: { astm: 'A240 / UNS S31008', is: '-', en: '1.4845' }, m: 'moderate', w: 'good', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('ss410', 'Stainless steel 410 (martensitic)', 'Stainless steel', { C: 0.12, Cr: 12, Mn: 0.8, Si: 0.4, bal: 'Fe' }, { al: ['ss410', '410', 's41000'], y: 275, uts: 480, t: 650, d: 7.75, price: [180, 240], av: 'stock', std: { astm: 'A240 / UNS S41000', is: 'IS 6911 12Cr13', en: '1.4006' }, m: 'moderate', w: 'poor', am: 'possible', c: 1, s: 'BCC', cryo: false }),
    grade('ss430', 'Stainless steel 430 (ferritic)', 'Stainless steel', { C: 0.06, Cr: 17, Mn: 0.8, Si: 0.5, bal: 'Fe' }, { al: ['ss430', '430', 's43000'], y: 260, uts: 450, t: 815, d: 7.7, price: [170, 230], av: 'stock', std: { astm: 'A240 / UNS S43000', is: 'IS 6911 04Cr17', en: '1.4016' }, m: 'moderate', w: 'fair', am: 'possible', c: 1, s: 'BCC', cryo: false }),
    grade('ss174', 'Stainless steel 17-4PH', 'Stainless steel', { C: 0.05, Cr: 16.5, Ni: 4, Cu: 4, Nb: 0.3, Mn: 0.7, Si: 0.5, bal: 'Fe' }, { al: ['174ph', '17-4ph', '17-4', 'ss17-4', 's17400', '630'], y: 1000, uts: 1100, t: 315, d: 7.8, price: [550, 750], av: 'order', std: { astm: 'A564 / UNS S17400', is: '-', en: '1.4542' }, m: 'moderate', w: 'fair', am: 'proven', c: 2, s: 'BCC', cryo: false }),
    grade('du2205', 'Duplex stainless 2205', 'Stainless steel', { C: 0.02, Cr: 22, Ni: 5.5, Mo: 3.1, N: 0.17, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['2205', 'duplex2205', 'duplex', 's32205', 's31803', 'f51'], y: 450, uts: 655, t: 300, d: 7.8, price: [450, 600], av: 'order', std: { astm: 'A240 / UNS S32205', is: '-', en: '1.4462' }, m: 'hard', w: 'fair', am: 'possible', c: 3, s: 'FCC', cryo: false }),
    grade('du2507', 'Super duplex 2507', 'Stainless steel', { C: 0.02, Cr: 25, Ni: 7, Mo: 4, N: 0.27, Mn: 1, Si: 0.5, bal: 'Fe' }, { al: ['2507', 'superduplex', 's32750', 'f53'], y: 550, uts: 795, t: 300, d: 7.8, price: [650, 900], av: 'import', std: { astm: 'A240 / UNS S32750', is: '-', en: '1.4410' }, m: 'hard', w: 'fair', am: 'possible', c: 3, s: 'FCC', cryo: false }),
    grade('ss904l', 'Super austenitic 904L', 'Stainless steel', { C: 0.02, Cr: 20, Ni: 25, Mo: 4.5, Cu: 1.5, Mn: 1.5, Si: 0.5, bal: 'Fe' }, { al: ['904l', 'ss904l', 'n08904'], y: 220, uts: 490, t: 400, d: 8.0, price: [700, 1000], av: 'import', std: { astm: 'A240 / UNS N08904', is: '-', en: '1.4539' }, m: 'moderate', w: 'good', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    // ---- Aluminium alloys
    grade('al6061', 'Aluminium 6061-T6', 'Aluminium', { Mg: 1.0, Si: 0.6, Cu: 0.28, Cr: 0.2, bal: 'Al' }, { al: ['6061', 'al6061', '6061t6', 'a96061'], y: 275, uts: 310, t: 150, d: 2.7, price: [320, 420], av: 'stock', std: { astm: 'AA 6061-T6', is: '-', en: 'EN AW-6061' }, m: 'easy', w: 'good', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('al6063', 'Aluminium 6063-T6 (extrusion)', 'Aluminium', { Mg: 0.7, Si: 0.4, bal: 'Al' }, { al: ['6063', 'al6063', 'he9'], y: 215, uts: 245, t: 150, d: 2.7, price: [260, 340], av: 'stock', std: { astm: 'AA 6063-T6', is: 'IS 733 HE9', en: 'EN AW-6063' }, m: 'easy', w: 'good', am: 'no', c: 2, s: 'FCC', cryo: true }),
    grade('al7075', 'Aluminium 7075-T6', 'Aluminium', { Zn: 5.6, Mg: 2.5, Cu: 1.6, Cr: 0.23, bal: 'Al' }, { al: ['7075', 'al7075', '7075t6', 'a97075'], y: 503, uts: 572, t: 120, d: 2.81, price: [520, 700], av: 'stock', std: { astm: 'AA 7075-T6', is: '-', en: 'EN AW-7075' }, m: 'easy', w: 'poor', am: 'no', c: 1, s: 'FCC', cryo: true }),
    grade('al2024', 'Aluminium 2024-T3', 'Aluminium', { Cu: 4.4, Mg: 1.5, Mn: 0.6, bal: 'Al' }, { al: ['2024', 'al2024', '2024t3'], y: 345, uts: 483, t: 120, d: 2.78, price: [450, 600], av: 'order', std: { astm: 'AA 2024-T3', is: '-', en: 'EN AW-2024' }, m: 'easy', w: 'poor', am: 'no', c: 1, s: 'FCC', cryo: true }),
    grade('al5083', 'Aluminium 5083-H116 (marine)', 'Aluminium', { Mg: 4.4, Mn: 0.7, Cr: 0.15, bal: 'Al' }, { al: ['5083', 'al5083', 'h116'], y: 215, uts: 305, t: 65, d: 2.66, price: [350, 460], av: 'order', std: { astm: 'AA 5083-H116', is: '-', en: 'EN AW-5083' }, m: 'moderate', w: 'good', am: 'no', c: 3, s: 'FCC', cryo: true }),
    grade('al5052', 'Aluminium 5052-H32', 'Aluminium', { Mg: 2.5, Cr: 0.25, bal: 'Al' }, { al: ['5052', 'al5052'], y: 195, uts: 230, t: 100, d: 2.68, price: [280, 360], av: 'stock', std: { astm: 'AA 5052-H32', is: '-', en: 'EN AW-5052' }, m: 'moderate', w: 'good', am: 'no', c: 3, s: 'FCC', cryo: true }),
    grade('alsi10mg', 'Aluminium AlSi10Mg (cast / 3D-print)', 'Aluminium', { Si: 10, Mg: 0.35, bal: 'Al' }, { al: ['alsi10mg', 'a360', 'al10mg'], y: 230, uts: 350, t: 160, d: 2.67, price: [350, 600], av: 'order', std: { astm: 'ASTM B85 / A360', is: '-', en: 'EN AC-43000' }, m: 'moderate', w: 'fair', am: 'proven', c: 2, s: 'FCC', cryo: true }),
    // ---- Titanium
    grade('ti2', 'Titanium Grade 2 (commercially pure)', 'Titanium', { bal: 'Ti' }, { al: ['ti2', 'grade2', 'gr2', 'cptitanium', 'titaniumgrade2'], y: 275, uts: 345, t: 300, d: 4.51, price: [1800, 2800], av: 'order', std: { astm: 'B265 Gr 2', is: '-', en: '3.7035' }, m: 'hard', w: 'good', am: 'possible', c: 3, s: 'HCP', cryo: true }),
    grade('ti64', 'Titanium Ti-6Al-4V (Grade 5)', 'Titanium', { Al: 6, V: 4, bal: 'Ti' }, { al: ['ti6al4v', 'ti64', 'grade5', 'gr5', 'titanium64', 'r56400'], y: 880, uts: 950, t: 400, d: 4.43, price: [3500, 5500], av: 'import', std: { astm: 'B265 Gr 5 / AMS 4911', is: '-', en: '3.7165' }, m: 'hard', w: 'fair', am: 'proven', c: 3, s: 'HCP', cryo: true }),
    // ---- Copper alloys
    grade('cuetp', 'Copper (ETP, C11000)', 'Copper alloy', { bal: 'Cu' }, { al: ['c11000', 'copper', 'cuetp', 'etpcopper', 'cu'], y: 120, uts: 220, t: 200, d: 8.94, price: [800, 950], av: 'stock', std: { astm: 'B152 / UNS C11000', is: 'IS 191 Cu-ETP', en: 'CW004A' }, m: 'moderate', w: 'fair', am: 'possible', c: 2, s: 'FCC', cryo: true }),
    grade('brass70', 'Brass 70/30 (C26000)', 'Copper alloy', { Cu: 70, bal: 'Zn' }, { al: ['c26000', 'brass', 'cartridgebrass', 'brass7030', 'cz106'], y: 150, uts: 340, t: 200, d: 8.53, price: [520, 650], av: 'stock', std: { astm: 'B36 / UNS C26000', is: 'IS 410 (CuZn30)', en: 'CW505L' }, m: 'easy', w: 'fair', am: 'no', c: 1, s: 'FCC', cryo: true }),
    grade('brassfc', 'Free-cutting brass (C36000)', 'Copper alloy', { Cu: 61.5, Pb: 3.0, bal: 'Zn' }, { al: ['c36000', 'freecuttingbrass', 'fcbrass', 'cz121'], y: 310, uts: 400, t: 200, d: 8.5, price: [480, 600], av: 'stock', std: { astm: 'B16 / UNS C36000', is: 'IS 319', en: 'CW603N' }, m: 'easy', w: 'poor', am: 'no', c: 1, s: 'FCC', cryo: true, lead: true }),
    grade('phbronze', 'Phosphor bronze (C51000)', 'Copper alloy', { Sn: 5, P: 0.2, bal: 'Cu' }, { al: ['c51000', 'phosphorbronze', 'phbronze', 'pb1'], y: 380, uts: 470, t: 200, d: 8.86, price: [750, 950], av: 'stock', std: { astm: 'B103 / UNS C51000', is: 'IS 7814', en: 'CW451K' }, m: 'moderate', w: 'fair', am: 'no', c: 2, s: 'FCC', cryo: true }),
    grade('albronze', 'Aluminium bronze (C95400)', 'Copper alloy', { Al: 11, Fe: 4, bal: 'Cu' }, { al: ['c95400', 'aluminiumbronze', 'albronze', 'alumbronze'], y: 275, uts: 550, t: 300, d: 7.45, price: [700, 900], av: 'order', std: { astm: 'B148 / UNS C95400', is: '-', en: 'CC333G' }, m: 'moderate', w: 'fair', am: 'no', c: 3, s: 'FCC', cryo: true }),
    // ---- Nickel & high-temperature alloys
    grade('in718', 'Inconel 718', 'Nickel superalloy', { Cr: 19, Fe: 18, Nb: 5.1, Mo: 3, Ti: 0.9, Al: 0.5, bal: 'Ni' }, { al: ['inconel718', 'in718', '718', 'n07718', 'alloy718'], y: 1035, uts: 1240, t: 700, d: 8.19, price: [2800, 4500], av: 'import', std: { astm: 'B637 / UNS N07718', is: '-', en: '2.4668' }, m: 'hard', w: 'fair', am: 'proven', c: 3, s: 'FCC', cryo: true }),
    grade('in625', 'Inconel 625', 'Nickel superalloy', { Cr: 21.5, Mo: 9, Nb: 3.6, Fe: 2.5, bal: 'Ni' }, { al: ['inconel625', 'in625', '625', 'n06625', 'alloy625'], y: 415, uts: 830, t: 980, d: 8.44, price: [2800, 4200], av: 'import', std: { astm: 'B443 / UNS N06625', is: '-', en: '2.4856' }, m: 'hard', w: 'good', am: 'proven', c: 3, s: 'FCC', cryo: true }),
    grade('in600', 'Inconel 600', 'Nickel superalloy', { Cr: 15.5, Fe: 8, bal: 'Ni' }, { al: ['inconel600', 'in600', '600', 'n06600', 'alloy600'], y: 250, uts: 655, t: 1090, d: 8.47, price: [2600, 3800], av: 'import', std: { astm: 'B168 / UNS N06600', is: '-', en: '2.4816' }, m: 'hard', w: 'good', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    grade('h230', 'Haynes 230', 'Nickel superalloy', { Cr: 22, W: 14, Mo: 2, Fe: 1.5, bal: 'Ni' }, { al: ['haynes230', 'h230', 'alloy230', 'n06230'], y: 390, uts: 860, t: 1150, d: 8.97, price: [4500, 7000], av: 'import', std: { astm: 'B435 / UNS N06230', is: '-', en: '2.4733' }, m: 'hard', w: 'good', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    grade('c276', 'Hastelloy C-276', 'Nickel superalloy', { Mo: 16, Cr: 15.5, Fe: 5, W: 3.7, bal: 'Ni' }, { al: ['c276', 'hastelloyc276', 'hastelloy', 'n10276'], y: 355, uts: 790, t: 1000, d: 8.89, price: [3500, 5500], av: 'import', std: { astm: 'B575 / UNS N10276', is: '-', en: '2.4819' }, m: 'hard', w: 'good', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    grade('monel400', 'Monel 400', 'Nickel alloy', { Cu: 31.5, Fe: 1.5, Mn: 1, bal: 'Ni' }, { al: ['monel400', 'monel', 'n04400', 'alloy400'], y: 240, uts: 550, t: 540, d: 8.8, price: [1800, 2800], av: 'order', std: { astm: 'B164 / UNS N04400', is: '-', en: '2.4360' }, m: 'moderate', w: 'good', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    grade('monelk500', 'Monel K-500 (age-hardened)', 'Nickel alloy', { Cu: 29.5, Al: 2.8, Ti: 0.5, Fe: 1, Mn: 0.8, bal: 'Ni' }, { al: ['monelk500', 'k500', 'k-500', 'n05500', 'alloy k500'], y: 790, uts: 1100, t: 480, d: 8.44, price: [3000, 4500], av: 'import', std: { astm: 'B865 / UNS N05500', is: '-', en: '2.4375' }, m: 'moderate', w: 'fair', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    grade('ni200', 'Nickel 200', 'Nickel alloy', { bal: 'Ni' }, { al: ['nickel200', 'ni200', 'n02200', 'purenickel'], y: 150, uts: 450, t: 315, d: 8.89, price: [1700, 2500], av: 'order', std: { astm: 'B160 / UNS N02200', is: '-', en: '2.4066' }, m: 'moderate', w: 'good', am: 'possible', c: 3, s: 'FCC', cryo: true }),
    grade('stellite6', 'Stellite 6 (cobalt wear alloy)', 'Cobalt alloy', { Cr: 28, W: 4.5, C: 1.2, Fe: 2, bal: 'Co' }, { al: ['stellite6', 'stellite', 'cocr'], y: 650, uts: 900, t: 800, d: 8.4, price: [3500, 6000], av: 'import', std: { astm: 'AMS 5894', is: '-', en: '-' }, m: 'hard', w: 'poor', am: 'possible', c: 3, s: 'FCC', cryo: false }),
    grade('tzm', 'Molybdenum TZM', 'Refractory metal', { Ti: 0.5, Zr: 0.08, bal: 'Mo' }, { al: ['tzm', 'molybdenum', 'moly'], y: 560, uts: 690, t: 1400, d: 10.2, price: [6000, 9000], av: 'import', std: { astm: 'B386 / R03630', is: '-', en: '-' }, m: 'hard', w: 'poor', am: 'possible', c: 2, s: 'BCC', cryo: false }),
    grade('tungsten', 'Tungsten (pure)', 'Refractory metal', { bal: 'W' }, { al: ['tungsten', 'w', 'wolfram'], y: 750, uts: 980, t: 2000, d: 19.3, price: [5000, 8000], av: 'import', std: { astm: 'B760 / R07005', is: '-', en: '-' }, m: 'hard', w: 'poor', am: 'possible', c: 2, s: 'BCC', cryo: false }),
    grade('mgaz31', 'Magnesium AZ31B', 'Magnesium', { Al: 3, Zn: 1, Mn: 0.3, bal: 'Mg' }, { al: ['az31', 'az31b', 'magnesium'], y: 200, uts: 260, t: 120, d: 1.77, price: [450, 650], av: 'order', std: { astm: 'B90 / AZ31B', is: '-', en: 'MgAl3Zn1' }, m: 'easy', w: 'fair', am: 'possible', c: 1, s: 'HCP', cryo: false }),
  ];
  const BY_ID = Object.fromEntries(GRADES.map((g) => [g.id, g]));
  const AVAIL = {
    stock: { label: 'Readily stocked in India', tone: 'good' },
    order: { label: 'Orderable in India, typically 2-4 weeks', tone: 'warn' },
    import: { label: 'Mostly imported, expect 6+ weeks', tone: 'bad' },
    custom: { label: 'Custom melt, request a quote', tone: 'bad' },
  };

  /* ------------------------------------------------------------------ */
  /* Matching                                                            */
  /* ------------------------------------------------------------------ */
  function normalise(comp) {
    const entries = Object.entries(comp || {}).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0);
    const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
    return Object.fromEntries(entries.map(([k, v]) => [k, (v / total) * 100]));
  }

  function overlap(a, b) {
    let sum = 0;
    Object.keys(a).forEach((el) => { if (b[el]) sum += Math.min(a[el], b[el]); });
    return sum;
  }

  function matchGrades(comp, limit = 3) {
    const user = normalise(comp);
    return GRADES.map((g) => ({ grade: g, score: overlap(user, g.comp) })).sort((x, y) => y.score - x.score).slice(0, limit);
  }

  function findGrade(text) {
    const key = String(text || '').toLowerCase().replace(/[^a-z0-9/]/g, '');
    const compact = key.replace(/\//g, '');
    let best = null;
    let bestLen = 0;
    GRADES.forEach((g) => {
      g.al.concat([g.id]).forEach((alias) => {
        const a = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (a && (compact === a || compact.includes(a)) && a.length > bestLen) { best = g; bestLen = a.length; }
      });
    });
    return best;
  }

  const FEAS = {
    m: { easy: ['good', 'Easy to machine'], moderate: ['warn', 'Moderate, use carbide tools'], hard: ['bad', 'Hard, rigid setup + carbide/ceramic tools'] },
    w: { good: ['good', 'Welds well'], fair: ['warn', 'Weldable with care (preheat / filler)'], poor: ['bad', 'Prone to cracking when welded'] },
    am: { proven: ['good', 'Printable (DMLS/SLM), commonly offered'], possible: ['warn', 'Possible, limited powder and process data'], no: ['bad', 'Not practical to 3D-print'] },
  };

  function heuristicFeasibility(comp) {
    const c = normalise(comp);
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0] || ['Fe', 100];
    const [el] = top;
    if (el === 'Al' || el === 'Mg') return { m: 'easy', w: 'fair', am: 'possible' };
    if (el === 'Ti' || el === 'Ni' || el === 'Co' || el === 'W' || el === 'Mo' || el === 'Nb') return { m: 'hard', w: 'fair', am: 'possible' };
    if (el === 'Cu') return { m: 'moderate', w: 'fair', am: 'possible' };
    const hard = (c.Cr || 0) + (c.Ni || 0) + (c.Mo || 0) + (c.V || 0) > 20;
    return { m: hard ? 'moderate' : 'easy', w: hard ? 'fair' : 'good', am: 'possible' };
  }

  function describeMatch(comp, sim) {
    const [first, ...rest] = matchGrades(comp, 3);
    const strong = first.score >= 80;
    const g = first.grade;
    const cost = sim?.derived?.cost_per_kg;
    const feas = strong ? { m: g.m, w: g.w, am: g.am } : heuristicFeasibility(comp);
    return {
      best: first, others: rest, strong,
      price: strong ? g.price : null,
      rawCost: cost,
      avail: strong ? g.av : 'custom',
      feas,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Plain-English verdict + grade card (injected under #verdictCard)    */
  /* ------------------------------------------------------------------ */
  function plainEnglish(sim) {
    const d = sim.derived;
    const req = state.simRequest || {};
    const tC = sim.conditions?.temperature_c ?? req.temperature_c ?? 25;
    const load = req.load_mpa ?? 0;
    const use = Math.round((d.utilization_ratio || 0) * 100);
    const formula = 'This alloy';
    const verdict = d.verdict;
    const heads = {
      SAFE: ['good', 'It holds', `${formula} should hold up under these conditions.`],
      MARGINAL: ['warn', 'It might hold, with little margin', `${formula} may survive, but there is not much safety margin.`],
      UNSAFE: ['bad', 'It would likely fail', `${formula} is likely to bend, crack or yield under these conditions.`],
      MELTED: ['bad', 'It would melt', `At ${num(tC)}°C this alloy is past its melting range, so it cannot carry any load.`],
    };
    if (d.is_gas) heads.MELTED = ['bad', 'Not a structural material', 'This mix is mostly a gas at ordinary conditions, so it cannot form a solid part at all. Add metals to build an alloy.'];
    else if (d.is_vaporized) heads.MELTED = ['bad', 'It would vaporise', `At ${num(tC)}°C the main elements are past their boiling point, so the material boils away instead of holding load.`];
    const [tone, title, line] = heads[verdict] || ['warn', verdict, formula];
    const bits = [];
    if (d.is_gas || d.is_vaporized) {
      bits.push(`Phase at ${num(tC)}°C: <b>gas / vapour</b>.`);
    } else if (verdict !== 'MELTED') {
      bits.push(`At ${num(tC)}°C it keeps about <b>${num(d.operating_strength_mpa)} MPa</b> of strength. Your load is <b>${num(load)} MPa</b>, so you are using about <b>${use}%</b> of the capacity you allowed for.`);
    } else if (d.liquidus_c) {
      bits.push(`It starts to melt at roughly <b>${num(d.liquidus_c)}°C</b>.`);
    }
    bits.push(`It weighs <b>${Number(d.density_gcm3).toFixed(2)} g/cm³</b> (steel is about 7.8) and the raw material costs about <b>${rupee(d.cost_per_kg)}/kg</b>.`);
    let next = '';
    if (verdict === 'UNSAFE' || verdict === 'MARGINAL') next = 'Try lowering the load, thickening the part, or switching to a stronger grade. The Failure Doctor can suggest one.';
    if (verdict === 'MELTED') next = d.is_gas ? 'Choose metals such as iron, nickel or titanium and set realistic conditions.' : d.is_vaporized ? 'Lower the temperature, or use a refractory metal such as tungsten or molybdenum.' : 'Pick a high-temperature grade such as a nickel superalloy, or lower the temperature.';
    if (verdict === 'SAFE') next = 'Next: check the closest real grade and price below, then generate an RFQ.';
    return { tone, title, line, bits, next };
  }

  function ensureCards() {
    const verdict = q('#verdictCard');
    if (!verdict) return {};
    let plain = q('#plainVerdict');
    if (!plain) {
      plain = document.createElement('article');
      plain.id = 'plainVerdict';
      plain.className = 'plain-verdict glass';
      verdict.parentNode.insertBefore(plain, verdict);
    }
    let card = q('#gradeCard');
    if (!card) {
      card = document.createElement('article');
      card.id = 'gradeCard';
      card.className = 'grade-card glass';
      verdict.parentNode.insertBefore(card, verdict.nextSibling);
    }
    return { plain, card };
  }

  const pill = (tone, text) => `<span class="feas feas-${tone}">${esc(text)}</span>`;

  function renderPlain(sim) {
    const { plain } = ensureCards();
    if (!plain) return;
    const p = plainEnglish(sim);
    plain.className = `plain-verdict glass tone-${p.tone}`;
    plain.innerHTML = `
      <div class="pv-head"><span class="pv-kicker">IN PLAIN ENGLISH</span><h3>${esc(p.title)}</h3></div>
      <p class="pv-line">${esc(p.line)}</p>
      <ul class="pv-bits">${p.bits.map((b) => `<li>${b}</li>`).join('')}</ul>
      ${p.next ? `<p class="pv-next">${esc(p.next)}</p>` : ''}`;
  }

  function renderGradeCard(sim) {
    const { card } = ensureCards();
    if (!card) return;
    const comp = typeof normalisedComposition === 'function' ? normalisedComposition() : (sim.composition?.fractions || {});
    const info = describeMatch(comp, sim);
    const g = info.best.grade;
    window.MH_TOOLS.lastMatch = info;
    const score = Math.round(info.best.score);
    const stds = [g.std.astm, g.std.is !== '-' ? g.std.is : '', g.std.en !== '-' ? g.std.en : ''].filter(Boolean);
    const av = AVAIL[info.avail];
    const priceHtml = info.price
      ? `<strong>${rupee(info.price[0])} - ${rupee(info.price[1])}<small> /kg</small></strong><span>Indicative stockist range. Confirm with a supplier.</span>`
      : `<strong>Raw metal ≈ ${rupee(info.rawCost || 0)}<small> /kg</small></strong><span>No commercial equivalent: specialty melts cost more. Request a quote.</span>`;
    card.innerHTML = `
      <div class="gc-head">
        <div><span class="pv-kicker">REAL-WORLD MATCH</span><h3>${info.strong ? `Closest grade: ${esc(g.name)}` : 'Custom alloy, no close commercial grade'}</h3></div>
        <span class="gc-score ${info.strong ? 'ok' : 'low'}" title="Share of the composition that overlaps the grade"><b>${score}%</b> match</span>
      </div>
      ${info.strong ? `<p class="gc-std">${stds.map(esc).join(' · ')}</p>` : `<p class="gc-std">Nearest: ${esc(g.name)} (${score}%). Treat this as a research melt.</p>`}
      <div class="gc-grid">
        <div class="gc-cell"><span>Estimated Indian price</span>${priceHtml}</div>
        <div class="gc-cell"><span>Availability</span><strong class="tone-${av.tone}">${esc(av.label)}</strong></div>
      </div>
      <div class="gc-feas">
        <div><span>CNC machining</span>${pill(...FEAS.m[info.feas.m])}</div>
        <div><span>Welding</span>${pill(...FEAS.w[info.feas.w])}</div>
        <div><span>Metal 3D printing</span>${pill(...FEAS.am[info.feas.am])}</div>
      </div>
      ${info.strong ? '' : '<p class="gc-note">Feasibility is estimated from the composition because there is no matching commercial grade.</p>'}
      ${info.others.length ? `<p class="gc-alt">Also close: ${info.others.map((o) => `${esc(o.grade.name)} (${Math.round(o.score)}%)`).join(', ')}</p>` : ''}
      <div class="gc-actions">
        <button class="btn btn-primary small" id="gcRfq">Create RFQ &amp; test sheet</button>
        <button class="btn btn-glass small" id="gcSave">Save design</button>
        <button class="btn btn-glass small" id="gcDoctor">Run Failure Doctor</button>
      </div>`;
    q('#gcRfq', card)?.addEventListener('click', () => openRfqSheet());
    q('#gcSave', card)?.addEventListener('click', () => { if (window.MH_DESIGNS) window.MH_DESIGNS.save(); else notify('Saving is not ready yet.', 'warning'); });
    q('#gcDoctor', card)?.addEventListener('click', () => { setView('doctor'); });
  }

  /* wrap renderSimulation so every result gets the plain verdict + real-world card */
  if (typeof renderSimulation === 'function') {
    const original = renderSimulation;
    window.renderSimulation = function patchedRenderSimulation(sim) {
      original(sim);
      try {
        if (sim.derived?.is_gas) { const v = q('#simVerdict'); if (v) v.textContent = 'NOT A SOLID'; }
        else if (sim.derived?.is_vaporized) { const v = q('#simVerdict'); if (v) v.textContent = 'VAPORISED'; }
        renderPlain(sim); renderGradeCard(sim);
      } catch (error) { console.warn('tools render', error); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Applying a grade to the simulator                                   */
  /* ------------------------------------------------------------------ */
  function applyGrade(g, opts = {}) {
    state.composition = Object.fromEntries(Object.entries(g.comp).map(([k, v]) => [k, Number(v.toFixed ? v.toFixed(3) : v)]));
    if (typeof renderElementSliders === 'function') renderElementSliders();
    if (g.s && q('#structureSelect')) {
      q('#structureSelect').value = g.s;
      q('#structureSelect').dispatchEvent(new Event('change', { bubbles: true }));
    }
    const setSlider = (id, value) => {
      const el = q(id);
      if (el && value !== undefined && value !== null) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
    };
    setSlider('#temperatureSlider', opts.tempC);
    setSlider('#loadSlider', opts.loadMpa);
    setSlider('#safetySlider', opts.safety);
    if (opts.environment && q('#environmentSelect')) {
      const opt = qa('#environmentSelect option').find((o) => o.textContent.toLowerCase().includes(opts.environment.toLowerCase()));
      if (opt) q('#environmentSelect').value = opt.value;
    }
    if (typeof updateCompositionUI === 'function') updateCompositionUI();
    if (opts.view !== false) setView('simulator');
    if (opts.run !== false && typeof runSimulation === 'function') runSimulation();
  }

  const GOALS = [
    { id: 'rocket', icon: 'rocket', title: 'Rocket nozzle or hot gas part', sub: 'Hot gas at 650°C under load', grade: 'in718', tempC: 650, loadMpa: 200, safety: 1.5 },
    { id: 'drone', icon: 'drone', title: 'Light drone or bike frame', sub: 'Strong, low weight', grade: 'ti64', tempC: 25, loadMpa: 380, safety: 1.5 },
    { id: 'marine', icon: 'wave', title: 'Boat or coastal fitting', sub: 'Seawater corrosion', grade: 'du2205', tempC: 30, loadMpa: 200, safety: 1.5, environment: 'sea' },
    { id: 'cryo', icon: 'snow', title: 'Cryogenic tank or valve', sub: 'Stay tough at -196°C', grade: 'ss316l', tempC: -196, loadMpa: 150, safety: 1.5 },
    { id: 'exhaust', icon: 'flame', title: 'Exhaust or furnace part', sub: 'Heat plus oxidation', grade: 'ss310', tempC: 900, loadMpa: 40, safety: 1.5 },
    { id: 'shaft', icon: 'gear', title: 'Shaft, gear or fastener', sub: 'Strength at low cost', grade: 'en19', tempC: 25, loadMpa: 280, safety: 1.5 },
  ];
  const ICONS = {
    rocket: '<path d="M12 2c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10Z"/><circle cx="12" cy="9" r="1.6"/><path d="M9 15l-3 4M15 15l3 4M12 15v6"/>',
    drone: '<circle cx="5" cy="5" r="2.4"/><circle cx="19" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>',
    wave: '<path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
    snow: '<path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    flame: '<path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9Z"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  };

  /* ------------------------------------------------------------------ */
  /* Minimal PDF writer (A4, Helvetica, rects + lines + text)            */
  /* ------------------------------------------------------------------ */
  function pdfSafe(text) {
    return String(text ?? '')
      .replace(/₹/g, 'INR ').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/→/g, '->').replace(/[–—]/g, '-')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/…/g, '...')
      .replace(/[^\x20-\x7E\xB0\xB1\xB5]/g, '?');
  }
  const pdfEsc = (t) => pdfSafe(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  function makePdf() {
    const ops = [];
    const H = 842;
    const col = (c) => c.map((v) => (v / 255).toFixed(3)).join(' ');
    const api = {
      width: 595, height: H,
      text(x, yTop, str, o = {}) {
        const size = o.size || 9;
        ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${size} Tf ${col(o.color || [20, 28, 40])} rg ${x.toFixed(1)} ${(H - yTop).toFixed(1)} Td (${pdfEsc(str)}) Tj ET`);
      },
      rect(x, yTop, w, h, o = {}) {
        if (o.fill) ops.push(`${col(o.fill)} rg ${x.toFixed(1)} ${(H - yTop - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
        if (o.stroke) ops.push(`${o.lw || 0.6} w ${col(o.stroke)} RG ${x.toFixed(1)} ${(H - yTop - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`);
      },
      line(x1, y1, x2, y2, o = {}) {
        ops.push(`${o.lw || 0.6} w ${col(o.color || [200, 208, 220])} RG ${x1.toFixed(1)} ${(H - y1).toFixed(1)} m ${x2.toFixed(1)} ${(H - y2).toFixed(1)} l S`);
      },
      wrap(str, maxW, size = 9, bold = false) {
        const cw = size * (bold ? 0.56 : 0.5);
        const words = pdfSafe(str).split(/\s+/);
        const lines = [];
        let cur = '';
        words.forEach((w) => {
          if ((cur + ' ' + w).trim().length * cw > maxW) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
        });
        if (cur) lines.push(cur);
        return lines;
      },
      build() {
        const stream = ops.join('\n');
        const objs = [
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>',
          `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        ];
        let pdf = '%PDF-1.4\n';
        const offsets = [];
        objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
        const xref = pdf.length;
        pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
        offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
        pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
        return new Blob([bytes], { type: 'application/pdf' });
      },
    };
    return api;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const INK = [16, 24, 40];
  const ACCENT = [8, 145, 178];
  const MUTED = [90, 103, 122];
  const BAND = [8, 20, 38];

  function pdfHeader(pdf, title, ref) {
    pdf.rect(0, 0, 595, 74, { fill: BAND });
    pdf.text(40, 34, 'MATERIALHUNT', { size: 17, bold: true, color: [255, 255, 255] });
    pdf.text(40, 52, title, { size: 10, color: [160, 205, 225] });
    pdf.text(595 - 40 - 150, 34, `Ref: ${ref}`, { size: 9, bold: true, color: [255, 255, 255] });
    pdf.text(595 - 40 - 150, 50, `Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, { size: 9, color: [160, 205, 225] });
  }

  function pdfSection(pdf, y, title) {
    pdf.rect(40, y, 515, 15, { fill: [232, 244, 249] });
    pdf.rect(40, y, 3, 15, { fill: ACCENT });
    pdf.text(50, y + 11, title.toUpperCase(), { size: 8.5, bold: true, color: ACCENT });
    return y + 22;
  }

  function pdfKV(pdf, y, pairs, cols = 2) {
    const w = 515 / cols;
    let row = 0;
    pairs.forEach(([k, v], i) => {
      const cx = 40 + (i % cols) * w;
      const cy = y + Math.floor(i / cols) * 22;
      pdf.text(cx + 4, cy + 7, k, { size: 7, color: MUTED });
      const lines = pdf.wrap(v || '-', w - 12, 9, true);
      pdf.text(cx + 4, cy + 17, lines[0] || '-', { size: 9, bold: true, color: INK });
      row = Math.max(row, Math.floor(i / cols) + 1);
    });
    return y + row * 22 + 4;
  }

  /* ------------------------------------------------------------------ */
  /* RFQ + NABL test sheet                                               */
  /* ------------------------------------------------------------------ */
  const FORMS = ['Round bar', 'Flat bar / plate', 'Sheet', 'Tube / pipe', 'Forging blank', 'Casting', 'Powder (3D printing)', 'Wire'];

  function testsFor(g, env) {
    const stainless = g.family === 'Stainless steel';
    const t = env.tempC;
    const tests = [
      ['Chemical analysis (OES / ICP)', stainless ? 'ASTM E1086 / E415' : 'ASTM E415 / E1479', 'Confirm composition against the window above'],
      ['Tensile test (yield, UTS, elongation)', 'ASTM E8/E8M · IS 1608', 'Verify yield strength and ductility'],
      ['Hardness (Rockwell / Brinell)', 'ASTM E18 / E10', 'Check heat-treatment condition'],
    ];
    if (g.cryo === false || t <= 0 || g.s === 'BCC') {
      if (t <= 0 || g.s === 'BCC') tests.push(['Charpy V-notch impact', 'ASTM E23', t <= 0 ? `Toughness at ${num(t)}°C` : 'Toughness / brittleness check']);
    }
    if (env.marine) tests.push(['Neutral salt spray (500 h)', 'ASTM B117', 'Coastal / saltwater corrosion']);
    if (stainless && (env.marine || env.acid)) tests.push(['Pitting & crevice corrosion', 'ASTM G48', 'Chloride / acid pitting resistance']);
    if (t >= 400) tests.push(['Creep / stress-rupture', 'ASTM E139', `Long-life behaviour at ${num(t)}°C`]);
    if (!stainless && g.family !== 'Aluminium') tests.push(['Microstructure / grain size', 'ASTM E3 / E112', 'Detect segregation and coarse grains']);
    return tests.slice(0, 7);
  }

  function compWindow(el, nominal) {
    const tol = nominal >= 5 ? Math.max(0.5, nominal * 0.08) : Math.max(0.03, nominal * 0.25);
    const lo = Math.max(0, nominal - tol);
    const hi = nominal + tol;
    const f = (v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
    return [f(lo), f(nominal), f(hi)];
  }

  function buildRfqPdf(data) {
    const g = BY_ID[data.gradeId] || GRADES[0];
    const env = data.env;
    const ref = data.ref;
    const pdf = makePdf();
    pdfHeader(pdf, 'Request for Quotation (RFQ) and Material Test Sheet', ref);
    let y = 90;

    y = pdfSection(pdf, y, '1. Buyer');
    y = pdfKV(pdf, y, [
      ['Name', data.name], ['Organisation', data.org],
      ['Email', data.email], ['Delivery location', data.city],
    ]);

    y = pdfSection(pdf, y, '2. Material requested');
    const stds = [g.std.astm, g.std.is !== '-' ? g.std.is : '', g.std.en !== '-' ? g.std.en : ''].filter(Boolean).join('  |  ');
    y = pdfKV(pdf, y, [
      ['Target grade', g.name], ['Equivalent standards', stds],
      ['Product form', data.form], ['Quantity', `${data.qty} kg`],
      ['Required by', data.needBy || 'To be agreed'], ['Alternates acceptable', data.alts || 'Please quote equivalent grades']
    ]);

    y = pdfSection(pdf, y, '3. Chemical composition (wt %)');
    const els = Object.entries(g.comp).sort((a, b) => b[1] - a[1]).slice(0, 9);
    const colW = 515 / Math.min(els.length, 9);
    els.forEach(([el, v], i) => {
      const x = 40 + i * colW;
      const [lo, nom, hi] = compWindow(el, v);
      pdf.rect(x, y, colW, 42, { stroke: [210, 218, 230] });
      pdf.text(x + 5, y + 11, el, { size: 9, bold: true, color: ACCENT });
      pdf.text(x + 5, y + 23, `${nom}`, { size: 9, bold: true, color: INK });
      pdf.text(x + 5, y + 35, `${lo}-${hi}`, { size: 6.5, color: MUTED });
    });
    y += 46;
    pdf.text(40, y + 6, 'Top: nominal. Bottom: suggested acceptance window. Supplier to quote against the applicable standard.', { size: 6.5, color: MUTED });
    y += 14;

    y = pdfSection(pdf, y, '4. Mechanical and service requirements');
    y = pdfKV(pdf, y, [
      ['Min. yield strength (room temp.)', `${num(Math.round(g.y * 0.95))} MPa`], ['Tensile strength (typical)', `${num(g.uts)} MPa`],
      ['Operating temperature', `${num(env.tempC)} °C`], ['Design load / safety factor', `${num(env.loadMpa)} MPa / ${env.safety}`],
      ['Environment', env.label], ['Density (typical)', `${g.d} g/cm3`],
    ], 3);

    y = pdfSection(pdf, y, '5. Required tests (NABL-accredited laboratory)');
    const tests = testsFor(g, env);
    pdf.rect(40, y, 515, 13, { fill: [243, 246, 250] });
    pdf.text(46, y + 9, 'Test', { size: 7.5, bold: true, color: MUTED });
    pdf.text(236, y + 9, 'Standard', { size: 7.5, bold: true, color: MUTED });
    pdf.text(356, y + 9, 'Purpose', { size: 7.5, bold: true, color: MUTED });
    y += 13;
    tests.forEach(([name, std, why]) => {
      pdf.text(46, y + 9, name, { size: 8, bold: true, color: INK });
      pdf.text(236, y + 9, std, { size: 8, color: INK });
      pdf.text(356, y + 9, pdf.wrap(why, 195, 7.5)[0] || '', { size: 7.5, color: MUTED });
      pdf.line(40, y + 13, 555, y + 13);
      y += 14;
    });
    y += 6;

    y = pdfSection(pdf, y, '6. Compliance declarations');
    const decl = [
      'Mill test certificate to EN 10204 3.1 (or equivalent) with heat number traceability.',
      g.lead ? 'NOTE: this grade contains lead. Confirm RoHS / REACH exemption applicability for your end use.' : 'Supplier to confirm RoHS / REACH compliance for the supplied material.',
      'Dual-use / export-control screen: no U, Pu, Th, Be, Br, Cd, Hg or As in the specified composition.',
    ];
    decl.forEach((d) => { pdf.text(46, y + 8, `[ ]  ${d}`.slice(0, 120), { size: 7.8, color: INK }); y += 12; });
    y += 6;
    pdf.line(40, y, 555, y, { color: [180, 190, 205] });
    pdf.text(40, y + 14, 'Please quote: unit price, MOQ, lead time, certificates, and the test lab you propose.', { size: 8, bold: true, color: INK });
    pdf.text(40, y + 27, 'Prepared with MaterialHunt screening estimates. This sheet is a purchasing aid, not a certified specification.', { size: 6.8, color: MUTED });
    pdf.text(40, 826, `Generated by MaterialHunt | materialhunt-2026.web.app | ${ref}`, { size: 6.8, color: MUTED });
    return pdf.build();
  }

  function rfqEnv() {
    const req = state.simRequest || {};
    const envName = String(req.environment || 'Air / Industrial');
    return {
      tempC: Number(req.temperature_c ?? 25), loadMpa: Number(req.load_mpa ?? 0), safety: Number(req.safety_factor ?? 1.5),
      label: envName, marine: /sea|salt|marine|coast/i.test(envName), acid: /acid|chem/i.test(envName),
    };
  }

  function openRfqSheet(gradeId) {
    if (window.MH_PLAN && !window.MH_PLAN.canOpen('rfq')) return;
    const matches = window.MH_TOOLS.lastMatch ? [window.MH_TOOLS.lastMatch.best, ...window.MH_TOOLS.lastMatch.others] : matchGrades(typeof normalisedComposition === 'function' ? normalisedComposition() : {}, 3);
    const options = matches.map((m) => m.grade);
    if (gradeId && BY_ID[gradeId] && !options.find((o) => o.id === gradeId)) options.unshift(BY_ID[gradeId]);
    let modal = q('#rfqSheetModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'rfqSheetModal';
      modal.className = 'modal-backdrop hidden';
      document.body.appendChild(modal);
    }
    const user = state.user || {};
    modal.innerHTML = `
      <div class="auth-modal glass tool-modal" role="dialog" aria-modal="true" aria-labelledby="rfqSheetTitle">
        <button class="modal-close" data-close aria-label="Close">×</button>
        <span class="panel-kicker">1-PAGE RFQ &amp; NABL TEST SHEET</span>
        <h2 id="rfqSheetTitle">Request quotes for this material</h2>
        <p class="micro-note">We fill in the grade, composition window, mechanical needs and required lab tests. You add your details.</p>
        <form id="rfqSheetForm" class="auth-form">
          <div class="field-two-col">
            <div><label class="field-label" for="rsGrade">Grade to request</label>
              <select id="rsGrade" class="field-select">${options.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
            <div><label class="field-label" for="rsForm">Product form</label>
              <select id="rsForm" class="field-select">${FORMS.map((f) => `<option>${esc(f)}</option>`).join('')}</select></div>
          </div>
          <div class="field-two-col">
            <div><label class="field-label" for="rsQty">Quantity (kg)</label><input id="rsQty" type="number" min="1" value="50" required /></div>
            <div><label class="field-label" for="rsNeed">Needed by</label><input id="rsNeed" type="text" placeholder="e.g. 30 Jan 2027" /></div>
          </div>
          <div class="field-two-col">
            <div><label class="field-label" for="rsName">Your name</label><input id="rsName" type="text" value="${esc(user.organization_name || '')}" required /></div>
            <div><label class="field-label" for="rsOrg">Organisation</label><input id="rsOrg" type="text" placeholder="Company / college / team" required /></div>
          </div>
          <div class="field-two-col">
            <div><label class="field-label" for="rsEmail">Email</label><input id="rsEmail" type="email" value="${esc(user.email || '')}" required /></div>
            <div><label class="field-label" for="rsCity">Delivery city</label><input id="rsCity" type="text" value="Bengaluru" required /></div>
          </div>
          <div class="rfq-actions">
            <button class="btn btn-primary" type="submit" id="rsDownload">Download RFQ PDF</button>
            <button class="btn btn-glass" type="button" id="rsSend">Send to sourcing desk</button>
          </div>
          <p class="micro-note">"Send to sourcing desk" shares this RFQ with MaterialHunt, who forward it to matching suppliers and NABL labs and come back with comparable quotes.</p>
          <p class="form-error" id="rsError"></p>
        </form>
      </div>`;
    modal.classList.remove('hidden');
    q('[data-close]', modal).addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    const collect = () => {
      const f = (id) => q(id, modal).value.trim();
      const data = {
        gradeId: f('#rsGrade'), form: f('#rsForm'), qty: Number(f('#rsQty')) || 1, needBy: f('#rsNeed'),
        name: f('#rsName'), org: f('#rsOrg'), email: f('#rsEmail'), city: f('#rsCity'), env: rfqEnv(),
        ref: `MH-RFQ-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      };
      data.alts = options.filter((o) => o.id !== data.gradeId).map((o) => o.name).slice(0, 2).join('; ');
      return data;
    };
    const valid = (d) => {
      if (!d.name || !d.org || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) || !d.city) { q('#rsError', modal).textContent = 'Please fill in name, organisation, a valid email and city.'; return false; }
      q('#rsError', modal).textContent = '';
      return true;
    };
    q('#rfqSheetForm', modal).addEventListener('submit', (e) => {
      e.preventDefault();
      const d = collect();
      if (!valid(d)) return;
      if (window.MH_PLAN && !window.MH_PLAN.use('rfq')) return;
      saveBlob(buildRfqPdf(d), `${d.ref}.pdf`);
      notify('RFQ downloaded. Attach it to your email or send it to the sourcing desk.', 'success', 4500);
    });
    q('#rsSend', modal).addEventListener('click', async () => {
      const d = collect();
      if (!valid(d)) return;
      if (window.MH_PLAN && !window.MH_PLAN.use('rfq')) return;
      const g = BY_ID[d.gradeId];
      const result = await window.MH_FIREBASE?.saveLead?.({
        kind: 'rfq', name: d.name, organization: d.org, email: d.email, city: d.city, alloy: g.name,
        request_type: 'Supplier RFQ + NABL tests', quantity_kg: d.qty, notes: `Form: ${d.form}. Need by: ${d.needBy || 'n/a'}. Ref ${d.ref}`,
      });
      saveBlob(buildRfqPdf(d), `${d.ref}.pdf`);
      notify(result?.ok ? 'RFQ sent. We will reply with supplier and lab quotes by email.' : 'Saved locally. Please retry when online.', result?.ok ? 'success' : 'warning', 5000);
      modal.classList.add('hidden');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Failure Doctor                                                      */
  /* ------------------------------------------------------------------ */
  const EVENTS = [
    ['crack_vib', 'Cracked under vibration or repeated load'],
    ['melted', 'Melted or went soft'],
    ['corroded', 'Rusted or corroded'],
    ['warped', 'Warped or bent out of shape'],
    ['brittle', 'Snapped suddenly, like glass'],
  ];
  const ENVS = [
    ['coastal', 'Coastal / saltwater', { tempC: 30, env: 'Seawater', need: 2 }],
    ['hot900', '900°C exhaust or furnace', { tempC: 900, env: 'Air / Industrial', need: 0 }],
    ['acid', 'Acidic or chemical', { tempC: 60, env: 'Chemical', need: 3 }],
    ['cryo', 'Sub-zero / cryogenic', { tempC: -196, env: 'Air / Industrial', need: 0 }],
    ['dry', 'Normal dry indoor use', { tempC: 25, env: 'Air / Industrial', need: 0 }],
  ];
  const LATTICE = {
    BCC: 'Body-centred cubic (BCC). Few slip planes, so it loses toughness in the cold and under sharp loading.',
    FCC: 'Face-centred cubic (FCC). Many slip planes keep it tough, even at very low temperatures.',
    HCP: 'Hexagonal close-packed (HCP). Strong but direction-dependent, so loading direction and finish matter.',
  };

  const rankFamily = (c, g, o) => (o.prefer && o.prefer.includes(c.family) ? 2 : 0) + (c.family === g.family ? 1 : 0);
  const SPECIAL = ['Tool steel', 'Cast iron', 'Refractory metal', 'Cobalt alloy', 'Magnesium', 'Specialty steel'];

  function pren(g) { return (g.comp.Cr || 0) + 3.3 * (g.comp.Mo || 0) + 16 * (g.comp.N || 0); }

  function alternatives(g, o) {
    return GRADES.filter((c) => c.id !== g.id)
      .filter((c) => c.t >= (o.minTemp || 0))
      .filter((c) => c.c >= (o.minCorr || 0))
      .filter((c) => !o.cryo || c.cryo)
      .filter((c) => c.y >= (o.minYield || 0))
      .filter((c) => !o.notFamily || !o.notFamily.includes(c.family))
      .filter((c) => !o.noPoorWeld || c.w !== 'poor')
      .filter((c) => !SPECIAL.includes(c.family) || c.family === g.family)
      .sort((a, b) => (rankFamily(b, g, o) - rankFamily(a, g, o)) || (mid(a.price) - mid(b.price)))
      .slice(0, 3);
  }

  function diagnose(g, event, envKey) {
    const env = ENVS.find((e) => e[0] === envKey);
    const T = env[2].tempC;
    const need = env[2].need;
    const ev = { evidence: [], fixes: [] };
    const stainless = g.family === 'Stainless steel';
    const steel = /steel|iron/i.test(g.family);

    if (event === 'melted' || (event === 'warped' && envKey === 'hot900')) {
      if (T > g.t) {
        ev.mechanism = event === 'melted' ? 'Over-temperature failure (softening and local melting)' : 'High-temperature creep and distortion';
        ev.why = `${g.name} is only good for about ${num(g.t)}°C continuous service. At ${num(T)}°C its strength collapses and it slowly stretches (creep) or softens.`;
        ev.evidence = [`Rated service temperature ≈ ${num(g.t)}°C`, `Your environment ≈ ${num(T)}°C`, `Margin = ${num(g.t - T)}°C (negative)`];
      } else {
        ev.mechanism = 'Local hot spots and thermal-cycling fatigue';
        ev.why = `${g.name} is rated above the environment temperature, so the real metal temperature was probably higher at a hot spot, or repeated heating and cooling caused cracking.`;
        ev.evidence = [`Rated ≈ ${num(g.t)}°C vs ${num(T)}°C nominal`, 'Check for flame impingement, poor cooling or sharp section changes'];
      }
      ev.fixes = alternatives(g, { minTemp: Math.max(T * 1.1, 200), minCorr: Math.max(need, envKey === 'hot900' ? 2 : 0) });
      ev.lattice = g.s;
    } else if (event === 'corroded') {
      if (envKey === 'coastal') {
        if (stainless) {
          ev.mechanism = 'Chloride pitting and crevice corrosion';
          ev.why = `Salt (chloride) breaks the thin protective film on stainless steel. ${g.name} has a pitting index (PREN) of about ${pren(g).toFixed(0)}; seawater service needs roughly 35 or more.`;
          ev.evidence = [`PREN ≈ ${pren(g).toFixed(0)} (want ≥ 35)`, 'Look for small pits and rust streaks near joints and under gaskets'];
        } else if (g.family === 'Aluminium') {
          ev.mechanism = 'Pitting and exfoliation corrosion';
          ev.why = `Aluminium alloys with copper or zinc (${g.name}) pit and flake in salty air. Marine grades (5xxx) resist it far better.`;
          ev.evidence = ['High-strength 2xxx/7xxx alloys are the most vulnerable'];
        } else if (g.family === 'Copper alloy' && /brass/i.test(g.name)) {
          ev.mechanism = 'Dezincification';
          ev.why = 'Brass loses its zinc in seawater, leaving a weak, porous copper skeleton.';
          ev.evidence = ['Pink / copper colour and brittle crumbling surface'];
        } else if (steel) {
          ev.mechanism = 'General rusting plus galvanic attack';
          ev.why = `${g.name} has no protective film, so salty moisture turns it to rust.`;
          ev.evidence = ['Corrosion resistance rating: poor'];
        } else {
          ev.mechanism = 'Crevice or galvanic corrosion';
          ev.why = `${g.name} normally resists seawater, so look for galvanic contact with another metal or tight crevices trapping salt water.`;
          ev.evidence = ['Check fasteners and mating metals'];
        }
        ev.fixes = alternatives(g, { minCorr: 3, minYield: g.y * 0.8 });
      } else if (envKey === 'acid') {
        ev.mechanism = stainless ? 'Acid attack and pitting (breakdown of the passive film)' : 'General acid dissolution';
        ev.why = `${g.name} is not built for acids. Reducing acids like hydrochloric or dilute sulphuric attack stainless steel and carbon steel quickly.`;
        ev.evidence = ['Chemical environment pH below 4', `Corrosion rating ${g.c} of 3`, 'For strong or oxidising acids at high concentration, ask a corrosion specialist about Hastelloy C-276 or titanium'];
        ev.fixes = alternatives(g, { minCorr: 3, minTemp: 100, notFamily: ['Aluminium', 'Magnesium', 'Copper alloy'], prefer: ['Stainless steel'] });
      } else if (envKey === 'hot900') {
        ev.mechanism = 'High-temperature oxidation and scaling';
        ev.why = `At ${num(T)}°C ${g.name} grows a thick flaky oxide that peels off, eating the metal away. High-chromium alloys form a protective oxide instead.`;
        ev.evidence = [`Chromium content ${(g.comp.Cr || 0).toFixed(1)}% (want 20%+)`];
        ev.fixes = alternatives(g, { minTemp: 1000, minCorr: 2 });
      } else {
        ev.mechanism = 'Atmospheric rusting or galvanic corrosion';
        ev.why = 'Condensation, humidity or contact between different metals is attacking the surface.';
        ev.evidence = [`Corrosion rating ${g.c} of 3`];
        ev.fixes = alternatives(g, { minCorr: 2, minYield: g.y * 0.8 });
      }
      ev.lattice = g.s;
    } else if (event === 'brittle' || (event === 'crack_vib' && envKey === 'cryo')) {
      if (g.s === 'BCC') {
        ev.mechanism = 'Ductile-to-brittle transition (cold brittle fracture)';
        ev.why = `${g.name} has a BCC crystal structure. Below a certain temperature it stops bending and snaps suddenly, which is exactly what happens at ${num(T)}°C.`;
        ev.evidence = ['BCC lattice: few slip systems at low temperature', 'Flat, shiny fracture surface with no stretching'];
      } else {
        ev.mechanism = 'Fatigue or hidden defect (not a cold-brittle material)';
        ev.why = `${g.name} stays tough in the cold because of its ${g.s} crystal structure, so look for a casting or weld defect, a sharp notch, or hydrogen/embrittling contamination.`;
        ev.evidence = [`${g.s} lattice stays ductile`, 'Inspect the fracture origin under magnification'];
      }
      ev.fixes = alternatives(g, { cryo: true, minYield: g.y * 0.35, minTemp: 100, prefer: ['Stainless steel'], notFamily: ['Copper alloy', 'Nickel superalloy'] });
      ev.lattice = g.s;
    } else if (event === 'crack_vib') {
      ev.mechanism = envKey === 'coastal' && g.c < 2 ? 'Corrosion fatigue' : 'High-cycle fatigue';
      ev.why = `Repeated small loads grow a crack from a sharp corner, weld toe or scratch until the part snaps. ${g.name} has a yield of about ${num(g.y)} MPa; vibration failures usually start well below that.`;
      ev.evidence = ['Beach-mark rings on the fracture surface', 'Origin at a notch, hole, weld or corner', envKey === 'coastal' ? 'Salt shortens fatigue life further' : 'Check for loose fasteners causing extra vibration'];
      ev.fixes = alternatives(g, { minYield: g.y * 1.3, minCorr: Math.max(need, 0), minTemp: Math.max(T, 100), notFamily: [g.family === 'Aluminium' ? 'Aluminium' : ''] });
      ev.lattice = g.s;
    } else {
      ev.mechanism = 'Yielding (permanent bending) or residual-stress distortion';
      ev.why = `The load exceeded the yield strength of ${g.name} (${num(g.y)} MPa), or stress released after welding or machining.`;
      ev.evidence = [`Yield strength ${num(g.y)} MPa`, 'Check for loads above design or heat from welding'];
      ev.fixes = alternatives(g, { minYield: g.y * 1.4, minCorr: need, minTemp: T, cryo: T <= -50 });
      ev.lattice = g.s;
    }
    ev.test = { tempC: T, env: env[2].env };
    ev.event = event;
    return ev;
  }

  function doctorView() {
    return `
      <section class="view" id="view-doctor">
        <div class="section-head">
          <div>
            <span class="panel-kicker">FAILURE DOCTOR</span>
            <h2>Something broke? Find out why, and what to use instead.</h2>
            <p>Answer three questions. You get the likely failure mechanism in plain English and a safer alloy you can test in one click.</p>
          </div>
        </div>
        <div class="doctor-layout">
          <article class="glass tool-form">
            <label class="field-label" for="drMetal">1. What metal was it?</label>
            <select id="drMetal" class="field-select">${GRADES.map((g) => `<option value="${g.id}"${g.id === 'ss304' ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
            <label class="field-label" for="drEvent">2. What happened?</label>
            <select id="drEvent" class="field-select">${EVENTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
            <label class="field-label" for="drEnv">3. Where was it used?</label>
            <select id="drEnv" class="field-select">${ENVS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
            <button class="btn btn-primary full" id="drRun">Diagnose</button>
            <p class="micro-note">This is a screening diagnosis from material data. For a safety-critical failure, send the part to a failure-analysis lab.</p>
          </article>
          <article class="glass doctor-result" id="drResult">
            <div class="empty-state"><strong>Your diagnosis appears here</strong><span>Choose the metal, what happened and the environment, then press Diagnose.</span></div>
          </article>
        </div>
      </section>`;
  }

  function runDoctor() {
    const g = BY_ID[q('#drMetal').value];
    const result = diagnose(g, q('#drEvent').value, q('#drEnv').value);
    const out = q('#drResult');
    const fixes = result.fixes;
    out.innerHTML = `
      <span class="pv-kicker">LIKELY CAUSE</span>
      <h3>${esc(result.mechanism)}</h3>
      <p class="dr-why">${esc(result.why)}</p>
      <ul class="dr-evidence">${result.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      <div class="dr-lattice"><b>Why, at the crystal level:</b> ${esc(LATTICE[result.lattice] || '')}
        <button class="btn btn-glass small" id="drLattice">Show on 3D lattice</button></div>
      <h4>Safer alternatives</h4>
      ${fixes.length ? `<div class="dr-fixes">${fixes.map((f, i) => `
        <div class="dr-fix${i === 0 ? ' best' : ''}">
          ${i === 0 ? '<span class="dr-tag">RECOMMENDED</span>' : ''}
          <strong>${esc(f.name)}</strong>
          <span>${rupee(f.price[0])} - ${rupee(f.price[1])} /kg · ${esc(AVAIL[f.av].label)}</span>
          ${window.MH_ENGINE ? window.MH_ENGINE.crossCheckHtml(f, 'y') : ''}
          <div class="dr-fix-actions">
            <button class="btn ${i === 0 ? 'btn-primary' : 'btn-glass'} small" data-swap="${f.id}">${i === 0 ? 'Auto-swap & test it' : 'Test it'}</button>
            <button class="btn btn-ghost small" data-rfq="${f.id}">Get RFQ</button>
          </div>
        </div>`).join('')}</div>` : '<p class="micro-note">No single catalogue grade fits all conditions. Combine a coating or redesign with a specialist.</p>'}
      <div class="ai-review"><button class="btn btn-glass small" id="drAiReview" type="button">Ask the assistant to review this diagnosis</button></div>`;
    q('#drAiReview', out)?.addEventListener('click', () => {
      const fixList = fixes.map((f) => f.name).join(', ') || 'none found';
      askAssistant(`Review this Failure Doctor diagnosis. Part: ${g.name}. Event: ${q('#drEvent').selectedOptions[0]?.textContent || q('#drEvent').value}. Environment: ${q('#drEnv').selectedOptions[0]?.textContent || q('#drEnv').value}. Likely cause given: ${result.mechanism}. Suggested alternatives: ${fixList}. Is the diagnosis sensible, and what else should I check?`);
    });
    q('#drLattice', out)?.addEventListener('click', () => {
      applyGrade(g, { tempC: result.test.tempC, run: true });
      q('.mode-btn[data-shape="lattice"]')?.click();
    });
    qa('[data-swap]', out).forEach((b) => b.addEventListener('click', () => {
      applyGrade(BY_ID[b.dataset.swap], { tempC: result.test.tempC, loadMpa: Math.round(g.y * 0.4), safety: 1.5 });
      notify(`Testing ${BY_ID[b.dataset.swap].name} in the simulator`, 'success', 2800);
    }));
    qa('[data-rfq]', out).forEach((b) => b.addEventListener('click', () => {
      state.simRequest = { ...(state.simRequest || {}), temperature_c: result.test.tempC, environment: result.test.env };
      openRfqSheet(b.dataset.rfq);
    }));
    if (window.MH_GROWTH?.track) window.MH_GROWTH.track('failure_doctor', { metal: g.id, event: result.event });
  }

  /* ------------------------------------------------------------------ */
  /* BOM cost-down scanner                                               */
  /* ------------------------------------------------------------------ */
  const SAMPLE_BOM = `Drone motor mount: Ti-6Al-4V, 2 kg @ 180 MPa
Landing gear leg: 7075-T6, 3.5 kg @ 250 MPa
Gearbox housing: Inconel 625, 4 kg
Fuel line bracket: 316L, 1.2 kg
Chassis plate: 6061-T6, 6 kg`;

  function yieldAt(g, T) {
    if (T <= 100) return g.y;
    return g.y * (1 - 0.7 * clampN((T - 100) / Math.max(1, g.t - 100), 0, 1));
  }

  function parseBom(text) {
    return text.split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean).slice(0, 25).map((line) => {
      const stress = line.match(/@\s*([\d.]+)\s*MPa/i);
      const clean = line.replace(/@\s*[\d.]+\s*MPa/i, '');
      let name = ''; let rest = clean;
      const sep = clean.match(/^(.*?)[:|](.*)$/);
      if (sep) { name = sep[1].trim(); rest = sep[2]; }
      const parts = rest.split(/[,|]/).map((p) => p.trim()).filter(Boolean);
      const qtyPart = parts.find((p) => /^[\d.]+\s*(kg|g)?$/i.test(p)) || (rest.match(/([\d.]+)\s*(kg|g)\b/i) || [])[0];
      let qty = 0;
      if (qtyPart) { const m = qtyPart.match(/([\d.]+)\s*(kg|g)?/i); qty = Number(m[1]) / (/^g$/i.test(m[2] || '') ? 1000 : 1); }
      const matText = parts.filter((p) => p !== qtyPart).join(' ') || rest;
      return { raw: line, name: name || matText, matText, qty: qty || 1, stress: stress ? Number(stress[1]) : null, grade: findGrade(matText) };
    });
  }

  function scanBom(input) {
    const { rows, tempC, envNeed, sf, batch, light } = input;
    return rows.map((r) => {
      if (!r.grade) return { ...r, status: 'unknown' };
      const cur = r.grade;
      const assumed = r.stress === null;
      const sigma = r.stress ?? Math.round(yieldAt(cur, tempC) * 0.4);
      const sfNow = yieldAt(cur, tempC) / sigma;
      const massNow = r.qty;
      const costNow = massNow * mid(cur.price) * batch;
      const candidates = GRADES.filter((c) => c.id !== cur.id)
        .filter((c) => c.t >= Math.max(tempC, 0))
        .filter((c) => c.c >= envNeed)
        .filter((c) => tempC > -50 || c.cryo)
        .filter((c) => !SPECIAL.includes(c.family) || c.family === cur.family)
        .filter((c) => !light || c.d <= cur.d * 1.08)
        .filter((c) => yieldAt(c, tempC) / sigma >= sf)
        .map((c) => {
          const mass = massNow * (c.d / cur.d);
          const cost = mass * mid(c.price) * batch;
          return { grade: c, mass, cost, sf: yieldAt(c, tempC) / sigma, saving: costNow - cost };
        })
        .filter((c) => c.saving > costNow * 0.05)
        .sort((a, b) => b.saving - a.saving);
      const best = candidates[0];
      return { ...r, assumed, sigma, sfNow, costNow, best, status: sfNow < sf ? 'under' : best ? 'save' : 'ok' };
    });
  }

  function bomView() {
    return `
      <section class="view" id="view-bom">
        <div class="section-head">
          <div>
            <span class="panel-kicker">COST-DOWN SCANNER</span>
            <h2>Paste your parts list. See where you are overpaying.</h2>
            <p>List up to 25 parts with material and weight. We check each one against cheaper grades that still meet your safety factor, and total the saving per batch.</p>
          </div>
        </div>
        <div class="bom-layout">
          <article class="glass tool-form">
            <label class="field-label" for="bomInput">Parts (one per line)</label>
            <textarea id="bomInput" rows="9" placeholder="Part name: Material, weight in kg @ working stress in MPa (optional)"></textarea>
            <p class="micro-note">Format: <code>Motor mount: Ti-6Al-4V, 2 kg @ 180 MPa</code>. Skip "@ MPa" and we assume a moderate load and tell you so.</p>
            <div class="field-two-col">
              <div><label class="field-label" for="bomTemp">Service temperature (°C)</label><input id="bomTemp" type="number" value="25" /></div>
              <div><label class="field-label" for="bomSf">Target safety factor</label><input id="bomSf" type="number" step="0.1" min="1" value="1.8" /></div>
            </div>
            <div class="field-two-col">
              <div><label class="field-label" for="bomEnv">Environment</label>
                <select id="bomEnv" class="field-select"><option value="0">Dry / indoor</option><option value="2">Humid or coastal air</option><option value="3">Seawater or chemicals</option></select></div>
              <div><label class="field-label" for="bomBatch">Parts per batch</label><input id="bomBatch" type="number" min="1" value="100" /></div>
            </div>
            <label class="guardrail-check bom-light"><input type="checkbox" id="bomLight" checked /><span><strong>Weight matters</strong><small>Drones, vehicles, aerospace: never suggest a heavier material.</small></span></label>
            <div class="rfq-actions">
              <button class="btn btn-primary" id="bomRun">Scan for savings</button>
              <button class="btn btn-ghost" id="bomSample">Load an example</button>
            </div>
          </article>
          <article class="glass doctor-result" id="bomResult">
            <div class="empty-state"><strong>Your savings report appears here</strong><span>Load the example to see how it works.</span></div>
          </article>
        </div>
      </section>`;
  }

  let lastBom = null;

  function runBom() {
    const rows = parseBom(q('#bomInput').value);
    if (!rows.length) { notify('Add at least one part line first.', 'warning'); return; }
    if (window.MH_PLAN && !window.MH_PLAN.use('bom')) return;
    const input = {
      rows, tempC: Number(q('#bomTemp').value) || 25, sf: Number(q('#bomSf').value) || 1.8,
      envNeed: Number(q('#bomEnv').value) || 0, batch: Math.max(1, Number(q('#bomBatch').value) || 1), light: q('#bomLight').checked,
    };
    const result = scanBom(input);
    lastBom = { input, result };
    const total = result.filter((r) => r.best).reduce((a, r) => a + r.best.saving, 0);
    const base = result.reduce((a, r) => a + (r.costNow || 0), 0);
    const out = q('#bomResult');
    out.innerHTML = `
      <div class="bom-total"><span>Potential saving per batch</span><strong>${rupee(Math.round(total))}</strong><small>${base ? `${Math.round((total / base) * 100)}% of ${rupee(Math.round(base))} material spend` : ''}</small></div>
      <div class="bom-rows">${result.map((r, i) => {
        if (r.status === 'unknown') return `<div class="bom-row warn"><b>${esc(r.name)}</b><span>Could not recognise "${esc(r.matText)}". Try a grade like 316L, 7075, Ti-6Al-4V.</span></div>`;
        const sfTxt = `Safety factor now ${r.sfNow.toFixed(1)}`;
        if (r.status === 'under') return `<div class="bom-row bad"><b>${esc(r.name)}</b><span>${esc(r.grade.name)} gives a safety factor of only ${r.sfNow.toFixed(1)} (target ${input.sf}). Consider a stronger grade or a thicker section.</span></div>`;
        if (r.status === 'ok') return `<div class="bom-row good"><b>${esc(r.name)}</b><span>${esc(r.grade.name)} is already well chosen. ${sfTxt}. No cheaper grade meets your safety factor.</span></div>`;
        const b = r.best;
        return `<div class="bom-row save">
          <b>${i + 1}. ${esc(r.name)}</b>
          <span>You may be over-engineering. Switching from <b>${esc(r.grade.name)}</b> to <b>${esc(b.grade.name)}</b> keeps the safety factor at <b>${b.sf.toFixed(1)}</b> (${sfTxt}) and saves <b class="saving">${rupee(Math.round(b.saving))}</b> per batch.${r.assumed ? ' <em>Stress assumed, add "@ MPa" for accuracy.</em>' : ''}</span>
          <button class="btn btn-glass small" data-bom-rfq="${b.grade.id}">Get RFQ for ${esc(b.grade.name)}</button>
        </div>`;
      }).join('')}</div>
      <div class="rfq-actions"><button class="btn btn-primary" id="bomPdf">Download cost-reduction report</button></div>
      <p class="micro-note">Screening estimate using indicative prices and typical strengths. Validate every change with your own stress analysis and a supplier quote.</p>`;
    qa('[data-bom-rfq]', out).forEach((b) => b.addEventListener('click', () => openRfqSheet(b.dataset.bomRfq)));
    q('#bomPdf', out)?.addEventListener('click', downloadBomPdf);
    if (window.MH_GROWTH?.track) window.MH_GROWTH.track('bom_scan', { parts: rows.length, saving: Math.round(total) });
  }

  function downloadBomPdf() {
    if (!lastBom) return;
    if (window.MH_PLAN && !window.MH_PLAN.use('pdf')) return;
    const { input, result } = lastBom;
    const ref = `MH-CDR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const pdf = makePdf();
    pdfHeader(pdf, 'Cost-Reduction Report', ref);
    let y = 92;
    const total = result.filter((r) => r.best).reduce((a, r) => a + r.best.saving, 0);
    pdf.rect(40, y, 515, 50, { fill: [236, 250, 244], stroke: [160, 220, 190] });
    pdf.text(54, y + 17, 'POTENTIAL SAVING PER BATCH', { size: 7.5, bold: true, color: [20, 110, 80] });
    pdf.text(54, y + 40, rupee(Math.round(total)), { size: 22, bold: true, color: [10, 90, 60] });
    pdf.text(300, y + 22, `Batch size: ${input.batch} parts`, { size: 8.5, color: INK });
    pdf.text(300, y + 35, `Service: ${input.tempC}°C · target safety factor ${input.sf}`, { size: 8.5, color: INK });
    y += 64;
    y = pdfSection(pdf, y, 'Part-by-part findings');
    result.slice(0, 14).forEach((r, i) => {
      if (y > 760) return;
      pdf.text(46, y + 8, `${i + 1}. ${r.name}`.slice(0, 40), { size: 8.5, bold: true, color: INK });
      let line = '';
      if (r.status === 'unknown') line = 'Material not recognised.';
      else if (r.status === 'under') line = `${r.grade.name}: safety factor ${r.sfNow.toFixed(1)} is below target. Needs a stronger grade.`;
      else if (r.status === 'ok') line = `${r.grade.name}: already well chosen.`;
      else line = `${r.grade.name} -> ${r.best.grade.name}. Safety factor ${r.best.sf.toFixed(1)}. Saves ${rupee(Math.round(r.best.saving))} per batch.`;
      pdf.wrap(line, 360, 8)[0] && pdf.text(190, y + 8, pdf.wrap(line, 365, 8)[0], { size: 8, color: INK });
      const second = pdf.wrap(line, 365, 8)[1];
      if (second) { pdf.text(190, y + 18, second, { size: 8, color: INK }); y += 10; }
      pdf.line(40, y + 14, 555, y + 14);
      y += 17;
    });
    y += 8;
    pdf.text(40, y + 8, 'Method: yield strength at temperature >= stress x safety factor; mass scaled by density for the same geometry;', { size: 7, color: MUTED });
    pdf.text(40, y + 18, 'cost from indicative mid-market Indian stockist prices. Verify with your own analysis and supplier quotes.', { size: 7, color: MUTED });
    pdf.text(40, 826, `Generated by MaterialHunt | materialhunt-2026.web.app | ${ref}`, { size: 6.8, color: MUTED });
    saveBlob(pdf.build(), `${ref}.pdf`);
    notify('Cost-reduction report downloaded.', 'success', 3200);
  }

  /* ------------------------------------------------------------------ */
  /* Rotating benchmark + live leaderboard                               */
  /* The challenge changes every week (or month, see config.js). Each    */
  /* period has its own leaderboard; last period's winners stay visible. */
  /* ------------------------------------------------------------------ */
  const TIER_NAMES = { GOLD: 'Gold', SILVER: 'Silver', BRONZE: 'Bronze' };
  const IST_MS = 5.5 * 3600 * 1000;
  const DAY = 86400000;
  const RESET_SHIFT = 60000; // 1 minute

  /* period maths use IST wall-clock time so weeks start on Monday morning in India */
  function periodInfo(offset = 0) {
    const kind = window.MH_CONFIG?.challengePeriod === 'month' ? 'month' : 'week';
    // the period rolls over at 11:59 PM IST on the last day (Sunday for weeks), one minute before midnight
    const now = new Date(Date.now() + IST_MS + RESET_SHIFT);
    let start; let end; let id; let index;
    if (kind === 'month') {
      const y = now.getUTCFullYear(); const m = now.getUTCMonth() + offset;
      start = Date.UTC(y, m, 1); end = Date.UTC(y, m + 1, 1);
      const s = new Date(start);
      id = `${s.getUTCFullYear()}-M${String(s.getUTCMonth() + 1).padStart(2, '0')}`;
      index = s.getUTCFullYear() * 12 + s.getUTCMonth();
    } else {
      const dayOfWeek = (now.getUTCDay() + 6) % 7; // Monday = 0
      const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek) + offset * 7 * DAY;
      start = monday; end = monday + 7 * DAY;
      const thursday = new Date(monday + 3 * DAY);
      const isoYear = thursday.getUTCFullYear();
      const week = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * DAY)) + 1;
      id = `${isoYear}-W${String(week).padStart(2, '0')}`;
      index = Math.floor(monday / (7 * DAY));
    }
    return { id, kind, startMs: start - IST_MS - RESET_SHIFT, endMs: end - IST_MS - RESET_SHIFT, index };
  }

  function benchIdFor(period) {
    const cfg = window.MH_CONFIG || {};
    if (cfg.featured && cfg.featured[period.id] && BENCHMARKS[cfg.featured[period.id]]) return cfg.featured[period.id];
    const rotation = (cfg.rotation || ['rocket-nozzle', 'submersible', 'turbine-blade', 'ev-enclosure']).filter((x) => BENCHMARKS[x] && BENCHMARKS[x].tiers);
    return rotation[((period.index % rotation.length) + rotation.length) % rotation.length] || 'rocket-nozzle';
  }
  const currentPeriod = () => periodInfo(0);
  const currentBench = () => BENCHMARKS[benchIdFor(currentPeriod())];
  const countdown = (ms) => {
    const t = Math.max(0, ms);
    const d = Math.floor(t / DAY); const h = Math.floor((t % DAY) / 3600000); const m = Math.floor((t % 3600000) / 60000);
    return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
  };
  const periodLabel = (p) => (p.kind === 'month' ? 'This month' : 'This week');

  function awardsText() {
    const a = (window.MH_CONFIG && window.MH_CONFIG.awards) || [];
    return a.map((x) => `<li><b>${esc(x.place)}</b> ${esc(x.prize)}</li>`).join('');
  }

  function benchHeaderHtml() {
    const p = currentPeriod();
    const b = currentBench();
    const tierRows = b.tiers.slice().reverse().map((t) => `<tr class="tier-${t.name.toLowerCase()}"><td><span class="medal-dot medal-${t.name.toLowerCase()}"></span>${esc(t.label || TIER_NAMES[t.name])}</td><td>≥ ${t.sf.toFixed(2)}</td><td>≤ ${rupee(t.cost)}</td><td>≤ ${t.dens}</td></tr>`).join('');
    return { p, b, html: `
      <span class="panel-kicker">${esc(periodLabel(p).toUpperCase())} · RESETS ${p.kind === 'month' ? 'ON THE LAST DAY' : 'SUNDAY'} 11:59 PM IST · <span id="chCountdown">${esc(countdown(p.endMs - Date.now()))}</span> LEFT</span>
      <h2>${esc(b.title)}</h2>
      <p>${esc(b.brief)}</p>
      <div class="tier-wrap"><table class="tier-table"><thead><tr><th>Medal</th><th>Safety factor</th><th>Cost/kg</th><th>Density</th></tr></thead><tbody>${tierRows}</tbody></table></div>` };
  }

  function challengeView() {
    const { html } = benchHeaderHtml();
    return `
      <section class="view" id="view-challenge">
        <div class="section-head">
          <div id="chHeader">${html}</div>
          <button class="btn btn-glass" id="chCopy">Copy benchmark link</button>
        </div>
        <div class="challenge-layout">
          <article class="glass tool-form">
            <h3>How to enter</h3>
            <ol class="ch-steps">
              <li>Press <b>Open the stress test</b>. It loads this week's blueprint in the Forge.</li>
              <li>Mix your alloy with the element sliders, then press <b>Run Stress Test</b>.</li>
              <li>Passing designs earn a medal. Press <b>Submit my current design</b> to enter the leaderboard.</li>
            </ol>
            <p class="micro-note">Submitting a new design replaces your previous entry for this period. Your name and alloy are shown publicly. The leaderboard and the challenge reset automatically.</p>
            ${awardsText() ? `<div class="ch-prizes"><b>Prizes for the period winners</b><ul>${awardsText()}</ul></div>` : ''}
            <div class="rfq-actions">
              <button class="btn btn-primary" id="chLoad">Open the stress test</button>
              <button class="btn btn-glass" id="chSubmit">Submit my current design</button>
            </div>
            <label class="field-label" for="chName">Display name on the leaderboard</label>
            <input id="chName" type="text" maxlength="40" placeholder="e.g. Team Vajra" />
            <div class="ch-check" id="chCheck"></div>
          </article>
          <div class="ch-right">
            <article class="glass leaderboard-card">
              <div class="panel-title-row"><h3>Leaderboard</h3><span class="pill pill-emerald" id="chLive">RANKED</span></div>
              <div class="lb-head"><span>#</span><span>Name</span><span>Alloy</span><span>SF</span><span>₹/kg</span><span>Score</span></div>
              <div id="chBoard" class="lb-body"><div class="empty-state"><strong>No entries yet</strong><span>Be the first on the board.</span></div></div>
            </article>
            <article class="glass leaderboard-card" id="chPrevCard">
              <div class="panel-title-row"><h3>Last period's winners</h3></div>
              <div id="chPrev" class="lb-body"><div class="empty-state"><span>Loading…</span></div></div>
            </article>
          </div>
        </div>
      </section>`;
  }

  function rowsHtml(rows, limitRows) {
    return rows.slice(0, limitRows).map((r, i) => `
      <div class="lb-row${state.user && r.user_id === state.user.id ? ' me' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name"><span class="lb-av" data-av="${esc(r.user_id)}" data-nm="${esc(r.name)}"></span><button class="lb-person" data-person="${esc(r.user_id)}">${esc(r.name)}</button>${r.medal ? `<span class="medal-dot medal-${esc(String(r.medal).toLowerCase())}" title="${esc(TIER_NAMES[r.medal] || '')}"></span>` : ''}</span>
        <span class="lb-alloy">${esc(r.formula)}</span><span>${r.sf ? Number(r.sf).toFixed(2) : '-'}</span><span>${rupee(r.cost)}</span><b>${r.score}</b>
      </div>`).join('');
  }

  let boardRows = [];
  function renderBoard(rows) {
    boardRows = rows;
    const body = q('#chBoard');
    if (!body) return;
    body.innerHTML = rows.length ? rowsHtml(rows, 25) : '<div class="empty-state"><strong>No entries yet</strong><span>Be the first on the board.</span></div>';
    window.MH_PROFILE?.decorate?.(body);
  }

  const sortRows = (docs) => docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.score - a.score);
  let unsub = null;
  let unsubPeriod = '';

  async function loadPrevious() {
    const body = q('#chPrev');
    if (!body) return;
    try {
      await window.MH_FIREBASE?.initFirebase?.();
      const db = window.MH_FIREBASE?.db;
      if (!db) { body.innerHTML = '<div class="empty-state"><span>Not available offline.</span></div>'; return; }
      const prev = periodInfo(-1);
      const snap = await db.collection('challenge_entries').where('period', '==', prev.id).limit(100).get();
      const rows = sortRows(snap.docs);
      body.innerHTML = rows.length
        ? `<p class="micro-note" style="padding:0 6px">${esc(BENCHMARKS[benchIdFor(prev)]?.title || '')}</p>${rowsHtml(rows, 3)}`
        : '<div class="empty-state"><span>No finished period yet.</span></div>';
      window.MH_PROFILE?.decorate?.(body);
    } catch { body.innerHTML = '<div class="empty-state"><span>Could not load.</span></div>'; }
  }

  async function startBoard() {
    const bridge = window.MH_FIREBASE;
    const period = currentPeriod();
    // re-render the header in case the period rolled over while the page was open
    const header = benchHeaderHtml();
    const hEl = q('#chHeader');
    if (hEl) hEl.innerHTML = header.html;
    if (unsub && unsubPeriod === period.id) return;
    if (unsub) { unsub(); unsub = null; }
    unsubPeriod = period.id;
    let local = [];
    try { local = JSON.parse(localStorage.getItem('mh_challenge_local_' + period.id) || '[]'); } catch { local = []; }
    renderBoard(local);
    loadPrevious();
    try {
      await bridge?.initFirebase?.();
      if (!bridge?.db) return;
      unsub = bridge.db.collection('challenge_entries').where('period', '==', period.id).limit(100).onSnapshot((snap) => {
        renderBoard(sortRows(snap.docs));
      }, () => { q('#chLive')?.classList.add('hidden'); });
    } catch { /* offline board only */ }
  }
  setInterval(() => {
    const el = q('#chCountdown');
    if (el) el.textContent = countdown(currentPeriod().endMs - Date.now());
  }, 30000);

  let pendingSubmit = false;

  async function submitFromForge() {
    if (window.MH_COMMUNITY?.handle()) return;   // community challenge or draft
    const b = currentBench();
    const period = currentPeriod();
    const result = state.forgeResult;
    const sim = state.simulation;
    if (!state.benchmark || state.benchmark.id !== b.id) { notify(`${periodLabel(period)}'s challenge is "${b.title}". Select it in the blueprint list first.`, 'warning', 5000); return; }
    if (!result || result.verdict !== 'PASS' || !sim) { notify('Only passing designs can be submitted. Run the stress test first.', 'warning', 4000); return; }
    if (!state.user) { pendingSubmit = true; notify('Create a free account to enter the leaderboard.', 'info', 4500); openAuth('register'); return; }
    const d = sim.derived;
    const comp = Object.fromEntries(Object.entries(normalisedComposition()).map(([k, v]) => [k, Number(Number(v).toFixed(2))]));
    const name = ((q('#chName')?.value || window.MH_PROFILE?.displayName?.() || state.user.organization_name || 'Anonymous') + '').trim().slice(0, 40) || 'Anonymous';
    const entry = {
      name, formula: String(humanFormula(comp, 4)).slice(0, 60), composition: comp, medal: result.tier || 'BRONZE', period: period.id, bench: b.id,
      sf: Number(Number(result.sf).toFixed(2)), cost: Math.round(d.cost_per_kg), density: Number(Number(d.density_gcm3).toFixed(2)), score: result.score,
    };
    const bridge = window.MH_FIREBASE;
    try {
      await bridge?.initFirebase?.();
      const user = bridge?.auth?.currentUser;
      if (!bridge?.db || !user) throw new Error('offline');
      const ref = bridge.db.collection('challenge_entries').doc(`${period.id}_${user.uid}`);
      const existing = await ref.get();
      if (existing.exists && existing.data().score > entry.score) {
        const keep = !window.confirm(`Your current entry scores ${existing.data().score}. This design scores ${entry.score}. Replace your entry with this one anyway?`);
        if (keep) { notify('Kept your higher-scoring entry.', 'info', 3500); return; }
      }
      await ref.set({ ...entry, user_id: user.uid, created_at: window.firebase.firestore.FieldValue.serverTimestamp() });
      notify(`${TIER_NAMES[entry.medal]} medal entered the leaderboard with a score of ${entry.score}.`, 'success', 5000);
      window.MH_GROWTH?.track?.('benchmark_submit', { score: entry.score, medal: entry.medal, bench: b.id });
      setView('challenge');
    } catch (error) {
      const key = 'mh_challenge_local_' + period.id;
      const list = JSON.parse(localStorage.getItem(key) || '[]').filter((x) => x.user_id !== state.user.id);
      list.push({ user_id: state.user.id, ...entry });
      list.sort((a, c) => c.score - a.score);
      localStorage.setItem(key, JSON.stringify(list.slice(0, 25)));
      renderBoard(list);
      notify('Saved on this device (live leaderboard unavailable).', 'warning', 4000);
    }
  }

  async function submitCurrent() {
    const check = q('#chCheck');
    const b = currentBench();
    applyBenchmark(b.id, { silent: true });
    check.innerHTML = '<span class="ch-pending">Running the stress test on your current alloy...</span>';
    await runBenchmark();
    const r = state.forgeResult;
    if (!r) { check.innerHTML = '<span class="ch-fail">Could not run the test. Try again.</span>'; return; }
    const sim = state.simulation;
    const lines = [
      ['Survives the heat', r.verdict !== 'MELT', r.verdict === 'MELT' ? 'It melts at this temperature' : 'No melting'],
      ['Metals only', r.verdict !== 'BANNED', r.verdict === 'BANNED' ? 'Remove carbon, boron, silicon…' : 'OK'],
      ['Weight and cost', !['OVERWEIGHT', 'OVER BUDGET'].includes(r.verdict), `${Number(sim.derived.density_gcm3).toFixed(2)} g/cm³ · ${rupee(Math.round(sim.derived.cost_per_kg))}/kg`],
      ['Safety factor', r.verdict !== 'FRACTURE' && r.verdict !== 'BURST', `${Number(r.sf).toFixed(2)}×`],
    ];
    check.innerHTML = `<ul>${lines.map(([t, ok, s]) => `<li class="${ok ? 'ok' : 'no'}"><b>${ok ? '✓' : '✕'} ${esc(t)}</b><span>${esc(s)}</span></li>`).join('')}</ul>
      <div class="ch-score">${r.verdict === 'PASS' ? `Pass. <b>${esc(TIER_NAMES[r.tier] || '')}</b> medal · score <b>${r.score}</b>` : `Verdict: <b>${esc(r.verdict)}</b>. Adjust your alloy and try again.`}</div>`;
    if (r.verdict === 'PASS') await submitFromForge();
  }

  function wireChallenge() {
    q('#chLoad')?.addEventListener('click', () => {
      applyBenchmark(currentBench().id, { silent: true });
      setView('simulator');
      setTimeout(() => q('#forgePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      notify('Blueprint loaded. Mix your alloy, then press Run Stress Test.', 'success', 4500);
    });
    q('#chSubmit')?.addEventListener('click', submitCurrent);
    q('#chCopy')?.addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?challenge=1`;
      navigator.clipboard?.writeText(url).then(() => notify('Link copied. Share it on WhatsApp or show it on screen.', 'success', 3500));
    });
    const display = q('#chName');
    if (display && state.user && !display.value) display.value = window.MH_PROFILE?.displayName?.() || state.user.organization_name || '';
  }

  window.addEventListener('mh:session', (e) => {
    if (e.detail.user && pendingSubmit) {
      pendingSubmit = false;
      setTimeout(() => { setView('simulator'); q('#forgePanel')?.scrollIntoView({ behavior: 'smooth' }); notify('Welcome! Run the stress test and press Submit to leaderboard.', 'success', 5000); }, 700);
    }
  });
  window.MH_CHALLENGE = { submitFromForge, periodInfo, currentPeriod, currentBench, benchIdFor, boardRows: () => boardRows };

  /* ------------------------------------------------------------------ */
  /* Mount views + banner                                                */
  /* ------------------------------------------------------------------ */
  function mount() {
    const main = q('main');
    if (!main || q('#view-doctor')) return;
    const holder = document.createElement('div');
    holder.innerHTML = doctorView() + bomView() + challengeView();
    Array.from(holder.children).forEach((node) => main.appendChild(node));
    q('#drRun').addEventListener('click', runDoctor);
    q('#bomRun').addEventListener('click', runBom);
    q('#bomSample').addEventListener('click', () => { q('#bomInput').value = SAMPLE_BOM; notify('Example loaded. Press Scan for savings.', 'info', 2500); });
    wireChallenge();

    const sim = q('#view-simulator');
    if (sim && !q('#challengeBanner')) {
      const banner = document.createElement('a');
      banner.href = '#';
      banner.id = 'challengeBanner';
      banner.className = 'challenge-banner';
      const nb = currentBench(); const per = currentPeriod();
      banner.innerHTML = `<span class="cb-tag">${esc(periodLabel(per).toUpperCase())}'S CHALLENGE</span><span class="cb-text"><b>${esc(nb.title)}</b> · ${num(nb.targetTempC)}°C · ${nb.minBurstMPa} MPa · ≤ ${nb.maxDensity} g/cm³ · ≤ ${rupee(nb.maxCostINR)}/kg · metals only</span><span class="cb-go">Try it →</span>`;
      banner.addEventListener('click', (e) => { e.preventDefault(); setView('challenge'); });
      sim.insertBefore(banner, sim.firstChild);
    }

    const goalGrid = q('#goalGrid');
    if (goalGrid) {
      goalGrid.innerHTML = GOALS.map((g) => `
        <button class="goal-card glass" data-goal="${g.id}">
          <span class="goal-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[g.icon]}</svg></span>
          <strong>${esc(g.title)}</strong><small>${esc(g.sub)}</small>
        </button>`).join('');
      goalGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-goal]');
        if (!btn) return;
        const goal = GOALS.find((x) => x.id === btn.dataset.goal);
        applyGrade(BY_ID[goal.grade], { tempC: goal.tempC, loadMpa: goal.loadMpa, safety: goal.safety, environment: goal.environment });
        q('.hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.MH_GROWTH?.track) window.MH_GROWTH.track('goal_start', { goal: goal.id });
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Alloy Finder: real constraint-based search (replaces the old random */
  /* "AI designer"). Hard pass/fail gates first, ranking second.         */
  /* ------------------------------------------------------------------ */
  const DENSITY_FALLBACK = { Pb: 11.34, Bi: 9.78, Hf: 13.31, Ta: 16.65, Re: 21.02, Y: 4.47, Zr: 6.51, B: 2.34, P: 1.82, N: 0.00125, S: 2.07 };
  function elementDensity(sym) {
    const rows = window.MH_FIREBASE?.getHandbook?.()?.periodic || [];
    const row = rows.find((r) => r.symbol === sym);
    const d = Number(row?.density);
    if (Number.isFinite(d) && d > 0.01) return d;
    return DENSITY_FALLBACK[sym] || 7.8;
  }
  /* rule of mixtures from weight fractions: rho = 100 / sum(w_i / rho_i). Never an ML guess. */
  function analyticDensity(comp) {
    const entries = Object.entries(comp).filter(([, w]) => w > 0);
    const total = entries.reduce((a, [, w]) => a + w, 0) || 1;
    // N is dissolved interstitially and adds no volume at these levels
    const vol = entries.filter(([el]) => el !== 'N').reduce((a, [el, w]) => a + (w / total * 100) / elementDensity(el), 0);
    return 100 / vol;
  }
  function vec(comp) {
    const V = { Fe: 8, Ni: 10, Cr: 6, Mo: 6, Ti: 4, Al: 3, V: 5, Cu: 11, Co: 9, W: 6, Mn: 7, Nb: 5, Zn: 12, Mg: 2, Si: 4, C: 4, Zr: 4, Hf: 4, Ta: 5, Sn: 4 };
    const mass = (sym) => Number((window.MH_FIREBASE?.getHandbook?.()?.periodic || []).find((r) => r.symbol === sym)?.mass) || 50;
    const at = Object.entries(comp).map(([el, w]) => [el, w / mass(el)]);
    const tot = at.reduce((a, [, x]) => a + x, 0) || 1;
    return at.reduce((a, [el, x]) => a + (V[el] || 6) * (x / tot), 0);
  }

  function elementNames() {
    const rows = window.MH_FIREBASE?.getHandbook?.()?.periodic || [];
    const map = { aluminium: 'Al', sulphur: 'S', caesium: 'Cs' };
    rows.forEach((r) => { map[String(r.name).toLowerCase()] = r.symbol; });
    return map;
  }

  /* ---- property tables used by the finder gates ---- */
  const FERRO_FAMILIES = ['Carbon steel', 'Low-alloy steel', 'Tool steel', 'Specialty steel', 'Cast iron'];
  const FERRO_IDS = ['ss410', 'ss430', 'ss174', 'du2205', 'du2507', 'ni200', 'stellite6', 'monel400'];
  const isMagnetic = (g) => FERRO_IDS.includes(g.id) || FERRO_FAMILIES.includes(g.family);
  const EC = { cuetp: 100, brass70: 28, brassfc: 26, phbronze: 15, albronze: 7, al6061: 43, al6063: 53, al7075: 33, al2024: 30, al5083: 29, al5052: 35, alsi10mg: 30, mgaz31: 38, ni200: 18, tungsten: 31, tzm: 34 };
  const elecCond = (g) => EC[g.id] ?? 3;
  const BIO = ['ti2', 'ti64', 'ss316l'];
  const FOOD = ['ss304', 'ss304l', 'ss316', 'ss316l', 'ti2', 'ti64', 'du2205'];
  const WEAR = ['d2', 'h13', 'stellite6', 'ss174', 'maraging', 'en24', 'tungsten', 'ss410'];
  const SOUR_OK = ['in625', 'c276'];
  const SOUR_LIMITED = ['ss316l', 'ss316', 'in718', 'monelk500', 'monel400', 'du2205', 'du2507', 'ss174', 'ti64', 'ti2', 'ss904l', 'h230'];
  const STRUCT_CUES = /\b(mpa|gpa|ksi|yield|stress|load|pressure|weld\w*|valve|stem|shaft|bracket|tank|pipe|frame|blade|fastener|bolt|housing|plate|beam|structural|aerospace|subsea|offshore|marine|cryogenic|part|component)\b/i;
  const toMPa = (n, u) => Number(n) * (/gpa/i.test(u) ? 1000 : /ksi/i.test(u) ? 6.895 : 1);

  const UNMODELLED = [
    [/fatigue/i, 'fatigue life'], [/creep/i, 'creep life'], [/fracture toughness|\bK1c\b|\bKIC\b/i, 'fracture toughness value'],
    [/hardness|\bHRC\b|\bHV\b|brinell/i, 'hardness'], [/thermal expansion|\bCTE\b/i, 'thermal expansion'], [/damping/i, 'vibration damping'],
    [/radiation|nuclear/i, 'radiation behaviour'], [/vacuum|outgass/i, 'vacuum outgassing'], [/lead time|delivery time/i, 'lead time'],
    [/elongation/i, 'elongation target'], [/modulus|stiffness/i, 'stiffness / modulus'], [/coating|plating|anodi[sz]/i, 'coating options'],
    [/\bASTM\b|\bAPI\b|\bNORSOK\b|\bISO\b/i, 'specific standard compliance'], [/fire|flammab/i, 'fire behaviour'],
  ];

  function parseRequirement(text) {
    const raw = String(text || '').replace(/[−–]/g, '-');
    const req = {
      text: raw, tempC: null, stress: null, yieldMin: null, maxCost: null, maxDensity: null, banned: [], corr: 0,
      weld: false, ductile: false, am: false, hydrogen: false, functional: false, nonMagnetic: false, sour: false, conductive: false,
      bio: false, food: false, wear: false, rank: null, sfExplicit: null, sfUser: null, notes: [], unmodelled: [], constraintCount: 0,
    };
    // temperatures: C, F, K
    const temps = [];
    raw.replace(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:°\s*C|deg(?:rees?)?\.?\s*C|celsius|centigrade)/gi, (m, n) => { temps.push(Number(n.replace(/,/g, ''))); return m; });
    if (!temps.length) {
      // looser forms: "600C", "600 C", "600°", "600 degrees", "600 deg"
      raw.replace(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:°|deg(?:rees?)?\b|C(?![A-Za-z0-9]))/g, (m, n) => { if (!/F/.test(m)) temps.push(Number(n.replace(/,/g, ''))); return m; });
    }
    raw.replace(/(-?\d[\d,]*(?:\.\d+)?)\s*(?:°\s*F|deg(?:rees)?\s*F|fahrenheit)/gi, (m, n) => { temps.push((Number(n.replace(/,/g, '')) - 32) / 1.8); return m; });
    raw.replace(/(\d+(?:\.\d+)?)\s*K\b/g, (m, n) => { temps.push(Number(n) - 273.15); return m; });
    if (temps.length) req.tempC = Math.max(-269, temps.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)));
    if (req.tempC !== null && req.tempC > 3500) req.notes.push(`${num(req.tempC)}°C is above the melting point of every metal, including tungsten (about 3,400°C). Try a lower temperature or a ceramic or carbon material.`);
    if (req.tempC === null) {
      // words that imply a temperature when none is given: the assumption is shown in the notes
      if (/exhaust|furnace|kiln|boiler|forge|incinerat|combustion|rocket/i.test(raw)) { req.tempC = 800; req.notes.push('No temperature given, so I assumed about 800°C for a hot part. Add your own number to refine the list.'); }
      else if (/\bhot\b|high[- ]temp(?:erature)?|\bheat\b|engine/i.test(raw)) { req.tempC = 500; req.notes.push('No temperature given, so I assumed about 500°C for a hot part. Add your own number to refine the list.'); }
    }
    if (/cryo|liquid (?:hydrogen|nitrogen|helium|oxygen)|\bLH2\b|\bLN2\b/i.test(raw) && (req.tempC === null || req.tempC > -150)) req.tempC = req.tempC !== null && req.tempC < 0 ? req.tempC : -196;

    // explicit yield-strength requirements are separate from applied stress (no hidden safety factor)
    let work = raw;
    const yields = [];
    const takeYield = (m, n, u) => { yields.push(toMPa(n, u)); return ' '; };
    work = work.replace(/(?:min(?:imum)?\.?\s*)?(?:yield(?:\s*strength)?|\bys\b|proof\s*stress|0\.2\s*%\s*(?:proof|offset))\s*(?:of|[:=≥>]|>=|at least|min(?:imum)?)?\s*(\d+(?:\.\d+)?)\s*(MPa|GPa|ksi)/gi, (m, n, u) => takeYield(m, n, u));
    work = work.replace(/(\d+(?:\.\d+)?)\s*(MPa|GPa|ksi)\s*(?:min(?:imum)?\s*)?yield/gi, (m, n, u) => takeYield(m, n, u));
    if (yields.length) req.yieldMin = Math.max(...yields);
    const stresses = [];
    work.replace(/(\d+(?:\.\d+)?)\s*(MPa|GPa|ksi)/gi, (m, n, u) => { stresses.push(toMPa(n, u)); return m; });
    if (stresses.length) req.stress = Math.max(...stresses);
    const sf = raw.match(/(?:safety factor|factor of safety|\bSF\b)\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)/i);
    if (sf) req.sfExplicit = Number(sf[1]);

    // cost (INR/kg, USD converted at 85)
    const PER_KG = '(?:\\/\\s*(?:kg|kilo)\\b|per\\s*(?:kg|kilo(?:gram)?)\\b|a\\s*kg\\b|\\/\\s*kilogram)';
    const CUR = '(₹|rs\\.?|inr|rupees?|\\$|usd|dollars?)';
    let m = raw.match(new RegExp(`${CUR}\\s*([\\d,]+(?:\\.\\d+)?)\\s*${PER_KG}`, 'i'))
      || raw.match(new RegExp(`([\\d,]+(?:\\.\\d+)?)\\s*${CUR}\\s*${PER_KG}`, 'i'))
      || raw.match(new RegExp(`(?:under|below|less than|max(?:imum)?|within|<=?|≤)\\s*(₹|rs\\.?|inr|rupees?|\\$|usd)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:\\/\\s*kg|per\\s*kg|a\\s*kg)`, 'i'));
    if (m) {
      // the number and the currency can come in either order
      const numFirst = /^[\d,]/.test(m[1] || '');
      const cur = String(numFirst ? m[2] : m[1] || '').toLowerCase();
      const val = Number(String(numFirst ? m[1] : m[2]).replace(/,/g, ''));
      req.maxCost = /\$|usd|dollar/.test(cur) ? val * 85 : val;
      if (/\$|usd|dollar/.test(cur)) req.notes.push(`Converted $${val}/kg to about ₹${num(req.maxCost)}/kg`);
    }
    m = raw.match(/(?:density|lighter than|under|below|<=?|≤)\s*(?:<=?|≤)?\s*(\d+(?:\.\d+)?)\s*g\s*\/\s*(?:cm3|cm³|cc)/i);
    if (m) req.maxDensity = Number(m[1]);

    // excluded elements
    const names = elementNames();
    const banned = new Set();
    raw.replace(/(?:\bno\b|\bzero\b|without|free of|exclude|avoid)\s+([^.;\n]*)/gi, (full, tail) => {
      if (/^(?:magnetic|magnetism)/i.test(String(tail).trim())) return full;
      String(tail).split(/[,\/]|\band\b|\bor\b|\s+/).forEach((tok) => {
        const word = tok.trim().replace(/[^A-Za-z]/g, '');
        if (!word) return;
        const sym = names[word.toLowerCase()] || (/^[A-Z][a-z]?$/.test(word) && Object.values(names).includes(word) ? word : null);
        if (sym) banned.add(sym);
      });
      return full;
    });
    req.banned = Array.from(banned);

    // environment and needs (negation-safe: "non-magnetic" and "H2S" are NOT functional-material requests)
    const noSour = raw.replace(/hydrogen\s+sulph?ide/gi, ' H2S ');
    req.nonMagnetic = /non[-\s]?magnetic|paramagnetic|low[-\s]?magnetic|magnetically transparent|magnetic permeability|\bMRI\b|\bMR[- ]safe\b/i.test(raw);
    req.sour = /\bNACE\b|MR0175|ISO 15156|sour (?:service|gas|environment)|\bH2S\b|hydrogen\s+sulph?ide/i.test(raw);
    if (/sea ?water|submerg|marine|offshore|subsea|ocean|brine/i.test(raw)) req.corr = 3;
    else if (/coast|salt|chloride|humid|corros|rust/i.test(raw)) req.corr = 2;
    if (/acid|chemical|caustic|\bH2S\b|sour/i.test(raw)) req.corr = 3;
    req.weld = /weld/i.test(raw);
    req.ductile = /ductil|toughness|tough\b|fracture|weld/i.test(raw);
    req.am = /lpbf|slm|dmls|3d[- ]?print|additive|\bAM\b|powder bed/i.test(raw);
    req.hydrogen = /hydrogen/i.test(noSour) && !/storage alloy|hydride/i.test(noSour);
    req.conductive = /conductiv|bus ?bar|current[- ]carrying|electrical contact|heat ?sink|heat exchanger|thermal management/i.test(raw);
    req.bio = /implant|biocompatib|surgical|dental|orthop|medical device/i.test(raw);
    req.food = /food|pharma|sanitary|hygienic|dairy|beverage|brewery/i.test(raw);
    req.wear = /\bwear\b|abras|galling|erosion|cutting tool|\bdie\b|\bdies\b/i.test(raw);
    const stripped = raw.replace(/non[-\s]?magnetic|paramagnetic|low[-\s]?magnetic|magnetically transparent/gi, ' ');
    req.functional = /\bmagnet(?:ic|s)\b|catalys|amorphous|metallic glass|glass ribbon|hydrogen storage|hydride|thermoelectric|superconduct/i.test(stripped) && !STRUCT_CUES.test(stripped);

    // superlatives choose the ranking key (never silently fall back to cheapest/lightest)
    const RANKS = [
      [/strongest|highest strength|most strong|toughest|highest yield/i, 'strength'],
      [/lightest|lowest density|most lightweight/i, 'density'],
      [/cheapest|lowest cost|most affordable|least expensive/i, 'cost'],
      [/highest (?:melting|temperature)|most heat[- ]resistant|hottest|withstand(?:s)? the highest/i, 'temp'],
      [/most corrosion[- ]resistant|best corrosion|corrosion[- ]proof/i, 'corrosion'],
    ];
    const hit = RANKS.find(([re]) => re.test(raw));
    if (hit) req.rank = hit[1];
    else if (/\blight(?:weight)?\b/i.test(raw)) req.rank = 'density';
    else if (/\bcheap|low[- ]cost|budget|affordable/i.test(raw)) req.rank = 'cost';
    else if (req.conductive) req.rank = 'conductivity';

    UNMODELLED.forEach(([re, label]) => { if (re.test(raw) && !(label === 'specific standard compliance' && req.sour)) req.unmodelled.push(label); });
    req.constraintCount = [req.tempC !== null, req.stress, req.yieldMin, req.maxCost, req.maxDensity, req.banned.length, req.corr, req.weld, req.am, req.hydrogen,
      req.nonMagnetic, req.sour, req.conductive, req.bio, req.food, req.wear].filter(Boolean).length;
    return req;
  }

  function evaluateGrade(g, req) {
    const fails = [];
    const notes = [];
    const T = req.tempC;
    const rho = analyticDensity(g.comp);
    const price = mid(g.price);
    const effT = T === null ? 25 : T;
    const yT = effT < -50 && g.cryo ? g.y * 1.3 : yieldAt(g, effT);
    const sfY = req.sfUser ?? req.sfExplicit ?? 1.0;   // a stated minimum yield already includes the user's margin
    const sfS = req.sfUser ?? req.sfExplicit ?? 1.5;   // applied loads get a default design factor, shown and editable
    const need = Math.max(req.yieldMin ? req.yieldMin * sfY : 0, req.stress ? req.stress * sfS : 0);
    if (req.maxDensity && rho > req.maxDensity) fails.push(['density', `Density ${rho.toFixed(2)} g/cm³ is above your ${req.maxDensity} g/cm³ limit`, rho / req.maxDensity - 1]);
    if (req.maxCost && price > req.maxCost) fails.push(['cost', `Typical ${rupee(price)}/kg is above your ${rupee(req.maxCost)}/kg limit`, price / req.maxCost - 1]);
    const hit = req.banned.filter((el) => (g.comp[el] || 0) > 0.05);
    if (hit.length) fails.push(['banned', `Contains ${hit.join(', ')}, which you excluded`, 1]);
    if (T !== null && T > 0 && g.t < T) fails.push(['temperature', `Rated to about ${num(g.t)}°C, below your ${num(T)}°C`, (T - g.t) / Math.max(T, 100)]);
    if (effT <= -50 && !g.cryo) fails.push(['cryogenic', `${g.s === 'BCC' ? 'BCC lattice turns brittle in the cold' : 'Not proven tough at low temperature'}`, 1]);
    if (need && yT < need) fails.push(['strength', `Yield at ${num(effT)}°C is about ${num(Math.round(yT))} MPa, below ${num(Math.round(need))} MPa needed`, 1 - yT / need]);
    if (g.c < req.corr) fails.push(['corrosion', `Corrosion resistance ${g.c}/3, needs ${req.corr}/3`, (req.corr - g.c) / 3]);
    if (req.weld && g.w === 'poor') fails.push(['weldability', 'Prone to cracking when welded', 0.5]);
    if (req.ductile) {
      const metalloids = ['B', 'C', 'P', 'Si'].reduce((a, el) => a + (g.comp[el] || 0), 0);
      if (metalloids > 2) fails.push(['metalloids', `${metalloids.toFixed(1)} wt% of B/C/Si/P is too brittle for ductile, weldable service (cap 2%)`, 0.5]);
      if (g.family === 'Cast iron') fails.push(['metalloids', 'Cast iron is brittle', 0.5]);
    }
    if (req.am && g.am !== 'proven') fails.push(['process', 'Not a proven laser powder-bed (LPBF) material', 0.5]);
    if (req.hydrogen && (g.s !== 'FCC' || ['Titanium', 'Tool steel', 'Specialty steel', 'Magnesium'].includes(g.family))) fails.push(['hydrogen', 'Susceptible to hydrogen embrittlement or hydride formation', 1]);
    if (req.nonMagnetic && isMagnetic(g)) fails.push(['magnetic', 'Magnetic (ferromagnetic) material', 1]);
    if (req.conductive && elecCond(g) < 30) fails.push(['conductivity', `Electrical/thermal conductivity only about ${elecCond(g)}% of copper (needs 30%+)`, 1 - elecCond(g) / 30]);
    if (req.bio && !BIO.includes(g.id)) fails.push(['biocompat', 'Not a standard implant-grade biocompatible metal', 1]);
    if (req.food && !FOOD.includes(g.id)) fails.push(['food', 'Not a standard food / pharma contact metal', 1]);
    if (req.wear && !WEAR.includes(g.id)) fails.push(['wear', 'Not a wear- or abrasion-resistant grade', 0.6]);
    if (req.sour) {
      if (!SOUR_OK.includes(g.id) && !SOUR_LIMITED.includes(g.id)) fails.push(['sour', 'Not qualified for sour (H2S) service under NACE MR0175 / ISO 15156', 1]);
      else if (SOUR_LIMITED.includes(g.id)) notes.push('Sour service only with limits (hardness, temperature, chloride). Check NACE MR0175 / ISO 15156 for your exact condition.');
    }
    const margin = need ? yT / need : null;
    const availPts = { stock: 10, order: 6, import: 2 }[g.av] || 0;
    const strengthPts = margin === null ? 20 : 30 * clampN((margin - 1) / 1.5, 0, 1);
    const costPts = req.maxCost ? 30 * clampN(1 - price / req.maxCost, 0, 1) : 30 * clampN(1 - price / 6000, 0, 1);
    const densPts = req.maxDensity ? 20 * clampN(1 - rho / req.maxDensity, 0, 1) : 20 * clampN(1 - rho / 12, 0, 1);
    return { grade: g, fails, notes, rho, yT, margin, need, price, score: Math.round(strengthPts + costPts + densPts + availPts + 10) };
  }

  /* failure-style questions ("my 304 bracket rusted at the coast") route to the Failure Doctor logic */
  function detectFailure(text, req) {
    const g = findGrade(text);
    if (!g || !/\b(failed|failure|broke|broken|cracked|cracking|rusted|rusting|corroded|melted|warped|bent|snapped|keeps? (?:cracking|rusting|breaking))\b/i.test(text)) return null;
    let event = 'warped';
    if (/rust|corrod|pitting|stain/i.test(text)) event = 'corroded';
    else if (/melt|soft|sag|slump/i.test(text)) event = 'melted';
    else if (/brittle|shatter|snap/i.test(text)) event = 'brittle';
    else if (/crack|fatigue|vibrat|broke|break/i.test(text)) event = 'crack_vib';
    let env = 'dry';
    if (/sea|salt|coast|marine|ocean|chloride/i.test(text)) env = 'coastal';
    else if (/exhaust|furnace|boiler|kiln|hot|900|1000/i.test(text) || (req.tempC !== null && req.tempC >= 600)) env = 'hot900';
    else if (/acid|chemical|caustic|bleach/i.test(text)) env = 'acid';
    else if (/cryo|cold|freez|sub-?zero/i.test(text) || (req.tempC !== null && req.tempC <= -50)) env = 'cryo';
    return { grade: g, event, env, result: diagnose(g, event, env) };
  }

  function findAlloys(text, opts = {}) {
    const req = parseRequirement(text);
    if (opts.sf) req.sfUser = Number(opts.sf);
    if (req.functional) return { req, blocked: 'functional' };
    const failure = detectFailure(text, req);
    if (failure) return { req, failure, passed: [], near: [], unlock: [], funnel: {}, total: GRADES.length };
    const evaluated = GRADES.map((g) => evaluateGrade(g, req));
    const rankKey = {
      strength: (e) => -e.yT, density: (e) => e.rho, cost: (e) => e.price, temp: (e) => -e.grade.t,
      corrosion: (e) => -(e.grade.c * 1e6) + e.price, conductivity: (e) => -elecCond(e.grade),
    }[req.rank];
    const passed = evaluated.filter((e) => !e.fails.length).sort((a, b) => (rankKey ? rankKey(a) - rankKey(b) : b.score - a.score));
    const funnel = {};
    evaluated.forEach((e) => e.fails.forEach(([k]) => { funnel[k] = (funnel[k] || 0) + 1; }));
    const near = evaluated.filter((e) => e.fails.length).sort((a, b) => (a.fails.length - b.fails.length) || (b.score - a.score)).slice(0, 3);
    const single = {};
    evaluated.filter((e) => e.fails.length === 1).forEach((e) => { (single[e.fails[0][0]] = single[e.fails[0][0]] || []).push(e); });
    const unlock = Object.entries(single).map(([gate, list]) => ({ gate, list: list.sort((a, b) => a.fails[0][2] - b.fails[0][2]).slice(0, 3) })).sort((a, b) => a.list[0].fails[0][2] - b.list[0].fails[0][2]).slice(0, 3);
    return { req, passed, near, unlock, funnel, total: evaluated.length, noLimits: req.constraintCount === 0 && !req.rank };
  }

  const FUNNEL_LABEL = { density: 'too heavy', cost: 'too expensive', banned: 'contains excluded elements', temperature: 'cannot take the temperature', cryogenic: 'brittle in the cold', strength: 'not strong enough', corrosion: 'corrodes too easily', weldability: 'poor weldability', metalloids: 'too brittle (B/C/Si/P)', process: 'not proven for 3D printing', hydrogen: 'hydrogen-embrittlement risk', magnetic: 'magnetic', conductivity: 'not conductive enough', biocompat: 'not biocompatible', food: 'not food-safe', wear: 'not wear-resistant', sour: 'not qualified for sour service' };
  const UNLOCK_LABEL = { density: 'the weight limit', cost: 'the budget', banned: 'the excluded elements', temperature: 'the temperature requirement', cryogenic: 'the low-temperature toughness requirement', strength: 'the strength requirement', corrosion: 'the corrosion requirement', weldability: 'the weldability requirement', metalloids: 'the ductility requirement', process: 'the 3D-printing requirement', hydrogen: 'the hydrogen-service requirement', magnetic: 'the non-magnetic requirement', conductivity: 'the conductivity requirement', biocompat: 'the biocompatibility requirement', food: 'the food-safety requirement', wear: 'the wear requirement', sour: 'the sour-service requirement' };
  const FINDER_EXAMPLES = [
    'Lightweight drone arm at 25°C, 300 MPa, density under 3 g/cm3, under ₹800/kg',
    'Subsea valve stem, minimum yield 750 MPa, non-magnetic, H2S sour service, weldable',
    'Cryogenic liquid hydrogen tank at 20 K, 150 MPa, weldable and tough, no cobalt',
    'EV battery busbar, high electrical conductivity, under ₹1,000/kg',
    'Surgical implant, biocompatible, 500 MPa',
    'What is the strongest metal here?',
    'My 304 bracket keeps rusting at the coast',
    'Rocket injector plate at 1400°C, 60 MPa, zero cobalt, under ₹2000/kg',
  ];

  function reqChips(req) {
    const sfNow = req.sfUser ?? req.sfExplicit;
    const sfOpts = ['auto', '1', '1.25', '1.5', '2'].map((v) => `<option value="${v}" ${(v === 'auto' && sfNow == null) || Number(v) === sfNow ? 'selected' : ''}>${v === 'auto' ? 'Auto' : `${v}×`}</option>`).join('');
    const chips = [];
    chips.push(['Temperature', req.tempC === null ? 'Not given (room temp.)' : `${num(Math.round(req.tempC))}°C`]);
    if (req.yieldMin) chips.push(['Min. yield strength', `${num(req.yieldMin)} MPa (used as stated)`]);
    if (req.stress) chips.push(['Applied stress', `${num(req.stress)} MPa (safety factor applied)`]);
    if (req.yieldMin || req.stress) chips.push(['Safety factor', `<select id="aiSf" class="field-select">${sfOpts}</select>`, true]);
    chips.push(['Max cost', req.maxCost ? `${rupee(Math.round(req.maxCost))}/kg` : 'Not given']);
    chips.push(['Max density', req.maxDensity ? `${req.maxDensity} g/cm³` : 'Not given']);
    chips.push(['Excluded', req.banned.length ? req.banned.join(', ') : 'None']);
    const needs = [req.corr ? `corrosion ${req.corr}/3` : '', req.weld ? 'weldable' : '', req.ductile ? 'ductile, tough' : '', req.am ? 'LPBF printable' : '', req.hydrogen ? 'hydrogen service' : '',
      req.nonMagnetic ? 'non-magnetic' : '', req.sour ? 'sour (H2S) service' : '', req.conductive ? 'conductive' : '', req.bio ? 'biocompatible' : '', req.food ? 'food-safe' : '', req.wear ? 'wear-resistant' : ''].filter(Boolean);
    chips.push(['Also needs', needs.length ? needs.join(', ') : 'Nothing specific']);
    if (req.rank) chips.push(['Ranking by', { strength: 'highest strength', density: 'lowest weight', cost: 'lowest cost', temp: 'highest temperature', corrosion: 'best corrosion resistance', conductivity: 'highest conductivity' }[req.rank]]);
    return chips.map(([k, v, html]) => `<div class="ai-req-item"><div class="ai-req-label">${esc(k)}</div><div class="ai-req-value">${html ? v : esc(v)}</div></div>`).join('');
  }

  function resultCard(e, i, req, tag) {
    const g = e.grade;
    const T = req.tempC === null ? 25 : req.tempC;
    const av = AVAIL[g.av];
    const stds = [g.std.astm, g.std.is !== '-' ? g.std.is : ''].filter(Boolean).join(' · ');
    return `<div class="ai-result-card${tag === 'near' ? ' near' : ''}">
      <div class="ai-result-header"><span class="ai-result-formula">${esc(g.name)}</span>${tag === 'near' ? '<span class="ai-result-score miss">MISSES</span>' : `<span class="ai-result-score" title="Ranking score among grades that pass every hard limit">${e.score}</span>`}</div>
      <p class="gc-std">${esc(stds)}</p>
      <div class="ai-result-props">
        <span class="ai-result-prop"><b>${num(Math.round(e.yT))} MPa</b> yield at ${num(T)}°C</span>
        ${e.margin ? `<span class="ai-result-prop"><b>${e.margin.toFixed(1)}×</b> margin over need</span>` : ''}
        <span class="ai-result-prop"><b>${e.rho.toFixed(2)} g/cm³</b> density</span>
        <span class="ai-result-prop"><b>${rupee(g.price[0])}-${rupee(g.price[1])}</b> /kg</span>
        <span class="ai-result-prop tone-${av.tone}">${esc(av.label)}</span>
      </div>
      ${window.MH_ENGINE ? window.MH_ENGINE.crossCheckHtml(g, 'y') : ''}
      <div class="gc-feas">
        <div><span>CNC</span>${pill(...FEAS.m[g.m])}</div><div><span>Welding</span>${pill(...FEAS.w[g.w])}</div><div><span>3D printing</span>${pill(...FEAS.am[g.am])}</div>
      </div>
      ${tag === 'near' ? `<ul class="ai-why">${e.fails.map(([, why]) => `<li>${esc(why)}</li>`).join('')}</ul>` : ''}
      ${(e.notes || []).map((n) => `<p class="ai-caveat">${esc(n)}</p>`).join('')}
      <div class="ai-result-actions">
        <button class="btn btn-primary small" data-find-load="${g.id}">Test in simulator</button>
        <button class="btn btn-glass small" data-find-rfq="${g.id}">Get RFQ</button>
      </div>
    </div>`;
  }

  function renderFinder() {
    const container = q('#aiDesignPanel');
    if (!container) return;
    container.innerHTML = `
      <div class="ai-design-input">
        <label class="field-label" for="aiDesignPrompt">Describe your problem: what the part must do, or what went wrong</label>
        <textarea id="aiDesignPrompt" rows="3" placeholder="e.g. Turbine blade at 1000°C, 50 MPa, zero cobalt, under $60/kg, weldable"></textarea>
        <div class="finder-examples">${FINDER_EXAMPLES.map((x, i) => `<button type="button" class="copilot-chip" data-example="${i}">${esc(x)}</button>`).join('')}</div>
        <div class="rfq-actions"><button class="btn btn-primary" id="runAIDesign">Find alloys</button><button class="btn btn-ghost" id="clearAIDesign">Clear</button></div>
        <p class="micro-note">Searches ${GRADES.length} real commercial grades. Every limit you give (strength, temperature, budget, weight, excluded elements, non-magnetic, sour service, conductivity, biocompatibility…) is a strict pass/fail check before ranking, and anything it cannot check is listed so nothing is silently ignored. Describe a failure instead ("my 304 bracket rusted at the coast") and it diagnoses the cause.</p>
      </div>
      <div class="ai-design-requirements" id="aiDesignRequirements" style="display:none"></div>
      <div id="aiFunnel" class="ai-funnel"></div>
      <div class="ai-design-results" id="aiDesignResults"></div>`;
    qa('[data-example]', container).forEach((b) => b.addEventListener('click', () => { q('#aiDesignPrompt').value = FINDER_EXAMPLES[Number(b.dataset.example)]; runFinder(); }));
    q('#runAIDesign').addEventListener('click', () => runFinder());
    q('#clearAIDesign').addEventListener('click', () => { q('#aiDesignPrompt').value = ''; q('#aiDesignRequirements').style.display = 'none'; q('#aiFunnel').innerHTML = ''; q('#aiDesignResults').innerHTML = ''; });
  }

  function failureHtml(f) {
    const r = f.result;
    return `<div class="ai-note warn"><b>This sounds like a failure, so here is the likely cause.</b></div>
      <div class="ai-result-card" style="grid-column:1/-1"><div class="ai-result-header"><span class="ai-result-formula">${esc(r.mechanism)}</span></div>
      <p class="dr-why">${esc(r.why)}</p><ul class="dr-evidence">${r.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      ${r.fixes.map((g, i) => `<div class="ai-result-card"><div class="ai-result-header"><span class="ai-result-formula">${esc(g.name)}</span>${i === 0 ? '<span class="ai-result-score">BEST FIX</span>' : ''}</div>
        <div class="ai-result-props"><span class="ai-result-prop"><b>${rupee(g.price[0])}-${rupee(g.price[1])}</b> /kg</span><span class="ai-result-prop tone-${AVAIL[g.av].tone}">${esc(AVAIL[g.av].label)}</span></div>
        ${window.MH_ENGINE ? window.MH_ENGINE.crossCheckHtml(g, 'y') : ''}
        <div class="ai-result-actions"><button class="btn btn-primary small" data-find-load="${g.id}">Test in simulator</button><button class="btn btn-glass small" data-find-rfq="${g.id}">Get RFQ</button></div></div>`).join('')}`;
  }

  function runFinder(sfOverride) {
    const text = q('#aiDesignPrompt')?.value?.trim();
    if (!text) { notify('Describe the requirement first, or pick an example.', 'warning'); return; }
    const out = findAlloys(text, { sf: typeof sfOverride === 'string' || typeof sfOverride === 'number' ? sfOverride : null });
    const reqBox = q('#aiDesignRequirements');
    reqBox.style.display = 'grid';
    reqBox.innerHTML = reqChips(out.req);
    q('#aiSf')?.addEventListener('change', (e) => runFinder(e.target.value === 'auto' ? null : e.target.value));
    const funnel = q('#aiFunnel');
    const results = q('#aiDesignResults');
    const unmod = out.req.unmodelled.length ? `<div class="ai-note warn"><b>Not checked automatically:</b> ${esc(out.req.unmodelled.join(', '))}. Confirm these with your supplier or a lab. Everything else above is a strict pass/fail check.</div>` : '';
    if (out.blocked) {
      funnel.innerHTML = '<div class="ai-note warn"><b>This looks like a functional-material request</b> (magnetic, catalytic, amorphous or hydrogen-storage). The finder covers structural alloys, so no list is returned. If you need a non-magnetic structural metal, say "non-magnetic" with your load and conditions.</div>';
      results.innerHTML = '';
      return;
    }
    if (out.failure) {
      funnel.innerHTML = '';
      results.innerHTML = failureHtml(out.failure);
    } else if (out.noLimits) {
      funnel.innerHTML = '<div class="ai-note warn"><b>I could not find any limits in that.</b> Add at least one requirement so the list means something: a temperature, a load in MPa, a budget in ₹/kg, a corrosion environment, "non-magnetic", "weldable", or ask a question like "strongest metal".</div>';
      results.innerHTML = '';
      return;
    } else {
      const failed = Object.entries(out.funnel).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${FUNNEL_LABEL[k] || k}`);
      const rankNote = out.req.rank ? ` Sorted by ${{ strength: 'highest strength', density: 'lowest weight', cost: 'lowest cost', temp: 'highest temperature', corrosion: 'best corrosion resistance', conductivity: 'highest conductivity' }[out.req.rank]}.` : '';
      const scope = out.req.rank === 'strength' ? ' This is the strongest among the engineering grades in the library; ceramics, composites and exotic materials are not included.' : '';
      funnel.innerHTML = `<div class="ai-note"><b>${out.passed.length} of ${out.total}</b> commercial grades pass every hard limit.${esc(rankNote)}${esc(scope)}${failed.length ? ` Removed: ${esc(failed.join(' · '))}.` : ''}</div>${out.req.notes.length ? `<div class="ai-note">${esc(out.req.notes.join('. '))}.</div>` : ''}`;
      const list = out.passed.slice(0, 8);
      results.innerHTML = list.length
        ? list.map((e, i) => resultCard(e, i, out.req, 'pass')).join('')
        : (out.unlock.length
          ? `<div class="ai-note warn"><b>No commercial grade meets every requirement.</b> Here is what is really blocking you. Each grade below passes everything except one limit:</div>${out.unlock.map((u) => `<div class="ai-note"><b>If you relax ${esc(UNLOCK_LABEL[u.gate] || u.gate)}:</b></div>${u.list.map((e) => resultCard(e, 0, out.req, 'near')).join('')}`).join('')}`
          : `<div class="ai-note warn"><b>No commercial grade meets every requirement.</b> Closest options and what each one misses:</div>${out.near.map((e, i) => resultCard(e, i, out.req, 'near')).join('')}`);
    }
    funnel.innerHTML += unmod;
    qa('[data-find-load]', results).forEach((b) => b.addEventListener('click', () => {
      applyGrade(BY_ID[b.dataset.findLoad], { tempC: out.req.tempC ?? 25, loadMpa: out.req.stress || out.req.yieldMin || undefined, safety: out.req.sfUser ?? out.req.sfExplicit ?? 1.5 });
    }));
    qa('[data-find-rfq]', results).forEach((b) => b.addEventListener('click', () => {
      state.simRequest = { ...(state.simRequest || {}), temperature_c: out.req.tempC ?? 25, load_mpa: out.req.stress || out.req.yieldMin || 0, safety_factor: out.req.sfUser ?? out.req.sfExplicit ?? 1.5 };
      openRfqSheet(b.dataset.findRfq);
    }));
    const shown = out.passed && out.passed.length ? out.passed : (out.near || []);
    if (shown.length && !out.failure) {
      results.insertAdjacentHTML('beforeend', '<div class="ai-review"><button class="btn btn-glass small" id="aiReview" type="button">Ask the assistant to review these results</button></div>');
      q('#aiReview', results)?.addEventListener('click', () => {
        const names = shown.slice(0, 5).map((e) => e.grade.name).join(', ');
        askAssistant(`Review these Alloy Finder results. My requirement: "${text}". Grades listed (${out.passed && out.passed.length ? 'they pass every limit' : 'closest misses, none pass every limit'}): ${names}. Which one would you pick, and what should I double-check before buying?`);
      });
    }
    if (window.MH_GROWTH?.track) window.MH_GROWTH.track('alloy_finder', { passed: (out.passed || []).length, failure: Boolean(out.failure) });
  }
  window.renderAIDesign = renderFinder;

  /* hand a question to the assistant (it answers on the device, or with the live AI if that is switched on) */
  function askAssistant(question) {
    if (typeof window.copilotOpen === 'function') window.copilotOpen();
    if (typeof window.copilotAsk === 'function') window.copilotAsk(question);
  }

  /* the Estimator switch changed: redraw whatever the Finder and the Doctor are showing */
  window.addEventListener('mh:engine', () => {
    try {
      if (q('#aiDesignResults') && q('#aiDesignResults').children.length && q('#aiDesignPrompt') && q('#aiDesignPrompt').value) runFinder();
      if (q('#drResult') && q('#drResult').children.length && q('#drMetal')) runDoctor();
    } catch { /* leave the page as it is */ }
  });

  /* ------------------------------------------------------------------ */
  /* Screening report PDF (replaces the plain-text dossier)              */
  /* ------------------------------------------------------------------ */
  async function screeningReport() {
    let sim = state.simulation;
    let req = state.simRequest || collectSimulationRequest();
    if (!sim) { req = collectSimulationRequest(); sim = await api('/api/simulate', { method: 'POST', body: req }); }
    const d = sim.derived;
    const comp = typeof normalisedComposition === 'function' ? normalisedComposition() : {};
    const info = describeMatch(comp, sim);
    const g = info.best.grade;
    const rho = analyticDensity(normalise(comp));
    const ref = `MH-RPT-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const pdf = makePdf();
    pdfHeader(pdf, 'Material Screening Report', ref);
    let y = 90;

    // verdict banner
    const tones = { SAFE: [[226, 246, 236], [16, 150, 100]], MARGINAL: [[253, 243, 220], [200, 130, 10]], UNSAFE: [[253, 228, 232], [200, 40, 70]], MELTED: [[253, 228, 232], [200, 40, 70]] };
    const [bg, fg] = tones[d.verdict] || tones.MARGINAL;
    pdf.rect(40, y, 515, 58, { fill: bg });
    pdf.rect(40, y, 5, 58, { fill: fg });
    const plain = plainEnglish(sim);
    pdf.text(58, y + 22, plain.title.toUpperCase(), { size: 15, bold: true, color: fg });
    const lines = pdf.wrap(`${plain.line} ${plain.next && !/^Next:/.test(plain.next) ? plain.next : ''}`, 480, 8.5);
    lines.slice(0, 2).forEach((l, i) => pdf.text(58, y + 38 + i * 11, l, { size: 8.5, color: INK }));
    y += 72;

    y = pdfSection(pdf, y, '1. Alloy');
    const els = Object.entries(comp).sort((a, b) => b[1] - a[1]).slice(0, 9);
    const colW = 515 / Math.max(els.length, 1);
    els.forEach(([el, v], i) => {
      const x = 40 + i * colW;
      pdf.rect(x, y, colW, 34, { stroke: [210, 218, 230] });
      pdf.text(x + 6, y + 13, el, { size: 10, bold: true, color: ACCENT });
      pdf.text(x + 6, y + 27, `${v.toFixed(v >= 10 ? 1 : 2)}%`, { size: 9, bold: true, color: INK });
    });
    y += 42;
    const stds = [g.std.astm, g.std.is !== '-' ? g.std.is : ''].filter(Boolean).join('  |  ');
    y = pdfKV(pdf, y, [
      [info.strong ? 'Closest commercial grade' : 'Nearest grade (no close match)', `${g.name} (${Math.round(info.best.score)}% match)`],
      ['Equivalent standards', stds || '-'],
      ['Indicative price (India)', info.price ? `${rupee(info.price[0])} - ${rupee(info.price[1])} /kg` : `Custom melt, raw metal about ${rupee(Math.round(d.cost_per_kg))} /kg`],
      ['Availability', AVAIL[info.avail].label],
    ]);

    y = pdfSection(pdf, y, '2. Service conditions');
    const cond = sim.conditions || {};
    y = pdfKV(pdf, y, [
      ['Temperature', `${num(cond.temperature_c ?? req.temperature_c)} °C`], ['Applied load', `${num(cond.load_mpa ?? req.load_mpa)} MPa`],
      ['Safety factor', String(cond.safety_factor ?? req.safety_factor)], ['Environment', String(cond.environment || req.environment || '-')],
      ['Pressure', d.pressure_label || '-'], ['Flow velocity', `${num(cond.velocity_kmh ?? req.velocity_kmh ?? 0)} km/h`],
    ], 3);

    y = pdfSection(pdf, y, '3. Results');
    const util = clampN(d.utilization_ratio || 0, 0, 1.5);
    pdf.text(44, y + 8, 'Capacity used', { size: 7, color: MUTED });
    pdf.rect(44, y + 12, 330, 10, { fill: [232, 238, 246] });
    pdf.rect(44, y + 12, 330 * clampN(util, 0, 1), 10, { fill: util > 1 ? [200, 40, 70] : util > 0.85 ? [220, 150, 20] : [16, 150, 100] });
    pdf.text(384, y + 21, `${Math.round((d.utilization_ratio || 0) * 100)}%`, { size: 11, bold: true, color: INK });
    y += 30;
    y = pdfKV(pdf, y, [
      ['Predicted yield strength', `${num(Math.round(sim.prediction.predicted))} MPa (+/-${num(Math.round(sim.prediction.uncertainty))})`],
      ['Working strength at temperature', `${num(Math.round(d.operating_strength_mpa))} MPa`],
      ['Density (from composition)', `${rho.toFixed(2)} g/cm3`],
      ['Raw material cost', `${rupee(Math.round(d.cost_per_kg))} /kg`],
      ['Melting range (liquidus)', `${num(Math.round(d.liquidus_c || 0))} °C`],
      ['Max service temperature', `${num(Math.round(d.thermal_limit_c || 0))} °C`],
    ], 3);

    y = pdfSection(pdf, y, '4. Can your shop make it?');
    const feas = [['CNC machining', FEAS.m[info.feas.m]], ['Welding', FEAS.w[info.feas.w]], ['Metal 3D printing', FEAS.am[info.feas.am]]];
    const tone = { good: [16, 150, 100], warn: [200, 130, 10], bad: [200, 40, 70] };
    feas.forEach(([label, [t, text]], i) => {
      const x = 40 + i * 172;
      pdf.rect(x, y, 167, 34, { stroke: [210, 218, 230] });
      pdf.rect(x, y, 4, 34, { fill: tone[t] });
      pdf.text(x + 12, y + 12, label, { size: 7, color: MUTED });
      pdf.wrap(text, 150, 7.5, true).slice(0, 2).forEach((l, k) => pdf.text(x + 12, y + 23 + k * 9, l, { size: 7.5, bold: true, color: INK }));
    });
    y += 44;

    y = pdfSection(pdf, y, '5. Engineering notes');
    const notes = [...(sim.advice || []).slice(0, 3), ...(sim.warnings || []).slice(0, 2)];
    const metalloids = ['B', 'C', 'P', 'Si'].reduce((a, el) => a + (comp[el] || 0), 0);
    if (metalloids > 2) notes.push(`High metalloid content (${metalloids.toFixed(1)}% B/C/Si/P) can make the alloy brittle and hard to weld.`);
    if (!info.strong) notes.push('This is a custom composition with no close commercial equivalent. Treat it as a research melt and validate with a tensile coupon.');
    notes.slice(0, 5).forEach((n) => { pdf.wrap(n, 500, 8.5).slice(0, 2).forEach((l, i) => { pdf.text(i ? 56 : 46, y + 9, (i ? '' : '- ') + l, { size: 8.5, color: INK }); y += 11; }); });
    y += 6;
    pdf.line(40, 790, 555, 790, { color: [200, 208, 220] });
    pdf.text(40, 803, 'Screening estimates only, not a certified test report. Validate with an NABL-accredited laboratory before production use.', { size: 7, color: MUTED });
    pdf.text(40, 826, `Generated by MaterialHunt | materialhunt-2026.web.app | ${ref}`, { size: 6.8, color: MUTED });
    return { blob: pdf.build(), ref };
  }

  window.downloadPdf = async function downloadScreeningPdf() {
    const button = q('#downloadPdf');
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.textContent = 'Building report...'; }
    try {
      const { blob, ref } = await screeningReport();
      saveBlob(blob, `${ref}.pdf`);
      notify('Report downloaded.', 'success', 2800);
    } catch (err) {
      notify(err.message || 'Could not build the report.', 'error');
    } finally {
      if (button) { button.disabled = false; button.innerHTML = original; }
    }
  };

  window.MH_TOOLS = { GRADES, BY_ID, screeningReport, buildRfqPdf, findAlloys, parseRequirement, analyticDensity, vec, matchGrades, findGrade, describeMatch, applyGrade, openRfqSheet, diagnose, scanBom, startBoard, lastMatch: null, GOALS };

  const origSetView = window.setView;
  if (typeof origSetView === 'function') {
    window.setView = function patchedSetView(view, scroll) {
      origSetView(view, scroll);
      if (view === 'challenge') { startBoard(); window.dispatchEvent(new CustomEvent('mh:view', { detail: { view } })); const n = q('#chName'); if (n && state.user && !n.value) n.value = state.user.organization_name || ''; }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
