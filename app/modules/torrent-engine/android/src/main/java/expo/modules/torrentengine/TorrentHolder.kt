package expo.modules.torrentengine

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.io.File

/**
 * The one torrent engine for the whole app (shared by the JS module and the background
 * service), plus the network rules: "Wi-Fi only" and "VPN only" pause everything when the
 * current connection doesn't qualify.
 */
object TorrentHolder {
  @Volatile private var core: TorrentCore? = null
  private lateinit var appContext: Context
  @Volatile var wifiOnly = false
  @Volatile var vpnOnly = false
  @Volatile var blockedReason: String? = null
  private var watching = false

  @Synchronized
  fun get(context: Context): TorrentCore {
    core?.let { return it }
    appContext = context.applicationContext
    try {
      return create()
    } catch (t: Throwable) {
      // e.g. the native library couldn't load on this device: report it, don't crash the app.
      throw IllegalStateException("The torrent engine couldn't start on this device: ${t.message}", t)
    }
  }

  private fun create(): TorrentCore {
    val prefs = appContext.getSharedPreferences("torrent-engine", Context.MODE_PRIVATE)
    wifiOnly = prefs.getBoolean("wifiOnly", false)
    vpnOnly = prefs.getBoolean("vpnOnly", false)
    val c = TorrentCore(dir(appContext))
    c.setSeedRatio(prefs.getInt("seedRatioPct", 0))
    c.start(null)
    core = c
    watchNetwork()
    applyGate()
    return c
  }

  private fun dir(context: Context) =
    context.getExternalFilesDir("torrents") ?: File(context.filesDir, "torrents")

  /** There are torrents saved from before (so starting the engine has something to do). */
  fun hasSaved(context: Context) = core != null || File(dir(context.applicationContext), "torrents.tsv").length() > 0

  /** Saves the rules; applies them now if the engine is running (doesn't start it). */
  @Synchronized
  fun setOptions(context: Context, wifi: Boolean?, vpn: Boolean?, seedRatioPct: Int?) {
    val prefs = context.applicationContext.getSharedPreferences("torrent-engine", Context.MODE_PRIVATE).edit()
    wifi?.let { wifiOnly = it; prefs.putBoolean("wifiOnly", it) }
    vpn?.let { vpnOnly = it; prefs.putBoolean("vpnOnly", it) }
    seedRatioPct?.let { pct -> core?.setSeedRatio(pct); prefs.putInt("seedRatioPct", pct) }
    prefs.apply()
    applyGate()
  }

  private fun watchNetwork() {
    if (watching) return
    watching = true
    val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = applyGate()
      override fun onLost(network: Network) = applyGate()
      override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = applyGate()
    })
  }

  @Synchronized
  fun applyGate() {
    val c = core ?: return
    val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val caps = cm.getNetworkCapabilities(cm.activeNetwork)
    val reason = when {
      wifiOnly && (caps == null || cm.isActiveNetworkMetered) -> "Waiting for Wi-Fi"
      vpnOnly && (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) -> "Waiting for a VPN"
      else -> null
    }
    blockedReason = reason
    c.setGate(reason == null)
  }
}
