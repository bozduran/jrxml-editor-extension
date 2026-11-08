// designViewClient.js
// Client script for the JRXML design-view webview.
//
// designViewHtml.js reads this file and inlines it into the generated
// document. INITIAL_MODEL, INITIAL_FILE and INITIAL_VERSION are declared in
// the injected preamble; browser globals are configured in eslint.config.mjs.

const vscode = acquireVsCodeApi();
const GUTTER = 150;          // CSS px reserved for band labels
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const DRAG_THRESHOLD = 3;

const byId = id => document.getElementById(id);

const viewport   = byId('viewport');
const page       = byId('page');
const empty      = byId('empty');
const emptyTitle = byId('empty-title');
const emptyMsg   = byId('empty-message');
const banner     = byId('banner');
const fileNameEl = byId('file-name');
const metaEl     = byId('report-meta');
const statusLeft = byId('status-left');
const statusHint = byId('status-hint');
const zoomLabel  = byId('zoom-label');

const modeViewBtn = byId('mode-view');
const modeEditBtn = byId('mode-edit');
const followBtn   = byId('follow-cursor');

const inspector      = byId('inspector');
const inspectKind    = byId('inspect-kind');
const inspectPos     = byId('inspect-position');
const inspectReveal  = byId('inspect-reveal');
const inspectorError = byId('inspector-error');
const contentSection = byId('content-section');
const contentTitle   = byId('content-title');
const contentHint    = byId('content-hint');
const textStyleSection = byId('text-style-section');
const appearanceSection = byId('appearance-section');
const styleSection      = byId('style-section');
const styleHint         = byId('style-hint');
const behaviorSection   = byId('behavior-section');
const imageSection      = byId('image-section');
const lineSection       = byId('line-section');
const rectangleSection  = byId('rectangle-section');
const breakSection      = byId('break-section');
const subreportSection  = byId('subreport-section');
const boxSection        = byId('box-section');
const attributesSection = byId('attributes-section');
const attributesList    = byId('attributes-list');
const completionPopup   = byId('completion-popup');
const completionList    = byId('completion-list');
const completionHint    = byId('completion-hint');

const inputs = {
  x:          byId('prop-x'),
  y:          byId('prop-y'),
  width:      byId('prop-width'),
  height:     byId('prop-height'),
  text:       byId('prop-text'),
  textApply:  byId('prop-text-apply'),
  fontName:   byId('prop-font-name'),
  fontSize:   byId('prop-font-size'),
  bold:       byId('prop-bold'),
  italic:     byId('prop-italic'),
  underline:  byId('prop-underline'),
  strike:     byId('prop-strike'),
  hAlign:     byId('prop-halign'),
  vAlign:     byId('prop-valign'),
  rotation:   byId('prop-rotation'),
  markup:     byId('prop-markup'),
  mode:       byId('prop-mode'),
  forecolor:  byId('prop-forecolor'),
  backcolor:  byId('prop-backcolor'),
  style:            byId('prop-style'),
  positionType:     byId('prop-position-type'),
  stretchType:      byId('prop-stretch-type'),
  printRepeated:    byId('prop-print-repeated'),
  removeLine:       byId('prop-remove-line'),
  printFirstWhole:  byId('prop-print-first-whole'),
  printDetail:      byId('prop-print-detail-overflow'),
  printGroup:       byId('prop-print-group'),
  evaluationTime:   byId('prop-evaluation-time'),
  evaluationGroup:  byId('prop-evaluation-group'),
  bookmarkLevel:    byId('prop-bookmark-level'),
  key:              byId('prop-key'),
  textAdjust:       byId('prop-text-adjust'),
  pattern:          byId('prop-pattern'),
  blankNull:        byId('prop-blank-null'),
  scaleImage:       byId('prop-scale-image'),
  hImageAlign:      byId('prop-h-image-align'),
  vImageAlign:      byId('prop-v-image-align'),
  onError:          byId('prop-on-error'),
  linkType:         byId('prop-link-type'),
  usingCache:       byId('prop-using-cache'),
  lazy:             byId('prop-lazy'),
  lineDirection:    byId('prop-line-direction'),
  lineWidth:        byId('prop-line-width'),
  lineStyle:        byId('prop-line-style'),
  lineColor:        byId('prop-line-color'),
  radius:           byId('prop-radius'),
  breakType:        byId('prop-break-type'),
  subreportCache:   byId('prop-subreport-cache'),
  runToBottom:      byId('prop-run-to-bottom'),
  boxBorder:        byId('prop-box-border'),
  boxWidth:         byId('prop-box-width'),
  boxStyle:         byId('prop-box-style'),
  boxColor:         byId('prop-box-color'),
  boxPadding:       byId('prop-box-padding'),
  newAttrName:      byId('new-attr-name'),
  newAttrValue:     byId('new-attr-value'),
  addAttribute:     byId('add-attribute'),
};

const savedState = typeof vscode.getState === 'function' ? (vscode.getState() || {}) : {};

let model         = null;
let fileName      = '';
let version       = Number.isInteger(INITIAL_VERSION) ? INITIAL_VERSION : null;
let baseVersion   = version;
let scale         = 1;
let zoomMode      = 'fit';
let selected      = null;
let selectedElement = null;
let lastSelection = null;
let lastSourceSelection = null;
let editMode      = savedState.editMode === true;
let followCursor  = savedState.followCursor !== false;
let editPending   = false;
let drag          = null;
let suppressClick = false;
let resizeTimer   = null;
let contentLayer  = null;
const elementModels = new WeakMap();

let completionTimer      = null;
let completionRequestId  = 0;
let completionSnapshot   = null;
let completionItems      = [];
let completionIndex      = -1;
let completionVisible    = false;
let completionReplace    = null;
let completionMode       = 'general';
let completionPrefix     = '';

// ── Small DOM helpers ───────────────────────────────────────────────────────

