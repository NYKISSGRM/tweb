// src/lib/nykiss/quickBubble.ts
// NYKISS Gram — floating Quick Bubble for operators.
//
// A single fixed-position control that lives over the open chat (Nicegram-style).
// Tapping it opens a compact list of quick-reply templates; clicking one drops
// its text into the composer. Add/remove templates inline.
//
// Deliberately framework-free: it mounts into <body> and shows itself only while
// a chat composer is on screen, so it never touches the SolidJS component tree.

const TEMPLATES_STORAGE_KEY = 'nykiss_quick_templates';

type QuickTemplate = {id: string; text: string};

const DEFAULT_TEMPLATES: QuickTemplate[] = [
  {id: 'greet', text: 'Здравствуйте! На связи, чем могу помочь?'},
  {id: 'wait', text: 'Секунду, уточняю информацию и вернусь к вам.'},
  {id: 'thanks', text: 'Спасибо за ожидание! Вот что по вашему вопросу:'}
];

let inited = false;

// ---- storage (per-device; templates are an operator convenience) ------------

function readTemplates(): QuickTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if(!raw) return DEFAULT_TEMPLATES.slice();
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return parsed.filter((t) => t && typeof t.text === 'string');
  } catch(e) {}
  return DEFAULT_TEMPLATES.slice();
}

function writeTemplates(list: QuickTemplate[]) {
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(list));
  } catch(e) {}
}

// ---- composer insertion ------------------------------------------------------

// The currently usable message field: a visible, editable `.input-message-input`.
function getActiveInput(): HTMLElement | null {
  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>('.input-message-input[contenteditable="true"]')
  );
  // offsetParent is null for display:none nodes — keep the one actually on screen.
  return inputs.find((el) => el.offsetParent !== null) || null;
}

