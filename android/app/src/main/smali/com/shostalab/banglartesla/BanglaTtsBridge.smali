.class public final Lcom/shostalab/banglartesla/BanglaTtsBridge;
.super Ljava/lang/Object;
.source "BanglaTtsBridge.java"

# interfaces
.implements Landroid/speech/tts/TextToSpeech$OnInitListener;

# instance fields
.field private final utteranceSeq:Ljava/util/concurrent/atomic/AtomicInteger;
.field private volatile tts:Landroid/speech/tts/TextToSpeech;
.field private volatile bengaliReady:Z
.field private volatile shutDown:Z

# direct methods
.method public constructor <init>(Landroid/content/Context;)V
    .locals 3

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    new-instance v0, Ljava/util/concurrent/atomic/AtomicInteger;
    const/4 v1, 0x0
    invoke-direct {v0, v1}, Ljava/util/concurrent/atomic/AtomicInteger;-><init>(I)V
    iput-object v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->utteranceSeq:Ljava/util/concurrent/atomic/AtomicInteger;

    iput-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    iput-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->shutDown:Z

    :try_start_init
    invoke-virtual {p1}, Landroid/content/Context;->getApplicationContext()Landroid/content/Context;
    move-result-object v0
    new-instance v2, Landroid/speech/tts/TextToSpeech;
    invoke-direct {v2, v0, p0}, Landroid/speech/tts/TextToSpeech;-><init>(Landroid/content/Context;Landroid/speech/tts/TextToSpeech$OnInitListener;)V
    iput-object v2, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    :try_end_init
    .catch Ljava/lang/Throwable; {:try_start_init .. :try_end_init} :catch_init
    return-void

    :catch_init
    move-exception v0
    const/4 v0, 0x0
    iput-object v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    iput-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    return-void
.end method

.method private tryEnableLocale(Landroid/speech/tts/TextToSpeech;Ljava/util/Locale;)Z
    .locals 4

    const/4 v0, 0x0
    if-eqz p2, :cond_fail

    :try_start_loc
    invoke-virtual {p1, p2}, Landroid/speech/tts/TextToSpeech;->isLanguageAvailable(Ljava/util/Locale;)I
    move-result v1
    if-ltz v1, :cond_fail

    invoke-virtual {p1, p2}, Landroid/speech/tts/TextToSpeech;->setLanguage(Ljava/util/Locale;)I
    move-result v1
    if-ltz v1, :cond_fail

    invoke-virtual {p1}, Landroid/speech/tts/TextToSpeech;->getVoice()Landroid/speech/tts/Voice;
    move-result-object v1
    if-eqz v1, :cond_fail

    invoke-virtual {v1}, Landroid/speech/tts/Voice;->getLocale()Ljava/util/Locale;
    move-result-object v2
    if-eqz v2, :cond_fail

    invoke-virtual {v2}, Ljava/util/Locale;->getLanguage()Ljava/lang/String;
    move-result-object v2
    const-string v3, "bn"
    invoke-virtual {v3, v2}, Ljava/lang/String;->equalsIgnoreCase(Ljava/lang/String;)Z
    move-result v3
    if-nez v3, :cond_lang_ok

    const-string v3, "ben"
    invoke-virtual {v3, v2}, Ljava/lang/String;->equalsIgnoreCase(Ljava/lang/String;)Z
    move-result v3
    if-eqz v3, :cond_fail

    :cond_lang_ok
    invoke-virtual {v1}, Landroid/speech/tts/Voice;->getFeatures()Ljava/util/Set;
    move-result-object v2
    if-eqz v2, :cond_feat_ok

    const-string v3, "notInstalled"
    invoke-interface {v2, v3}, Ljava/util/Set;->contains(Ljava/lang/Object;)Z
    move-result v2
    if-nez v2, :cond_fail

    :cond_feat_ok
    :try_end_loc
    .catch Ljava/lang/Throwable; {:try_start_loc .. :try_end_loc} :catch_loc

    const/4 v0, 0x1
    return v0

    :catch_loc
    move-exception v1

    :cond_fail
    return v0
.end method

# virtual methods
.method public onInit(I)V
    .locals 4

    const/4 v0, 0x0
    iget-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->shutDown:Z
    if-nez v1, :cond_not_ready

    iget-object v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    if-eqz v1, :cond_not_ready
    if-nez p1, :cond_not_ready

    const-string v2, "bn-BD"
    invoke-static {v2}, Ljava/util/Locale;->forLanguageTag(Ljava/lang/String;)Ljava/util/Locale;
    move-result-object v2
    invoke-direct {p0, v1, v2}, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tryEnableLocale(Landroid/speech/tts/TextToSpeech;Ljava/util/Locale;)Z
    move-result v2
    if-eqz v2, :cond_try_in

    const/4 v0, 0x1
    iput-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    return-void

    :cond_try_in
    const-string v2, "bn-IN"
    invoke-static {v2}, Ljava/util/Locale;->forLanguageTag(Ljava/lang/String;)Ljava/util/Locale;
    move-result-object v2
    invoke-direct {p0, v1, v2}, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tryEnableLocale(Landroid/speech/tts/TextToSpeech;Ljava/util/Locale;)Z
    move-result v2
    if-eqz v2, :cond_try_bn

    const/4 v0, 0x1
    iput-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    return-void

    :cond_try_bn
    new-instance v2, Ljava/util/Locale;
    const-string v3, "bn"
    invoke-direct {v2, v3}, Ljava/util/Locale;-><init>(Ljava/lang/String;)V
    invoke-direct {p0, v1, v2}, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tryEnableLocale(Landroid/speech/tts/TextToSpeech;Ljava/util/Locale;)Z
    move-result v2
    if-eqz v2, :cond_not_ready

    const/4 v0, 0x1
    iput-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    return-void

    :cond_not_ready
    iput-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    return-void
