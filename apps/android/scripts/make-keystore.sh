#!/usr/bin/env bash
# Генерирует ключ подписи Android-APK NYKISS Gram локально.
# Файлы кладёт в ~/.nykiss-secrets/android/ с правами 600. Пароли НЕ печатает.
# Нужен keytool (из JDK 17+: JAVA_HOME или PATH) и openssl.
set -euo pipefail

DIR="${NYKISS_SECRETS_DIR:-$HOME/.nykiss-secrets/android}"
KEYSTORE="$DIR/nykiss-gram.jks"
PROPS="$DIR/signing.properties"
B64="$DIR/nykiss-gram.jks.b64"
ALIAS="nykiss-gram"

if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  KEYTOOL="$JAVA_HOME/bin/keytool"
elif command -v keytool >/dev/null 2>&1 && keytool -help >/dev/null 2>&1; then
  KEYTOOL="$(command -v keytool)"
else
  echo "keytool не найден. Поставь JDK 17 или укажи JAVA_HOME." >&2
  exit 1
fi

if [ -e "$KEYSTORE" ]; then
  echo "Ключ уже существует: $KEYSTORE" >&2
  echo "Не перезаписываю: новый ключ = приложение нельзя будет обновлять поверх." >&2
  exit 1
fi

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

# PKCS12 требует одинаковый пароль хранилища и ключа.
PASS="$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-28)"

"$KEYTOOL" -genkeypair -v \
  -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=NYKISS Gram, O=NYKISS, C=PL" >/dev/null

cat > "$PROPS" <<PROPS_EOF
storeFile=$KEYSTORE
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
PROPS_EOF

base64 < "$KEYSTORE" | tr -d '\n' > "$B64"
chmod 600 "$KEYSTORE" "$PROPS" "$B64"

echo "Готово. Файлы (права 600) в $DIR:"
echo "  nykiss-gram.jks        сам ключ"
echo "  signing.properties     пароли (Gradle подхватывает автоматически для локальной release-сборки)"
echo "  nykiss-gram.jks.b64    ключ в base64 для секрета GitHub"
echo
echo "SHA-256 отпечаток сертификата (не секрет):"
"$KEYTOOL" -list -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$PASS" 2>/dev/null | grep -i "SHA-256\|SHA256" || true
echo
echo "!!! СДЕЛАЙ РЕЗЕРВНУЮ КОПИЮ папки $DIR (менеджер паролей / зашифрованный диск)."
echo "!!! Потерял ключ = больше нельзя обновить приложение у воркеров, только переустановка."
echo
if command -v gh >/dev/null 2>&1; then
  echo "Положить в секреты репозитория (значения не печатаются):"
  echo "  gh secret set ANDROID_KEYSTORE_B64 --repo NYKISSGRM/tweb < $B64"
  echo "  grep '^storePassword=' $PROPS | cut -d= -f2- | tr -d '\\n' | gh secret set ANDROID_KEYSTORE_PASSWORD --repo NYKISSGRM/tweb"
  echo "  echo -n $ALIAS | gh secret set ANDROID_KEY_ALIAS --repo NYKISSGRM/tweb"
  echo "  grep '^keyPassword=' $PROPS | cut -d= -f2- | tr -d '\\n' | gh secret set ANDROID_KEY_PASSWORD --repo NYKISSGRM/tweb"
else
  echo "gh не найден: добавь секреты вручную (GitHub -> Settings -> Secrets and variables -> Actions),"
  echo "значения бери из файлов в $DIR."
fi
