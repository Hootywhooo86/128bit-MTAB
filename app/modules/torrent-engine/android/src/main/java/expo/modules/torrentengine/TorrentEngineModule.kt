package expo.modules.torrentengine

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS side of the on-device torrent engine. Ids are the engine's small numbers; JS shows them as
 * negative TorBox-style ids so the rest of the app can treat both alike.
 */
class TorrentEngineModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun core() = TorrentHolder.get(context)

  private fun entry(id: Int) = core().byId(id) ?: throw IllegalArgumentException("No such torrent on this device")

  private fun status(e: TorrentCore.Entry): Map<String, Any?> =
    core().status(e).toMutableMap<String, Any?>().apply { put("blocked", TorrentHolder.blockedReason) }

  override fun definition() = ModuleDefinition {
    Name("TorrentEngine")

    /** Adds a magnet (or finds it) and starts it; returns its status. */
    AsyncFunction("add") { magnet: String, name: String? ->
      val e = core().add(magnet, name)
      TorrentService.ensure(context)
      status(e)
    }

    AsyncFunction("status") { id: Int -> status(entry(id)) }

    AsyncFunction("list") { core().all().map { status(it) } }

    /** Download only these files (null = all). */
    AsyncFunction("setWanted") { id: Int, files: List<Int>? ->
      core().setWanted(entry(id), files?.toIntArray())
      TorrentService.ensure(context)
    }

    /** Local URL for one file; `stream` downloads it in order so it can play straight away. */
    AsyncFunction("fileUrl") { id: Int, fileIndex: Int, stream: Boolean ->
      val url = core().fileUrl(entry(id), fileIndex, stream)
      TorrentService.ensure(context)
      url
    }

    AsyncFunction("pause") { id: Int -> core().pause(entry(id)) }

    AsyncFunction("resume") { id: Int ->
      core().resume(entry(id))
      TorrentService.ensure(context)
    }

    AsyncFunction("remove") { id: Int, deleteFiles: Boolean ->
      core().byId(id)?.let { core().remove(it, deleteFiles) }
      Unit
    }

    /** App opened: carry on with saved torrents in the background (Android 15 may have paused that). */
    AsyncFunction("wake") {
      if (TorrentHolder.hasSaved(context)) {
        core()
        TorrentService.ensure(context)
      }
    }

    /** Wi-Fi only, VPN only, and how much to upload back before stopping (ratio × 100). */
    AsyncFunction("setOptions") { wifiOnly: Boolean?, vpnOnly: Boolean?, seedRatioPct: Int? ->
      TorrentHolder.setOptions(context, wifiOnly, vpnOnly, seedRatioPct)
      mapOf("blocked" to TorrentHolder.blockedReason)
    }
  }
}