function px(value) {
  return String(value) + 'px';
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function position(node, left, top, width, height) {
  node.style.left = px(left);
  node.style.top = px(top);
  node.style.width = px(Math.max(0, width));
  node.style.height = px(Math.max(0, height));
  return node;
}

function setBanner(tone, message) {
  banner.className = 'banner ' + tone;
  banner.textContent = message;
  banner.hidden = false;
}

function hideBanner() {
  banner.hidden = true;
  banner.textContent = '';
}

function setEmptyState(title, message) {
  page.hidden = true;
  empty.hidden = false;
  emptyTitle.textContent = title;
  emptyMsg.textContent = message;
  metaEl.textContent = '';
  statusLeft.textContent = '';
  zoomLabel.textContent = '';
}

function hideEmptyState() {
  empty.hidden = true;
  page.hidden = false;
}

// ── Model / state ───────────────────────────────────────────────────────────

function setModel(nextModel, nextFile, nextVersion) {
  model    = nextModel || null;
  fileName = nextFile || '';
  version  = Number.isInteger(nextVersion) ? nextVersion : version;
  baseVersion = version;

  fileNameEl.textContent = fileName;
  fileNameEl.title = fileName;
}

function persistState() {
  try {
    vscode.setState({ editMode: editMode, followCursor: followCursor });
  } catch (_err) {
    // The webview state API is best-effort only.
  }
}

function syncModeControls() {
  document.body.classList.toggle('editing', editMode);
  modeViewBtn.classList.toggle('active', !editMode);
  modeEditBtn.classList.toggle('active', editMode);
  modeViewBtn.setAttribute('aria-pressed', !editMode ? 'true' : 'false');
  modeEditBtn.setAttribute('aria-pressed', editMode ? 'true' : 'false');
  followBtn.setAttribute('aria-pressed', followCursor ? 'true' : 'false');
  statusHint.textContent = editMode
    ? 'Edit mode \u00b7 drag to move, handles to resize \u00b7 changes are undoable'
    : 'Read-only \u00b7 click an element or band label to reveal it in the source';

  if (model && model.report) {
    statusLeft.textContent = (editMode ? 'Editing' : 'Read-only') + ' \u00b7 ' + model.report.language;
  }
}

function setEditMode(next) {
  if (drag) cancelDrag(true);
  editMode = !!next;
  persistState();
  syncModeControls();
  applySelection(lastSelection, false);
}

function setFollowCursor(next) {
  followCursor = !!next;
  persistState();
  syncModeControls();
  if (followCursor) applySelection(lastSourceSelection, true);
}

function updatePendingUi() {
  inspector.classList.toggle('editing-pending', editPending);
  if (editPending) page.classList.add('edit-pending');
  else page.classList.remove('edit-pending');

  inspector.querySelectorAll('input, select, textarea, button').forEach(function (control) {
    control.disabled = editPending;
  });

  if (!editPending && selectedElement && selectedElement.content) {
    inputs.textApply.disabled = !selectedElement.content.editable;
  }
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function fitScale(report) {
  const available = viewport.clientWidth - GUTTER - 64;
  if (!(available > 0)) return 1;
  return clamp(available / report.pageWidth, ZOOM_MIN, 2);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render() {
  const scrollLeft = viewport.scrollLeft;
  const scrollTop  = viewport.scrollTop;

  selected = null;
  selectedElement = null;
  clearHandles();
  hideInspector();

  if (!model) {
    hideBanner();
    setEmptyState(
      'No report selected',
      'Open a .jrxml file and run "JRXML: Open Design View" from the editor title or the JRXML menu.'
    );
    applySelection(null, false);
    updatePendingUi();
    return;
  }

  if (model.error) {
    setBanner('error', 'Cannot read this report: ' + model.error);
    setEmptyState('Cannot read this report', model.error + ' Fix the XML and the view will refresh.');
    applySelection(null, false);
    updatePendingUi();
    return;
  }

  if (model.unsupported === 'classic') {
    setBanner('info', 'This Design view supports the Studio 7 / JasperReports 7 JRXML format only.');
    setEmptyState(
      'Classic JRXML format',
      'This report uses the classic format (<staticText>, <textField>, <reportElement ...>). ' +
      'The read-only Design view currently renders Studio 7 files (<element kind="...">).'
    );
    applySelection(null, false);
    updatePendingUi();
    return;
  }

  if (!model.bands || model.bands.length === 0) {
    hideBanner();
    setEmptyState('No bands yet', 'This report has no bands to display. Add a band in the source and the view will refresh.');
    if (model.report) {
      metaEl.textContent = 'Page ' + model.report.pageWidth + ' \u00d7 ' + model.report.pageHeight + ' px';
    }
    applySelection(null, false);
    updatePendingUi();
    return;
  }

  hideEmptyState();
  setBannerForWarnings(model);

  const report = model.report;
  if (zoomMode === 'fit') scale = fitScale(report);

  renderPage(model, report);
  updateMeta(model);
  updateZoomLabel();
  applySelection(lastSelection, false);
  updatePendingUi();

  viewport.scrollLeft = scrollLeft;
  viewport.scrollTop  = scrollTop;
}

function setBannerForWarnings(current) {
  const warnings = Array.isArray(current.warnings) ? current.warnings.slice() : [];
  if (warnings.length === 0) {
    hideBanner();
    return;
  }
  setBanner('warn', warnings.join(' '));
}

function updateMeta(current) {
  const report = current.report;
  const columnText = report.columnCount === 1
    ? 'column ' + report.columnWidth + ' px'
    : report.columnCount + ' columns of ' + report.columnWidth + ' px';
  metaEl.textContent =
    'Page ' + report.pageWidth + ' \u00d7 ' + report.pageHeight + ' px \u00b7 ' +
    columnText + ' \u00b7 ' + current.counts.bands + ' bands \u00b7 ' +
    current.counts.elements + ' elements';
  statusLeft.textContent = (editMode ? 'Editing' : 'Read-only') + ' \u00b7 ' + report.language;
}

function updateZoomLabel() {
  zoomLabel.textContent = Math.round(scale * 100) + '%';
}

// ── Selection, handles and inspector ────────────────────────────────────────

function clearHandles() {
  page.querySelectorAll('.resize-handle').forEach(function (handle) {
    handle.remove();
  });
}

function hideInspector() {
  inspector.hidden = true;
}

function findElementNode(offset) {
  if (!contentLayer) return null;
  return contentLayer.querySelector('.element[data-offset="' + Number(offset) + '"]');
}

function findBandRow(offset) {
  if (!contentLayer) return null;
  return contentLayer.querySelector('.band-row[data-offset="' + Number(offset) + '"]');
}

function scrollTargetIntoView(node) {
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  if (rect.top < view.top + 4 || rect.bottom > view.bottom - 4 ||
      rect.left < view.left + 4 || rect.right > view.right - 4) {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function applySelection(target, shouldScroll) {
  page.querySelectorAll('.band-selected').forEach(function (node) {
    node.classList.remove('band-selected');
  });
  if (selected) selected.classList.remove('selected');
  clearHandles();
  selected = null;
  selectedElement = null;
  hideInspector();

  if (!target) {
    lastSelection = null;
    return;
  }

  lastSelection = target;

  if (target.kind === 'band') {
    const row = findBandRow(target.offset);
    if (!row) {
      lastSelection = null;
      return;
    }
    row.classList.add('band-selected');
    selected = row;
    if (shouldScroll) scrollTargetIntoView(row);
    return;
  }

  const node = findElementNode(target.offset);
  if (!node) {
    lastSelection = null;
    return;
  }

  const element = elementModels.get(node);
  if (!element) {
    lastSelection = null;
    return;
  }

  selected = node;
  selectedElement = element;
  node.classList.add('selected');

  if (editMode) {
    if (!editPending) addHandles(node);
    renderInspector(element);
  }

  if (shouldScroll) scrollTargetIntoView(node);
}

function addHandles(node) {
  node.querySelectorAll('.resize-handle').forEach(function (handle) {
    handle.remove();
  });

  for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const handle = make('div', 'resize-handle ' + direction);
    handle.setAttribute('data-handle', direction);
    handle.setAttribute('aria-hidden', 'true');
    node.appendChild(handle);
  }
}

function fontNameFromStack(stack) {
  const text = String(stack || '');
  const quoted = /^"([^"]+)"/.exec(text);
  if (quoted) return quoted[1];
  const first = text.split(',')[0].trim();
  if (!first || first === 'sans-serif' || first === 'monospace' || first === 'serif') return '';
  return first;
}

function rotationToXml(degrees) {
  if (degrees === -90) return 'Left';
  if (degrees === 90) return 'Right';
  if (degrees === 180) return 'UpsideDown';
  return 'None';
}

const H_ALIGN_TO_XML = { left: 'Left', center: 'Center', right: 'Right', justify: 'Justify' };
const V_ALIGN_TO_XML = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };

function setInspectorError(message) {
  inspectorError.textContent = message || '';
}

function renderInspector(element) {
  const style = element.style || {};
  const kind  = String(element.kind || '').toLowerCase();
  const content = element.content || null;

  hideCompletions();
  inspector.hidden = false;
  setInspectorError('');

  inspectKind.textContent = element.kind;
  inspectPos.textContent = 'x ' + element.x + ' \u00b7 y ' + element.y +
    ' \u00b7 ' + element.width + ' \u00d7 ' + element.height;

  inputs.x.value = String(element.x);
  inputs.y.value = String(element.y);
  inputs.width.value = String(element.width);
  inputs.height.value = String(element.height);

  contentSection.hidden = !content;
  textStyleSection.hidden = !(kind === 'statictext' || kind === 'textfield');
  appearanceSection.hidden = false;

  if (content) {
    contentTitle.textContent = content.tag === 'text' ? 'Text' : 'Expression';
    inputs.text.value = content.raw;
    inputs.text.readOnly = !content.editable;
    inputs.textApply.disabled = !content.editable || editPending;

    if (!content.editable) {
      if (content.nested) contentHint.textContent = 'Nested markup \u2014 edit in source';
      else if (content.mixed) contentHint.textContent = 'Mixed CDATA/text \u2014 edit in source';
      else contentHint.textContent = 'Too long to edit here';
    } else if (content.missing) {
      contentHint.textContent = 'Adds <' + content.tag + '>';
    } else {
      contentHint.textContent = content.cdata ? 'CDATA' : 'Plain text';
    }
  }

  inputs.fontName.value = fontNameFromStack(style.fontFamily);
  inputs.fontSize.value = String(style.fontSize || '');
  inputs.bold.checked = !!style.bold;
  inputs.italic.checked = !!style.italic;
  inputs.underline.checked = !!style.underline;
  inputs.strike.checked = !!style.strikeThrough;
  inputs.hAlign.value = H_ALIGN_TO_XML[style.hAlign] || 'Left';
  inputs.vAlign.value = V_ALIGN_TO_XML[style.vAlign] || 'Top';
  inputs.rotation.value = rotationToXml(style.rotation);
  inputs.markup.value = style.markup || 'none';
  inputs.mode.value = style.mode === 'Opaque' ? 'Opaque' : 'Transparent';
  inputs.forecolor.value = style.forecolor && style.forecolor !== 'transparent' ? style.forecolor : '';
  inputs.backcolor.value = style.backcolor && style.backcolor !== 'transparent' ? style.backcolor : '';

  const attrs = element.attrs || {};

  styleSection.hidden = false;
  behaviorSection.hidden = false;
  imageSection.hidden = kind !== 'image';
  lineSection.hidden = kind !== 'line';
  rectangleSection.hidden = kind !== 'rectangle';
  breakSection.hidden = kind !== 'break';
  subreportSection.hidden = kind !== 'subreport';
  boxSection.hidden = !['statictext', 'textfield', 'image', 'frame', 'elementgroup',
    'rectangle', 'ellipse', 'subreport', 'chart'].includes(kind);
  attributesSection.hidden = false;

  populateStyleSelect(attrs.style || '');
  styleHint.textContent = attrs.style
    ? 'Explicit style reference; element attributes still win.'
    : 'No explicit style; uses the default style and inherited attributes.';

  setSelect(inputs.positionType, attrs.positionType || '');
  setSelect(inputs.stretchType, attrs.stretchType || '');
  setSelect(inputs.evaluationTime, attrs.evaluationTime || '');
  inputs.printGroup.value = attrs.printWhenGroupChanges || '';
  inputs.evaluationGroup.value = attrs.evaluationGroup || '';
  inputs.bookmarkLevel.value = attrs.bookmarkLevel !== undefined ? attrs.bookmarkLevel : '';
  inputs.key.value = attrs.key || '';
  inputs.printRepeated.checked = String(attrs.printRepeatedValues || '').toLowerCase() !== 'false';
  inputs.removeLine.checked = isAttrTrue(attrs.removeLineWhenBlank);
  inputs.printFirstWhole.checked = isAttrTrue(attrs.printInFirstWholeBand);
  inputs.printDetail.checked = isAttrTrue(attrs.printWhenDetailOverflows);

  inputs.textAdjust.value = attrs.textAdjust || '';
  ensureSelectOption(inputs.textAdjust, attrs.textAdjust);
  inputs.pattern.value = attrs.pattern !== undefined ? attrs.pattern : '';
  inputs.blankNull.checked = isAttrTrue(attrs.blankWhenNull);

  inputs.scaleImage.value = attrs.scaleImage || '';
  ensureSelectOption(inputs.scaleImage, attrs.scaleImage);
  inputs.hImageAlign.value = attrs.hImageAlign || '';
  ensureSelectOption(inputs.hImageAlign, attrs.hImageAlign);
  inputs.vImageAlign.value = attrs.vImageAlign || '';
  ensureSelectOption(inputs.vImageAlign, attrs.vImageAlign);
  inputs.onError.value = attrs.onErrorType || '';
  ensureSelectOption(inputs.onError, attrs.onErrorType);
  inputs.linkType.value = attrs.linkType || '';
  ensureSelectOption(inputs.linkType, attrs.linkType);
  inputs.usingCache.checked = isAttrTrue(attrs.usingCache);
  inputs.lazy.checked = isAttrTrue(attrs.lazy);

  const lineInfo = element.line || {};
  inputs.lineDirection.value = attrs.direction || '';
  ensureSelectOption(inputs.lineDirection, attrs.direction);
  inputs.lineWidth.value = String(lineInfo.width || 1);
  inputs.lineStyle.value = capitalizeWord(lineInfo.style || 'Solid');
  ensureSelectOption(inputs.lineStyle, capitalizeWord(lineInfo.style || 'Solid'));
  inputs.lineColor.value = lineInfo.color || '';

  inputs.radius.value = attrs.radius !== undefined ? attrs.radius : '';
  inputs.breakType.value = attrs.type || '';
  ensureSelectOption(inputs.breakType, attrs.type);
  inputs.subreportCache.checked = isAttrTrue(attrs.usingCache);
  inputs.runToBottom.checked = isAttrTrue(attrs.runToBottom);

  const box = element.box || {};
  inputs.boxBorder.checked = !!box.border;
  inputs.boxWidth.value = String(box.width || 1);
  inputs.boxStyle.value = capitalizeWord(box.lineStyle || 'Solid');
  ensureSelectOption(inputs.boxStyle, capitalizeWord(box.lineStyle || 'Solid'));
  inputs.boxColor.value = box.color || '';
  inputs.boxPadding.value = String(box.padding || 0);

  renderAttributeRows(element);

  [inputs.x, inputs.y, inputs.width, inputs.height, inputs.fontSize,
    inputs.forecolor, inputs.backcolor].forEach(function (input) {
    input.classList.remove('invalid');
  });
  updatePendingUi();
}

function capitalizeWord(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function isAttrTrue(value) {
  return String(value || '').toLowerCase() === 'true';
}

function ensureSelectOption(select, value) {
  if (!value) return;
  const exists = Array.from(select.options).some(option => option.value === value);
  if (exists) return;
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

function setSelect(select, value) {
  ensureSelectOption(select, value);
  select.value = value;
}

function populateStyleSelect(current) {
  const names = (model && model.styles ? model.styles : []).map(style => style.name);
  if (current && !names.includes(current)) names.push(current);

  inputs.style.replaceChildren();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(inherit / default)';
  inputs.style.appendChild(none);

  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    inputs.style.appendChild(option);
  }
  inputs.style.value = current || '';
}

function renderAttributeRows(element) {
  attributesList.replaceChildren();
  const attrs = element.attrs || {};

  for (const name of Object.keys(attrs).sort()) {
    const row = make('div', 'attr-row');
    row.appendChild(make('span', 'attr-name', name));

    const value = make('input', 'attr-value');
    value.type = 'text';
    value.value = attrs[name];
    value.spellcheck = false;
    if (name === 'kind') {
      value.readOnly = true;
    } else {
      value.addEventListener('change', function () {
        queueAttributeSet(name, value.value);
      });
    }
    row.appendChild(value);

    if (name === 'kind') {
      row.appendChild(make('span'));
    } else {
      const remove = make('button', '', '\u00d7');
      remove.type = 'button';
      remove.title = 'Remove attribute ' + name;
      remove.addEventListener('click', function () {
        queueAttributeRemove(name);
      });
      row.appendChild(remove);
    }
    attributesList.appendChild(row);
  }
}

function queueAttributeSet(name, value) {
  if (!selectedElement || editPending) return;
  if (name === 'kind') return;
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
    setInspectorError('Attribute names must start with a letter or underscore.');
    return;
  }
  setInspectorError('');
  queuePatch({ attributes: { set: { [name]: value } } });
}

function queueAttributeRemove(name) {
  if (!selectedElement || editPending) return;
  if (name === 'kind') return;
  setInspectorError('');
  queuePatch({ attributes: { remove: [name] } });
}

function applyOptionalProperty(name, value) {
  if (!selectedElement || editPending) return;
  const text = String(value || '').trim();
  if (!text) {
    queuePatch({ attributes: { remove: [name] } });
    return;
  }
  queuePatch({ properties: { [name]: text } });
}

function applyOptionalText(name, input) {
  if (!selectedElement || editPending) return;
  const text = String(input.value || '').trim();
  if (!text) {
    queuePatch({ attributes: { remove: [name] } });
    input.value = '';
    return;
  }
  queuePatch({ properties: { [name]: text } });
}

function updateInspectorGeometry(geometry) {
  if (inspector.hidden) return;
  inputs.x.value = String(geometry.x);
  inputs.y.value = String(geometry.y);
  inputs.width.value = String(geometry.width);
  inputs.height.value = String(geometry.height);
}

function renderPage(current, report) {
  page.replaceChildren();

  // Everything that belongs to the printable page goes into a clipping layer
  // so elements wider than the paper never paint over the surrounding canvas.
  // Band labels are appended to the page itself, outside this layer.
  contentLayer = make('div', 'page-content');
  page.appendChild(contentLayer);

  const rows = [];
  let top = report.topMargin;

  for (const band of current.bands) {
    const displayHeight = band.height > 0 ? band.height : 14;
    rows.push({ band, top, displayHeight });
    top += displayHeight;
  }

  const surfaceHeight = Math.max(report.pageHeight, top + report.bottomMargin);
  const pageWidthPx   = report.pageWidth * scale;
  const surfacePx     = surfaceHeight * scale;
  const contentWidth  = Math.max(0, report.pageWidth - report.leftMargin - report.rightMargin);

  page.style.width = px(pageWidthPx);
  page.style.height = px(surfacePx);
  page.style.marginLeft = px(GUTTER);

  renderMargins(report, surfaceHeight);
  renderPageBreaks(report, surfaceHeight);
  renderColumns(report, surfaceHeight);

  for (const row of rows) {
    renderBandRow(row, report, contentWidth);
  }
}

function renderMargins(report, surfaceHeight) {
  const width  = report.pageWidth * scale;
  const height = surfaceHeight * scale;

  addOverlay('margin', 0, 0, width, report.topMargin * scale);
  addOverlay('margin', 0, 0, report.leftMargin * scale, height);
  addOverlay(
    'margin',
    (report.pageWidth - report.rightMargin) * scale,
    0,
    report.rightMargin * scale,
    height
  );

  if (surfaceHeight <= report.pageHeight) {
    addOverlay(
      'margin',
      0,
      (report.pageHeight - report.bottomMargin) * scale,
      width,
      report.bottomMargin * scale
    );
  }
}

function renderPageBreaks(report, surfaceHeight) {
  let pageNumber = 2;
  for (let y = report.pageHeight; y < surfaceHeight - 0.5; y += report.pageHeight) {
    const line = make('div', 'page-break');
    line.style.top = px(y * scale);
    line.appendChild(make('span', 'page-break-label', 'Page ' + pageNumber));
    contentLayer.appendChild(line);
    pageNumber += 1;
  }
}

function renderColumns(report, surfaceHeight) {
  if (report.columnCount <= 1) return;

  const totalWidth = report.columnCount * report.columnWidth +
    (report.columnCount - 1) * report.columnSpacing;
  const start = report.leftMargin + report.columnWidth + report.columnSpacing;
  const end   = Math.min(
    report.leftMargin + totalWidth,
    report.pageWidth - report.rightMargin
  );

  if (end > start) {
    addOverlay(
      'column-restricted',
      start * scale,
      report.topMargin * scale,
      (end - start) * scale,
      Math.max(0, surfaceHeight - report.topMargin - report.bottomMargin) * scale
    );
  }

  for (let column = 1; column < report.columnCount; column += 1) {
    const x = report.leftMargin + column * (report.columnWidth + report.columnSpacing);
    const guide = make('div', 'column-guide');
    guide.style.left = px(x * scale);
    guide.style.top = px(report.topMargin * scale);
    guide.style.height = px(Math.max(0, surfaceHeight - report.topMargin - report.bottomMargin) * scale);
    contentLayer.appendChild(guide);

    const label = make('div', 'column-label', 'Column ' + (column + 1));
    label.style.left = px((x + 4) * scale);
    label.style.top = px((report.topMargin + 2) * scale);
    contentLayer.appendChild(label);
  }
}

function addOverlay(className, left, top, width, height) {
  const node = make('div', className);
  position(node, left, top, width, height);
  contentLayer.appendChild(node);
  return node;
}

function renderBandRow(row, report, contentWidth) {
  const band = row.band;
  const scaling = scale;

  const rowEl = make('div', 'band-row');
  rowEl.style.top = px(row.top * scaling);
  rowEl.style.left = px(report.leftMargin * scaling);
  rowEl.style.width = px(contentWidth * scaling);
  rowEl.style.height = px(row.displayHeight * scaling);
  rowEl.setAttribute('data-offset', String(band.offset));
  rowEl.setAttribute('data-end', String(band.end));
  if (band.key === 'background') rowEl.className += ' background-band';
  contentLayer.appendChild(rowEl);

  const label = make('div', 'band-label');
  label.style.top = px(row.top * scaling);
  label.style.left = px(-(GUTTER - 10));
  label.style.width = px(GUTTER - 20);
  label.style.height = px(Math.max(row.displayHeight * scaling, 16));
  label.setAttribute('data-offset', String(band.offset));
  label.setAttribute('data-end', String(band.end));
  label.title = band.label + ' \u2014 click to reveal in source';
  label.appendChild(make('span', 'band-label-name', band.label));
  label.appendChild(make('span', 'band-label-height', String(band.height)));
  page.appendChild(label);

  const layer = make('div', 'band-elements');
  layer.style.left = px(report.leftMargin * scaling);
  layer.style.top = px(row.top * scaling);
  layer.style.width = px(report.columnWidth * scaling);
  layer.style.height = px(row.displayHeight * scaling);
  renderElements(band.elements, layer);
  contentLayer.appendChild(layer);
}

// ── Elements ────────────────────────────────────────────────────────────────

function renderElements(elements, parent) {
  for (const element of elements) parent.appendChild(renderElement(element));
}

function renderElement(element) {
  const style = element.style || {};
  const node  = make('div', 'element');
  const kind  = String(element.kind || 'element').toLowerCase();

  node.style.left = px(element.x * scale);
  node.style.top = px(element.y * scale);
  node.style.width = px(Math.max(0, element.width * scale));
  node.style.height = px(Math.max(0, element.height * scale));
  node.setAttribute('data-offset', String(element.offset));
  node.setAttribute('data-end', String(element.end));
  elementModels.set(node, element);
  if (element.tooltip) node.title = element.tooltip;

  if (style.mode === 'Opaque' && style.backcolor && style.backcolor !== 'transparent') {
    node.style.backgroundColor = style.backcolor;
  }
  if (style.rotation) {
    node.style.transform = 'rotate(' + style.rotation + 'deg)';
    node.style.transformOrigin = 'center center';
  }

  if (kind === 'statictext' || kind === 'textfield') {
    renderText(node, element, style);
  } else if (kind === 'line') {
    renderLine(node, element);
  } else if (kind === 'rectangle') {
    renderShape(node, element, style, false);
  } else if (kind === 'ellipse') {
    renderShape(node, element, style, true);
  } else if (kind === 'frame' || kind === 'elementgroup') {
    renderFrame(node, element);
  } else if (kind === 'break') {
    renderBreak(node);
  } else {
    renderPlaceholder(node, element);
  }

  return node;
}

function renderText(node, element, style) {
  node.classList.add('text-element');
  node.style.overflow = 'hidden';
  applyBox(node, element.box, null);

  const wrap = make('div', 'text-wrap');
  wrap.style.justifyContent = justifyFor(style.vAlign);
  const padding = element.box && element.box.padding ? element.box.padding : 0;
  if (padding > 0) wrap.style.padding = px(padding * scale);

  const content = make('div', 'text-content');
  const isTextField = String(element.kind).toLowerCase() === 'textfield';
  content.textContent = element.displayText || (isTextField ? '(no expression)' : '(empty)');
  if (!element.displayText) content.classList.add('empty-text');
  content.style.textAlign = style.hAlign || 'left';
  content.style.fontFamily = style.fontFamily || 'sans-serif';
  content.style.fontSize = px(Math.max(6, (style.fontSize || 10) * scale));
  content.style.fontWeight = style.bold ? '600' : '400';
  content.style.fontStyle = style.italic ? 'italic' : 'normal';
  content.style.color = style.forecolor || '#000000';

  const decorations = [];
  if (style.underline) decorations.push('underline');
  if (style.strikeThrough) decorations.push('line-through');
  if (decorations.length > 0) content.style.textDecoration = decorations.join(' ');

  wrap.appendChild(content);
  node.appendChild(wrap);
}

function renderPlaceholder(node, element) {
  node.classList.add('placeholder');
  node.style.borderStyle = 'dashed';
  node.style.borderWidth = '1px';
  node.style.borderColor = 'rgba(110,110,110,0.7)';
  if (!node.style.backgroundColor) node.style.backgroundColor = 'rgba(110,110,110,0.06)';

  node.appendChild(make('div', 'placeholder-kind', element.kind));
  if (element.displayText) {
    const text = make('div', 'placeholder-text', element.displayText);
    text.title = element.displayText;
    node.appendChild(text);
  }
}

function renderFrame(node, element) {
  applyBox(node, element.box, null);
  const children = make('div', 'frame-children');
  children.style.position = 'absolute';
  children.style.inset = '0';
  children.style.overflow = 'visible';
  renderElements(element.children || [], children);
  node.appendChild(children);
}

function renderLine(node, element) {
  const line = element.line || { direction: 'TopDown', width: 1, style: 'solid', color: '#000000' };
  const width = Math.max(1, element.width * scale);
  const height = Math.max(1, element.height * scale);
  const viewWidth = Math.max(1, element.width);
  const viewHeight = Math.max(1, element.height);
  const strokeWidth = Math.max(0.5, (line.width || 1) * scale);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '0 0 ' + viewWidth + ' ' + viewHeight);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  let x1 = 0;
  let y1 = 0;
  let x2 = viewWidth;
  let y2 = viewHeight;

  if (element.height <= 1) {
    y1 = y2 = viewHeight / 2;
  } else if (element.width <= 1) {
    x1 = x2 = viewWidth / 2;
  } else if (line.direction === 'BottomUp') {
    y1 = viewHeight;
    y2 = 0;
  }

  stroke.setAttribute('x1', String(x1));
  stroke.setAttribute('y1', String(y1));
  stroke.setAttribute('x2', String(x2));
  stroke.setAttribute('y2', String(y2));
  stroke.setAttribute('stroke', line.color || '#000000');
  stroke.setAttribute('stroke-width', String(strokeWidth));
  stroke.setAttribute('stroke-linecap', 'butt');
  if (line.style === 'dashed') stroke.setAttribute('stroke-dasharray', '4 2');
  else if (line.style === 'dotted') stroke.setAttribute('stroke-dasharray', '1 2');

  svg.appendChild(stroke);
  node.appendChild(svg);

  node.style.width = px(width);
  node.style.height = px(height);
}

