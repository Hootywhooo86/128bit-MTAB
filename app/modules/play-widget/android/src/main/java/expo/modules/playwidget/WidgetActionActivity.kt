package expo.modules.playwidget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * A widget tap lands here (invisible). If the app is running, the action goes straight to
 * the audiobook player; if not, the app opens and resumes the last book.
 * It stays a moment so Android lets the player start in the background.
 */
class WidgetActionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val action = intent?.action ?: PlayWidget.ACTION_TOGGLE
    val module = PlayWidgetModule.live
    if (module != null && module.observing) {
      module.emit(action)
      Handler(Looper.getMainLooper()).postDelayed({ finish() }, 800)
      return
    }
    val key = getSharedPreferences(PlayWidget.PREFS, MODE_PRIVATE).getString("key", null)
    val open = if (key != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse("bit128://open?kind=book&play=1&key=" + Uri.encode(key))).setPackage(packageName)
    } else {
      packageManager.getLaunchIntentForPackage(packageName)
    }
    open?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      if (open != null) startActivity(open)
    } catch (_: Exception) {
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
    finish()
  }

  override fun finish() {
    super.finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }
}