.end method

.method public isBengaliAvailable()Z
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v0, 0x0
    iget-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->shutDown:Z
    if-nez v1, :cond_ret
    iget-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    if-eqz v1, :cond_ret
    iget-object v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    if-eqz v1, :cond_ret
    const/4 v0, 0x1

    :cond_ret
    return v0
.end method

.method public speak(Ljava/lang/String;FFF)Z
    .locals 6
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v0, 0x0
    iget-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->shutDown:Z
    if-nez v1, :cond_fail
    iget-boolean v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z
    if-eqz v1, :cond_fail
    iget-object v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    if-eqz v1, :cond_fail
    if-eqz p1, :cond_fail

    invoke-virtual {p1}, Ljava/lang/String;->isEmpty()Z
    move-result v2
    if-nez v2, :cond_fail

    const v2, 0x3f19999a    # 0.6f
    invoke-static {v2, p2}, Ljava/lang/Math;->max(FF)F
    move-result v2
    const/high16 v3, 0x3fc00000    # 1.5f
    invoke-static {v3, v2}, Ljava/lang/Math;->min(FF)F
    move-result v2

    const v3, 0x3f333333    # 0.7f
    invoke-static {v3, p3}, Ljava/lang/Math;->max(FF)F
    move-result v3
    const v4, 0x3fb33333    # 1.4f
    invoke-static {v4, v3}, Ljava/lang/Math;->min(FF)F
    move-result v3

    const/4 v4, 0x0
    invoke-static {v4, p4}, Ljava/lang/Math;->max(FF)F
    move-result v4
    const/high16 v5, 0x3f800000    # 1.0f
    invoke-static {v5, v4}, Ljava/lang/Math;->min(FF)F
    move-result v4

    :try_start_spk
    invoke-virtual {v1, v2}, Landroid/speech/tts/TextToSpeech;->setPitch(F)I
    invoke-virtual {v1, v3}, Landroid/speech/tts/TextToSpeech;->setSpeechRate(F)I

    new-instance v2, Landroid/os/Bundle;
    invoke-direct {v2}, Landroid/os/Bundle;-><init>()V
    const-string v3, "volume"
    invoke-virtual {v2, v3, v4}, Landroid/os/Bundle;->putFloat(Ljava/lang/String;F)V

    iget-object v3, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->utteranceSeq:Ljava/util/concurrent/atomic/AtomicInteger;
    invoke-virtual {v3}, Ljava/util/concurrent/atomic/AtomicInteger;->incrementAndGet()I
    move-result v3
    invoke-static {v3}, Ljava/lang/String;->valueOf(I)Ljava/lang/String;
    move-result-object v3

    invoke-virtual {v1, p1, v0, v2, v3}, Landroid/speech/tts/TextToSpeech;->speak(Ljava/lang/CharSequence;ILandroid/os/Bundle;Ljava/lang/String;)I
    move-result v1
    :try_end_spk
    .catch Ljava/lang/Throwable; {:try_start_spk .. :try_end_spk} :catch_spk

    if-nez v1, :cond_fail
    const/4 v0, 0x1
    return v0

    :catch_spk
    move-exception v1

    :cond_fail
    return v0
.end method

.method public stop()V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->shutDown:Z
    if-nez v0, :cond_done
    iget-object v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    if-eqz v0, :cond_done

    :try_start_stp
    invoke-virtual {v0}, Landroid/speech/tts/TextToSpeech;->stop()I
    :try_end_stp
    .catch Ljava/lang/Throwable; {:try_start_stp .. :try_end_stp} :catch_stp
    return-void

    :catch_stp
    move-exception v1

    :cond_done
    return-void
.end method

.method public shutdown()V
    .locals 2

    const/4 v0, 0x1
    iput-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->shutDown:Z
    const/4 v0, 0x0
    iput-boolean v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->bengaliReady:Z

    iget-object v0, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    const/4 v1, 0x0
    iput-object v1, p0, Lcom/shostalab/banglartesla/BanglaTtsBridge;->tts:Landroid/speech/tts/TextToSpeech;
    if-eqz v0, :cond_done

    :try_start_sh1
    invoke-virtual {v0}, Landroid/speech/tts/TextToSpeech;->stop()I
    :try_end_sh1
    .catch Ljava/lang/Throwable; {:try_start_sh1 .. :try_end_sh1} :catch_sh1
    goto :after_stop

    :catch_sh1
    move-exception v1

    :after_stop
    :try_start_sh2
    invoke-virtual {v0}, Landroid/speech/tts/TextToSpeech;->shutdown()V
    :try_end_sh2
    .catch Ljava/lang/Throwable; {:try_start_sh2 .. :try_end_sh2} :catch_sh2
    return-void

    :catch_sh2
    move-exception v1

    :cond_done
    return-void
.end method
