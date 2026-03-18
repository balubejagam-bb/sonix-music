package com.sonix.music;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.sonix.music.MusicPlayerPlugin;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 4107;

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

        requestNotificationPermissionIfNeeded();
	}

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;

        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                    REQ_POST_NOTIFICATIONS
                );
            }
        } catch (Throwable t) {
            android.util.Log.w("SonixMusic", "Notification permission request failed", t);
        }
    }
}
