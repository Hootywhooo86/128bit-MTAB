package expo.modules.comicarchive

import android.os.ParcelFileDescriptor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import me.zhanghai.android.libarchive.Archive
import me.zhanghai.android.libarchive.ArchiveEntry
import java.io.File
import java.net.URLDecoder

private val IMAGE = Regex("\\.(jpe?g|png|webp|gif|avif)$", RegexOption.IGNORE_CASE)
private val JUNK = Regex("(^|/)(__MACOSX|\\.)")

private fun toPath(uri: String): String =
  if (uri.startsWith("file://")) URLDecoder.decode(uri.removePrefix("file://"), "UTF-8") else uri

/**
 * Comic archives: CBZ/ZIP, CBR (RAR4 and RAR5), CB7 and CBT, read with libarchive.
 * The pictures are written into a folder; JS puts them in reading order.
 */
class ComicArchiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ComicArchive")

    /** Extracts every picture; returns [{ name (path in the archive), uri (extracted file) }]. */
    AsyncFunction("extractImages") { archiveUri: String, outDirUri: String ->
      val outDir = File(toPath(outDirUri)).apply { mkdirs() }
      val found = mutableListOf<Map<String, String>>()
      val archive = Archive.readNew()
      try {
        Archive.readSupportFilterAll(archive)
        Archive.readSupportFormatAll(archive)
        Archive.readOpenFileName(archive, toPath(archiveUri).toByteArray(), 64 * 1024)
        var index = 0
        while (true) {
          val entry = Archive.readNextHeader(archive)
          if (entry == 0L) break
          val name = ArchiveEntry.pathnameUtf8(entry) ?: String(ArchiveEntry.pathname(entry) ?: ByteArray(0))
          val isFile = (ArchiveEntry.filetype(entry) and ArchiveEntry.AE_IFMT) == ArchiveEntry.AE_IFREG
          if (!isFile || !IMAGE.containsMatchIn(name) || JUNK.containsMatchIn(name)) {
            Archive.readDataSkip(archive)
            continue
          }
          val ext = IMAGE.find(name)!!.value.lowercase()
          val out = File(outDir, "x%05d%s".format(index++, ext))
          ParcelFileDescriptor.open(
            out,
            ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE,
          ).use { Archive.readDataIntoFd(archive, it.fd) }
          found.add(mapOf("name" to name, "uri" to "file://" + out.absolutePath))
        }
      } finally {
        try { Archive.readFree(archive) } catch (_: Exception) {}
      }
      found
    }
  }
}
