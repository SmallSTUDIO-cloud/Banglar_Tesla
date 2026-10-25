package com.shostalab.banglartesla;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the bundled Vite production build from APK assets/public/ under
 * https://appassets.androidplatform.net/ completely offline with zero network dependency.
 */
public final class AssetWebViewClient extends WebViewClient {
    public static final String APP_HOST = "appassets.androidplatform.net";
    private final AssetManager assets;

    public AssetWebViewClient(AssetManager assets) {
        this.assets = assets;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request == null) return null;
        Uri url = request.getUrl();
        if (url == null) return null;
        if (!APP_HOST.equals(url.getHost())) return null;

        String path = url.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.isEmpty()) {
            path = "index.html";
        }
        if (path.contains("..")) {
            return notFound();
        }

        String assetPath = "public/" + path;
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://appassets.androidplatform.net");
        headers.put("Cache-Control", "no-cache");

        try {
            InputStream stream = assets.open(assetPath);
            String mime = mimeForPath(path);
            String encoding = isTextMime(mime) ? "UTF-8" : null;
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, stream);
        } catch (IOException ignored) {
            return notFound();
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return true;
        return !APP_HOST.equals(request.getUrl().getHost());
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://appassets.androidplatform.net");
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            headers,
            new ByteArrayInputStream(new byte[0])
        );
    }

    public static String mimeForPath(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    public static boolean isTextMime(String mime) {
        return mime.startsWith("text/")
            || "application/json".equals(mime)
            || "application/manifest+json".equals(mime)
            || "image/svg+xml".equals(mime);
    }
}
