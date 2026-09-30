// Bulk Creator — Figma plugin (main thread)
// Genereert varianten van template-frames op basis van een Excel/CSV-bestand.

const KEY = {
  role: 'bcRole',          // 'variant' | 'section'
  template: 'bcTemplate',  // id van de template
  dataset: 'bcDataset',    // id van de dataset (upload)
  rowKey: 'bcRowKey',      // sleutel van de rij in de Excel
  order: 'bcOrder',        // volgorde binnen de set
  excelRow: 'bcExcelRow',  // rijnummer in de Excel bij de laatste run
  spacing: 'bcSpacing',    // spacing van de set (op section)
  perRow: 'bcPerRow',      // max varianten per rij (op section)
  datasets: 'bcDatasets',  // JSON met eerdere uploads (op template)
};

const TEMPLATE_TYPES = ['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP'];
const SHAPE_TYPES = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR'];
const IMAGE_HINT = /(image|img|foto|photo|afbeelding|beeld|picture|pic|visual|logo|icon|icoon|packshot|thumb|background|achtergrond|avatar|product|media)/i;

let settings = { autoRelayout: true };
let pick = null;   // { templateId, column, restore: [ids] }
let busy = false;
let watchedPage = null;

// ---------------------------------------------------------------------------
// Opstart

(async function start() {
  const size = await figma.clientStorage.getAsync('uiSize');
  figma.showUI(__html__, {
    width: size ? size.w : 460,
    height: size ? size.h : 720,
    themeColors: true,
  });
  const stored = await figma.clientStorage.getAsync('settings');
  if (stored) settings = Object.assign(settings, stored);
  watchPage();
})();

figma.on('currentpagechange', () => {
  watchPage();
  sendSelection();
});

figma.on('selectionchange', () => {
  if (pick) handlePick();
  else sendSelection();
});

