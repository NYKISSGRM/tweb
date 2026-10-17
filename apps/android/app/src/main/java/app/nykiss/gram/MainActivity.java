package app.nykiss.gram;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.List;

/**
 * NYKISS Gram: один полноэкранный WebView, который открывает только наш сайт.
 * Всё остальное (внешние ссылки, tg://, mailto:) уходит в системные приложения.
 */
public class MainActivity extends ComponentActivity {
    static final String APP_HOST = "nykissgrm.github.io";
    static final String APP_PATH_PREFIX = "/tweb";
    static final String APP_URL = "https://" + APP_HOST + APP_PATH_PREFIX + "/";
    private static final long SPLASH_MAX_MS = 6000;
    private static final long BACK_EXIT_WINDOW_MS = 2000;

    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    private volatile boolean firstLoadDone = false;
    private long startedAt;
    private long lastBackAt = 0;

    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;

    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String[]> mediaPermissionLauncher;

    private BlobDownloader downloader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        startedAt = SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(
            () -> !firstLoadDone && SystemClock.uptimeMillis() - startedAt < SPLASH_MAX_MS);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        fileChooserLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileCallback == null) return;
                Uri[] uris = WebChromeClient.FileChooserParams.parseResult(
                    result.getResultCode(), result.getData());
                fileCallback.onReceiveValue(uris);
                fileCallback = null;
            });
        mediaPermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(), result -> finishPermissionRequest());

        setupWindow();
        downloader = new BlobDownloader(this);
        createWebView();
        setupBackHandling();

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            // состояние восстановлено
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private void setupWindow() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.felt_black));
        setContentView(root);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        // Отступы под статус-бар, вырез, навигацию и клавиатуру: страница получает уже готовую область.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.felt_black));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setUserAgentString(s.getUserAgentString() + " NykissGramAndroid/" + BuildConfig.VERSION_NAME);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // Тёмные темы Gram рисует сам; WebView не должен перекрашивать страницу.
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        downloader.attach(webView);
        webView.setDownloadListener(downloader);
        webView.setWebViewClient(new GramClient());
        webView.setWebChromeClient(new GramChromeClient());
    }

    private void setupBackHandling() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customView != null) {
                    hideCustomView();
                } else if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    long now = SystemClock.uptimeMillis();
                    if (now - lastBackAt < BACK_EXIT_WINDOW_MS) {
                        finish();
                    } else {
                        lastBackAt = now;
                        Toast.makeText(MainActivity.this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
                    }
                }
            }
        });
    }

    static boolean isAppUrl(Uri u) {
        if (u == null || !"https".equals(u.getScheme()) || !APP_HOST.equals(u.getHost())) return false;
        String p = u.getPath();
        return p != null && (p.equals(APP_PATH_PREFIX) || p.startsWith(APP_PATH_PREFIX + "/"));
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        boolean allowed = "https".equals(scheme) || "http".equals(scheme) || "tg".equals(scheme)
            || "mailto".equals(scheme) || "tel".equals(scheme);
        if (!allowed) return; // intent:, file:, javascript:, data: и прочее не открываем
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    private class GramClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (isAppUrl(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            firstLoadDone = true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            firstLoadDone = true;
            view.loadDataWithBaseURL(null, OFFLINE_HTML, "text/html", "utf-8", null);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Рендерер убит системой (память): пересоздаём активность, сессия лежит в хранилище WebView.
            root.removeView(view);
            view.destroy();
            recreate();
            return true;
        }
    }

    private class GramChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                fileChooserLauncher.launch(params.createIntent());
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handlePermissionRequest(request));
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback cb) {
            cb.invoke(origin, false, false);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            webView.setVisibility(View.GONE);
            root.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .hide(WindowInsetsCompat.Type.systemBars());
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        webView.setVisibility(View.VISIBLE);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .show(WindowInsetsCompat.Type.systemBars());
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private void handlePermissionRequest(PermissionRequest request) {
        if (!APP_HOST.equals(request.getOrigin().getHost())) {
            request.deny();
            return;
        }
        if (pendingPermission != null) pendingPermission.deny();
        pendingPermission = request;
        List<String> need = new ArrayList<>();
        for (String res : request.getResources()) {
            String perm = null;
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) perm = Manifest.permission.CAMERA;
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) perm = Manifest.permission.RECORD_AUDIO;
            if (perm != null && checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) need.add(perm);
        }
        if (need.isEmpty()) finishPermissionRequest();
        else mediaPermissionLauncher.launch(need.toArray(new String[0]));
    }

    private void finishPermissionRequest() {
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        if (request == null) return;
        List<String> granted = new ArrayList<>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                granted.add(res);
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                granted.add(res);
            }
        }
        if (granted.isEmpty()) request.deny();
        else request.grant(granted.toArray(new String[0]));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        downloader.shutdown();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        super.onDestroy();
    }

    private static final String OFFLINE_HTML =
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;background:#070807;color:#e9e4d4;font-family:sans-serif;display:flex;"
            + "flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center'>"
            + "<div style='font-size:64px;color:#d2a94f;font-weight:700'>N</div>"
            + "<p style='margin:12px 24px'>Нет соединения с NYKISS Gram</p>"
            + "<button onclick=\"location.href='" + APP_URL + "'\" style='background:#d2a94f;color:#070807;"
            + "border:0;border-radius:12px;padding:12px 28px;font-size:16px;font-weight:600'>Повторить</button>";
}