function insertTemplate(text: string) {
  const input = getActiveInput();
  if(!input) return;

  input.focus();

  // Put the caret at the end when the field isn't already focused inside itself,
  // so we append rather than overwrite a stray selection.
  const selection = window.getSelection();
  if(!selection || !input.contains(selection.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  // execCommand fires the same beforeinput/input events tweb's ChatInput listens
  // to, so height, send-button state and draft saving all update as if typed.
  const ok = document.execCommand('insertText', false, text);
  if(!ok) {
    // Fallback for engines without execCommand: append a text node + notify.
    input.appendChild(document.createTextNode(text));
    input.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
  }
}

// ---- styles ------------------------------------------------------------------

const STYLE_ID = 'nykiss-quick-bubble-style';

function injectStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.nykiss-qb {
  position: fixed;
  right: 16px;
  bottom: 104px;
  z-index: 5;
  display: none;
  font-family: var(--font-family, inherit);
  -webkit-user-select: none;
  user-select: none;
}
.nykiss-qb.is-visible { display: block; }

.nykiss-qb__fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #1a1206;
  background: linear-gradient(135deg, var(--primary-color, #C9A227), #B8891E);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .45), 0 0 0 1px rgba(255, 255, 255, .06) inset;
  font-weight: 800;
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform .18s ease, box-shadow .18s ease;
}
.nykiss-qb__fab:hover { transform: translateY(-2px) scale(1.04); }
.nykiss-qb__fab:active { transform: scale(.96); }
.nykiss-qb.is-open .nykiss-qb__fab { transform: rotate(45deg); }

.nykiss-qb__menu {
  position: absolute;
  right: 0;
  bottom: 60px;
  width: 268px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 8px;
  border-radius: 16px;
  background: var(--surface-color, #1a1206);
  color: var(--primary-text-color, #f0ead8);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .55), 0 0 0 1px rgba(201, 162, 39, .18);
  opacity: 0;
  transform: translateY(8px) scale(.98);
  pointer-events: none;
  transition: opacity .16s ease, transform .16s ease;
}
.nykiss-qb.is-open .nykiss-qb__menu {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.nykiss-qb__section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
  opacity: .55;
  padding: 8px 10px 4px;
}

.nykiss-qb__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  transition: background .12s ease;
}
.nykiss-qb__row:hover { background: rgba(201, 162, 39, .12); }
.nykiss-qb__row-ico { font-size: 16px; width: 18px; text-align: center; }
.nykiss-qb__row-label { flex: 1; min-width: 0; }

.nykiss-qb__tpl {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background .12s ease;
}
.nykiss-qb__tpl:hover { background: rgba(201, 162, 39, .12); }
.nykiss-qb__tpl-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nykiss-qb__tpl-del {
  border: none;
  background: transparent;
  color: inherit;
  opacity: .4;
  cursor: pointer;
  font-size: 15px;
  padding: 2px 4px;
  border-radius: 6px;
}
.nykiss-qb__tpl-del:hover { opacity: 1; background: rgba(255, 80, 80, .18); }
`;
  document.head.appendChild(style);
}

// ---- DOM building ------------------------------------------------------------

let rootEl: HTMLDivElement;
let menuEl: HTMLDivElement;
let templatesWrapEl: HTMLDivElement;

function buildTemplatesList() {
  templatesWrapEl.textContent = '';
  const templates = readTemplates();

  templates.forEach((tpl) => {
    const row = document.createElement('div');
    row.className = 'nykiss-qb__tpl';

    const text = document.createElement('span');
    text.className = 'nykiss-qb__tpl-text';
    text.textContent = tpl.text;
    text.title = tpl.text;
    text.addEventListener('click', () => {
      insertTemplate(tpl.text);
      closeMenu();
    });

    const del = document.createElement('button');
    del.className = 'nykiss-qb__tpl-del';
    del.textContent = '×';
    del.title = 'Удалить шаблон';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      writeTemplates(readTemplates().filter((t) => t.id !== tpl.id));
      buildTemplatesList();
    });

    row.append(text, del);
    templatesWrapEl.append(row);
  });

  const add = document.createElement('button');
  add.className = 'nykiss-qb__row';
  add.innerHTML = '<span class="nykiss-qb__row-ico">＋</span><span class="nykiss-qb__row-label">Добавить шаблон</span>';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    const value = window.prompt('Текст шаблона:');
    if(value && value.trim()) {
      const list = readTemplates();
      list.push({id: 'tpl_' + Date.now().toString(36), text: value.trim()});
      writeTemplates(list);
      buildTemplatesList();
    }
  });
  templatesWrapEl.append(add);
}

function buildMenu() {
  menuEl.textContent = '';

  const title = document.createElement('div');
  title.className = 'nykiss-qb__section-title';
  title.textContent = 'Шаблоны';
  menuEl.append(title);

  templatesWrapEl = document.createElement('div');
  menuEl.append(templatesWrapEl);
  buildTemplatesList();
}

// ---- open/close + visibility -------------------------------------------------

function openMenu() {
  rootEl.classList.add('is-open');
  buildTemplatesList();
}

function closeMenu() {
  rootEl.classList.remove('is-open');
}

function toggleMenu() {
  rootEl.classList.contains('is-open') ? closeMenu() : openMenu();
}

// Show the bubble only while a chat composer is on screen.
function syncVisibility() {
  const visible = !!getActiveInput();
  rootEl.classList.toggle('is-visible', visible);
  if(!visible) closeMenu();
}

export function initQuickBubble() {
  if(inited) return;
  inited = true;

  injectStyle();

  rootEl = document.createElement('div');
  rootEl.className = 'nykiss-qb';

  const fab = document.createElement('button');
  fab.className = 'nykiss-qb__fab';
  fab.textContent = 'N';
  fab.title = 'NYKISS — шаблоны';
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  menuEl = document.createElement('div');
  menuEl.className = 'nykiss-qb__menu';

  rootEl.append(menuEl, fab);
  document.body.append(rootEl);

  buildMenu();

  // Close on outside click / Escape.
  document.addEventListener('click', (e) => {
    if(!rootEl.contains(e.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') closeMenu();
  });

  // The chat can open/close without a full navigation, so poll cheaply.
  syncVisibility();
  window.setInterval(syncVisibility, 600);
}
