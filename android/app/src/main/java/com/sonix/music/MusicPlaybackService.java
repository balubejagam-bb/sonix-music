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
    public static final String ACTION_PLAY_SINGLE = "com.sonix.music.action.PLAY_SINGLE";
    public static final String ACTION_PLAY_QUEUE = "com.sonix.music.action.PLAY_QUEUE";
    public static final String ACTION_PAUSE = "com.sonix.music.action.PAUSE";
    public static final String ACTION_RESUME = "com.sonix.music.action.RESUME";
    public static final String ACTION_STOP = "com.sonix.music.action.STOP";
    public static final String ACTION_NEXT = "com.sonix.music.action.NEXT";
    public static final String ACTION_PREVIOUS = "com.sonix.music.action.PREVIOUS";
    public static final String ACTION_SEEK = "com.sonix.music.action.SEEK";
    public static final String ACTION_SET_SHUFFLE = "com.sonix.music.action.SET_SHUFFLE";
    public static final String ACTION_SET_REPEAT = "com.sonix.music.action.SET_REPEAT";

    private static final String CHANNEL_ID = "sonix_music_playback";
    private static final int NOTIFICATION_ID = 1001;

    private ExoPlayer player;
    private MediaSession mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();

        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(audioAttributes, true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_NETWORK);
        
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                updateNotification();
                if (playbackState == Player.STATE_ENDED && !player.hasNextMediaItem()) {
                    stopForeground(false);
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updateNotification();
            }
        });

        mediaSession = new MediaSession.Builder(this, player).build();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, createNotification("Sonix Music", "Loading..."));
        handleAction(intent);
        return START_STICKY;
    }

    @Override
    public MediaSession onGetSession(ControllerInfo controllerInfo) {
        return mediaSession;
    }

    private void handleAction(@Nullable Intent intent) {
        if (intent == null || player == null) {
            return;
        }

        String action = intent.getAction();
        if (TextUtils.isEmpty(action)) {
            return;
        }

        try {
            switch (action) {
                case ACTION_PLAY_SINGLE:
                    playSingle(intent);
                    break;
                case ACTION_PLAY_QUEUE:
                    playQueue(intent);
                    break;
                case ACTION_PAUSE:
                    player.pause();
                    break;
                case ACTION_RESUME:
                    player.play();
                    break;
                case ACTION_STOP:
                    player.stop();
                    stopForeground(true);
                    stopSelf();
                    break;
                case ACTION_NEXT:
                    if (player.hasNextMediaItem()) {
                        player.seekToNextMediaItem();
                        player.play();
                    }
                    break;
                case ACTION_PREVIOUS:
                    if (player.hasPreviousMediaItem()) {
                        player.seekToPreviousMediaItem();
                        player.play();
                    } else {
                        player.seekToDefaultPosition(0);
                        player.play();
                    }
                    break;
                case ACTION_SEEK:
                    long positionMs = Math.max(0L, intent.getLongExtra("positionMs", 0L));
                    player.seekTo(positionMs);
                    break;
                case ACTION_SET_SHUFFLE:
                    player.setShuffleModeEnabled(intent.getBooleanExtra("enabled", false));
                    break;
                case ACTION_SET_REPEAT:
                    String mode = intent.getStringExtra("repeatMode");
                    player.setRepeatMode(mapRepeatMode(mode));
                    break;
                default:
                    break;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void playSingle(Intent intent) {
        String url = intent.getStringExtra("url");
        if (TextUtils.isEmpty(url)) {
            return;
        }
        
        String title = intent.getStringExtra("title");
        String artist = intent.getStringExtra("artist");
        
        MediaItem item = buildItem(
            url,
            title,
            artist,
            intent.getStringExtra("album"),
            intent.getStringExtra("artwork")
        );
        
        player.setMediaItem(item);
        player.prepare();
        player.play();
        
        updateNotification(title, artist);
    }

    private void playQueue(Intent intent) {
        String queueJson = intent.getStringExtra("queue");
        if (TextUtils.isEmpty(queueJson)) {
            playSingle(intent);
            return;
        }

        int index = Math.max(0, intent.getIntExtra("index", 0));
        boolean shuffle = intent.getBooleanExtra("shuffle", false);
        String repeat = intent.getStringExtra("repeatMode");

        List<MediaItem> items = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(queueJson);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.optJSONObject(i);
                if (obj == null) continue;
                String url = obj.optString("url", "");
                if (TextUtils.isEmpty(url)) continue;
                items.add(buildItem(
                    url,
                    obj.optString("title", "Unknown Track"),
                    obj.optString("artist", "Unknown Artist"),
                    obj.optString("album", "Sonix Music"),
                    obj.optString("artwork", "")
                ));
            }
        } catch (Exception e) {
            e.printStackTrace();
            return;
        }

        if (items.isEmpty()) {
            return;
        }

        if (index >= items.size()) {
            index = 0;
        }

        player.setShuffleModeEnabled(shuffle);
        player.setRepeatMode(mapRepeatMode(repeat));
        player.setMediaItems(items, index, C.TIME_UNSET);
        player.prepare();
        player.play();
        
        updateNotification();
    }

    private MediaItem buildItem(String url, String title, String artist, String album, String artwork) {
        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
            .setTitle(title != null ? title : "Unknown Track")
            .setArtist(artist != null ? artist : "Unknown Artist")
            .setAlbumTitle(album != null ? album : "Sonix Music");

        if (!TextUtils.isEmpty(artwork)) {
            try {
                metaBuilder.setArtworkUri(android.net.Uri.parse(artwork));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        return new MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(metaBuilder.build())
            .build();
    }

    private int mapRepeatMode(String mode) {
        if ("one".equalsIgnoreCase(mode)) {
            return Player.REPEAT_MODE_ONE;
        }
        if ("all".equalsIgnoreCase(mode)) {
            return Player.REPEAT_MODE_ALL;
        }
        return Player.REPEAT_MODE_OFF;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Sonix Music Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Music playback controls");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void updateNotification() {
        if (player != null && player.getCurrentMediaItem() != null) {
            MediaMetadata metadata = player.getCurrentMediaItem().mediaMetadata;
            String title = metadata.title != null ? metadata.title.toString() : "Sonix Music";
            String artist = metadata.artist != null ? metadata.artist.toString() : "Now Playing";
            updateNotification(title, artist);
        }
    }

    private void updateNotification(String title, String artist) {
        Notification notification = createNotification(title, artist);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification createNotification(String title, String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            notificationIntent, 
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (player != null && player.isPlaying()) {
            builder.addAction(android.R.drawable.ic_media_pause, "Pause", 
                createActionIntent(ACTION_PAUSE));
        } else {
            builder.addAction(android.R.drawable.ic_media_play, "Play", 
                createActionIntent(ACTION_RESUME));
        }

        builder.addAction(android.R.drawable.ic_media_next, "Next", 
            createActionIntent(ACTION_NEXT));

        return builder.build();
    }

    private PendingIntent createActionIntent(String action) {
        Intent intent = new Intent(this, MusicPlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(
            this, 
            action.hashCode(), 
            intent, 
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