function renderShape(node, element, style, ellipse) {
  if (ellipse) {
    node.style.borderRadius = '50%';
  } else {
    const radius = Number.parseFloat(element.attrs && element.attrs.radius);
    if (Number.isFinite(radius) && radius > 0) node.style.borderRadius = px(radius * scale);
  }
  if (style.mode === 'Opaque' && style.backcolor && style.backcolor !== 'transparent') {
    node.style.backgroundColor = style.backcolor;
  }
  const drewBorder = applyBox(node, element.box, style.forecolor || '#000000');
  if (!drewBorder) {
    node.style.borderStyle = 'solid';
    node.style.borderWidth = '1px';
    node.style.borderColor = style.forecolor || '#000000';
  }
}

function renderBreak(node) {
  node.style.overflow = 'visible';
  node.appendChild(make('div', 'break-line'));
  node.appendChild(make('div', 'break-label', 'Page Break'));
}

function applyBox(node, box, fallbackColor) {
  if (!box) return false;

  const borderStyle = box.lineStyle === 'dashed' || box.lineStyle === 'dotted' || box.lineStyle === 'double'
    ? box.lineStyle
    : 'solid';
  const color = box.color || fallbackColor || '#000000';
  const width = Math.max(1, Math.round((box.width || 1) * scale)) + 'px';
  let drew = false;

  if (box.top)    { node.style.borderTop    = width + ' ' + borderStyle + ' ' + color; drew = true; }
  if (box.right)  { node.style.borderRight  = width + ' ' + borderStyle + ' ' + color; drew = true; }
  if (box.bottom) { node.style.borderBottom = width + ' ' + borderStyle + ' ' + color; drew = true; }
  if (box.left)   { node.style.borderLeft   = width + ' ' + borderStyle + ' ' + color; drew = true; }

  return drew;
}

