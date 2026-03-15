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
    public static final String ACTION_TOGGLE_PAUSE = "com.sonix.music.action.TOGGLE_PAUSE";

    private static final String CHANNEL_ID = "sonix_music_playback";
    private static final int NOTIFICATION_ID = 1001;

    private ExoPlayer player;
    private MediaSession mediaSession;
    public static ExoPlayer currentPlayer;

    private final android.os.Handler updateHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updateRunnable = new Runnable() {
        @Override
        public void run() {
            if (player != null && player.isPlaying()) {
                MusicPlayerPlugin.onStateChanged(true, player.getCurrentPosition(), player.getDuration(), player.getPlaybackState());
            }
            updateHandler.postDelayed(this, 1000);
        }
    };

    private PendingIntent createActionIntent(String action) {
        Intent intent = new Intent(this, MusicPlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Playback Controls",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows controls for the current song");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void updateForegroundNotification(String title, String artist) {
        Intent mainIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            mainIntent,
            PendingIntent.FLAG_IMMUTABLE
        );

        boolean isPlaying = player != null && player.isPlaying();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(isPlaying)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_previous, "Previous", createActionIntent(ACTION_PREVIOUS)))
            .addAction(new NotificationCompat.Action(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                createActionIntent(ACTION_TOGGLE_PAUSE)))
            .addAction(new NotificationCompat.Action(
                android.R.drawable.ic_media_next, "Next", createActionIntent(ACTION_NEXT)))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionCompatToken())
                .setShowActionsInCompactView(0, 1, 2));

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();

        androidx.media3.exoplayer.DefaultLoadControl loadControl = new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                50000, // minBufferMs
                100000, // maxBufferMs
                2500, // bufferForPlaybackMs
                5000  // bufferForPlaybackAfterRebufferMs
            )
            .build();

        player = new ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .build();
        player.setAudioAttributes(audioAttributes, true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_NETWORK);

        // Wrap player to force Next/Previous commands to be available
        androidx.media3.common.ForwardingPlayer forwardingPlayer = new androidx.media3.common.ForwardingPlayer(player) {
            @Override
            public androidx.media3.common.Player.Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                    .add(androidx.media3.common.Player.COMMAND_SEEK_TO_NEXT)
                    .add(androidx.media3.common.Player.COMMAND_SEEK_TO_PREVIOUS)
                    .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                return command == androidx.media3.common.Player.COMMAND_SEEK_TO_NEXT ||
                       command == androidx.media3.common.Player.COMMAND_SEEK_TO_PREVIOUS ||
                       super.isCommandAvailable(command);
            }
        };

        currentPlayer = player;
        
        forwardingPlayer.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                notifyState();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                notifyState();
                if (isPlaying) {
                    updateHandler.post(updateRunnable);
                } else {
                    updateHandler.removeCallbacks(updateRunnable);
                }
            }

            @Override
            public void onPlayerError(androidx.media3.common.PlaybackException error) {
                android.util.Log.e("SonixMusic", "Player Error: " + error.errorCode + " - " + error.getMessage(), error);
            }

            @Override
            public void onMediaMetadataChanged(MediaMetadata mediaMetadata) {
                notifyState();
            }
        });

        mediaSession = new MediaSession.Builder(this, forwardingPlayer)
            .setCallback(new MediaSession.Callback() {
                @Override
                public androidx.media3.session.MediaSession.ConnectionResult onConnect(
                        MediaSession session, 
                        androidx.media3.session.MediaSession.ControllerInfo controller) {
                    androidx.media3.common.Player.Commands commands = androidx.media3.common.Player.Commands.EMPTY.buildUpon()
                        .add(androidx.media3.common.Player.COMMAND_PLAY_PAUSE)
                        .add(androidx.media3.common.Player.COMMAND_SEEK_TO_NEXT)
                        .add(androidx.media3.common.Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(androidx.media3.common.Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                        .add(androidx.media3.common.Player.COMMAND_STOP)
                        .build();
                    return new androidx.media3.session.MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailablePlayerCommands(commands)
                        .build();
                }

                @Override
                public int onPlayerCommandRequest(MediaSession session, ControllerInfo controller, int playerCommand) {
                    if (playerCommand == androidx.media3.common.Player.COMMAND_SEEK_TO_NEXT) {
                        MusicPlayerPlugin.triggerWebAction("next");
                        return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                    } else if (playerCommand == androidx.media3.common.Player.COMMAND_SEEK_TO_PREVIOUS) {
                        MusicPlayerPlugin.triggerWebAction("previous");
                        return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                    }
                    return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                }
            })
            .build();
        updateHandler.post(updateRunnable);
    }

    private void notifyState() {
        if (player != null) {
            MusicPlayerPlugin.onStateChanged(player.isPlaying(), player.getCurrentPosition(), player.getDuration(), player.getPlaybackState());
            
            MediaMetadata metadata = player.getMediaMetadata();
            String title = metadata.title != null ? metadata.title.toString() : "Sonix Music";
            String artist = metadata.artist != null ? metadata.artist.toString() : "Playing...";
            
            if (player.getPlaybackState() != Player.STATE_IDLE) {
                updateForegroundNotification(title, artist);
            }
        }
    }

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
                case ACTION_TOGGLE_PAUSE:
                    if (player.isPlaying()) player.pause();
                    else player.play();
                    break;
                case ACTION_NEXT:
                    MusicPlayerPlugin.triggerWebAction("next");
                    if (player.hasNextMediaItem()) {
                        player.seekToNextMediaItem();
                        player.play();
                    }
                    break;
                case ACTION_PREVIOUS:
                    MusicPlayerPlugin.triggerWebAction("previous");
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

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!player.getPlayWhenReady() || player.getPlaybackState() == Player.STATE_IDLE || player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
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
