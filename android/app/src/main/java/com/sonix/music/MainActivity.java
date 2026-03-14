package com.sonix.music;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(MusicPlayerPlugin.class);
		super.onCreate(savedInstanceState);

		// Allow media autoplay without user gesture (fixes 0:00 stuck bug)
		WebSettings settings = getBridge().getWebView().getSettings();
		settings.setMediaPlaybackRequiresUserGesture(false);
		settings.setDomStorageEnabled(true);
		settings.setJavaScriptEnabled(true);
		settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
	}
}