function justifyFor(vAlign) {
  if (vAlign === 'middle') return 'center';
  if (vAlign === 'bottom') return 'flex-end';
  return 'flex-start';
}

// ── Zoom ────────────────────────────────────────────────────────────────────

function setZoom(next, mode) {
  zoomMode = mode;
  scale = clamp(next, ZOOM_MIN, ZOOM_MAX);
  if (model && !model.error && !model.unsupported) render();
  else updateZoomLabel();
}

document.getElementById('zoom-out').addEventListener('click', function () {
  setZoom(scale - ZOOM_STEP, 'manual');
});

document.getElementById('zoom-in').addEventListener('click', function () {
  setZoom(scale + ZOOM_STEP, 'manual');
});

document.getElementById('zoom-fit').addEventListener('click', function () {
  zoomMode = 'fit';
  if (model && !model.error && !model.unsupported) render();
});

document.getElementById('refresh').addEventListener('click', function () {
  vscode.postMessage({ command: 'refresh' });
});

window.addEventListener('resize', function () {
  if (zoomMode !== 'fit' || !model || model.error || model.unsupported) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
});

// ── Mode / follow controls ──────────────────────────────────────────────────

modeViewBtn.addEventListener('click', function () { setEditMode(false); });
modeEditBtn.addEventListener('click', function () { setEditMode(true); });
followBtn.addEventListener('click', function () { setFollowCursor(!followCursor); });

