// ============================================================
// The Bread Binder — app.js
// Renders markdown recipes with loaf-size switcher + baker's % calc
// ============================================================

const RECIPES_DIR = './';   // recipes sit next to index.html
const INDEX_FILE  = 'index.md';

const state = {
  recipes: [],   // [{num, title, file, type}]
  current: null,
};

const els = {
  nav:     document.getElementById('recipe-nav'),
  content: document.getElementById('content'),
  search:  document.getElementById('search'),
};

// ---------- bootstrap ----------
init();

async function init() {
  marked.setOptions({ gfm: true, breaks: false });
  try {
    const idxText = await fetchText(INDEX_FILE);
    state.recipes = parseIndex(idxText);
    renderNav();
  } catch (e) {
    els.nav.innerHTML = `<div class="error-box">Could not load <code>${INDEX_FILE}</code>.<br>${e.message}</div>`;
    console.error(e);
    return;
  }
  els.search.addEventListener('input', renderNav);
  window.addEventListener('hashchange', loadFromHash);
  loadFromHash();
}

// ---------- fetch / parse ----------
async function fetchText(path) {
  const r = await fetch(RECIPES_DIR + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${path}`);
  return r.text();
}

// Parse the Quick-Reference table inside index.md
// Row shape: | 1 | Basic Bread | [01-basic-bread.md](./01-basic-bread.md) | Bread |
function parseIndex(md) {
  const recipes = [];
  const rowRe = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|/gm;
  let m;
  while ((m = rowRe.exec(md)) !== null) {
    const file = m[4].replace(/^\.\//, '').trim();
    if (!file.endsWith('.md')) continue;
    recipes.push({
      num:   parseInt(m[1], 10),
      title: m[2].trim(),
      file,
      type:  m[5].trim(),
    });
  }
  return recipes;
}

// ---------- sidebar ----------
function renderNav() {
  const q = els.search.value.trim().toLowerCase();
  const filtered = q
    ? state.recipes.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q)  ||
        String(r.num).includes(q))
    : state.recipes;

  if (!filtered.length) {
    els.nav.innerHTML = `<div class="loading">No recipes match "${escapeHtml(q)}"</div>`;
    return;
  }

  // group by type, preserve type-first-seen order
  const order = [];
  const groups = {};
  filtered.forEach(r => {
    if (!groups[r.type]) { groups[r.type] = []; order.push(r.type); }
    groups[r.type].push(r);
  });

  const currentId = state.current?.file.replace(/\.md$/, '');
  let html = '';
  order.forEach(type => {
    html += `<div class="nav-group"><div class="nav-group-title">${escapeHtml(type)}</div>`;
    groups[type].forEach(r => {
      const id = r.file.replace(/\.md$/, '');
      const active = id === currentId ? ' active' : '';
      html += `<a class="nav-item${active}" href="#${id}" data-file="${r.file}">
        <span class="nav-num">${String(r.num).padStart(2,'0')}</span>
        <span>${escapeHtml(r.title)}</span>
      </a>`;
    });
    html += `</div>`;
  });
  els.nav.innerHTML = html;
}

// ---------- routing ----------
function loadFromHash() {
  const hash = (location.hash || '').replace(/^#/, '');
  if (!hash) return;

  if (hash === 'manual') {
    loadRecipe({ file: 'manual.md', title: 'Manual', num: 0, type: 'Reference' });
    return;
  }
  const recipe = state.recipes.find(r => r.file === `${hash}.md`);
  if (recipe) loadRecipe(recipe);
}

async function loadRecipe(recipe) {
  state.current = recipe;
  renderNav();
  els.content.innerHTML = `<div class="loading" style="padding:60px;color:var(--ink-mute);">Loading ${escapeHtml(recipe.title)}…</div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    let md   = await fetchText(recipe.file);
    md = fixMarkdownTables(md);
    const html = DOMPurify.sanitize(marked.parse(md));
    els.content.innerHTML = html;
    enhanceRecipe();
  } catch (e) {
    els.content.innerHTML = `<div class="error-box">Could not load <code>${escapeHtml(recipe.file)}</code>.<br>${escapeHtml(e.message)}</div>`;
  }
}

