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

    private static MusicPlayerPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    public static void onStateChanged(boolean isPlaying, long currentTime, long duration, int playbackState) {
        if (instance != null) {
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            ret.put("isPlaying", isPlaying);
            ret.put("currentTime", currentTime / 1000.0);
            ret.put("duration", duration / 1000.0);
            ret.put("playbackState", playbackState);
            instance.notifyListeners("onStateChanged", ret);
        }
    }

    public static void triggerWebAction(String action) {
        if (instance != null) {
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            ret.put("action", action);
            instance.notifyListeners("onWebAction", ret);
        }
    }

    /**
     * Called by the web layer when a YouTube song starts playing.
     * Updates the notification with title/artist and puts the service
     * into "YouTube mode" so notification buttons relay to the web.
     */
    @PluginMethod
    public void updateMeta(PluginCall call) {
        String title   = call.getString("title",   "Sonix Music");
        String artist  = call.getString("artist",  "Playing...");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("isPlaying", true));

        Intent intent = baseIntent(MusicPlaybackService.ACTION_UPDATE_META);
        intent.putExtra("title",     title);
        intent.putExtra("artist",    artist);
        intent.putExtra("isPlaying", playing);
        getContext().startService(intent);
        call.resolve();
    }

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
        getContext().startService(intent);
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
        getContext().startService(intent);
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

    @PluginMethod
    public void getPosition(PluginCall call) {
        if (MusicPlaybackService.currentPlayer != null) {
            getActivity().runOnUiThread(() -> {
                try {
                    com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
                    long duration = MusicPlaybackService.currentPlayer.getDuration();
                    long current = MusicPlaybackService.currentPlayer.getCurrentPosition();

                    ret.put("currentTime", Math.max(0L, current) / 1000.0);
                    ret.put("duration", duration > 0 ? duration / 1000.0 : 0.0);
                    ret.put("isPlaying", MusicPlaybackService.currentPlayer.isPlaying());
                    ret.put("playbackState", MusicPlaybackService.currentPlayer.getPlaybackState());
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Thread error", e);
                }
            });
        } else {
            call.resolve(); // Don't reject, just return empty
        }
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