// ── Drag and resize ─────────────────────────────────────────────────────────

function suppressNextClick() {
  suppressClick = true;
  setTimeout(function () { suppressClick = false; }, 300);
}

function postReveal(target) {
  if (!target) return;
  vscode.postMessage({
    command: 'reveal',
    offset: Number.isFinite(target.offset) ? target.offset : 0,
    end: Number.isFinite(target.end) ? target.end : target.offset,
  });
}

function queuePatch(patch, element) {
  const target = element || selectedElement;
  if (!editMode || editPending || !target) return;

  editPending = true;
  updatePendingUi();
  setInspectorError('');
  vscode.postMessage({
    command: 'applyEdit',
    elementOffset: target.offset,
    baseVersion: baseVersion,
    patch: patch,
  });
}

function liveGeometry(node, geometry) {
  node.style.left = px(geometry.x * scale);
  node.style.top = px(geometry.y * scale);
  node.style.width = px(Math.max(1, geometry.width) * scale);
  node.style.height = px(Math.max(1, geometry.height) * scale);
}

function dragGeometry(current, dxPx, dyPx) {
  const start = current.startGeometry;
  const dx = Math.round(dxPx / scale);
  const dy = Math.round(dyPx / scale);

  if (current.mode === 'move') {
    return {
      x: Math.max(0, start.x + dx),
      y: Math.max(0, start.y + dy),
      width: start.width,
      height: start.height,
    };
  }

  let left   = start.x;
  let right  = start.x + start.width;
  let top    = start.y;
  let bottom = start.y + start.height;
  const handle = current.handle || '';

  if (handle.indexOf('e') !== -1) right += dx;
  if (handle.indexOf('w') !== -1) left += dx;
  if (handle.indexOf('s') !== -1) bottom += dy;
  if (handle.indexOf('n') !== -1) top += dy;

  left = Math.max(0, left);
  top  = Math.max(0, top);

  if (right - left < 1) {
    if (handle.indexOf('w') !== -1) left = right - 1;
    else right = left + 1;
  }
  if (bottom - top < 1) {
    if (handle.indexOf('n') !== -1) top = bottom - 1;
    else bottom = top + 1;
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
}

function onPointerDown(event) {
  if (!editMode || editPending || event.button !== 0) return;
  if (!model || model.error || model.unsupported) return;

  const target = event.target;
  if (!target || !target.closest) return;

  const handleEl  = target.closest('.resize-handle');
  const elementEl = target.closest('.element');
  if (!elementEl) return;

  const element = elementModels.get(elementEl);
  if (!element) return;

  if (selected !== elementEl) {
    applySelection({ kind: 'element', offset: element.offset, end: element.end }, false);
  }

  event.preventDefault();

  drag = {
    pointerId: event.pointerId,
    mode: handleEl ? 'resize' : 'move',
    handle: handleEl ? handleEl.getAttribute('data-handle') : '',
    node: elementEl,
    element: element,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startGeometry: {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    },
    geometry: null,
    started: false,
  };
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const dx = event.clientX - drag.startClientX;
  const dy = event.clientY - drag.startClientY;

  if (!drag.started) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.started = true;
    document.body.classList.add('dragging');
  }

  event.preventDefault();
  drag.geometry = dragGeometry(drag, dx, dy);
  liveGeometry(drag.node, drag.geometry);
  updateInspectorGeometry(drag.geometry);
}

