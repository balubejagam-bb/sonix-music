package com.sonix.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.text.TextUtils;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSession.ControllerInfo;
import androidx.media3.session.MediaSessionService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MusicPlaybackService extends MediaSessionService {
    public static final String ACTION_PLAY_SINGLE   = "com.sonix.music.action.PLAY_SINGLE";
    public static final String ACTION_PLAY_QUEUE    = "com.sonix.music.action.PLAY_QUEUE";
    public static final String ACTION_PAUSE         = "com.sonix.music.action.PAUSE";
    public static final String ACTION_RESUME        = "com.sonix.music.action.RESUME";
    public static final String ACTION_STOP          = "com.sonix.music.action.STOP";
    public static final String ACTION_NEXT          = "com.sonix.music.action.NEXT";
    public static final String ACTION_PREVIOUS      = "com.sonix.music.action.PREVIOUS";
    public static final String ACTION_SEEK          = "com.sonix.music.action.SEEK";
    public static final String ACTION_SET_SHUFFLE   = "com.sonix.music.action.SET_SHUFFLE";
    public static final String ACTION_SET_REPEAT    = "com.sonix.music.action.SET_REPEAT";
    public static final String ACTION_TOGGLE_PAUSE  = "com.sonix.music.action.TOGGLE_PAUSE";

    // Sent from web to update the notification metadata for YT songs
    public static final String ACTION_UPDATE_META   = "com.sonix.music.action.UPDATE_META";

    private static final String CHANNEL_ID      = "sonix_music_playback";
    private static final int    NOTIFICATION_ID  = 1001;

    private ExoPlayer    player;
    private MediaSession mediaSession;
    public  static ExoPlayer currentPlayer;

    // Track whether we are in "YouTube mode" (no real ExoPlayer stream)
    private boolean ytMode = false;
    private boolean ytPlaying = false;
    private boolean nativeSessionLoaded = false;
    private String  currentTitle  = "Sonix Music";
    private String  currentArtist = "Playing...";

    private final android.os.Handler updateHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updateRunnable = new Runnable() {
        @Override public void run() {
            if (player != null && player.isPlaying()) {
                MusicPlayerPlugin.onStateChanged(true, player.getPlayWhenReady(),
                    player.getCurrentPosition(), player.getDuration(), player.getPlaybackState());
            }
            updateHandler.postDelayed(this, 2000);
        }
    };

    private boolean hasNativeQueue() {
        return player != null && player.getMediaItemCount() > 0;
    }

    private boolean playNextNativeOrWrap() {
        if (player == null || !hasNativeQueue()) return false;

        if (player.hasNextMediaItem()) {
            ytMode = false;
            player.seekToNextMediaItem();
            player.play();
            return true;
        }

        final int count = player.getMediaItemCount();
        if (count > 1) {
            ytMode = false;
            player.seekToDefaultPosition(0);
            player.play();
            return true;
        }

        return false;
    }

    private boolean playPreviousNativeOrWrap() {
        if (player == null || !hasNativeQueue()) return false;

        if (player.hasPreviousMediaItem()) {
            ytMode = false;
            player.seekToPreviousMediaItem();
            player.play();
            return true;
        }

        final int count = player.getMediaItemCount();
        if (count > 1) {
            ytMode = false;
            player.seekToDefaultPosition(count - 1);
            player.play();
            return true;
        }

        return false;
    }

    // ── Pending intents for notification buttons ──────────────────────────────
    private PendingIntent actionIntent(String action, int reqCode) {
        Intent i = new Intent(this, MusicPlaybackService.class);
        i.setAction(action);
        return PendingIntent.getService(this, reqCode,
            i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── Notification channel ─────────────────────────────────────────────────
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Playback Controls",
                // HIGH importance → shows in status bar AND notification shade on Android 15+
                NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Music playback controls");
            ch.setShowBadge(false);
            ch.setSound(null, null);          // no sound for media channel
            ch.enableVibration(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    // ── Build & post the foreground notification ──────────────────────────────
    private void updateForegroundNotification(String title, String artist, boolean playing) {
        currentTitle  = title  != null ? title  : "Sonix Music";
        currentArtist = artist != null ? artist : "Playing...";

        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, mainIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            // ONGOING only while playing so user can dismiss when paused
            .setOngoing(playing)
            // Show on lock screen AND notification shade
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setShowWhen(false)
            // Prevent heads-up popup for every state change
            .setOnlyAlertOnce(true)
            // Android 12+ — show immediately in notification shade
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_previous, "Previous",
                actionIntent(ACTION_PREVIOUS, 1)))
            .addAction(new NotificationCompat.Action(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pause" : "Play",
                actionIntent(ACTION_TOGGLE_PAUSE, 2)))
            .addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_next, "Next",
                actionIntent(ACTION_NEXT, 3)))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionCompatToken())
                .setShowActionsInCompactView(0, 1, 2));

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();

        androidx.media3.exoplayer.DefaultLoadControl loadControl =
            new androidx.media3.exoplayer.DefaultLoadControl.Builder()
                .setBufferDurationsMs(50000, 100000, 2500, 5000)
                .build();

        player = new ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .build();
        player.setAudioAttributes(audioAttributes, true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_NETWORK);

        // ForwardingPlayer — always advertise Next/Prev commands so the
        // system media session shows those buttons
        androidx.media3.common.ForwardingPlayer fp =
            new androidx.media3.common.ForwardingPlayer(player) {
                @Override
                public Player.Commands getAvailableCommands() {
                    return super.getAvailableCommands().buildUpon()
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .build();
                }
                @Override
                public boolean isCommandAvailable(int command) {
                    return command == Player.COMMAND_SEEK_TO_NEXT
                        || command == Player.COMMAND_SEEK_TO_PREVIOUS
                        || command == Player.COMMAND_PLAY_PAUSE
                        || super.isCommandAvailable(command);
                }
            };

        currentPlayer = player;

        fp.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                notifyState();
                // If the native queue reaches terminal END with no next item,
                // ask the web layer to resolve/play the next logical track.
                if (state == Player.STATE_ENDED && shouldUseNativeTransport()) {
                    if (!playNextNativeOrWrap()) {
                        MusicPlayerPlugin.triggerWebAction("next");
                    }
                }
            }
            @Override public void onIsPlayingChanged(boolean isPlaying) {
                notifyState();
                if (isPlaying) updateHandler.post(updateRunnable);
                else           updateHandler.removeCallbacks(updateRunnable);
            }
            @Override public void onPlayerError(androidx.media3.common.PlaybackException e) {
                android.util.Log.e("SonixMusic", "Player error: " + e.getMessage(), e);
                MusicPlayerPlugin.triggerWebAction("native_error");
            }
            @Override public void onMediaMetadataChanged(MediaMetadata m) { notifyState(); }
        });

        mediaSession = new MediaSession.Builder(this, fp)
            .setCallback(new MediaSession.Callback() {
                @Override
                public MediaSession.ConnectionResult onConnect(
                        MediaSession session, ControllerInfo controller) {
                    Player.Commands cmds = Player.Commands.EMPTY.buildUpon()
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                        .add(Player.COMMAND_STOP)
                        .build();
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailablePlayerCommands(cmds)
                        .build();
                }

                @Override
                public int onPlayerCommandRequest(
                        MediaSession session, ControllerInfo controller, int playerCommand) {
                    if (playerCommand == Player.COMMAND_PLAY_PAUSE) {
                        if (shouldUseNativeTransport()) {
                            ytMode = false;
                            if (player.isPlaying()) player.pause();
                            else                    player.play();
                        } else if (ytMode) {
                            ytPlaying = !ytPlaying;
                            MusicPlayerPlugin.triggerWebAction(ytPlaying ? "play" : "pause");
                            updateForegroundNotification(currentTitle, currentArtist, ytPlaying);
                        }
                        return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                    }
                    if (playerCommand == Player.COMMAND_SEEK_TO_NEXT) {
                        if (!playNextNativeOrWrap()) {
                            MusicPlayerPlugin.triggerWebAction("next");
                        }
                        return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                    }
                    if (playerCommand == Player.COMMAND_SEEK_TO_PREVIOUS) {
                        if (!playPreviousNativeOrWrap()) {
                            MusicPlayerPlugin.triggerWebAction("previous");
                        }
                        return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                    }
                    return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                }
            })
            .build();

        updateHandler.post(updateRunnable);
    }

    private void notifyState() {
        if (player == null) return;
        MusicPlayerPlugin.onStateChanged(
            player.isPlaying(),
            player.getPlayWhenReady(),
            player.getCurrentPosition(),
            player.getDuration(),
            player.getPlaybackState());

        MediaMetadata meta = player.getMediaMetadata();
        String title  = meta.title  != null ? meta.title.toString()  : currentTitle;
        String artist = meta.artist != null ? meta.artist.toString() : currentArtist;

        if (player.getPlaybackState() != Player.STATE_IDLE) {
            updateForegroundNotification(title, artist, player.isPlaying());
        }
    }

    private boolean shouldUseNativeTransport() {
        if (player == null) return false;
        if (nativeSessionLoaded) return true;
        return !ytMode && player.getMediaItemCount() > 0;
    }

    // ── onStartCommand ────────────────────────────────────────────────────────
    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        handleAction(intent);
        return START_STICKY;
    }

    @Override
    public MediaSession onGetSession(ControllerInfo controllerInfo) {
        return mediaSession;
    }

    private void handleAction(@Nullable Intent intent) {
        if (intent == null || player == null) return;
        String action = intent.getAction();
        if (TextUtils.isEmpty(action)) return;

        try {
            switch (action) {
                case ACTION_PLAY_SINGLE:
                    ytMode = false;
                    nativeSessionLoaded = true;
                    playSingle(intent);
                    break;

                case ACTION_PLAY_QUEUE:
                    ytMode = false;
                    nativeSessionLoaded = true;
                    playQueue(intent);
                    break;

                // ── YouTube-mode: update notification metadata only ──────────
                case ACTION_UPDATE_META:
                    // Do not downgrade native transport state when a native queue exists.
                    if (!hasNativeQueue()) {
                        ytMode = true;
                        nativeSessionLoaded = false;
                    }
                    ytPlaying = intent.getBooleanExtra("isPlaying", true);
                    currentTitle  = intent.getStringExtra("title")  != null
                        ? intent.getStringExtra("title")  : "Sonix Music";
                    currentArtist = intent.getStringExtra("artist") != null
                        ? intent.getStringExtra("artist") : "Playing...";
                    updateForegroundNotification(currentTitle, currentArtist, ytPlaying);
                    break;

                case ACTION_PAUSE:
                    if (shouldUseNativeTransport()) {
                        ytMode = false;
                        player.pause();
                    } else if (ytMode) {
                        ytPlaying = false;
                        MusicPlayerPlugin.triggerWebAction("pause");
                        updateForegroundNotification(currentTitle, currentArtist, false);
                    }
                    break;

                case ACTION_RESUME:
                    if (shouldUseNativeTransport()) {
                        ytMode = false;
                        player.play();
                    } else if (ytMode) {
                        ytPlaying = true;
                        MusicPlayerPlugin.triggerWebAction("play");
                        updateForegroundNotification(currentTitle, currentArtist, true);
                    }
                    break;

                case ACTION_TOGGLE_PAUSE:
                    if (shouldUseNativeTransport()) {
                        ytMode = false;
                        if (player.isPlaying()) player.pause();
                        else                    player.play();
                    } else if (ytMode) {
                        ytPlaying = !ytPlaying;
                        MusicPlayerPlugin.triggerWebAction(ytPlaying ? "play" : "pause");
                        updateForegroundNotification(currentTitle, currentArtist, ytPlaying);
                    }
                    break;

                case ACTION_NEXT:
                    if (!playNextNativeOrWrap()) {
                        MusicPlayerPlugin.triggerWebAction("next");
                    }
                    break;

                case ACTION_PREVIOUS:
                    if (!playPreviousNativeOrWrap()) {
                        MusicPlayerPlugin.triggerWebAction("previous");
                    }
                    break;

                case ACTION_STOP:
                    ytMode = false;
                    nativeSessionLoaded = false;
                    player.stop();
                    stopForeground(true);
                    stopSelf();
                    break;

                case ACTION_SEEK:
                    long posMs = Math.max(0L, intent.getLongExtra("positionMs", 0L));
                    if (!ytMode) player.seekTo(posMs);
                    break;

                case ACTION_SET_SHUFFLE:
                    player.setShuffleModeEnabled(intent.getBooleanExtra("enabled", false));
                    break;

                case ACTION_SET_REPEAT:
                    player.setRepeatMode(mapRepeatMode(intent.getStringExtra("repeatMode")));
                    break;

                default:
                    break;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // ── Queue / item builders ─────────────────────────────────────────────────
    private void playSingle(Intent intent) {
        String url = intent.getStringExtra("url");
        if (TextUtils.isEmpty(url)) return;
        player.setMediaItem(buildItem(
            url,
            intent.getStringExtra("title"),
            intent.getStringExtra("artist"),
            intent.getStringExtra("album"),
            intent.getStringExtra("artwork")));
        player.prepare();
        player.play();
    }

    private void playQueue(Intent intent) {
        String queueJson = intent.getStringExtra("queue");
        if (TextUtils.isEmpty(queueJson)) { playSingle(intent); return; }

        int    index   = Math.max(0, intent.getIntExtra("index", 0));
        boolean shuffle = intent.getBooleanExtra("shuffle", false);
        String  repeat  = intent.getStringExtra("repeatMode");

        List<MediaItem> items = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(queueJson);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.optJSONObject(i);
                if (obj == null) continue;
                String url = obj.optString("url", "");
                if (TextUtils.isEmpty(url)) continue;
                items.add(buildItem(url,
                    obj.optString("title",  "Unknown Track"),
                    obj.optString("artist", "Unknown Artist"),
                    obj.optString("album",  "Sonix Music"),
                    obj.optString("artwork", "")));
            }
        } catch (Exception e) { e.printStackTrace(); return; }

        if (items.isEmpty()) return;
        if (index >= items.size()) index = 0;

        player.setShuffleModeEnabled(shuffle);
        player.setRepeatMode(mapRepeatMode(repeat));
        player.setMediaItems(items, index, C.TIME_UNSET);
        player.prepare();
        player.play();
    }

    private MediaItem buildItem(String url, String title, String artist, String album, String artwork) {
        MediaMetadata.Builder mb = new MediaMetadata.Builder()
            .setTitle(title   != null ? title   : "Unknown Track")
            .setArtist(artist != null ? artist  : "Unknown Artist")
            .setAlbumTitle(album != null ? album : "Sonix Music");
        if (!TextUtils.isEmpty(artwork)) {
            try { mb.setArtworkUri(android.net.Uri.parse(artwork)); } catch (Exception ignored) {}
        }
        return new MediaItem.Builder().setUri(url).setMediaMetadata(mb.build()).build();
    }

    private int mapRepeatMode(String mode) {
        if ("one".equalsIgnoreCase(mode)) return Player.REPEAT_MODE_ONE;
        if ("all".equalsIgnoreCase(mode)) return Player.REPEAT_MODE_ALL;
        return Player.REPEAT_MODE_OFF;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (shouldUseNativeTransport()) {
            return;
        }
        if (ytMode && ytPlaying) {
            return;
        }
        if (!player.getPlayWhenReady()
                || player.getPlaybackState() == Player.STATE_IDLE
                || player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        updateHandler.removeCallbacks(updateRunnable);
        if (mediaSession != null) { mediaSession.release(); mediaSession = null; }
        if (player != null)       { player.release();       player = null; }
        super.onDestroy();
    }
}
