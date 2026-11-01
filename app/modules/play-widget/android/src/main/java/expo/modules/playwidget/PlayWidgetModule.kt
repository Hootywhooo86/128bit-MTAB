package expo.modules.playwidget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** JS side of the widgets: the player saves what's playing here; widget taps come back as events. */
class PlayWidgetModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  @Volatile var observing = false

  fun emit(action: String) = sendEvent("widgetAction", mapOf("action" to action))

  override fun definition() = ModuleDefinition {
    Name("PlayWidget")
    Events("widgetAction")

    OnCreate { live = this@PlayWidgetModule }
    OnDestroy { if (live === this@PlayWidgetModule) live = null }
    OnStartObserving { observing = true }
    OnStopObserving { observing = false }

    /** What's playing (or was last): the widgets redraw; a new cover is fetched in the background. */
    Function("update") { key: String, title: String, subtitle: String?, cover: String?, playing: Boolean, accent: Int ->
      val ctx = context.applicationContext
      val prefs = ctx.getSharedPreferences(PlayWidget.PREFS, Context.MODE_PRIVATE)
      val coverChanged = prefs.getString("cover", null) != cover || !PlayWidget.coverFile(ctx).exists()
      prefs.edit()
        .putString("key", key)
        .putString("title", title)
        .putString("subtitle", subtitle)
        .putString("cover", cover)
        .putBoolean("playing", playing)
        .putInt("accent", accent)
        .apply()
      if (!coverChanged) {
        PlayWidget.refreshAll(ctx)
      } else {
        thread {
          saveCover(ctx, cover)
          PlayWidget.refreshAll(ctx)
        }
      }
      Unit
    }
  }

  /** Downloads (or reads) the cover and keeps a small square-ish copy for the widgets. */
  private fun saveCover(ctx: Context, cover: String?) {
    val file = PlayWidget.coverFile(ctx)
    try {
      if (cover.isNullOrBlank()) {
        file.delete()
        return
      }
      val bytes = if (cover.startsWith("http")) {
        val conn = URL(cover).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.inputStream.use { it.readBytes() }
      } else {
        java.io.File(cover.removePrefix("file://")).readBytes()
      }
      val full = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
      // Widgets get a bitmap size budget: keep it around 320 px.
      val scale = 320f / maxOf(full.width, full.height)
      val small = if (scale < 1f) Bitmap.createScaledBitmap(full, (full.width * scale).toInt(), (full.height * scale).toInt(), true) else full
      FileOutputStream(file).use { small.compress(Bitmap.CompressFormat.PNG, 100, it) }
    } catch (_: Throwable) {
      // Keep the old cover (or the app icon).
    }
  }

  companion object {
    @Volatile var live: PlayWidgetModule? = null
  }
}
