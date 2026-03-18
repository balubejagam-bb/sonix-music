package com.sonix.music;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;
import com.sonix.music.MusicPlayerPlugin;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		try {
			registerPlugin(MusicPlayerPlugin.class);
		} catch (Throwable t) {
			android.util.Log.w("SonixMusic", "MusicPlayer plugin registration skipped", t);
		}

		// Allow media autoplay without user gesture (fixes 0:00 stuck bug)
		try {
			if (getBridge() != null && getBridge().getWebView() != null) {
				WebSettings settings = getBridge().getWebView().getSettings();
				settings.setMediaPlaybackRequiresUserGesture(false);
				settings.setDomStorageEnabled(true);
				settings.setJavaScriptEnabled(true);
				settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
			}
		} catch (Throwable t) {
			android.util.Log.w("SonixMusic", "WebView media settings not applied", t);
		}
	}
}
