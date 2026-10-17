package app.nykiss.gram;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Точка входа приложения. Открывает Gram в Trusted Web Activity: это сам Chrome без адресной
 * строки, с уведомлениями, нормальными звонками и общей с Chrome сессией. Если на телефоне нет
 * браузера с поддержкой TWA, запускается прежний свой WebView (MainActivity).
 */
public class TwaLaunchActivity extends Activity {
    private TwaLauncher launcher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        launcher = new TwaLauncher(this);
        launcher.launch(
            new TrustedWebActivityIntentBuilder(startUrl(getIntent())),
            null,
            null,
            this::finish,
            (context, twaBuilder, providerPackage, completionCallback) -> {
                context.startActivity(new Intent(context, MainActivity.class).setData(twaBuilder.getUri()));
                if (completionCallback != null) completionCallback.run();
            });
    }

    // Чужие адреса сюда не пускаем: только наш сайт, иначе стартовая страница.
    private static Uri startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null
            && "https".equals(data.getScheme())
            && MainActivity.APP_HOST.equals(data.getHost())
            && data.getPath() != null
            && data.getPath().startsWith(MainActivity.APP_PATH_PREFIX)) {
            return data;
        }
        return Uri.parse(MainActivity.APP_URL);
    }

    @Override
    protected void onDestroy() {
        if (launcher != null) launcher.destroy();
        super.onDestroy();
    }
}
