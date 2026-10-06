package expo.modules.torrentengine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * Keeps torrents downloading with the app in the background or the screen off, with a
 * notification ("128bitPlay · downloading 2 · 4.2 MB/s"). Stops itself once nothing is left.
 */
class TorrentService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var idleTicks = 0

  private val tick = object : Runnable {
    override fun run() {
      val core = TorrentHolder.get(this@TorrentService)
      val active = try { core.tick() } catch (e: Exception) { 0 }
      if (active == 0) idleTicks++ else idleTicks = 0
      if (idleTicks >= 5) {
        stopForegroundCompat()
        stopSelf()
        return
      }
      val (down, _) = core.rates().let { it[0] to it[1] }
      val text = TorrentHolder.blockedReason
        ?: "Downloading $active · ${formatRate(down)}"
      getSystemService(NotificationManager::class.java).notify(ID, notification(text))
      handler.postDelayed(this, 2000)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val n = notification("Starting downloads…")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(ID, n)
    }
    handler.removeCallbacks(tick)
    idleTicks = 0
    handler.post(tick)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    super.onDestroy()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
  }

  private fun notification(text: String): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Torrent downloads", NotificationManager.IMPORTANCE_LOW))
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
    else @Suppress("DEPRECATION") Notification.Builder(this)
    return b.setContentTitle("128bitPlay")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .build()
  }

  companion object {
    private const val CHANNEL = "torrents"
    private const val ID = 128_128

    fun formatRate(bytesPerSec: Long): String = when {
      bytesPerSec >= 1_000_000 -> "%.1f MB/s".format(bytesPerSec / 1_000_000.0)
      bytesPerSec >= 1_000 -> "${bytesPerSec / 1000} KB/s"
      else -> "$bytesPerSec B/s"
    }

    /** Starts (or nudges) the service; safe to call often. */
    fun ensure(context: Context) {
      val i = Intent(context, TorrentService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i) else context.startService(i)
      } catch (e: Exception) {
        // Not allowed from the background right now; downloads still run while the app is open.
      }
    }
  }
}
