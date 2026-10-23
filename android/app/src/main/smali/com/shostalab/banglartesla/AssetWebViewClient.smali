.class public final Lcom/shostalab/banglartesla/AssetWebViewClient;
.super Landroid/webkit/WebViewClient;
.source "AssetWebViewClient.java"

.field public static final APP_HOST:Ljava/lang/String; = "appassets.androidplatform.net"
.field private final assets:Landroid/content/res/AssetManager;

.method public constructor <init>(Landroid/content/res/AssetManager;)V
    .locals 0

    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V
    iput-object p1, p0, Lcom/shostalab/banglartesla/AssetWebViewClient;->assets:Landroid/content/res/AssetManager;
    return-void
.end method

.method public shouldInterceptRequest(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Landroid/webkit/WebResourceResponse;
    .locals 8

    const/4 v0, 0x0
    if-nez p2, :cond_req_ok
    return-object v0

    :cond_req_ok
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v1
    if-nez v1, :cond_url_ok
    return-object v0

    :cond_url_ok
    invoke-virtual {v1}, Landroid/net/Uri;->getHost()Ljava/lang/String;
    move-result-object v2
    const-string v3, "appassets.androidplatform.net"
    invoke-virtual {v3, v2}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v2
    if-nez v2, :cond_host_ok
    return-object v0

    :cond_host_ok
    invoke-virtual {v1}, Landroid/net/Uri;->getPath()Ljava/lang/String;
    move-result-object v1
    if-eqz v1, :cond_default_index
    invoke-virtual {v1}, Ljava/lang/String;->isEmpty()Z
    move-result v2
    if-nez v2, :cond_default_index
    const-string v2, "/"
    invoke-virtual {v2, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v2
    if-eqz v2, :cond_strip_loop

    :cond_default_index
    const-string v1, "/index.html"

    :cond_strip_loop
    const-string v2, "/"
    invoke-virtual {v1, v2}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z
    move-result v2
    if-eqz v2, :cond_after_strip
    const/4 v2, 0x1
    invoke-virtual {v1, v2}, Ljava/lang/String;->substring(I)Ljava/lang/String;
    move-result-object v1
    goto :cond_strip_loop

    :cond_after_strip
    invoke-virtual {v1}, Ljava/lang/String;->isEmpty()Z
    move-result v2
    if-eqz v2, :cond_check_traversal
    const-string v1, "index.html"

    :cond_check_traversal
    const-string v2, ".."
    invoke-virtual {v1, v2}, Ljava/lang/String;->contains(Ljava/lang/CharSequence;)Z
    move-result v2
    if-eqz v2, :cond_open_asset
    invoke-static {}, Lcom/shostalab/banglartesla/AssetWebViewClient;->notFound()Landroid/webkit/WebResourceResponse;
    move-result-object v0
    return-object v0

    :cond_open_asset
    new-instance v2, Ljava/lang/StringBuilder;
    invoke-direct {v2}, Ljava/lang/StringBuilder;-><init>()V
    const-string v3, "public/"
    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v2, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v2}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v2

    new-instance v5, Ljava/util/HashMap;
    invoke-direct {v5}, Ljava/util/HashMap;-><init>()V
    const-string v3, "Access-Control-Allow-Origin"
    const-string v4, "https://appassets.androidplatform.net"
    invoke-interface {v5, v3, v4}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;
    const-string v3, "Cache-Control"
    const-string v4, "no-cache"
    invoke-interface {v5, v3, v4}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;

    :try_start_0
    iget-object v3, p0, Lcom/shostalab/banglartesla/AssetWebViewClient;->assets:Landroid/content/res/AssetManager;
    invoke-virtual {v3, v2}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;
    move-result-object v6

    invoke-static {v1}, Lcom/shostalab/banglartesla/AssetWebViewClient;->mimeForPath(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v1

    invoke-static {v1}, Lcom/shostalab/banglartesla/AssetWebViewClient;->isTextMime(Ljava/lang/String;)Z
    move-result v2
    if-eqz v2, :cond_binary_enc
    const-string v2, "UTF-8"
    goto :cond_build_resp

    :cond_binary_enc
    const/4 v2, 0x0

    :cond_build_resp
    new-instance v0, Landroid/webkit/WebResourceResponse;
    const/16 v3, 0xc8
    const-string v4, "OK"
    invoke-direct/range {v0 .. v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V
    :try_end_0
    .catch Ljava/io/IOException; {:try_start_0 .. :try_end_0} :catch_0

    return-object v0

    :catch_0
    move-exception v0
    invoke-static {}, Lcom/shostalab/banglartesla/AssetWebViewClient;->notFound()Landroid/webkit/WebResourceResponse;
    move-result-object v0
    return-object v0
.end method

.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .locals 2

    const/4 v0, 0x1
    if-nez p2, :cond_check_uri
    return v0

    :cond_check_uri
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v1
    if-nez v1, :cond_check_host
    return v0

    :cond_check_host
    invoke-virtual {v1}, Landroid/net/Uri;->getHost()Ljava/lang/String;
    move-result-object v1
    const-string v0, "appassets.androidplatform.net"
    invoke-virtual {v0, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    xor-int/lit8 v0, v0, 0x1
    return v0
.end method

.method private static notFound()Landroid/webkit/WebResourceResponse;
    .locals 7

    new-instance v5, Ljava/util/HashMap;
    invoke-direct {v5}, Ljava/util/HashMap;-><init>()V
    const-string v0, "Access-Control-Allow-Origin"
    const-string v1, "https://appassets.androidplatform.net"
    invoke-interface {v5, v0, v1}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;

    const/4 v0, 0x0
    new-array v0, v0, [B
    new-instance v6, Ljava/io/ByteArrayInputStream;
    invoke-direct {v6, v0}, Ljava/io/ByteArrayInputStream;-><init>([B)V

    new-instance v0, Landroid/webkit/WebResourceResponse;
    const-string v1, "text/plain"
    const-string v2, "UTF-8"
    const/16 v3, 0x194
    const-string v4, "Not Found"
    invoke-direct/range {v0 .. v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V
    return-object v0
.end method

.method public static mimeForPath(Ljava/lang/String;)Ljava/lang/String;
    .locals 2

    sget-object v0, Ljava/util/Locale;->US:Ljava/util/Locale;
    invoke-virtual {p0, v0}, Ljava/lang/String;->toLowerCase(Ljava/util/Locale;)Ljava/lang/String;
    move-result-object v0

    const-string v1, ".html"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-nez v1, :cond_html
    const-string v1, ".htm"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_html
    :cond_html
    const-string v0, "text/html"
    return-object v0

    :cond_not_html
    const-string v1, ".js"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-nez v1, :cond_js
    const-string v1, ".mjs"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_js
    :cond_js
    const-string v0, "text/javascript"
    return-object v0

    :cond_not_js
    const-string v1, ".css"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_css
    const-string v0, "text/css"
    return-object v0

    :cond_not_css
    const-string v1, ".json"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_json
    const-string v0, "application/json"
    return-object v0

    :cond_not_json
    const-string v1, ".webmanifest"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_manifest
    const-string v0, "application/manifest+json"
    return-object v0

    :cond_not_manifest
    const-string v1, ".svg"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_svg
    const-string v0, "image/svg+xml"
    return-object v0

    :cond_not_svg
    const-string v1, ".ttf"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_ttf
    const-string v0, "font/ttf"
    return-object v0

    :cond_not_ttf
    const-string v1, ".woff2"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_woff2
    const-string v0, "font/woff2"
    return-object v0

    :cond_not_woff2
    const-string v1, ".png"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_png
    const-string v0, "image/png"
    return-object v0

    :cond_not_png
    const-string v1, ".jpg"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-nez v1, :cond_jpg
    const-string v1, ".jpeg"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_jpg
    :cond_jpg
    const-string v0, "image/jpeg"
    return-object v0

    :cond_not_jpg
    const-string v1, ".webp"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_webp
    const-string v0, "image/webp"
    return-object v0

    :cond_not_webp
    const-string v1, ".mp3"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_mp3
    const-string v0, "audio/mpeg"
    return-object v0

    :cond_not_mp3
    const-string v1, ".ogg"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_not_ogg
    const-string v0, "audio/ogg"
    return-object v0

    :cond_not_ogg
    const-string v1, ".wav"
    invoke-virtual {v0, v1}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :cond_default_bin
    const-string v0, "audio/wav"
    return-object v0

    :cond_default_bin
    const-string v0, "application/octet-stream"
    return-object v0
.end method

.method public static isTextMime(Ljava/lang/String;)Z
    .locals 2

    const-string v0, "text/"
    invoke-virtual {p0, v0}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z
    move-result v0
    const/4 v1, 0x1
    if-eqz v0, :cond_check_json
    return v1

    :cond_check_json
    const-string v0, "application/json"
    invoke-virtual {v0, p0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-eqz v0, :cond_check_manifest
    return v1

    :cond_check_manifest
    const-string v0, "application/manifest+json"
    invoke-virtual {v0, p0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-eqz v0, :cond_check_svg
    return v1

    :cond_check_svg
    const-string v0, "image/svg+xml"
    invoke-virtual {v0, p0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    return v0
.end method