function finishDrag() {
  document.body.classList.remove('dragging');
  const finished = drag;
  drag = null;
  return finished;
}

function cancelDrag(restore) {
  const finished = finishDrag();
  if (!finished) return;

  if (restore) {
    liveGeometry(finished.node, {
      x: finished.element.x,
      y: finished.element.y,
      width: finished.element.width,
      height: finished.element.height,
    });
    updateInspectorGeometry(finished.element);
  }
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const finished = finishDrag();
  if (!finished.started || !finished.geometry) return;

  suppressNextClick();
  const changed =
    finished.geometry.x !== finished.element.x ||
    finished.geometry.y !== finished.element.y ||
    finished.geometry.width !== finished.element.width ||
    finished.geometry.height !== finished.element.height;
  if (!changed) return;

  queuePatch({ geometry: finished.geometry }, finished.element);
}

page.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', function (event) {
  if (drag && event.pointerId === drag.pointerId) cancelDrag(true);
});

window.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  if (event.target && event.target.closest && event.target.closest('#inspector')) return;
  if (drag) {
    cancelDrag(true);
    return;
  }
  if (editMode) applySelection(null, false);
});

// ── Inspector edits ─────────────────────────────────────────────────────────

function readGeometryFields() {
  const geometry = {};
  let valid = true;

  for (const field of ['x', 'y', 'width', 'height']) {
    const input = inputs[field];
    const raw = Number(input.value);
    const ok = Number.isFinite(raw) &&
      (field === 'x' || field === 'y' ? raw >= 0 : raw >= 1);
    input.classList.toggle('invalid', !ok);
    if (!ok) valid = false;
    else geometry[field] = Math.round(raw);
  }
  return valid ? geometry : null;
}

function sameGeometry(a, b) {
  return !!a && !!b &&
    a.x === b.x && a.y === b.y &&
    a.width === b.width && a.height === b.height;
}

function applyGeometryFromInspector() {
  if (!selectedElement || editPending) return;
  const geometry = readGeometryFields();
  if (!geometry) {
    setInspectorError('Geometry values must be non-negative integers and at least 1 px wide/tall.');
    return;
  }
  setInspectorError('');
  if (sameGeometry(geometry, selectedElement)) return;
  queuePatch({ geometry: geometry });
}

function applyColorField(key) {
  if (!selectedElement || editPending) return;
  const input = inputs[key];
  const value = String(input.value || '').trim();
  if (!value) {
    input.value = key === 'backcolor' ? '' : (selectedElement.style.forecolor || '');
    return;
  }
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    input.classList.add('invalid');
    setInspectorError('Colors must be #rgb, #rrggbb or #rrggbbaa.');
    return;
  }
  input.classList.remove('invalid');
  setInspectorError('');
  queuePatch({ properties: { [key]: value } });
}

function applyFontName() {
  if (!selectedElement || editPending) return;
  const name = String(inputs.fontName.value || '').trim();
  if (!name) {
    inputs.fontName.classList.add('invalid');
    setInspectorError('Font name cannot be empty.');
    return;
  }
  inputs.fontName.classList.remove('invalid');
  setInspectorError('');
  queuePatch({ properties: { fontName: name } });
}

function applyFontSize() {
  if (!selectedElement || editPending) return;
  const size = Number(inputs.fontSize.value);
  if (!Number.isFinite(size) || size <= 0) {
    inputs.fontSize.classList.add('invalid');
    setInspectorError('Font size must be a positive number.');
    return;
  }
  inputs.fontSize.classList.remove('invalid');
  setInspectorError('');
  queuePatch({ properties: { fontSize: size } });
}

function applyContentFromInspector() {
  if (!selectedElement || !selectedElement.content || !selectedElement.content.editable || editPending) return;
  queuePatch({ content: { text: inputs.text.value } });
}

// ── Expression autocomplete ─────────────────────────────────────────────────

function completionEligible() {
  return editMode
    && !editPending
    && !!selectedElement
    && !!selectedElement.content
    && selectedElement.content.tag === 'expression'
    && selectedElement.content.editable;
}

function hideCompletions() {
  clearTimeout(completionTimer);
  completionRequestId += 1;
  completionSnapshot = null;
  completionItems = [];
  completionIndex = -1;
  completionVisible = false;
  completionReplace = null;
  completionPopup.hidden = true;
  completionList.replaceChildren();
  completionHint.textContent = '';
}

function completionTrigger(event) {
  if (completionVisible) return true;

  const data = event && event.data;
  if (data && ['$', '{', '.', '(', ' '].includes(data)) return true;

  const value = inputs.text.value;
  const offset = inputs.text.selectionStart;
  const before = value.slice(0, offset);
  return /$[FPVR]?{[^}]*$/.test(before)
    || /.s*[A-Za-z_$][w$]*$/.test(before);
}

function scheduleCompletions(event) {
  clearTimeout(completionTimer);

  if (!completionEligible()) {
    hideCompletions();
    return;
  }
  if (!completionTrigger(event)) {
    hideCompletions();
    return;
  }

  completionTimer = setTimeout(requestCompletions, 100);
}

function requestCompletions() {
  if (!completionEligible()) {
    hideCompletions();
    return;
  }

  const text = inputs.text.value;
  const offset = inputs.text.selectionStart;
  if (!Number.isInteger(offset)) return;

  completionSnapshot = { text, offset };
  const requestId = ++completionRequestId;

  vscode.postMessage({
    command: 'complete',
    expression: text,
    offset,
    requestId,
  });
}

function filterCompletions(items) {
  const prefix = String(completionPrefix || '').toLowerCase();
  if (!prefix) return items;

  return items.filter(function (item) {
    const label = String(item.label || '');
    const filter = String(item.filterText || label).toLowerCase();
    if (filter.startsWith(prefix)) return true;
    if (completionMode === 'general') {
      return label.toLowerCase().startsWith(prefix)
        || label.toLowerCase().includes('{' + prefix);
    }
    return false;
  });
}

