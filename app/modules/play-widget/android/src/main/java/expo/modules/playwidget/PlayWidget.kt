package expo.modules.playwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.RemoteViews
import java.io.File

/** The two "Resume audiobook" widgets: 1x1 (cover + play) and 2x1 (cover, title, ◀◀ ▶ ▶▶). */
class PlayWidgetSmall : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    PlayWidget.render(context, manager, ids, wide = false)
}

class PlayWidgetWide : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    PlayWidget.render(context, manager, ids, wide = true)
}

object PlayWidget {
  const val PREFS = "128bit.playWidget"
  const val ACTION_TOGGLE = "toggle"
  const val ACTION_BACK = "back"
  const val ACTION_FORWARD = "forward"

  fun coverFile(context: Context) = File(context.filesDir, "play_widget_cover.png")

  /** Redraws every placed widget from what the app last saved. */
  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    render(context, manager, manager.getAppWidgetIds(ComponentName(context, PlayWidgetSmall::class.java)), false)
    render(context, manager, manager.getAppWidgetIds(ComponentName(context, PlayWidgetWide::class.java)), true)
  }

  fun render(context: Context, manager: AppWidgetManager, ids: IntArray, wide: Boolean) {
    if (ids.isEmpty()) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val playing = prefs.getBoolean("playing", false)
    val title = prefs.getString("title", null)
    val views = RemoteViews(context.packageName, if (wide) R.layout.play_widget_wide else R.layout.play_widget_small)

    val cover = loadCover(context)
    if (cover != null) views.setImageViewBitmap(R.id.widget_cover, cover)
    else appIcon(context)?.let { views.setImageViewResource(R.id.widget_cover, it) }

    views.setImageViewResource(R.id.widget_toggle_icon, if (playing) R.drawable.widget_pause else R.drawable.widget_play)
    views.setContentDescription(R.id.widget_toggle_icon, if (playing) "Pause" else "Play")
    views.setInt(R.id.widget_button_bg, "setColorFilter", prefs.getInt("accent", 0xFFFF8C2A.toInt()))

    // The whole small widget is one big button; the wide one has three.
    views.setOnClickPendingIntent(if (wide) R.id.widget_toggle else R.id.widget_root, action(context, ACTION_TOGGLE))
    if (wide) {
      views.setTextViewText(R.id.widget_title, title ?: "128bit")
      views.setTextViewText(R.id.widget_subtitle, prefs.getString("subtitle", null) ?: "Tap play to listen")
      views.setOnClickPendingIntent(R.id.widget_back, action(context, ACTION_BACK))
      views.setOnClickPendingIntent(R.id.widget_fwd, action(context, ACTION_FORWARD))
      views.setOnClickPendingIntent(R.id.widget_cover, action(context, ACTION_TOGGLE))
    }
    manager.updateAppWidget(ids, views)
  }

  private fun action(context: Context, name: String): PendingIntent {
    val intent = Intent(context, WidgetActionActivity::class.java)
      .setAction(name)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    return PendingIntent.getActivity(
      context,
      name.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun loadCover(context: Context): Bitmap? {
    val file = coverFile(context)
    if (!file.exists()) return null
    return try {
      BitmapFactory.decodeFile(file.absolutePath)
    } catch (_: Throwable) {
      null
    }
  }

  private fun appIcon(context: Context): Int? =
    context.resources.getIdentifier("ic_launcher", "mipmap", context.packageName).takeIf { it != 0 }
}
