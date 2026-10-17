package app.nykiss.gram;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Скачивание файлов из Gram. Сам Gram отдаёт файлы через blob:/service worker, поэтому обычный
 * DownloadManager тут не работает: файл читается внутри страницы (fetch) и кусками
 * по 768 КБ передаётся в приложение через WebMessageListener, доступный только нашему origin.
 */
class BlobDownloader implements DownloadListener {
    private static final String BRIDGE = "NykissAndroid";
    private static final long MAX_BYTES = 2L * 1024 * 1024 * 1024;

    private final MainActivity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Map<String, Sink> sinks = new HashMap<>();
    private WebView webView;

    BlobDownloader(MainActivity activity) {
        this.activity = activity;
    }

    void attach(WebView view) {
        webView = view;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view, BRIDGE,
                Collections.singleton("https://" + MainActivity.APP_HOST), this::onMessage);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // Запоминаем имя из <a download="...">: blob-ссылка само имя не несёт.
            String js = "(function(){var o=HTMLAnchorElement.prototype.click;"
                + "HTMLAnchorElement.prototype.click=function(){"
                + "if(this.download)window.__nykissDlName=this.download;return o.apply(this,arguments)};"
                + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&"
                + "e.target.closest('a[download]');if(a)window.__nykissDlName=a.download},true)})();";
            WebViewCompat.addDocumentStartJavaScript(view, js,
                Collections.singleton("https://" + MainActivity.APP_HOST));
        }
    }

    @Override
    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mime, long length) {
        Uri uri = Uri.parse(url);
        boolean viaPage = url.startsWith("blob:") || MainActivity.isAppUrl(uri);
        if (!viaPage || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            if (url.startsWith("http")) {
                try {
                    activity.startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    toast(activity.getString(R.string.download_failed));
                }
            }
            return;
        }
        String guessed = URLUtil.guessFileName(url, contentDisposition, mime);
        String id = Long.toHexString(System.nanoTime());
        String js = "(async function(url,fallback,mime,id){var P=" + BRIDGE + ";"
            + "function send(o){o.id=id;P.postMessage(JSON.stringify(o))}"
            + "try{var r=await fetch(url);var b=await r.blob();"
            + "var name=window.__nykissDlName||fallback;window.__nykissDlName=null;"
            + "send({t:'start',name:name,mime:b.type||mime,size:b.size});"
            + "var CH=786432;for(var o=0;o<b.size;o+=CH){"
            + "var d=await new Promise(function(res,rej){var f=new FileReader();"
            + "f.onload=function(){var s=f.result;res(s.substring(s.indexOf(',')+1))};"
            + "f.onerror=rej;f.readAsDataURL(b.slice(o,o+CH))});send({t:'chunk',data:d})}"
            + "send({t:'end'})}catch(e){send({t:'error',msg:String(e)})}})("
            + JSONObject.quote(url) + "," + JSONObject.quote(guessed) + ","
            + JSONObject.quote(mime == null ? "" : mime) + "," + JSONObject.quote(id) + ");";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin,
                           boolean isMainFrame, JavaScriptReplyProxy reply) {
        if (!isMainFrame || message.getData() == null) return;
        final String raw = message.getData();
        io.execute(() -> {
            try {
                JSONObject m = new JSONObject(raw);
                String id = m.getString("id");
                switch (m.getString("t")) {
                    case "start": {
                        long size = m.optLong("size", 0);
                        if (size > MAX_BYTES) throw new IllegalStateException("too big");
                        sinks.put(id, new Sink(activity, m.optString("name", "gram-file"), m.optString("mime", "")));
                        break;
                    }
                    case "chunk": {
                        Sink s = sinks.get(id);
                        if (s != null) s.write(Base64.decode(m.getString("data"), Base64.DEFAULT));
                        break;
                    }
                    case "end": {
                        Sink s = sinks.remove(id);
                        if (s != null) {
                            s.finish();
                            toast(activity.getString(R.string.download_saved, s.name));
                        }
                        break;
                    }
                    default: {
                        Sink s = sinks.remove(id);
                        if (s != null) s.abort();
                        toast(activity.getString(R.string.download_failed));
                    }
                }
            } catch (Exception e) {
                toast(activity.getString(R.string.download_failed));
            }
        });
    }

    private void toast(String text) {
        activity.runOnUiThread(() -> Toast.makeText(activity, text, Toast.LENGTH_LONG).show());
    }

    void shutdown() {
        io.shutdownNow();
    }

    /** Запись в «Загрузки» (MediaStore на Android 10+, папка приложения на 7-9, разрешения не нужны). */
    private static class Sink {
        final String name;
        private final OutputStream out;
        private final ContentResolver resolver;
        private final Uri mediaUri;
        private File file;

        Sink(MainActivity a, String rawName, String mime) throws Exception {
            String safe = rawName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (safe.isEmpty()) safe = "gram-file";
            name = safe;
            resolver = a.getContentResolver();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                if (!mime.isEmpty()) v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/NYKISS Gram");
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                mediaUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (mediaUri == null) throw new IllegalStateException("insert failed");
                out = resolver.openOutputStream(mediaUri);
            } else {
                mediaUri = null;
                File dir = a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                file = new File(dir, safe);
                out = new FileOutputStream(file);
            }
        }

        void write(byte[] b) throws Exception {
            out.write(b);
        }

        void finish() throws Exception {
            out.close();
            if (mediaUri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(mediaUri, v, null, null);
            }
        }

        void abort() {
            try {
                out.close();
            } catch (Exception ignored) {
            }
            if (mediaUri != null) resolver.delete(mediaUri, null, null);
            else if (file != null) file.delete();
        }
    }
}
