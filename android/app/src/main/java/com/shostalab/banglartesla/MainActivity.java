package com.shostalab.banglartesla;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * Fullscreen landscape Android host for Banglar Tesla — বাংলার টেসলা.
 */
public final class MainActivity extends Activity {
    private static final String ENTRY_URL = "https://appassets.androidplatform.net/index.html";
    private static final int IMMERSIVE_FLAGS =
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;

    private WebView webView;
    private BanglaTtsBridge ttsBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        applyImmersiveFullscreen();

        WebView wv = new WebView(this);
        wv.setBackgroundColor(0xFF08110F);

        WebSettings settings = wv.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);

        wv.setWebViewClient(new AssetWebViewClient(getAssets()));
        wv.setWebChromeClient(new WebChromeClient());

        BanglaTtsBridge bridge = new BanglaTtsBridge(this);
        this.ttsBridge = bridge;
        wv.addJavascriptInterface(bridge, "__btAndroidTts");

        this.webView = wv;
        setContentView(wv);
        wv.loadUrl(ENTRY_URL);
    }

    private void applyImmersiveFullscreen() {
        Window window = getWindow();
        if (window == null) return;
        View decor = window.getDecorView();
        if (decor != null) {
            decor.setSystemUiVisibility(IMMERSIVE_FLAGS);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveFullscreen();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveFullscreen();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        if (ttsBridge != null) {
            ttsBridge.stop();
        }
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return !!(window.__banglarTeslaAndroidBack&&window.__banglarTeslaAndroidBack());}catch(e){return false;}})()",
            new BackCallback(this)
        );
    }

    @Override
    protected void onDestroy() {
        if (ttsBridge != null) {
            ttsBridge.shutdown();
            ttsBridge = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("__btAndroidTts");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    static final class BackCallback implements ValueCallback<String> {
        private final MainActivity activity;

        BackCallback(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onReceiveValue(String value) {
            if (!"true".equals(value)) {
                activity.finish();
            }
        }
    }
}