// Some source files have separator rows with one extra `---` cell
// (e.g. 5 columns of data but 6 dashes). Re-align the separator
// to match the header row's column count so marked parses the table.
function fixMarkdownTables(md) {
  const lines = md.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const sep = lines[i];
    if (!/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(sep)) continue;
    const header = lines[i - 1];
    if (!/^\s*\|.*\|\s*$/.test(header)) continue;
    const headerCols = header.trim().slice(1, -1).split('|').length;
    const sepCols    = sep.trim().slice(1, -1).split('|').length;
    if (sepCols !== headerCols) {
      lines[i] = '| ' + Array(headerCols).fill('---').join(' | ') + ' |';
    }
  }
  return lines.join('\n');
}

// ---------- post-render enhancements ----------
function enhanceRecipe() {
  // wrap h1 with eyebrow
  const h1 = els.content.querySelector('h1');
  if (h1 && state.current) {
    const eyebrow = document.createElement('div');
    eyebrow.className = 'recipe-eyebrow';
    const num = state.current.num ? `Program ${String(state.current.num).padStart(2,'0')} · ` : '';
    eyebrow.textContent = `${num}${state.current.type}`;
    h1.parentNode.insertBefore(eyebrow, h1);
    const header = document.createElement('div');
    header.className = 'recipe-header';
    h1.parentNode.insertBefore(header, eyebrow);
    header.appendChild(eyebrow);
    header.appendChild(h1);
  }

  injectSizeSwitcher();
  injectBakersCalculator();
}

// ---------- loaf size switcher ----------
function injectSizeSwitcher() {
  // Find a table whose header row has 500g / 750g / 1000g columns
  const table = findIngredientsTable();
  if (!table) return;

  const sizes = ['500g', '750g', '1000g'];
  const headerCells = [...table.tHead.rows[0].cells];
  const sizeColIdx = {}; // size -> column index
  headerCells.forEach((th, i) => {
    const t = th.textContent.trim();
    sizes.forEach(s => { if (t === s) sizeColIdx[s] = i; });
  });
  if (Object.keys(sizeColIdx).length < 2) return; // not a size-bearing table

  const switcher = document.createElement('div');
  switcher.className = 'size-switcher';
  switcher.innerHTML = `
    <span class="size-switcher-label">Loaf size</span>
    ${sizes.filter(s => sizeColIdx[s] !== undefined).map(s =>
      `<button class="size-btn" data-size="${s}">${s}</button>`).join('')}
    <button class="size-btn" data-size="all">show all</button>
  `;
  table.parentNode.insertBefore(switcher, table);

  switcher.addEventListener('click', e => {
    const btn = e.target.closest('.size-btn');
    if (!btn) return;
    const size = btn.dataset.size;
    [...switcher.querySelectorAll('.size-btn')].forEach(b => b.classList.toggle('active', b === btn));
    applySizeHighlight(table, sizeColIdx, size);
  });

  // default to 750g if present, else first available
  const def = sizeColIdx['750g'] !== undefined ? '750g' : Object.keys(sizeColIdx)[0];
  const defBtn = switcher.querySelector(`.size-btn[data-size="${def}"]`);
  defBtn.click();
}

function applySizeHighlight(table, sizeColIdx, size) {
  const activeIdx = sizeColIdx[size];
  const allRows = [table.tHead.rows[0], ...table.tBodies[0].rows];
  allRows.forEach(row => {
    [...row.cells].forEach((cell, i) => {
      cell.classList.remove('size-dim', 'size-active');
      if (size === 'all') return;
      const isSizeCol = Object.values(sizeColIdx).includes(i);
      if (!isSizeCol) return;
      if (i === activeIdx) cell.classList.add('size-active');
      else cell.classList.add('size-dim');
    });
  });
}

function findIngredientsTable() {
  const tables = els.content.querySelectorAll('table');
  for (const t of tables) {
    if (!t.tHead) continue;
    const headerText = t.tHead.textContent;
    const sizeCount = ['500g','750g','1000g'].filter(s => headerText.includes(s)).length;
    if (sizeCount >= 2) return t;
  }
  return null;
}