function post(msg) {
  figma.ui.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Helpers

function readDatasets(node) {
  try {
    return JSON.parse(node.getPluginData(KEY.datasets) || '{}');
  } catch (e) {
    return {};
  }
}

function writeDatasets(node, obj) {
  node.setPluginData(KEY.datasets, JSON.stringify(obj));
}

async function getNode(id) {
  if (!id) return null;
  const n = await figma.getNodeByIdAsync(id);
  return n && !n.removed ? n : null;
}

/** Alle door de plugin gemaakte varianten en sections op de huidige pagina. */
function indexBc() {
  const page = figma.currentPage;
  let nodes;
  try {
    nodes = page.findAllWithCriteria({ pluginData: { keys: [KEY.role] } });
  } catch (e) {
    nodes = page.findAll((n) => !!n.getPluginData(KEY.role));
  }
  return {
    variants: nodes.filter((n) => n.getPluginData(KEY.role) === 'variant'),
    sections: nodes.filter((n) => n.getPluginData(KEY.role) === 'section'),
  };
}

function templatesWithData() {
  const page = figma.currentPage;
  let nodes;
  try {
    nodes = page.findAllWithCriteria({ pluginData: { keys: [KEY.datasets] } });
  } catch (e) {
    nodes = page.findAll((n) => !!n.getPluginData(KEY.datasets));
  }
  return nodes.filter((n) => n.getPluginData(KEY.datasets) && n.getPluginData(KEY.datasets) !== '{}');
}

function pathFrom(root, node) {
  const path = [];
  let n = node;
  while (n && n !== root) {
    const parent = n.parent;
    if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT') return null;
    path.unshift(parent.children.indexOf(n));
    n = parent;
  }
  return n === root ? path : null;
}

function nodeAtPath(root, path) {
  let n = root;
  for (const i of path) {
    if (!n || !('children' in n) || !n.children[i]) return null;
    n = n.children[i];
  }
  return n;
}

function box(n) {
  const b = n.absoluteBoundingBox;
  if (b) return { x: b.x, y: b.y, width: b.width, height: b.height };
  return { x: n.x, y: n.y, width: n.width, height: n.height };
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

function layerKind(node) {
  if (node.type === 'TEXT') return 'text';
  if ('fills' in node && node.fills !== figma.mixed) return 'image';
  return null;
}

// ---------------------------------------------------------------------------
// Selectie → templates

async function templateForNode(node) {
  let n = node;
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') {
    const role = n.getPluginData(KEY.role);
    if (role) {
      const t = await getNode(n.getPluginData(KEY.template));
      return t ? { node: t, via: role } : null;
    }
    n = n.parent;
  }
  return null;
}

async function describeSelection() {
  const items = [];
  const seen = new Set();
  let ignored = 0;
  let hint = '';
  for (const node of figma.currentPage.selection) {
    let t = null;
    let via = null;
    const found = await templateForNode(node);
    if (found) {
      t = found.node;
      via = found.via;
    } else if (TEMPLATE_TYPES.includes(node.type)) {
      t = node;
    } else if (node.type === 'COMPONENT_SET') {
      hint = 'Select a single variant from the component set, not the set itself.';
    }
    if (!t) {
      ignored++;
      continue;
    }
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    items.push({ id: t.id, name: t.name, type: t.type, via });
  }
  return { items, ignored, hint };
}

async function sendSelection() {
  post(Object.assign({ type: 'selection' }, await describeSelection()));
}

function collectLayers(root) {
  const out = [];
  const visit = (node, trail) => {
    if (out.length > 600) return;
    const isRoot = node === root;
    const hidden = !node.visible;
    if (node.type === 'TEXT') {
      out.push({ id: node.id, name: node.name, kind: 'text', trail, sample: node.characters.slice(0, 60), hidden, tokens: placeholderTokens(node.characters) });
    } else if ('fills' in node && node.fills !== figma.mixed) {
      const hasImage = node.fills.some((p) => p.type === 'IMAGE');
      if (isRoot || hasImage || SHAPE_TYPES.includes(node.type) || IMAGE_HINT.test(node.name)) {
        out.push({ id: node.id, name: node.name, kind: 'image', trail, hasImage, hidden, root: isRoot, area: Math.round(node.width * node.height) });
      }
    }
    if ('children' in node) {
      const next = isRoot ? '' : (trail ? trail + ' › ' : '') + node.name;
      for (const c of node.children) visit(c, next);
    }
  };
  visit(root, '');
  return out;
}

function setsForTemplate(t, idx) {
  const ds = readDatasets(t);
  return Object.values(ds)
    .map((d) => ({
      id: d.id,
      fileName: d.fileName,
      sheet: d.sheet,
      updatedAt: d.updatedAt,
      count: idx.variants.filter((v) => v.getPluginData(KEY.template) === t.id && v.getPluginData(KEY.dataset) === d.id).length,
      hasSection: idx.sections.some((s) => s.getPluginData(KEY.template) === t.id && s.getPluginData(KEY.dataset) === d.id),
    }))
    .filter((s) => s.count > 0 || s.hasSection)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function templateInfos(ids) {
  const idx = indexBc();
  const out = [];
  for (const id of ids) {
    const t = await getNode(id);
    if (!t) continue;
    let thumb = null;
    try {
      thumb = await t.exportAsync({ format: 'PNG', constraint: { type: 'HEIGHT', value: 120 } });
    } catch (e) {
      thumb = null;
    }
    out.push({
      id: t.id,
      name: t.name,
      type: t.type,
      width: Math.round(t.width),
      height: Math.round(t.height),
      layers: collectLayers(t),
      thumb,
      sets: setsForTemplate(t, idx),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Laag kiezen op het canvas

async function handlePick() {
  const sel = figma.currentPage.selection;
  if (sel.length !== 1) return;
  const p = pick;
  pick = null;
  const node = sel[0];
  const tpl = await getNode(p.templateId);
  let layer = null;
  let error = null;

  if (tpl) {
    let n = node;
    while (n && n !== tpl && n.type !== 'PAGE') n = n.parent;
    if (n === tpl) {
      layer = node;
    } else {
      // Klik in een variant: vertaal naar dezelfde laag in de template
      let v = node;
      while (v && v.type !== 'PAGE' && v.type !== 'DOCUMENT' &&
        !(v.getPluginData(KEY.role) === 'variant' && v.getPluginData(KEY.template) === tpl.id)) {
        v = v.parent;
      }
      if (v && v.type !== 'PAGE' && v.type !== 'DOCUMENT') {
        const path = pathFrom(v, node);
        layer = node === v ? tpl : path ? nodeAtPath(tpl, path) : null;
      }
    }
  }

  if (!layer) error = 'That layer is not part of the template "' + (tpl ? tpl.name : '?') + '".';
  else if (!layerKind(layer)) error = 'The layer "' + layer.name + '" cannot hold text or an image.';

  post({
    type: 'picked',
    templateId: p.templateId,
    column: p.column,
    error,
    layer: layer && !error ? {
      id: layer.id,
      name: layer.name,
      kind: layerKind(layer),
      trail: '',
      sample: layer.type === 'TEXT' ? layer.characters.slice(0, 60) : undefined,
      tokens: layer.type === 'TEXT' ? placeholderTokens(layer.characters) : [],
      hasImage: layer.type !== 'TEXT' && layer.fills.some((f) => f.type === 'IMAGE'),
      root: layer === tpl,
    } : null,
  });

  // Oorspronkelijke selectie terugzetten
  const restore = [];
  for (const id of p.restore || []) {
    const r = await getNode(id);
    if (r && r.parent && r.parent.type !== 'DOCUMENT') restore.push(r);
  }
  if (restore.length) figma.currentPage.selection = restore;
}

// ---------------------------------------------------------------------------
// Dataset herkennen bij opnieuw uploaden

function sameSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

async function checkDataset(msg) {
  const idx = indexBc();
  const matches = [];
  for (const id of msg.templateIds) {
    const t = await getNode(id);
    if (!t) continue;
    let best = null;
    for (const d of Object.values(readDatasets(t))) {
      const sameFile = d.fileName === msg.fileName && (!d.sheet || d.sheet === msg.sheet);
      const sameHeaders = sameSet(d.headers, msg.headers);
      if (!sameFile && !sameHeaders) continue;
      const count = idx.variants.filter((v) => v.getPluginData(KEY.template) === t.id && v.getPluginData(KEY.dataset) === d.id).length;
      const score = (sameFile ? 2 : 0) + (sameHeaders ? 1 : 0) + (count ? 4 : 0);
      if (!best || score > best.score || (score === best.score && d.updatedAt > best.updatedAt)) {
        best = Object.assign({}, d, { count, score });
      }
    }
    if (best) {
      matches.push({
        templateId: t.id,
        templateName: t.name,
        datasetId: best.id,
        fileName: best.fileName,
        count: best.count,
        updatedAt: best.updatedAt,
        mapping: best.mapping || {},
        keyColumn: best.keyColumn,
        options: best.options || {},
      });
    }
  }
  post({ type: 'dataset-matches', token: msg.token, matches });
}

// ---------------------------------------------------------------------------
// Inhoud toepassen

const loadedFonts = new Set();

async function loadFonts(node) {
  const len = node.characters.length;
  const fonts = len ? node.getRangeAllFontNames(0, len) : [node.fontName];
  for (const f of fonts) {
    if (f === figma.mixed) continue;
    const k = f.family + '|' + f.style;
    if (loadedFonts.has(k)) continue;
    await figma.loadFontAsync(f);
    loadedFonts.add(k);
  }
}

async function setText(node, text, warn) {
  if (node.type !== 'TEXT') {
    warn('Layer "' + node.name + '" is not a text layer');
    return;
  }
  if (node.hasMissingFont) {
    warn('Missing font in layer "' + node.name + '"');
    return;
  }
  await loadFonts(node);
  if (node.characters !== text) node.characters = text;
}

function setImage(node, hash, warn) {
  if (!('fills' in node) || node.fills === figma.mixed) {
    warn('Layer "' + node.name + '" cannot hold an image');
    return;
  }
  const fills = node.fills.map((p) => JSON.parse(JSON.stringify(p)));
  const i = fills.findIndex((p) => p.type === 'IMAGE');
  if (i >= 0) {
    const p = fills[i];
    p.imageHash = hash;
    if (p.scaleMode === 'CROP') {
      // Een crop van de oude foto past zelden op een nieuwe foto
      p.scaleMode = 'FILL';
      delete p.imageTransform;
    }
    delete p.gifRef;
  } else {
    fills.push({ type: 'IMAGE', scaleMode: 'FILL', imageHash: hash });
  }
  node.fills = fills;
}

function clearImage(node) {
  if (!('fills' in node) || node.fills === figma.mixed) return;
  node.fills = node.fills.filter((p) => p.type !== 'IMAGE');
}

async function targetIn(variant, tpl, t) {
  if (t.path.length === 0) return variant;
  if (variant.type === 'INSTANCE' && t.id) {
    let id = null;
    if (tpl.type === 'COMPONENT') {
      id = 'I' + variant.id + ';' + t.id.replace(/^I/, '');
    } else if (tpl.type === 'INSTANCE' && t.id.indexOf('I' + tpl.id + ';') === 0) {
      id = 'I' + variant.id + t.id.slice(('I' + tpl.id).length);
    }
    if (id) {
      const n = await getNode(id);
      if (n) return n;
    }
  }
  return nodeAtPath(variant, t.path);
}

// ---------------------------------------------------------------------------
// Placeholders: "Only {{price}} per night" → enkel {{price}} wordt vervangen

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const normKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9#]/g, '');

function placeholderTokens(text) {
  const out = [];
  let m;
  PLACEHOLDER.lastIndex = 0;
  while ((m = PLACEHOLDER.exec(text))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

function placeholderValue(token, row, ctx, warn) {
  const k = normKey(token);
  if (k === 'nr' || k === 'row' || k === 'rij' || k === '#') return String(ctx.nr);
  const col = ctx.colByKey[k];
  if (!col) {
    warn('Placeholder {{' + token + '}} does not match any column');
    return '{{' + token + '}}';
  }
  const v = row.values[col];
  return v == null ? '' : String(v).replace(/\r\n?/g, '\n');
}

const STYLE_FIELDS = ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight', 'textStyleId'];

/** Vult de placeholders in op basis van de tekst in de template, zodat ook een update opnieuw vertrekt van {{…}}. */
async function setTemplatedText(node, src, row, ctx, warn) {
  if (node.type !== 'TEXT' || src.type !== 'TEXT') return;
  if (node.hasMissingFont || src.hasMissingFont) {
    warn('Missing font in layer "' + node.name + '"');
    return;
  }
  const full = src.characters;
  const segs = src.getStyledTextSegments(STYLE_FIELDS);
  const pieces = [];
  const pushRange = (a, b) => segs.forEach((g) => {
    const s = Math.max(a, g.start);
    const e = Math.min(b, g.end);
    if (e > s) pieces.push({ text: full.slice(s, e), seg: g });
  });
  const segAt = (i) => segs.find((g) => i >= g.start && i < g.end) || segs[0];
  let pos = 0;
  let m;
  PLACEHOLDER.lastIndex = 0;
  while ((m = PLACEHOLDER.exec(full))) {
    pushRange(pos, m.index);
    pieces.push({ text: placeholderValue(m[1], row, ctx, warn), seg: segAt(m.index) });
    pos = m.index + m[0].length;
  }
  pushRange(pos, full.length);

  await loadFonts(node);
  for (const g of segs) {
    const k = g.fontName.family + '|' + g.fontName.style;
    if (!loadedFonts.has(k)) {
      await figma.loadFontAsync(g.fontName);
      loadedFonts.add(k);
    }
  }
  const text = pieces.map((p) => p.text).join('');
  if (node.characters !== text) node.characters = text;
  // Eén stijl: niets extra instellen, zodat stijlwijzigingen in de template blijven doorstromen
  if (segs.length < 2 || !text.length) return;
  let at = 0;
  for (const p of pieces) {
    const a = at;
    const b = at + p.text.length;
    at = b;
    if (b <= a) continue;
    const g = p.seg;
    try {
      node.setRangeFills(a, b, g.fills);
      // Een tekststijl bevat font, grootte, … zelf; die apart instellen zou de stijl loskoppelen
      if (g.textStyleId) {
        await node.setRangeTextStyleIdAsync(a, b, g.textStyleId);
        continue;
      }
      node.setRangeFontName(a, b, g.fontName);
      node.setRangeFontSize(a, b, g.fontSize);
      node.setRangeTextDecoration(a, b, g.textDecoration);
      node.setRangeTextCase(a, b, g.textCase);
      node.setRangeLetterSpacing(a, b, g.letterSpacing);
      node.setRangeLineHeight(a, b, g.lineHeight);
    } catch (e) {
      warn('Could not keep all text styling in layer "' + node.name + '"');
    }
  }
}

async function fillVariant(variant, tpl, targets, row, opts, getHash, warn, ctx) {
  for (const t of targets) {
    const raw = row.values[t.col];
    const node = await targetIn(variant, tpl, t);
    if (!node) {
      warn('Layer ' + (t.col ? 'for column "' + t.col + '" ' : '') + 'not found in a variant');
      continue;
    }
    if (t.kind === 'placeholder') {
      const src = await getNode(t.id);
      if (src) await setTemplatedText(node, src, row, ctx, warn);
      continue;
    }
    const empty = raw == null || String(raw).trim() === '';
    if (empty) {
      if (opts.emptyMode === 'hide') node.visible = false;
      else if (opts.emptyMode === 'clear') {
        if (t.kind === 'image') clearImage(node);
        else await setText(node, '', warn);
      }
      continue;
    }
    if (opts.emptyMode === 'hide' && !node.visible) node.visible = true;
    if (t.kind === 'image') {
      const hash = getHash(raw);
      if (hash) setImage(node, hash, warn);
    } else {
      await setText(node, String(raw).replace(/\r\n?/g, '\n'), warn);
    }
  }
}

function makeName(pattern, tplName, row, nr) {
  return pattern.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => {
    const key = k.trim();
    const low = key.toLowerCase();
    if (low === 'template') return tplName;
    if (low === 'nr' || low === '#' || low === 'rij' || low === 'row') return String(nr);
    const v = row.values[key];
    return v == null ? '' : String(v).split('\n')[0].slice(0, 60);
  }).trim() || tplName + ' ' + nr;
}

// ---------------------------------------------------------------------------
// Layout

function layoutSection(section) {
  const spacing = Number(section.getPluginData(KEY.spacing)) || 80;
  const perRow = Number(section.getPluginData(KEY.perRow)) || 0;
  const pad = Math.max(40, spacing);
  // Een Section (oudere versie van de plugin) toont zijn titel binnenin; een frame toont die erboven
  const padTop = section.type === 'SECTION' ? pad + 40 : pad;
  const vs = section.children
    .filter((n) => n.getPluginData(KEY.role) === 'variant')
    .sort((a, b) => Number(a.getPluginData(KEY.order)) - Number(b.getPluginData(KEY.order)));

  let x = pad;
  let y = padTop;
  let rowH = 0;
  let maxW = 0;
  vs.forEach((v, i) => {
    if (perRow > 0 && i > 0 && i % perRow === 0) {
      x = pad;
      y += rowH + spacing;
      rowH = 0;
    }
    v.x = x;
    v.y = y;
    x += v.width + spacing;
    rowH = Math.max(rowH, v.height);
    maxW = Math.max(maxW, x - spacing);
  });
  section.resizeWithoutConstraints(Math.max(maxW + pad, 320), Math.max(y + rowH + pad, 200));
}

/** Schuift sets naar beneden zodat ze niet overlappen met templates of andere sets. */
function resolveOverlaps() {
  const idx = indexBc();
  const placed = templatesWithData().map(box);
  const sections = idx.sections.slice().sort((a, b) => a.y - b.y);
  for (const s of sections) {
    const gap = Number(s.getPluginData(KEY.spacing)) || 80;
    const b = box(s);
    let floor = null;
    for (const o of placed) {
      const overlapX = o.x < b.x + b.width && o.x + o.width > b.x;
      if (overlapX && o.y <= b.y) floor = floor === null ? o.y + o.height : Math.max(floor, o.y + o.height);
    }
    if (floor !== null && b.y < floor + gap) s.y = floor + gap;
    placed.push(box(s));
  }
}

function orderTemplates(list) {
  return list.slice().sort((a, b) => {
    const A = box(a.node);
    const B = box(b.node);
    const sameRow = Math.abs(A.y - B.y) < Math.min(A.height, B.height) / 2;
    return sameRow ? A.x - B.x : A.y - B.y;
  });
}

// ---------------------------------------------------------------------------
// Genereren

async function generate(msg) {
  const { rows, options, fileName, sheet, headers, keyColumn, columns } = msg;
  const images = msg.images || {};
  const warnings = new Map();
  const warn = (text) => warnings.set(text, (warnings.get(text) || 0) + 1);
  const colType = {};
  const colByKey = {};
  columns.forEach((c) => (colByKey[normKey(c.name)] = c.name));
  columns.forEach((c) => (colType[c.name] = c.type));

  const hashCache = new Map();
  const getHash = (src) => {
    if (hashCache.has(src)) return hashCache.get(src);
    let h = null;
    const bytes = images[src];
    if (bytes) {
      try {
        h = figma.createImage(bytes).hash;
      } catch (e) {
        warn('Image could not be processed: ' + String(src).slice(0, 80));
      }
    } else {
      warn('Image not available: ' + String(src).slice(0, 80));
    }
    hashCache.set(src, h);
    return h;
  };

  let list = [];
  for (const spec of msg.templates) {
    const node = await getNode(spec.id);
    if (node) list.push({ spec, node });
  }
  list = orderTemplates(list);

  const idx = indexBc();
  const total = list.length * rows.length;
  let done = 0;
  let created = 0;
  let updated = 0;
  let removed = 0;
  const idMap = {};
  const touched = [];

  // Startpositie voor nieuwe sets: onder de templates (en eerdere sets ervan)
  const tplIds = new Set(list.map((l) => l.node.id));
  const areaBoxes = list.map((l) => box(l.node))
    .concat(idx.sections.filter((s) => tplIds.has(s.getPluginData(KEY.template))).map(box));
  const baseX = Math.min.apply(null, list.map((l) => box(l.node).x));
  let cursorY = Math.max.apply(null, areaBoxes.map((b) => b.y + b.height)) + options.spacing * 1.5;

  figma.commitUndo();

  for (const entry of list) {
    const spec = entry.spec;
    let tpl = entry.node;
    const oldId = tpl.id;

    // Koppeling vastleggen als pad, zodat ze een conversie naar component overleeft
    const targets = [];
    const pairs = [];
    Object.keys(spec.mapping).forEach((col) => [].concat(spec.mapping[col]).forEach((id) => pairs.push([col, id])));
    for (const [col, layerId] of pairs) {
      if (!layerId) continue;
      const ln = await getNode(layerId);
      const path = ln ? pathFrom(tpl, ln) : null;
      if (!path) {
        warn('Linked layer for "' + col + '" no longer exists in "' + tpl.name + '"');
        continue;
      }
      targets.push({ col, path, kind: colType[col] || 'text' });
    }

    if (options.toComponent && (tpl.type === 'FRAME' || tpl.type === 'GROUP')) {
      try {
        tpl = figma.createComponentFromNode(tpl);
        idMap[oldId] = tpl.id;
      } catch (e) {
        warn('"' + tpl.name + '" could not be converted to a component; variants are copies');
      }
    }
    for (const t of targets) {
      const n = nodeAtPath(tpl, t.path);
      t.id = n ? n.id : null;
    }
    // Tekstlagen met {{placeholders}} worden altijd vanuit de template ingevuld
    const phNodes = tpl.type === 'TEXT' ? [] : tpl.findAll((n) => n.type === 'TEXT' && placeholderTokens(n.characters).length > 0);
    const phIds = new Set(phNodes.map((n) => n.id));
    for (let k = targets.length - 1; k >= 0; k--) if (phIds.has(targets[k].id)) targets.splice(k, 1);
    phNodes.forEach((n) => {
      const path = pathFrom(tpl, n);
      if (path) targets.push({ col: null, path, id: n.id, kind: 'placeholder' });
    });

    const dsId = spec.datasetId;
    const ownerIds = [oldId, tpl.id];
    const belongs = (n) => ownerIds.indexOf(n.getPluginData(KEY.template)) >= 0 && n.getPluginData(KEY.dataset) === dsId;

    let existing = [];
    let section = null;
    if (spec.mode === 'update') {
      existing = idx.variants.filter(belongs);
      section = idx.sections.find(belongs) || null;
    }
    let isNewSection = false;
    if (!section) {
      // Gewone frame als container, zodat je alle varianten in één keer kan exporteren
      section = figma.createFrame();
      section.name = tpl.name + ' · ' + fileName;
      section.fills = [];
      section.clipsContent = false;
      isNewSection = true;
    }
    section.setPluginData(KEY.role, 'section');
    section.setPluginData(KEY.template, tpl.id);
    section.setPluginData(KEY.dataset, dsId);
    section.setPluginData(KEY.spacing, String(options.spacing));
    section.setPluginData(KEY.perRow, String(options.perRow || 0));

    const byKey = new Map();
    existing.forEach((v) => {
      const k = v.getPluginData(KEY.rowKey);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(v);
    });
    const used = new Set();

    // 1. Koppel rijen aan bestaande varianten via de rij-sleutel
    const assigned = new Map();
    rows.forEach((row, i) => {
      const vs = (byKey.get(row.key) || []).filter((v) => !used.has(v.id));
      if (!vs.length) return;
      assigned.set(i, vs);
      vs.forEach((v) => used.add(v.id));
    });
    // 2. Sleutel gewijzigd (bv. tekst aangepast)? Dan hoort de variant op dezelfde Excel-rij erbij
    const leftovers = existing.filter((v) => !used.has(v.id));
    rows.forEach((row, i) => {
      if (assigned.has(i)) return;
      const v = leftovers.find((x) => !used.has(x.id) && (x.getPluginData(KEY.excelRow)
        ? x.getPluginData(KEY.excelRow) === String(row.excelRow)
        : x.getPluginData(KEY.order) === String(i)));
      if (!v) return;
      assigned.set(i, [v]);
      used.add(v.id);
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let vs = assigned.get(i);
      if (vs && vs.length) {
        updated += vs.length;
      } else {
        const v = tpl.type === 'COMPONENT' ? tpl.createInstance() : tpl.clone();
        v.setPluginData(KEY.datasets, '');
        section.appendChild(v);
        vs = [v];
        created++;
      }
      for (const v of vs) {
        used.add(v.id);
        v.setPluginData(KEY.role, 'variant');
        v.setPluginData(KEY.template, tpl.id);
        v.setPluginData(KEY.dataset, dsId);
        v.setPluginData(KEY.rowKey, row.key);
        v.setPluginData(KEY.order, String(i));
        v.setPluginData(KEY.excelRow, String(row.excelRow || ''));
        v.name = makeName(options.namePattern || '{{template}} {{nr}}', tpl.name, row, i + 1);
        await fillVariant(v, tpl, targets, row, options, getHash, warn, { colByKey, nr: i + 1 });
      }
      done++;
      if (done % 5 === 0 || done === total) {
        post({ type: 'progress', done, total, label: tpl.name });
        await tick();
      }
    }

    // Varianten van rijen die niet meer in de Excel staan
    for (const v of existing) {
      if (used.has(v.id)) continue;
      if (options.removeMissing) {
        v.remove();
        removed++;
      } else {
        v.setPluginData(KEY.order, String(rows.length + Number(v.getPluginData(KEY.order) || 0)));
        if (v.name.indexOf('⚠') !== 0) v.name = '⚠ no longer in Excel – ' + v.name;
        warn('Variant no longer matches a row (moved to the end, name starts with ⚠)');
      }
    }

    layoutSection(section);
    if (isNewSection) {
      section.x = baseX;
      section.y = cursorY;
      cursorY += section.height + options.spacing;
    }
    touched.push(section);

    const ds = readDatasets(tpl);
    const mapping = {};
    targets.forEach((t) => {
      if (t.id && t.col) mapping[t.col] = (mapping[t.col] || []).concat(t.id);
    });
    ds[dsId] = {
      id: dsId,
      fileName,
      sheet,
      headers,
      keyColumn,
      mapping,
      options: {
        spacing: options.spacing,
        perRow: options.perRow,
        emptyMode: options.emptyMode,
        namePattern: options.namePattern,
      },
      updatedAt: Date.now(),
    };
    writeDatasets(tpl, ds);
  }

  resolveOverlaps();
  figma.commitUndo();
  if (touched.length) figma.viewport.scrollAndZoomIntoView(touched);

  const warnList = [];
  warnings.forEach((count, text) => warnList.push({ text, count }));
  post({
    type: 'done',
    created,
    updated,
    removed,
    warnings: warnList,
    idMap,
    sectionIds: touched.map((s) => s.id),
  });
  figma.notify('Bulk Creator: ' + created + ' created, ' + updated + ' updated' + (removed ? ', ' + removed + ' removed' : ''));
}

// ---------------------------------------------------------------------------
// Automatisch herschikken wanneer een template van grootte verandert

let relayoutTimer = null;
const pendingTemplates = new Set();

function watchPage() {
  if (watchedPage === figma.currentPage) return;
  if (watchedPage) {
    try {
      watchedPage.off('nodechange', onNodeChange);
    } catch (e) { /* pagina bestaat niet meer */ }
  }
  watchedPage = figma.currentPage;
  watchedPage.on('nodechange', onNodeChange);
}

function onNodeChange(e) {
  if (!settings.autoRelayout || busy) return;
  for (const c of e.nodeChanges) {
    if (c.type !== 'PROPERTY_CHANGE') continue;
    const n = c.node;
    if (!n || n.removed || typeof n.getPluginData !== 'function') continue;
    if (c.properties.indexOf('width') < 0 && c.properties.indexOf('height') < 0) continue;
    if (!n.getPluginData(KEY.datasets)) continue;
    pendingTemplates.add(n.id);
  }
  if (pendingTemplates.size) {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(runAutoRelayout, 400);
  }
}

function runAutoRelayout() {
  const ids = new Set(pendingTemplates);
  pendingTemplates.clear();
  const idx = indexBc();
  idx.sections.filter((s) => ids.has(s.getPluginData(KEY.template))).forEach(layoutSection);
  resolveOverlaps();
}

function relayout(templateId, datasetId) {
  const idx = indexBc();
  const sections = idx.sections.filter((s) =>
    s.getPluginData(KEY.template) === templateId && (!datasetId || s.getPluginData(KEY.dataset) === datasetId));
  sections.forEach(layoutSection);
  resolveOverlaps();
  if (sections.length) figma.viewport.scrollAndZoomIntoView(sections);
  figma.notify(sections.length ? 'Variants rearranged' : 'No set found to rearrange');
}

// ---------------------------------------------------------------------------
// Berichten van de UI

figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {
      case 'ready':
        post({ type: 'settings', settings });
        await sendSelection();
        break;

      case 'load-templates':
        post({ type: 'templates', templates: await templateInfos(msg.ids), token: msg.token });
        break;

      case 'check-dataset':
        await checkDataset(msg);
        break;

      case 'generate':
        busy = true;
        try {
          await generate(msg);
        } finally {
          busy = false;
        }
        break;

      case 'pick-start':
        pick = { templateId: msg.templateId, column: msg.column, restore: figma.currentPage.selection.map((n) => n.id) };
        break;

      case 'pick-cancel':
        pick = null;
        break;

      case 'zoom': {
        const nodes = [];
        for (const id of msg.ids) {
          const n = await getNode(id);
          if (n) nodes.push(n);
        }
        if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
        break;
      }

      case 'show-set': {
        const idx = indexBc();
        const nodes = idx.sections.filter((s) => s.getPluginData(KEY.template) === msg.templateId && s.getPluginData(KEY.dataset) === msg.datasetId);
        const list = nodes.length ? nodes : idx.variants.filter((v) => v.getPluginData(KEY.template) === msg.templateId && v.getPluginData(KEY.dataset) === msg.datasetId);
        if (list.length) figma.viewport.scrollAndZoomIntoView(list);
        break;
      }

      case 'relayout':
        relayout(msg.templateId, msg.datasetId);
        break;

      case 'settings':
        settings = Object.assign(settings, msg.settings);
        await figma.clientStorage.setAsync('settings', settings);
        break;

      case 'resize': {
        const w = Math.max(360, Math.min(1000, Math.round(msg.w)));
        const h = Math.max(420, Math.min(1200, Math.round(msg.h)));
        figma.ui.resize(w, h);
        if (msg.save) await figma.clientStorage.setAsync('uiSize', { w, h });
        break;
      }

      case 'notify':
        figma.notify(msg.text, { error: !!msg.error });
        break;
    }
  } catch (err) {
    busy = false;
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};