function showCompletions(result, requestId) {
  if (requestId !== completionRequestId) return;
  if (!completionSnapshot) return;
  if (inputs.text.value !== completionSnapshot.text) return;
  if (inputs.text.selectionStart !== completionSnapshot.offset) return;

  if (!result || !Array.isArray(result.items) || result.items.length === 0) {
    hideCompletions();
    return;
  }

  completionMode = String(result.mode || 'general');
  completionPrefix = String(result.prefix || '');
  completionReplace = result.replace || {
    start: completionSnapshot.offset,
    end:   completionSnapshot.offset,
  };

  const filtered = filterCompletions(result.items).slice(0, 100);
  if (filtered.length === 0) {
    hideCompletions();
    return;
  }

  completionItems = filtered;
  completionIndex = 0;
  completionVisible = true;

  renderCompletions();
}

function renderCompletions() {
  completionList.replaceChildren();
  const fragment = document.createDocumentFragment();

  completionItems.forEach(function (item, index) {
    const row = make('li', 'completion-item');
    row.setAttribute('role', 'option');
    row.dataset.index = String(index);
    row.classList.toggle('active', index === completionIndex);
    row.setAttribute('aria-selected', index === completionIndex ? 'true' : 'false');

    row.appendChild(make('span', 'completion-label', item.label));
    if (item.detail) {
      row.appendChild(make('span', 'completion-detail', item.detail));
    }
    if (item.documentation) {
      row.title = String(item.documentation).slice(0, 800);
    }
    fragment.appendChild(row);
  });

  completionList.appendChild(fragment);
  completionHint.textContent = completionItems.length +
    (completionItems.length === 1 ? ' suggestion' : ' suggestions');
  completionPopup.hidden = false;

  const active = completionList.querySelector('.completion-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function moveCompletion(delta) {
  if (!completionVisible || completionItems.length === 0) return;
  const length = completionItems.length;
  completionIndex = (completionIndex + delta + length) % length;
  renderCompletions();
}

function acceptCompletion() {
  if (!completionVisible || completionIndex < 0) return;
  const item = completionItems[completionIndex];
  if (!item) return;

  // Type hints are informational: accepting one must not delete typed text.
  if (item.kind === 'text') {
    hideCompletions();
    return;
  }

  // If the draft or caret moved after the request, this list is stale.
  if (!completionSnapshot
      || inputs.text.value !== completionSnapshot.text
      || inputs.text.selectionStart !== completionSnapshot.offset) {
    hideCompletions();
    return;
  }

  const current = inputs.text.value;
  const fallback = inputs.text.selectionStart;
  const start = completionReplace
    ? Math.max(0, Math.min(completionReplace.start, current.length))
    : fallback;
  const end = completionReplace
    ? Math.max(start, Math.min(completionReplace.end, current.length))
    : fallback;

  const insert = String(item.insertTextPlain !== undefined ? item.insertTextPlain : item.label);
  const next = current.slice(0, start) + insert + current.slice(end);
  inputs.text.value = next;

  let caretStart = start + insert.length;
  let caretEnd = caretStart;
  if (item.placeholder) {
    const from = Math.max(0, Math.min(item.placeholder.start, insert.length));
    const to = Math.max(from, Math.min(item.placeholder.end, insert.length));
    caretStart = start + from;
    caretEnd = start + to;
  }

  inputs.text.focus();
  inputs.text.setSelectionRange(caretStart, caretEnd);
  hideCompletions();
}

inputs.text.addEventListener('input', scheduleCompletions);
inputs.text.addEventListener('blur', function () {
  setTimeout(hideCompletions, 120);
});
inputs.text.addEventListener('keydown', function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
    event.preventDefault();
    requestCompletions();
    return;
  }
  if (!completionVisible) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveCompletion(event.key === 'ArrowDown' ? 1 : -1);
  } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    acceptCompletion();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideCompletions();
  }
});
completionList.addEventListener('mousedown', function (event) {
  const row = event.target && event.target.closest
    ? event.target.closest('.completion-item')
    : null;
  if (!row) return;

  event.preventDefault();
  completionIndex = Number(row.dataset.index);
  acceptCompletion();
});

inputs.x.addEventListener('change', applyGeometryFromInspector);
inputs.y.addEventListener('change', applyGeometryFromInspector);
inputs.width.addEventListener('change', applyGeometryFromInspector);
inputs.height.addEventListener('change', applyGeometryFromInspector);
inputs.fontName.addEventListener('change', applyFontName);
inputs.fontSize.addEventListener('change', applyFontSize);

function applyBooleanProperty(key, input) {
  if (!selectedElement || editPending) return;
  queuePatch({ properties: { [key]: input.checked } });
}

inputs.bold.addEventListener('change', function () { applyBooleanProperty('bold', inputs.bold); });
inputs.italic.addEventListener('change', function () { applyBooleanProperty('italic', inputs.italic); });
inputs.underline.addEventListener('change', function () { applyBooleanProperty('underline', inputs.underline); });
inputs.strike.addEventListener('change', function () { applyBooleanProperty('strikeThrough', inputs.strike); });
inputs.hAlign.addEventListener('change', function () {
  if (selectedElement && !editPending) queuePatch({ properties: { hTextAlign: inputs.hAlign.value } });
});
inputs.vAlign.addEventListener('change', function () {
  if (selectedElement && !editPending) queuePatch({ properties: { vTextAlign: inputs.vAlign.value } });
});
inputs.rotation.addEventListener('change', function () {
  if (selectedElement && !editPending) queuePatch({ properties: { rotation: inputs.rotation.value } });
});
inputs.markup.addEventListener('change', function () {
  if (selectedElement && !editPending) queuePatch({ properties: { markup: inputs.markup.value } });
});
inputs.mode.addEventListener('change', function () {
  if (selectedElement && !editPending) queuePatch({ properties: { mode: inputs.mode.value } });
});
inputs.forecolor.addEventListener('change', function () { applyColorField('forecolor'); });
inputs.backcolor.addEventListener('change', function () { applyColorField('backcolor'); });

function isHexColor(value) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(value || '').trim());
}

function applyLineFields() {
  if (!selectedElement || editPending) return;

  const width = Number(inputs.lineWidth.value);
  if (!Number.isFinite(width) || width <= 0) {
    inputs.lineWidth.classList.add('invalid');
    setInspectorError('Line width must be a positive number.');
    return;
  }
  const style = inputs.lineStyle.value || 'Solid';
  const color = String(inputs.lineColor.value || '').trim();
  if (color && !isHexColor(color)) {
    inputs.lineColor.classList.add('invalid');
    setInspectorError('Line color must be #rgb, #rrggbb or #rrggbbaa.');
    return;
  }

  inputs.lineWidth.classList.remove('invalid');
  inputs.lineColor.classList.remove('invalid');
  setInspectorError('');
  queuePatch({ line: { width: width, style: style, color: color } });
}

function applyBoxFields() {
  if (!selectedElement || editPending) return;

  const width = Number(inputs.boxWidth.value);
  const paddingValue = String(inputs.boxPadding.value || '').trim();
  const padding = paddingValue === '' ? 0 : Number(paddingValue);
  const color = String(inputs.boxColor.value || '').trim();

  if (!Number.isFinite(width) || width <= 0) {
    inputs.boxWidth.classList.add('invalid');
    setInspectorError('Border width must be a positive number.');
    return;
  }
  if (!Number.isFinite(padding) || padding < 0) {
    inputs.boxPadding.classList.add('invalid');
    setInspectorError('Padding must be a non-negative number.');
    return;
  }
  if (color && !isHexColor(color)) {
    inputs.boxColor.classList.add('invalid');
    setInspectorError('Border color must be #rgb, #rrggbb or #rrggbbaa.');
    return;
  }

  inputs.boxWidth.classList.remove('invalid');
  inputs.boxPadding.classList.remove('invalid');
  inputs.boxColor.classList.remove('invalid');
  setInspectorError('');
  queuePatch({
    box: {
      border:  inputs.boxBorder.checked,
      padding: Math.round(padding),
      width:   width,
      style:   inputs.boxStyle.value || 'Solid',
      color:   color,
    },
  });
}