// ---------- baker's % calculator ----------
function injectBakersCalculator() {
  // Find heading "Baker's percentages..." then the next table
  const heads = [...els.content.querySelectorAll('h2, h3')];
  const head = heads.find(h => /baker.?s percentage/i.test(h.textContent));
  if (!head) return;

  let table = head.nextElementSibling;
  while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
  if (!table) return;

  const rows = parseBakersTable(table);
  if (!rows.length) return;

  const calc = document.createElement('div');
  calc.className = 'bakers-calc';
  calc.innerHTML = `
    <div class="calc-title">Scale this recipe</div>
    <div class="calc-input-row">
      <label for="flour-input">Total flour weight</label>
      <input type="number" id="flour-input" min="50" max="5000" step="10" value="400">
      <span style="color:var(--ink-mute);font-size:13px;">grams</span>
      <button class="calc-preset-btn" data-w="300">300g</button>
      <button class="calc-preset-btn" data-w="400">400g</button>
      <button class="calc-preset-btn" data-w="500">500g</button>
      <button class="calc-preset-btn" data-w="750">750g</button>
    </div>
    <div class="calc-results" id="calc-results"></div>
    <div style="margin-top:12px;font-size:11px;color:var(--ink-mute);font-style:italic;">
      Percentage ranges use the midpoint. Weights are approximate &mdash; trust the source table for final values.
    </div>
  `;
  table.parentNode.insertBefore(calc, table.nextSibling);

  const input   = calc.querySelector('#flour-input');
  const results = calc.querySelector('#calc-results');

  const render = () => {
    const flour = Math.max(0, parseFloat(input.value) || 0);
    results.innerHTML = rows.map(r => {
      const grams = flour * r.pct / 100;
      const unit = r.isFlour ? 'g (split per recipe)' : guessUnit(r.name, grams);
      const display = formatGrams(grams);
      return `<div class="calc-row">
        <div class="calc-row-name">${escapeHtml(r.name)}</div>
        <div class="calc-row-value">${display}<span class="calc-row-unit">${unit}</span></div>
      </div>`;
    }).join('');
  };

  input.addEventListener('input', render);
  calc.querySelectorAll('.calc-preset-btn').forEach(b => {
    b.addEventListener('click', () => { input.value = b.dataset.w; render(); });
  });
  render();
}

// extract {name, pct, isFlour} rows from baker's % table
function parseBakersTable(table) {
  const rows = [];
  const bodyRows = table.tBodies[0]?.rows || [];
  for (const tr of bodyRows) {
    if (tr.cells.length < 2) continue;
    const name = tr.cells[0].textContent.trim().replace(/\*+/g,'');
    const pctText = tr.cells[1].textContent.trim();
    // skip "Total flour" rows
    if (/^total/i.test(name)) continue;
    const pct = parsePercentage(pctText);
    if (pct === null) continue;
    const isFlour = /flour|atta/i.test(name) && Math.abs(pct - 100) < 0.1;
    rows.push({ name, pct, isFlour });
  }
  return rows;
}

// parse "60–65%" / "1.2-2%" / "100%" / "~60%" -> midpoint number
function parsePercentage(s) {
  s = s.replace(/[~%\s]/g, '');
  const range = s.match(/^([\d.]+)[\u2013\u2014\-]([\d.]+)/);
  if (range) {
    const a = parseFloat(range[1]), b = parseFloat(range[2]);
    return (a + b) / 2;
  }
  const single = s.match(/^([\d.]+)/);
  return single ? parseFloat(single[1]) : null;
}

function formatGrams(g) {
  if (g >= 100) return Math.round(g).toString();
  if (g >= 10)  return g.toFixed(1);
  return g.toFixed(2);
}

// rough unit hint based on ingredient name
function guessUnit(name, grams) {
  const n = name.toLowerCase();
  if (/water|milk|juice/.test(n)) return `g (≈${Math.round(grams)} ml)`;
  if (/yeast/.test(n))            return `g (≈${(grams/3).toFixed(2)} tsp)`;
  if (/salt/.test(n))             return `g (≈${(grams/6).toFixed(2)} tsp)`;
  if (/oil|butter|grease/.test(n))return `g (≈${(grams/14).toFixed(1)} tbsp)`;
  if (/sugar/.test(n))            return `g (≈${(grams/12).toFixed(1)} tbsp)`;
  return 'g';
}

// ---------- util ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
