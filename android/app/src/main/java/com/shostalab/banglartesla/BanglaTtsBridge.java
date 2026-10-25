package com.shostalab.banglartesla;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Offline native Android TextToSpeech bridge (`window.__btAndroidTts`) for Bangla dialogue.
 *
 * Strictly verifies that an actual Bengali (`bn-BD` / `bn-IN` / `bn`) voice pack is available
 * on the device before reporting `isBengaliAvailable() == true`. If Bengali voice data is
 * missing (`LANG_MISSING_DATA` or `LANG_NOT_SUPPORTED`), returns `false` so the WebView
 * cleanly falls back to browser `bn-*` SpeechSynthesis or bundled vocal clips + Bangla subtitles.
 */
public final class BanglaTtsBridge implements TextToSpeech.OnInitListener {
    private final AtomicInteger utteranceSeq = new AtomicInteger(0);
    private volatile TextToSpeech tts;
    private volatile boolean bengaliReady = false;
    private volatile boolean shutDown = false;

    public BanglaTtsBridge(Context context) {
        try {
            this.tts = new TextToSpeech(context.getApplicationContext(), this);
        } catch (Throwable ignored) {
            this.tts = null;
            this.bengaliReady = false;
        }
    }

    @Override
    public void onInit(int status) {
        TextToSpeech engine = this.tts;
        if (shutDown || engine == null || status != TextToSpeech.SUCCESS) {
            this.bengaliReady = false;
            return;
        }

        Locale[] candidates = new Locale[] {
            Locale.forLanguageTag("bn-BD"),
            Locale.forLanguageTag("bn-IN"),
            new Locale("bn")
        };

        for (Locale loc : candidates) {
            try {
                int avail = engine.isLanguageAvailable(loc);
                if (avail >= TextToSpeech.LANG_AVAILABLE) {
                    int setRes = engine.setLanguage(loc);
                    if (setRes >= TextToSpeech.LANG_AVAILABLE) {
                        this.bengaliReady = true;
                        return;
                    }
                }
            } catch (Throwable ignored) {
                // Continue trying fallback Bengali locale variants
            }
        }
        this.bengaliReady = false;
    }

    @JavascriptInterface
    public boolean isBengaliAvailable() {
        return !shutDown && bengaliReady && tts != null;
    }

    @JavascriptInterface
    public boolean speak(String text, float pitch, float rate, float volume) {
        TextToSpeech engine = this.tts;
        if (shutDown || !bengaliReady || engine == null || text == null || text.isEmpty()) {
            return false;
        }
        float safePitch = Math.max(0.6f, Math.min(1.5f, pitch));
        float safeRate = Math.max(0.7f, Math.min(1.4f, rate));
        float safeVol = Math.max(0.0f, Math.min(1.0f, volume));
        try {
            engine.setPitch(safePitch);
            engine.setSpeechRate(safeRate);
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, safeVol);
            String utteranceId = "bt_bn_" + utteranceSeq.incrementAndGet();
            int res = engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            return res == TextToSpeech.SUCCESS;
        } catch (Throwable ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public void stop() {
        TextToSpeech engine = this.tts;
        if (engine == null || shutDown) return;
        try {
            engine.stop();
        } catch (Throwable ignored) {
            // Ignore transient TTS binder state
        }
    }

    public void shutdown() {
        shutDown = true;
        bengaliReady = false;
        TextToSpeech engine = this.tts;
        this.tts = null;
        if (engine != null) {
            try {
                engine.stop();
            } catch (Throwable ignored) {
                // Ignore
            }
            try {
                engine.shutdown();
            } catch (Throwable ignored) {
                // Ignore
            }
        }
    }
}
