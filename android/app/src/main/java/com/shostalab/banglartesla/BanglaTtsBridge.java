package com.shostalab.banglartesla;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import java.util.Locale;
import java.util.Set;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Offline native Android TextToSpeech bridge (`window.__btAndroidTts`) for Bangla dialogue.
 *
 * Strictly verifies that an actual installed Bengali (`bn-BD` -> `bn-IN` -> `bn`) `Voice`
 * (without `KEY_FEATURE_NOT_INSTALLED` and never an `en` fallback voice) is active on the
 * device before reporting `isBengaliAvailable() == true`. If Bengali voice data is missing
 * or uninstalled, returns `false` so the WebView immediately plays the bundled offline
 * Bengali phonetic WAV clip + Bangla subtitles.
 */
public final class BanglaTtsBridge implements TextToSpeech.OnInitListener {
    private final AtomicInteger utteranceSeq = new AtomicInteger(0);
    private volatile TextToSpeech tts;
    private volatile boolean bengaliReady = false;
    private volatile boolean shutDown = false;
    private volatile Voice defaultBengaliVoice;
    private volatile List<Voice> bengaliVoices = Collections.emptyList();

    public BanglaTtsBridge(Context context) {
        try {
            this.tts = new TextToSpeech(context.getApplicationContext(), this);
        } catch (Throwable ignored) {
            this.tts = null;
            this.bengaliReady = false;
        }
    }

    private boolean tryEnableLocale(TextToSpeech engine, Locale loc) {
        if (loc == null) return false;
        try {
            int avail = engine.isLanguageAvailable(loc);
            if (avail < TextToSpeech.LANG_AVAILABLE) return false;
            int setRes = engine.setLanguage(loc);
            if (setRes < TextToSpeech.LANG_AVAILABLE) return false;

            Voice v = engine.getVoice();
            if (v == null) return false;
            Locale vLoc = v.getLocale();
            if (vLoc == null) return false;
            String lang = vLoc.getLanguage();
            if (!"bn".equalsIgnoreCase(lang) && !"ben".equalsIgnoreCase(lang)) {
                return false;
            }
            Set<String> features = v.getFeatures();
            if (v.isNetworkConnectionRequired() ||
                (features != null && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) {
                return false;
            }
            defaultBengaliVoice = v;
            List<Voice> voices = new ArrayList<>();
            Set<Voice> installed = engine.getVoices();
            if (installed != null) for (Voice voice : installed) {
                Locale locale = voice.getLocale();
                Set<String> installedFeatures = voice.getFeatures();
                if (locale != null && ("bn".equalsIgnoreCase(locale.getLanguage()) || "ben".equalsIgnoreCase(locale.getLanguage())) &&
                    !voice.isNetworkConnectionRequired() &&
                    (installedFeatures == null || !installedFeatures.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) {
                    voices.add(voice);
                }
            }
            Collections.sort(voices, Comparator.comparing(Voice::getName));
            bengaliVoices = voices;
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    @Override
    public void onInit(int status) {
        TextToSpeech engine = this.tts;
        if (shutDown || engine == null || status != TextToSpeech.SUCCESS) {
            this.bengaliReady = false;
            return;
        }

        if (tryEnableLocale(engine, Locale.forLanguageTag("bn-BD"))) {
            this.bengaliReady = true;
            return;
        }
        if (tryEnableLocale(engine, Locale.forLanguageTag("bn-IN"))) {
            this.bengaliReady = true;
            return;
        }
        if (tryEnableLocale(engine, new Locale("bn"))) {
            this.bengaliReady = true;
            return;
        }
        this.bengaliReady = false;
    }

    @JavascriptInterface
    public boolean isBengaliAvailable() {
        return !shutDown && bengaliReady && tts != null;
    }

    @JavascriptInterface
    public boolean speak(String text, float pitch, float rate, float volume) {
        return speakCharacter(text, pitch, rate, volume, "default");
    }

    /** Select distinct *installed offline Bengali* voices when available.
     * If the device has only one voice, per-character prosody still applies;
     * never promise that pitch changes manufacture different human actors. */
    @JavascriptInterface
    public boolean speakCharacter(String text, float pitch, float rate, float volume, String character) {
        TextToSpeech engine = this.tts;
        if (shutDown || !bengaliReady || engine == null || text == null || text.isEmpty()) return false;
        float safePitch = Math.max(0.6f, Math.min(1.5f, pitch));
        float safeRate = Math.max(0.7f, Math.min(1.4f, rate));
        float safeVol = Math.max(0.0f, Math.min(1.0f, volume));
        try {
            List<Voice> bengali = bengaliVoices;
            if (!bengali.isEmpty()) {
                int index = Math.floorMod(character == null ? 0 : character.hashCode(), bengali.size());
                if (engine.setVoice(bengali.get(index)) != TextToSpeech.SUCCESS) {
                    if (defaultBengaliVoice != null) engine.setVoice(defaultBengaliVoice);
                }
            } else if (defaultBengaliVoice != null) engine.setVoice(defaultBengaliVoice);
            engine.setPitch(safePitch);
            engine.setSpeechRate(safeRate);
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, safeVol);
            String utteranceId = String.valueOf(utteranceSeq.incrementAndGet());
            return engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId) == TextToSpeech.SUCCESS;
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
