// @vitest-environment jsdom
import {chipNote, noteError, noteFieldHtml, sanitizeNote, wireNoteField} from '@lib/nykiss/mammothNote';

describe('nykiss mammoth note', () => {
  test('sanitizeNote: one line, no control or invisible characters, direction marks kept, 200 code points', () => {
    expect(sanitizeNote('  хочет VIP,\n платит в пятницу  ')).toBe('хочет VIP, платит в пятницу');
    expect(sanitizeNote('a\u202eb\u200bc\u0000d\u2028e\u200fф')).toBe('abcd e\u200fф');
    expect(sanitizeNote('   ')).toBe('');
    expect(sanitizeNote(null)).toBe('');
    expect(Array.from(sanitizeNote('я'.repeat(250))).length).toBe(200);
    expect(sanitizeNote('😀'.repeat(250)).length).toBe(400);   // 200 символов, а не 200 половинок суррогатной пары
  });

  test('chipNote shortens long notes to 28 characters', () => {
    expect(chipNote('платит в пятницу')).toBe('платит в пятницу');
    expect(Array.from(chipNote('я'.repeat(60))).length).toBe(28);
    expect(chipNote('я'.repeat(60)).endsWith('…')).toBe(true);
  });

  test('noteFieldHtml escapes the value (no attribute or tag injection)', () => {
    const html = noteFieldHtml('"><img src=x onerror=alert(1)>');
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('img').length).toBe(0);
    expect(host.querySelector<HTMLInputElement>('input').value).toBe('"><img src=x onerror=alert(1)>');
    expect(host.querySelector('input').getAttribute('maxlength')).toBe('200');
  });

  test('wireNoteField saves on blur, reverts on error, ignores unchanged values', async() => {
    const host = document.createElement('div');
    host.innerHTML = noteFieldHtml('старая');
    document.body.append(host);
    const input = host.querySelector<HTMLInputElement>('input');
    const state = host.querySelector<HTMLElement>('.nykiss-qb__notestate');
    const calls: string[] = [];
    let fail = false;
    wireNoteField(host, 'старая', async(v) => { calls.push(v); if(fail) throw new Error('x'); return v; });

    input.value = 'старая';
    input.dispatchEvent(new Event('blur'));
    await Promise.resolve();
    expect(calls).toEqual([]);                                  // не менялось: запроса нет

    input.value = '  новая   строка ';
    input.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual(['новая строка']);
    expect(input.value).toBe('новая строка');
    expect(state.textContent).toBe('Сохранено');

    fail = true;
    input.value = 'сломается';
    input.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 0));
    expect(input.value).toBe('новая строка');                   // вернули сохранённое
    expect(state.classList.contains('is-err')).toBe(true);

    fail = false;
    input.value = '';
    input.dispatchEvent(new Event('blur'));
    await new Promise(r => setTimeout(r, 0));
    expect(calls[calls.length - 1]).toBe('');
    expect(state.textContent).toBe('Заметка удалена');
  });

  test('noteError names the real reason', () => {
    expect(noteError(new Error('bad-key'))).toMatch(/Ключ слетел/);
    expect(noteError(new Error('http-404'))).toMatch(/не в твоей CRM/);
    expect(noteError(new Error('http-429'))).toMatch(/Слишком часто/);
    expect(noteError(new Error('http-500'))).toBe('Сервер ответил ошибкой 500');
    expect(noteError(new TypeError('Failed to fetch'))).toBe('Запрос не дошёл до сервера (Failed to fetch)');
    expect(noteError(undefined)).toMatch(/не дошёл до сервера/);
  });

  test('wireNoteField: pasted multi-line text becomes one line with spaces', () => {
    const host = document.createElement('div');
    host.innerHTML = noteFieldHtml('');
    document.body.append(host);
    const input = host.querySelector<HTMLInputElement>('input');
    wireNoteField(host, '', async(v) => v);
    const ev: any = new Event('paste', {bubbles: true, cancelable: true});
    ev.clipboardData = {getData: () => 'хочет\nVIP\r\nплатит в пятницу'};
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(input.value).toBe('хочет VIP платит в пятницу');
  });

  test('wireNoteField: Enter blurs the input, other keys do not reach global hotkeys', () => {
    const host = document.createElement('div');
    host.innerHTML = noteFieldHtml('');
    document.body.append(host);
    const input = host.querySelector<HTMLInputElement>('input');
    wireNoteField(host, '', async(v) => v);
    let leaked = 0;
    document.addEventListener('keydown', () => { leaked++; });
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true}));
    expect(leaked).toBe(0);
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
    expect(document.activeElement).not.toBe(input);
  });
});
