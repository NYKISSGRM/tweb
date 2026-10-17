# NYKISS Gram для Android (APK)

Нативная оболочка: один полноэкранный WebView, который открывает только
`https://nykissgrm.github.io/tweb/`. Без Google Play, раздаётся APK-файлом.

- applicationId: `app.nykiss.gram` (debug-сборка: `app.nykiss.gram.debug`, ставится рядом)
- minSdk 24 (Android 7.0), targetSdk 35
- Чистый Gradle + Java, без npm и Capacitor. Зависимости: androidx core/activity/splashscreen/webkit

## Почему не Capacitor и не TWA

- **TWA** требует `/.well-known/assetlinks.json` в корне `nykissgrm.github.io`, а у нас проектный сайт `/tweb/`.
  Нужен отдельный user-site репозиторий `NYKISSGRM.github.io`, плюс при отсутствии Chrome уходит в
  адресную строку. Взамен TWA даёт веб-уведомления.
- **Capacitor** тянет npm-дерево и плагины ради того, что тут делают 300 строк Java; allowlist и
  обработку разрешений всё равно пришлось бы писать руками.
- **Свой WebView** даёт полный контроль: жёсткий allowlist навигации, разрешения камера/микрофон только для
  нашего origin, обработка «Назад», сплэш, сохранение файлов. Цена: веб-уведомления (Notification/Push)
  в Android WebView не работают.

## Что делает приложение

- Грузит только `https://nykissgrm.github.io/tweb/*`. Любая другая ссылка (http/https, tg://, mailto:, tel:)
  открывается в системном приложении, `intent:`/`file:`/`data:` блокируются. Cleartext запрещён.
- Сессия (localStorage, IndexedDB, cookies, service worker) хранится в данных WebView и переживает перезапуск.
  `allowBackup=false`, облачный бэкап и перенос на другое устройство отключены.
- «Назад»: по истории WebView, на корне: первое нажатие показывает подсказку, второе в течение 2 с закрывает.
- Тёмный сплэш `#070807` с золотой N, окно и WebView тоже `#070807` (нет белой вспышки);
  статус-бар и навигация в тон; клавиатура и вырезы учитываются через insets.
- Выбор файлов (системный пикер), камера и микрофон по разрешению (звонки, кружки, голосовые).
  Разрешения READ_MEDIA_* не нужны: пикер выдаёт доступ к выбранным файлам сам.
- Сохранение файлов из Gram: читается внутри страницы и пишется в `Загрузки/NYKISS Gram` (Android 10+)
  или в папку приложения (Android 7-9). Мост доступен только origin `https://nykissgrm.github.io`.
- Полноэкранное видео, офлайн-заглушка с кнопкой «Повторить», восстановление при падении рендерера.
- Release: WebView debugging выключен, секретов в APK нет.

## Локальная сборка

Нужны JDK 17 и Android SDK (platform 35, build-tools 35.0.0). `ANDROID_HOME` должен указывать на SDK.

```bash
cd apps/android
./gradlew assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Версия: `-PversionName=1.2.3 -PversionCode=7` (по умолчанию `0.0.0-local` / `1`).

Release с подписью локально: создай ключ (ниже), и `./gradlew assembleRelease`
сам подхватит `~/.nykiss-secrets/android/signing.properties`.

Иконки (результат уже закоммичен) пересобираются так: `python3 scripts/gen-icons.py` (нужен Pillow).

## Ключ подписи

> **СДЕЛАЙ РЕЗЕРВНУЮ КОПИЮ КЛЮЧА. Потерял ключ = обновить приложение у воркеров нельзя,
> только удалить и поставить заново (с потерей локальных данных). Ключ нельзя восстановить.**
> Не коммить, не присылай в чаты, не печатай в логи.

```bash
export JAVA_HOME=/путь/к/jdk17          # или keytool в PATH
apps/android/scripts/make-keystore.sh
```

Скрипт создаёт в `~/.nykiss-secrets/android/` (права 600): `nykiss-gram.jks`, `signing.properties`,
`nykiss-gram.jks.b64`. Существующий ключ не перезаписывает. Скопируй папку в менеджер паролей/на зашифрованный диск.

Секреты репозитория (скрипт в конце печатает те же команды):

```bash
gh secret set ANDROID_KEYSTORE_B64 --repo NYKISSGRM/tweb < ~/.nykiss-secrets/android/nykiss-gram.jks.b64
grep '^storePassword=' ~/.nykiss-secrets/android/signing.properties | cut -d= -f2- | tr -d '\n' | gh secret set ANDROID_KEYSTORE_PASSWORD --repo NYKISSGRM/tweb
echo -n nykiss-gram | gh secret set ANDROID_KEY_ALIAS --repo NYKISSGRM/tweb
grep '^keyPassword=' ~/.nykiss-secrets/android/signing.properties | cut -d= -f2- | tr -d '\n' | gh secret set ANDROID_KEY_PASSWORD --repo NYKISSGRM/tweb
```

Без `gh`: GitHub, Settings, Secrets and variables, Actions, New repository secret, значения из тех же файлов.
Нужны все четыре секрета: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Сборка в GitHub Actions

Workflow `.github/workflows/apps-android.yml`. Запускается только вручную (Actions, Android APK, Run workflow)
или пушем тега `android-v*`, на push в master не срабатывает.

```bash
git tag android-v1.0.0 && git push origin android-v1.0.0
```

- Секреты есть: подписанный release `nykiss-gram-1.0.0-release.apk`.
- Секретов нет: debug-APK и предупреждение в логе (приложение `.debug`, обновление поверх боевого не пойдёт).
- Результат: артефакт запуска (30 дней) и, для тега, asset GitHub Release (`.apk` и `.sha256`).
- versionName берётся из тега, versionCode равен номеру запуска workflow (растёт сам). Не удаляй и не пересоздавай
  workflow-файл: номер сбросится, и новая версия не обновится поверх старой.

## Как раздавать

1. Дай ссылку на Release: `https://github.com/NYKISSGRM/tweb/releases/latest` (Release приватного репо
   виден только участникам, для воркеров проще скачать APK и закинуть файл в Telegram).
2. Воркер скачивает APK, открывает, разрешает «Установка из неизвестных источников» для браузера/Telegram.
3. Обновление: ставится поверх при том же ключе и бо́льшем versionCode. Сама страница Gram обновляется
   с Pages без новой сборки APK; APK нужен только при смене оболочки.
4. Проверка целостности: `sha256sum -c nykiss-gram-*.apk.sha256`.

## Структура

```
apps/android/
  app/src/main/java/app/nykiss/gram/MainActivity.java   WebView, allowlist, разрешения, назад, сплэш
  app/src/main/java/app/nykiss/gram/BlobDownloader.java сохранение файлов
  app/src/main/res/                                     иконки, темы, network_security_config
  scripts/make-keystore.sh                              генерация ключа
  scripts/gen-icons.py                                  генерация иконок
  scripts/version.mjs                                   версия для CI
```
