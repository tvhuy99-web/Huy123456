package com.jiuguan.sillytavern

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*

/**
 * Foreground Service that keeps the Node.js SillyTavern server running.
 * Shows a persistent notification while active.
 */
class NodeService : Service() {

    companion object {
        private const val TAG = "NodeService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "sillytavern_service"

        private const val ACTION_START = "com.jiuguan.sillytavern.START"
        private const val ACTION_STOP = "com.jiuguan.sillytavern.STOP"
        private const val ACTION_GENERATION_STATE = "com.jiuguan.sillytavern.GENERATION_STATE"
        private const val WAKE_LOCK_TIMEOUT_MS = 15 * 60 * 1000L

        /** Refresh background generation protection while the server is running. */
        fun setGenerationActive(context: Context, active: Boolean) {
            if (!isRunning) return
            try {
                context.startService(Intent(context,NodeService::class.java).apply {
                    action=ACTION_GENERATION_STATE
                    putExtra("generating",active)
                })
            } catch (error: Exception) {
                Log.w(TAG,"Unable to deliver generation status",error)
            }
        }

        /** Convenience: start the service */
        fun start(context: Context) {
            val intent = Intent(context, NodeService::class.java).apply {
                action = ACTION_START
            }
            lastStartError = null
            isStarting = true
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                isStarting = false
                lastStartError = e.message ?: e.javaClass.simpleName
                throw e
            }
        }

        /** Convenience: stop the service */
        fun stop(context: Context) {
            val intent = Intent(context, NodeService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        /** State and error visible to the launcher during service startup. */
        @Volatile
        var isRunning = false
            private set

        @Volatile
        var isStarting = false
            private set

        @Volatile
        var lastStartError: String? = null
            private set
    }

    private lateinit var nodeManager: NodeManager
    private val serviceScope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var watchdogJob: Job? = null
    private var startupJob: Job? = null
    private var generationWakeLock: PowerManager.WakeLock? = null
    private var generating = false

    private fun setGenerationState(active: Boolean) {
        if (active && isRunning) {
            val lock = generationWakeLock ?: run {
                val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                power.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "${packageName}:SillyTavernGeneration"
                ).apply {setReferenceCounted(false)}.also { generationWakeLock=it }
            }
            // Time-bounded, refreshed by STREAM_TOKEN_RECEIVED events.
            // A lost WebView cannot hold a lock indefinitely.
            lock.acquire(WAKE_LOCK_TIMEOUT_MS)
            if (!generating) {
                generating=true
                updateNotification("AI đang tạo phản hồi, có thể dùng ứng dụng khác")
            }
        } else {
            if (generationWakeLock?.isHeld==true) generationWakeLock?.release()
            if (generating) {
                generating=false
                if (isRunning) updateNotification("SillyTavern đang chạy")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        nodeManager = NodeManager(applicationContext)
        createNotificationChannel()
        Log.i(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                setGenerationState(false)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_GENERATION_STATE -> {
                setGenerationState(intent?.getBooleanExtra("generating",false)==true)
                return START_STICKY
            }
            else -> {
                startForeground(NOTIFICATION_ID, buildNotification("Đang khởi động SillyTavern..."))
                startNodeServer()
                return START_STICKY
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        setGenerationState(false)
        isRunning = false
        isStarting = false
        startupJob?.cancel()
        watchdogJob?.cancel()
        serviceScope.cancel()
        nodeManager.stopServer()
        Log.i(TAG, "Service destroyed, server stopped")
        super.onDestroy()
    }

    private fun startNodeServer() {
        if (isRunning || startupJob?.isActive == true) return
        isStarting = true
        lastStartError = null
        startupJob = serviceScope.launch {
            try {
                if (!nodeManager.isReady()) {
                    lastStartError = "Node.js hoặc SillyTavern chưa sẵn sàng"
                    updateNotification("Node.js hoặc SillyTavern chưa sẵn sàng")
                    Log.e(TAG, "Cannot start: not ready")
                    return@launch
                }

                val error = nodeManager.startServer()
                if (error == null) {
                    isRunning = true
                    lastStartError = null
                    updateNotification(if (generating)
                            "AI đang tạo phản hồi, có thể dùng ứng dụng khác"
                            else "SillyTavern đang chạy · ${nodeManager.serverUrl}")
                    startWatchdog()
                    Log.i(TAG, "Server started successfully")
                } else {
                    lastStartError = error
                    updateNotification("Khởi động máy chủ thất bại")
                    Log.e(TAG, "Failed to start server: $error")
                    DiagnosticStore.record(applicationContext, "error", "node", error)
                }
            } catch (e: Exception) {
                lastStartError = e.message ?: e.javaClass.simpleName
                updateNotification("Lỗi khởi động: ${e.message}")
                Log.e(TAG, "Error starting server", e)
                DiagnosticStore.record(applicationContext, "error", "node",
                    e.message ?: e.javaClass.simpleName)
            } finally {
                isStarting = false
            }
        }
    }

    /** Monitor the Node.js process and restart if it crashes */
    private fun startWatchdog() {
        watchdogJob?.cancel()
        watchdogJob = serviceScope.launch {
            while (isActive) {
                delay(5000) // Check every 5 seconds
                if (!nodeManager.isProcessAlive()) {
                    Log.w(TAG, "Node.js process died, restarting...")
                    DiagnosticStore.record(applicationContext, "error", "node",
                        "Máy chủ Node.js dừng bất ngờ, đang khởi động lại")
                    isRunning = false
                    updateNotification("Đang khởi động lại máy chủ...")
                    delay(1000)
                    val restartError = nodeManager.startServer()
                    if (restartError == null) {
                        isRunning = true
                        lastStartError = null
                        updateNotification(if (generating)
                            "AI đang tạo phản hồi, có thể dùng ứng dụng khác"
                            else "SillyTavern đang chạy · ${nodeManager.serverUrl}")
                    } else {
                        lastStartError = restartError
                        updateNotification("Khởi động lại thất bại, hãy mở ứng dụng")
                        break
                    }
                }
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Dịch vụ SillyTavern",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Máy chủ SillyTavern hoạt động khi chuyển ứng dụng"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        // Clicking notification opens the app
        val openIntent = Intent(this, LauncherActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Stop action
        val stopIntent = Intent(this, NodeService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SillyTavern")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(android.R.drawable.ic_media_pause, "Dừng máy chủ", stopPending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(NOTIFICATION_ID, buildNotification(text))
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update notification", e)
        }
    }
}
