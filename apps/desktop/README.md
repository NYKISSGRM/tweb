# NYKISS Gram Desktop

Десктоп-обёртка на Electron для NYKISS Gram. Приложение открывает живой сайт
https://nykissgrm.github.io/tweb/ — обновления Gram приходят сразу, переустанавливать ничего не нужно.
Код приложения (`main.js`) почти не меняется; обновлять его нужно только при смене окна, меню или правил безопасности.

Зависимости ставятся только в `apps/desktop/` (свой `package.json`, `node_modules` в `.gitignore`).
Корень репозитория tweb не затрагивается.

## Что умеет

- одно окно, запоминает размер и позицию, один экземпляр (второй запуск фокусирует первое окно);
- тёмное окно без белой вспышки (`backgroundColor #070807`), иконка: золотая N на фетре;
- сессия сохраняется между запусками (`partition: persist:nykiss`, IndexedDB и localStorage);
- уведомления рабочего стола, камера и микрофон для звонков;
- меню: Правка / Вид / Окно (перезагрузка, масштаб, полный экран); DevTools только в dev-режиме;
- нет соединения: тёмная заглушка и повтор через 5 секунд.

## Безопасность

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity` не отключён, preload нет;
- навигация в окне разрешена только на `nykissgrm.github.io/tweb/`, `wcrm.206.71.148.212.nip.io` и `*.telegram.org`;
  остальные `http/https/mailto` ссылки открываются в системном браузере, любые другие схемы
  (`file:`, `javascript:` и т.п.) игнорируются; `will-navigate`, `will-redirect` и `setWindowOpenHandler` работают по allowlist;
- разрешения (камера/микрофон, уведомления, буфер, полный экран) выдаются только страницам с наших доменов;
  USB/HID/Serial и т.п. запрещены;
- `<webview>` запрещён; в User-Agent убран токен `Electron`.

Allowlist лежит в начале `main.js` (`OWN_HOSTS`, `TELEGRAM_DOMAIN`, `ALLOWED_PERMISSIONS`).
Если домен iframe мини-аппа сменится, поменяйте `OWN_HOSTS`, выпустите новую версию приложения и раздайте её.

## Запуск для разработки

Нужен Node 22+.

```bash
cd apps/desktop
npm install
npm start            # окно с живым сайтом, DevTools доступны в меню Вид
npm test             # смоук-тест через playwright-core (открывает логин-экран, ничего не вводит)
```

Если запуск падает с `Cannot read properties of undefined (reading 'isPackaged')`, в окружении стоит
`ELECTRON_RUN_AS_NODE=1` (так делают некоторые IDE). Запустите так: `env -u ELECTRON_RUN_AS_NODE npm start`.

Иконки (`build/icon.png`, `.ico`, `.icns`) уже лежат в репозитории. Пересобрать: `npm run icons`
(нужны Python 3 и Pillow; `.icns` собирается только на macOS через `iconutil`).

## Сборка локально

```bash
npm run dist:mac      # dmg + zip, arm64 и x64 (на macOS)
npm run dist:win      # NSIS-установщик + portable .exe (x64, на Windows)
npm run dist:linux    # AppImage + deb (x64, на Linux)
npm run dist:mac:dir  # только .app для arm64, быстро, для проверки
```

Результат в `apps/desktop/dist/`. Windows-сборку на Mac собрать нельзя, её собирает CI.

## Сборка и раздача через GitHub Actions

Workflow `.github/workflows/apps-desktop.yml` запускается только:

- вручную (Actions → Desktop app (Electron) → Run workflow): артефакты скачиваются со страницы запуска;
- при пуше тега `desktop-v*`: дополнительно создаётся GitHub Release со всеми файлами.

```bash
git tag desktop-v1.0.0 && git push origin desktop-v1.0.0
```

Версия в имени файлов берётся из `apps/desktop/package.json` (`version`); поднимайте её перед тегом.
Ссылку на релиз раздавайте воркерам: `https://github.com/NYKISSGRM/tweb/releases/latest`
(если репозиторий приватный, релизы видны только участникам; для раздачи наружу нужен публичный репозиторий или отдельный хостинг файлов).

Файлы: `NYKISS-Gram-<версия>-mac-arm64.dmg` (M1/M2/M3/M4), `...-mac-x64.dmg` (Intel),
`NYKISS-Gram-Setup-<версия>-x64.exe` (установщик Windows), `NYKISS-Gram-Portable-<версия>-x64.exe` (без установки),
`.AppImage` и `.deb` для Linux.

## Приложение не подписано: что увидят пользователи

Сертификатов кода пока нет, поэтому ОС предупреждает при первом запуске. Это ожидаемо, а не вирус.

**macOS (Gatekeeper).** Сборка подписана ad-hoc (без Apple Developer ID) и не нотаризована.
Скачанный из интернета dmg/zip при первом открытии покажет «приложение повреждено» или «нельзя проверить разработчика».
1. Перетащить NYKISS Gram в «Программы».
2. Первый раз: правый клик на приложении → «Открыть» → «Открыть». На macOS 15+: попытаться открыть, затем
   Системные настройки → Конфиденциальность и безопасность → внизу «Всё равно открыть».
3. Если пишет «повреждено»: в Терминале `xattr -dr com.apple.quarantine "/Applications/NYKISS Gram.app"`.

**Windows (SmartScreen).** «Windows защитил ваш компьютер»: нажать «Подробнее» → «Выполнить в любом случае».
Антивирусы иногда ругаются на portable `.exe` без подписи; установщик обычно проходит легче.

**Linux.** AppImage: `chmod +x NYKISS-Gram-*.AppImage && ./NYKISS-Gram-*.AppImage`; deb: `sudo apt install ./NYKISS-Gram-*.deb`.

### Что нужно для подписи позже

- macOS: Apple Developer Program ($99/год), сертификат «Developer ID Application» (.p12) и нотаризация
  (App Store Connect API key либо Apple ID + app-specific password). В `package.json` убрать `"identity": "-"`,
  добавить `"hardenedRuntime": true`, `"notarize": true` и положить секреты в GitHub Secrets:
  `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`
  (или `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Из workflow убрать `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.
  Для hardened runtime понадобится entitlements-файл (камера, микрофон, JIT).
- Windows: сертификат подписи кода (OV дешевле, но SmartScreen репутацию набирает не сразу; EV убирает предупреждение сразу)
  либо Azure Trusted Signing. Секреты `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
  (или конфиг `win.azureSignOptions`).

## Как добавить автообновление позже

Сейчас автообновления нет. Когда появится подпись (на macOS автообновление работает только с подписанным приложением):

1. `npm i electron-updater` и в `package.json` добавить `"publish": [{"provider": "github", "owner": "NYKISSGRM", "repo": "tweb"}]`.
2. В `main.js` после `createWindow()`: `require('electron-updater').autoUpdater.checkForUpdatesAndNotify()`.
3. В `files` в `package.json` ничего добавлять не нужно (зависимость подтянется автоматически), в CI сборка с `--publish always` и `GH_TOKEN`
   создаст `latest.yml` / `latest-mac.yml` в релизе (их тоже нужно загружать как asset).
4. Для macOS в таргетах нужен `zip` (он уже есть).

## Известные ограничения

- Демонстрация экрана в звонках не настроена (нет `setDisplayMediaRequestHandler`), в Electron она не заработает без доработки.
- Бейдж непрочитанных в доке/трее не реализован.
- Окна подфреймов (iframe мини-аппа) ограничены только CSP самого сайта; allowlist `will-navigate` действует на главное окно.
