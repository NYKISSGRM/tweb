// NYKISS Gram — «Заметка про мамонта»: одна строка («хочет VIP, платит в пятницу») в меню Quick Bubble и в чипе.
// Хранится в CRM (видна с любого браузера), пишет только владелец мамонта: сервер проверяет ключ (PUT /messenger/note).
// Здесь только разметка, санитайзер и поведение поля; сетевой вызов приходит снаружи (save), чтобы не плодить второй apiFetch.

export const NOTE_MAX = 200;
const KEEP = new Set(['\u200e', '\u200f']);   // метки направления нужны RTL-тексту; остальные невидимые символы вычищаем

/** Те же правила, что на сервере (services/mammoth.clean_note): одна строка, ≤200 символов, без управляющих и невидимых. */
export function sanitizeNote(raw: string | null | undefined): string {
  if(!raw) return '';
  let out = '';
  for(const ch of raw) {
    if(/[\r\n\t\u2028\u2029]/.test(ch)) out += ' ';
    else if(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u.test(ch) && !KEEP.has(ch)) continue;
    else out += ch;
  }
  return Array.from(out.split(/\s+/).filter(Boolean).join(' ')).slice(0, NOTE_MAX).join('');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'} as any)[c]);
}

/** Короткая версия для чипа над кнопкой: обрезаем по символам, остальное скроет CSS. */
export function chipNote(note: string | null | undefined): string {
  const s = sanitizeNote(note);
  return Array.from(s).length > 28 ? Array.from(s).slice(0, 27).join('') + '…' : s;
}

export function noteFieldHtml(note: string | null | undefined): string {
  return '<div class="nykiss-qb__sec nykiss-qb__notef"><label class="nykiss-qb__lbl" for="nykiss-qb-note">Заметка</label>' +
    '<input id="nykiss-qb-note" class="nykiss-qb__noteinput" type="text" maxlength="' + NOTE_MAX + '" dir="auto" enterkeyhint="done" ' +
    'autocomplete="off" spellcheck="false" placeholder="Хочет… боится… платит…" value="' + esc(sanitizeNote(note)) + '">' +
    '<div class="nykiss-qb__notestate" role="status" aria-live="polite"></div></div>';
}

export const NOTE_CSS = `
.nykiss-qb__notef{padding-bottom:12px}
.nykiss-qb__noteinput{display:block;box-sizing:border-box;inline-size:100%;margin-block-start:8px;padding:9px 10px;border:1px solid var(--nq-line);
  border-radius:5px;background:var(--nq-ink);color:var(--nq-text);font:500 13.5px/1.3 Manrope,sans-serif;text-overflow:ellipsis}
.nykiss-qb__noteinput::placeholder{color:var(--nq-muted)}
.nykiss-qb__noteinput:focus{outline:0;border-color:var(--nq-gold)}
:where(.a11y) .nykiss-qb__noteinput:focus-visible{outline:2px solid var(--nq-text);outline-offset:2px}
.nykiss-qb__notestate{min-block-size:14px;margin-block-start:5px;font:600 11px/1.2 Manrope,sans-serif;color:var(--nq-muted)}
.nykiss-qb__notestate.is-err{color:#e6a1a1}
.nykiss-qb__chipnote{max-inline-size:150px;overflow:hidden;text-overflow:ellipsis;color:var(--nq-muted);font-weight:500}
`;

/** Человеческая причина сбоя записи (apiFetch бросает 'bad-key' | 'http-<код>'; всё остальное: сеть, CORS, блокировщик). */
export function noteError(e: any): string {
  const m = String(e?.message || '');
  if(m === 'bad-key') return 'Ключ слетел, подключи CRM заново';
  const http = /^http-(\d+)$/.exec(m);
  if(http) return http[1] === '429' ? 'Слишком часто, подожди минуту' : http[1] === '404' ? 'Этот мамонт не в твоей CRM' : `Сервер ответил ошибкой ${http[1]}`;
  return 'Запрос не дошёл до сервера (' + (m || 'нет связи') + ')';
}

/** Подключает поведение к полю внутри меню: сохраняем при уходе из поля и по Enter, при ошибке возвращаем прежнее значение. */
export function wireNoteField(root: HTMLElement, initial: string | null | undefined, save: (note: string) => Promise<string | null | undefined>) {
  const input = root.querySelector<HTMLInputElement>('.nykiss-qb__noteinput');
  const state = root.querySelector<HTMLElement>('.nykiss-qb__notestate');
  if(!input || !state) return;
  let saved = sanitizeNote(initial);
  let timer = 0;
  const say = (text: string, err = false) => {
    window.clearTimeout(timer);
    state.textContent = text;
    state.classList.toggle('is-err', err);
    if(text && !err && text !== 'Сохраняю…') timer = window.setTimeout(() => { state.textContent = ''; }, 1600);
  };

  const commit = async() => {
    const v = sanitizeNote(input.value);
    if(v === saved) { input.value = v; return; }
    say('Сохраняю…');
    try {
      saved = sanitizeNote(await save(v));
      input.value = saved;
      say(saved ? 'Сохранено' : 'Заметка удалена');
    } catch(e) {
      input.value = saved;
      console.warn('[nykiss] note save failed', e);
      say(noteError(e), true);
    }
  };

  input.addEventListener('blur', () => { commit(); });
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') { input.value = saved; return; }   // Escape закрывает меню, это уже есть
    e.stopPropagation();                                      // горячие клавиши Gram не должны ловить ввод заметки
    if(e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  // браузер склеивает переводы строки в <input> без пробела («хочет\nVIP» → «хочетVIP»): сами превращаем их в пробел
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text');
    if(text == null) return;
    e.preventDefault();
    input.setRangeText(text.replace(/[\r\n\t\u2028\u2029]+/g, ' '), input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
  });
}
