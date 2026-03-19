package com.sonix.music;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.net.Uri;
import android.webkit.WebSettings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.sonix.music.MusicPlayerPlugin;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIFICATIONS = 4107;
	private final android.os.Handler backgroundHandler = new android.os.Handler(android.os.Looper.getMainLooper());
	private boolean keepAliveRunning = false;
	private final Runnable keepAliveRunnable = new Runnable() {
		@Override
		public void run() {
			if (!keepAliveRunning) return;
			keepWebViewMediaAlive();
			backgroundHandler.postDelayed(this, 1500);
		}
	};

	@Override
	public void onCreate(Bundle savedInstanceState) {
		try {
			registerPlugin(MusicPlayerPlugin.class);
			android.util.Log.i("SonixMusic", "MusicPlayer plugin registered");
		} catch (Throwable t) {
			android.util.Log.w("SonixMusic", "MusicPlayer plugin registration skipped", t);
		}

		super.onCreate(savedInstanceState);

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
		requestIgnoreBatteryOptimizationsIfNeeded();
		enableBackgroundModePlugin();
	}

	@Override
	public void onPause() {
		super.onPause();
		enableBackgroundModePlugin();
		startBackgroundKeepAlive();
	}

	@Override
	public void onStop() {
		super.onStop();
		enableBackgroundModePlugin();
		startBackgroundKeepAlive();
	}

	@Override
	public void onResume() {
		super.onResume();
		stopBackgroundKeepAlive();
	}

	@Override
	public void onDestroy() {
		stopBackgroundKeepAlive();
		super.onDestroy();
	}

	private void startBackgroundKeepAlive() {
		if (keepAliveRunning) return;
		keepAliveRunning = true;
		keepWebViewMediaAlive();
		backgroundHandler.postDelayed(keepAliveRunnable, 1500);
	}

	private void stopBackgroundKeepAlive() {
		keepAliveRunning = false;
		backgroundHandler.removeCallbacks(keepAliveRunnable);
	}

	private void keepWebViewMediaAlive() {
		try {
			if (getBridge() != null && getBridge().getWebView() != null) {
				// Capacitor/WebView can pause timers when app backgrounds; resume them to avoid audio drop.
				getBridge().getWebView().resumeTimers();
				getBridge().getWebView().onResume();
				getBridge().getWebView().setKeepScreenOn(true);
			}
		} catch (Throwable t) {
			android.util.Log.w("SonixMusic", "Failed to keep WebView media alive", t);
		}
	}

	private void enableBackgroundModePlugin() {
		try {
			if (getBridge() != null && getBridge().getWebView() != null) {
				String js = "(function(){"
					+ "var p=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.BackgroundMode;"
					+ "if(!p){return;}"
					+ "if(p.enable){p.enable();}"
					+ "if(p.disableWebViewOptimizations){p.disableWebViewOptimizations();}"
					+ "if(p.setDefaults){p.setDefaults({silent:true,title:'Sonix Music',text:'Playing in background'});}"
					+ "})();";
				getBridge().getWebView().evaluateJavascript(js, null);
			}
		} catch (Throwable t) {
			android.util.Log.w("SonixMusic", "Failed to enable BackgroundMode plugin", t);
		}
	}

    private void requestIgnoreBatteryOptimizationsIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;

        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;

            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Throwable t) {
            android.util.Log.w("SonixMusic", "Battery optimization request failed", t);
        }
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
