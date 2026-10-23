.class public final Lcom/shostalab/banglartesla/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

.field private static final ENTRY_URL:Ljava/lang/String; = "https://appassets.androidplatform.net/index.html"
.field private static final IMMERSIVE_FLAGS:I = 0x1706
.field private webView:Landroid/webkit/WebView;

.method public constructor <init>()V
    .locals 0

    invoke-direct {p0}, Landroid/app/Activity;-><init>()V
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 5

    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    invoke-virtual {p0}, Lcom/shostalab/banglartesla/MainActivity;->getWindow()Landroid/view/Window;
    move-result-object v0
    if-eqz v0, :cond_after_keep_on
    const/16 v1, 0x80
    invoke-virtual {v0, v1}, Landroid/view/Window;->addFlags(I)V

    :cond_after_keep_on
    invoke-direct {p0}, Lcom/shostalab/banglartesla/MainActivity;->applyImmersiveFullscreen()V

    new-instance v0, Landroid/webkit/WebView;
    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    const v1, -0xf7eef1
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;
    move-result-object v1
    const/4 v2, 0x1
    const/4 v3, 0x0

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDatabaseEnabled(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setAllowContentAccess(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setSupportZoom(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setBuiltInZoomControls(Z)V
    invoke-virtual {v1, v3}, Landroid/webkit/WebSettings;->setDisplayZoomControls(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setUseWideViewPort(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setLoadWithOverviewMode(Z)V
    const/16 v4, 0x64
    invoke-virtual {v1, v4}, Landroid/webkit/WebSettings;->setTextZoom(I)V

    new-instance v1, Lcom/shostalab/banglartesla/AssetWebViewClient;
    invoke-virtual {p0}, Lcom/shostalab/banglartesla/MainActivity;->getAssets()Landroid/content/res/AssetManager;
    move-result-object v2
    invoke-direct {v1, v2}, Lcom/shostalab/banglartesla/AssetWebViewClient;-><init>(Landroid/content/res/AssetManager;)V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    new-instance v1, Landroid/webkit/WebChromeClient;
    invoke-direct {v1}, Landroid/webkit/WebChromeClient;-><init>()V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    iput-object v0, p0, Lcom/shostalab/banglartesla/MainActivity;->webView:Landroid/webkit/WebView;
    invoke-virtual {p0, v0}, Lcom/shostalab/banglartesla/MainActivity;->setContentView(Landroid/view/View;)V

    const-string v1, "https://appassets.androidplatform.net/index.html"
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    return-void
.end method

.method private applyImmersiveFullscreen()V
    .locals 2

    invoke-virtual {p0}, Lcom/shostalab/banglartesla/MainActivity;->getWindow()Landroid/view/Window;
    move-result-object v0
    if-nez v0, :cond_has_win
    return-void

    :cond_has_win
    invoke-virtual {v0}, Landroid/view/Window;->getDecorView()Landroid/view/View;
    move-result-object v0
    if-eqz v0, :cond_done
    const/16 v1, 0x1706
    invoke-virtual {v0, v1}, Landroid/view/View;->setSystemUiVisibility(I)V

    :cond_done
    return-void
.end method

.method public onWindowFocusChanged(Z)V
    .locals 0

    invoke-super {p0, p1}, Landroid/app/Activity;->onWindowFocusChanged(Z)V
    if-eqz p1, :cond_done
    invoke-direct {p0}, Lcom/shostalab/banglartesla/MainActivity;->applyImmersiveFullscreen()V

    :cond_done
    return-void
.end method

.method protected onResume()V
    .locals 1

    invoke-super {p0}, Landroid/app/Activity;->onResume()V
    invoke-direct {p0}, Lcom/shostalab/banglartesla/MainActivity;->applyImmersiveFullscreen()V
    iget-object v0, p0, Lcom/shostalab/banglartesla/MainActivity;->webView:Landroid/webkit/WebView;
    if-eqz v0, :cond_done
    invoke-virtual {v0}, Landroid/webkit/WebView;->onResume()V
    invoke-virtual {v0}, Landroid/webkit/WebView;->resumeTimers()V

    :cond_done
    return-void
.end method

.method protected onPause()V
    .locals 1

    iget-object v0, p0, Lcom/shostalab/banglartesla/MainActivity;->webView:Landroid/webkit/WebView;
    if-eqz v0, :cond_super
    invoke-virtual {v0}, Landroid/webkit/WebView;->onPause()V

    :cond_super
    invoke-super {p0}, Landroid/app/Activity;->onPause()V
    return-void
.end method

.method public onBackPressed()V
    .locals 3

    iget-object v0, p0, Lcom/shostalab/banglartesla/MainActivity;->webView:Landroid/webkit/WebView;
    if-nez v0, :cond_eval
    invoke-super {p0}, Landroid/app/Activity;->onBackPressed()V
    return-void

    :cond_eval
    const-string v1, "(function(){try{return !!(window.__banglarTeslaAndroidBack&&window.__banglarTeslaAndroidBack());}catch(e){return false;}})()"
    new-instance v2, Lcom/shostalab/banglartesla/MainActivity$BackCallback;
    invoke-direct {v2, p0}, Lcom/shostalab/banglartesla/MainActivity$BackCallback;-><init>(Lcom/shostalab/banglartesla/MainActivity;)V
    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V
    return-void
.end method

.method protected onDestroy()V
    .locals 2

    iget-object v0, p0, Lcom/shostalab/banglartesla/MainActivity;->webView:Landroid/webkit/WebView;
    if-eqz v0, :cond_super
    invoke-virtual {v0}, Landroid/webkit/WebView;->destroy()V
    const/4 v1, 0x0
    iput-object v1, p0, Lcom/shostalab/banglartesla/MainActivity;->webView:Landroid/webkit/WebView;

    :cond_super
    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V
    return-void
.end method
