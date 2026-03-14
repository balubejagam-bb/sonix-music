package com.sonix.music;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MusicPlayer")
public class MusicPlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        Intent intent = baseIntent(MusicPlaybackService.ACTION_PLAY_SINGLE);
        intent.putExtra("url", url);
        intent.putExtra("title", call.getString("title", "Unknown Track"));
        intent.putExtra("artist", call.getString("artist", "Unknown Artist"));
        intent.putExtra("album", call.getString("album", "Sonix Music"));
        intent.putExtra("artwork", call.getString("artwork", ""));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void playQueue(PluginCall call) {
        JSArray queue = call.getArray("queue");
        if (queue == null || queue.length() == 0) {
            call.reject("queue is required");
            return;
        }

        Intent intent = baseIntent(MusicPlaybackService.ACTION_PLAY_QUEUE);
        intent.putExtra("queue", queue.toString());
        intent.putExtra("index", call.getInt("index", 0));
        intent.putExtra("shuffle", call.getBoolean("shuffle", false));
        intent.putExtra("repeatMode", call.getString("repeatMode", "off"));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        dispatchSimple(call, MusicPlaybackService.ACTION_PAUSE);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        dispatchSimple(call, MusicPlaybackService.ACTION_RESUME);
    }

    @PluginMethod
    public void next(PluginCall call) {
        dispatchSimple(call, MusicPlaybackService.ACTION_NEXT);
    }

    @PluginMethod
    public void previous(PluginCall call) {
        dispatchSimple(call, MusicPlaybackService.ACTION_PREVIOUS);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        dispatchSimple(call, MusicPlaybackService.ACTION_STOP);
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        long positionMs = Math.max(0L, Math.round(call.getDouble("positionMs", 0.0)));
        Intent intent = baseIntent(MusicPlaybackService.ACTION_SEEK);
        intent.putExtra("positionMs", positionMs);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        Intent intent = baseIntent(MusicPlaybackService.ACTION_SET_SHUFFLE);
        intent.putExtra("enabled", enabled);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String mode = call.getString("mode", "off");
        Intent intent = baseIntent(MusicPlaybackService.ACTION_SET_REPEAT);
        intent.putExtra("repeatMode", mode);
        getContext().startService(intent);
        call.resolve();
    }

    private void dispatchSimple(PluginCall call, String action) {
        getContext().startService(baseIntent(action));
        call.resolve();
    }

    private Intent baseIntent(String action) {
        Intent intent = new Intent(getContext(), MusicPlaybackService.class);
        intent.setAction(action);
        return intent;
    }
}