inputs.style.addEventListener('change', function () {
  if (!selectedElement || editPending) return;
  if (inputs.style.value) queuePatch({ properties: { style: inputs.style.value } });
  else queuePatch({ attributes: { remove: ['style'] } });
});

inputs.positionType.addEventListener('change', function () {
  applyOptionalProperty('positionType', inputs.positionType.value);
});
inputs.stretchType.addEventListener('change', function () {
  applyOptionalProperty('stretchType', inputs.stretchType.value);
});
inputs.evaluationTime.addEventListener('change', function () {
  applyOptionalProperty('evaluationTime', inputs.evaluationTime.value);
});
inputs.printGroup.addEventListener('change', function () {
  applyOptionalText('printWhenGroupChanges', inputs.printGroup);
});
inputs.evaluationGroup.addEventListener('change', function () {
  applyOptionalText('evaluationGroup', inputs.evaluationGroup);
});
inputs.key.addEventListener('change', function () {
  applyOptionalText('key', inputs.key);
});
inputs.bookmarkLevel.addEventListener('change', function () {
  if (!selectedElement || editPending) return;
  const text = String(inputs.bookmarkLevel.value || '').trim();
  if (!text) {
    queuePatch({ attributes: { remove: ['bookmarkLevel'] } });
    return;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    inputs.bookmarkLevel.classList.add('invalid');
    setInspectorError('Bookmark level must be a non-negative integer.');
    return;
  }
  inputs.bookmarkLevel.classList.remove('invalid');
  setInspectorError('');
  queuePatch({ properties: { bookmarkLevel: value } });
});

inputs.printRepeated.addEventListener('change', function () {
  applyBooleanProperty('printRepeatedValues', inputs.printRepeated);
});
inputs.removeLine.addEventListener('change', function () {
  applyBooleanProperty('removeLineWhenBlank', inputs.removeLine);
});
inputs.printFirstWhole.addEventListener('change', function () {
  applyBooleanProperty('printInFirstWholeBand', inputs.printFirstWhole);
});
inputs.printDetail.addEventListener('change', function () {
  applyBooleanProperty('printWhenDetailOverflows', inputs.printDetail);
});

inputs.textAdjust.addEventListener('change', function () {
  applyOptionalProperty('textAdjust', inputs.textAdjust.value);
});
inputs.pattern.addEventListener('change', function () {
  if (!selectedElement || editPending) return;
  queuePatch({ properties: { pattern: inputs.pattern.value } });
});
inputs.blankNull.addEventListener('change', function () {
  applyBooleanProperty('blankWhenNull', inputs.blankNull);
});

inputs.scaleImage.addEventListener('change', function () {
  applyOptionalProperty('scaleImage', inputs.scaleImage.value);
});
inputs.hImageAlign.addEventListener('change', function () {
  applyOptionalProperty('hImageAlign', inputs.hImageAlign.value);
});
inputs.vImageAlign.addEventListener('change', function () {
  applyOptionalProperty('vImageAlign', inputs.vImageAlign.value);
});
inputs.onError.addEventListener('change', function () {
  applyOptionalProperty('onErrorType', inputs.onError.value);
});
inputs.linkType.addEventListener('change', function () {
  applyOptionalProperty('linkType', inputs.linkType.value);
});
inputs.usingCache.addEventListener('change', function () {
  applyBooleanProperty('usingCache', inputs.usingCache);
});
inputs.lazy.addEventListener('change', function () {
  applyBooleanProperty('lazy', inputs.lazy);
});

inputs.lineDirection.addEventListener('change', function () {
  applyOptionalProperty('direction', inputs.lineDirection.value);
});
inputs.lineWidth.addEventListener('change', applyLineFields);
inputs.lineStyle.addEventListener('change', applyLineFields);
inputs.lineColor.addEventListener('change', applyLineFields);

inputs.radius.addEventListener('change', function () {
  if (!selectedElement || editPending) return;
  const text = String(inputs.radius.value || '').trim();
  if (!text) {
    queuePatch({ attributes: { remove: ['radius'] } });
    return;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    inputs.radius.classList.add('invalid');
    setInspectorError('Corner radius must be a non-negative integer.');
    return;
  }
  inputs.radius.classList.remove('invalid');
  setInspectorError('');
  queuePatch({ properties: { radius: value } });
});

inputs.breakType.addEventListener('change', function () {
  applyOptionalProperty('type', inputs.breakType.value);
});
inputs.subreportCache.addEventListener('change', function () {
  applyBooleanProperty('usingCache', inputs.subreportCache);
});
inputs.runToBottom.addEventListener('change', function () {
  applyBooleanProperty('runToBottom', inputs.runToBottom);
});

inputs.boxBorder.addEventListener('change', applyBoxFields);
inputs.boxWidth.addEventListener('change', applyBoxFields);
inputs.boxStyle.addEventListener('change', applyBoxFields);
inputs.boxColor.addEventListener('change', applyBoxFields);
inputs.boxPadding.addEventListener('change', applyBoxFields);

inputs.addAttribute.addEventListener('click', function () {
  if (!selectedElement || editPending) return;
  const name = String(inputs.newAttrName.value || '').trim();
  const value = String(inputs.newAttrValue.value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
    setInspectorError('Attribute names must start with a letter or underscore.');
    return;
  }
  if (name.toLowerCase() === 'kind' || name.toLowerCase() === 'xmlns' || name.toLowerCase().startsWith('xmlns:')) {
    setInspectorError('That attribute cannot be changed from the inspector.');
    return;
  }
  inputs.newAttrName.value = '';
  inputs.newAttrValue.value = '';
  setInspectorError('');
  queuePatch({ attributes: { set: { [name]: value } } });
});

inputs.textApply.addEventListener('click', applyContentFromInspector);
inputs.text.addEventListener('keydown', function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    applyContentFromInspector();
  }
});
inspectReveal.addEventListener('click', function () {
  if (selectedElement) {
    postReveal({ offset: selectedElement.offset, end: selectedElement.end });
  }
});

// ── Reveal in source ────────────────────────────────────────────────────────

page.addEventListener('click', function (event) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }

  const target = event.target;
  if (!target || !target.closest) return;
  if (target.closest('.resize-handle')) return;

  const elementNode = target.closest('.element');
  if (elementNode) {
    const element = elementModels.get(elementNode);
    if (!element) return;
    const selection = { kind: 'element', offset: element.offset, end: element.end };
    applySelection(selection, false);
    if (!editMode) postReveal(selection);
    return;
  }

  const bandLabel = target.closest('.band-label');
  if (bandLabel) {
    const selection = {
      kind: 'band',
      offset: Number(bandLabel.getAttribute('data-offset')),
      end: Number(bandLabel.getAttribute('data-end')),
    };
    applySelection(selection, true);
    postReveal(selection);
  }
});

// ── Host messages ───────────────────────────────────────────────────────────

window.addEventListener('message', function (event) {
  const message = event.data || {};

  if (message.command === 'update') {
    if (drag) cancelDrag(false);
    setModel(message.model, message.fileName, message.version);
    editPending = false;
    updatePendingUi();
    render();
  } else if (message.command === 'select') {
    lastSourceSelection = message.target || null;
    if (followCursor && !drag) applySelection(lastSourceSelection, true);
  } else if (message.command === 'completions') {
    showCompletions(message.result, message.requestId);
  } else if (message.command === 'editRejected') {
    editPending = false;
    updatePendingUi();
    render();
    setBanner('error', String(message.reason || 'The edit was not applied.'));
  } else if (message.command === 'error') {
    setBanner('error', String(message.message || 'The design view hit an error.'));
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

setModel(INITIAL_MODEL, INITIAL_FILE, INITIAL_VERSION);
syncModeControls();
updatePendingUi();
render();
vscode.postMessage({ command: 'ready' });
