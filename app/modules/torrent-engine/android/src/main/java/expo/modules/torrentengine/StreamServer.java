package expo.modules.torrentengine;

import com.frostwire.jlibtorrent.FileStorage;
import com.frostwire.jlibtorrent.TorrentHandle;
import com.frostwire.jlibtorrent.TorrentInfo;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A tiny HTTP server on 127.0.0.1 that serves torrent files with Range support:
 * GET /<hash>/<fileIndex>[/name]. Bytes that haven't downloaded yet are waited for (and
 * jumped to the front of the queue), so a video plays while the torrent is still coming in.
 */
final class StreamServer {
  private static final long PIECE_WAIT_MS = 120_000;

  private final TorrentCore core;
  private ServerSocket socket;
  private ExecutorService pool;
  private volatile boolean running;

  StreamServer(TorrentCore core) {
    this.core = core;
  }

  void start() throws IOException {
    socket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
    pool = Executors.newCachedThreadPool();
    running = true;
    Thread t = new Thread(() -> {
      while (running) {
        try {
          Socket s = socket.accept();
          pool.execute(() -> handle(s));
        } catch (IOException e) {
          if (!running) return;
        }
      }
    }, "torrent-http");
    t.setDaemon(true);
    t.start();
  }

  int port() {
    return socket == null ? 0 : socket.getLocalPort();
  }

  void stop() {
    running = false;
    try { socket.close(); } catch (Exception ignored) {}
    if (pool != null) pool.shutdownNow();
  }

  private static String type(String name) {
    String n = name.toLowerCase(Locale.ROOT);
    if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
    if (n.endsWith(".mkv")) return "video/x-matroska";
    if (n.endsWith(".webm")) return "video/webm";
    if (n.endsWith(".avi")) return "video/x-msvideo";
    if (n.endsWith(".mov")) return "video/quicktime";
    if (n.endsWith(".ts")) return "video/mp2t";
    if (n.endsWith(".mp3")) return "audio/mpeg";
    if (n.endsWith(".m4a") || n.endsWith(".m4b")) return "audio/mp4";
    if (n.endsWith(".flac")) return "audio/flac";
    if (n.endsWith(".ogg") || n.endsWith(".opus")) return "audio/ogg";
    if (n.endsWith(".cbz") || n.endsWith(".zip")) return "application/zip";
    if (n.endsWith(".cbr") || n.endsWith(".rar")) return "application/vnd.rar";
    return "application/octet-stream";
  }

  private void handle(Socket s) {
    try (Socket sock = s) {
      sock.setSoTimeout(30_000);
      BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.ISO_8859_1));
      String request = in.readLine();
      if (request == null) return;
      String range = null;
      String line;
      while ((line = in.readLine()) != null && !line.isEmpty()) {
        if (line.toLowerCase(Locale.ROOT).startsWith("range:")) range = line.substring(6).trim();
      }
      String[] parts = request.split(" ");
      boolean head = parts[0].equals("HEAD");
      String[] path = parts.length > 1 ? parts[1].split("\\?")[0].split("/") : new String[0];
      OutputStream out = sock.getOutputStream();
      if (path.length < 3) {
        status(out, 404, "Not Found");
        return;
      }
      TorrentCore.Entry e = core.byHash(path[1]);
      TorrentInfo ti = e == null ? null : core.info(e);
      TorrentHandle h = e == null ? null : core.handle(e);
      int index;
      try {
        index = Integer.parseInt(path[2]);
      } catch (NumberFormatException x) {
        index = -1;
      }
      if (ti == null || h == null || index < 0 || index >= ti.numFiles()) {
        status(out, 404, "Not Found");
        return;
      }
      FileStorage fs = ti.files();
      long size = fs.fileSize(index);
      File file = new File(core.dirOf(e), fs.filePath(index));
      long start = 0;
      long end = size - 1;
      boolean partial = false;
      if (range != null && range.startsWith("bytes=")) {
        String[] r = range.substring(6).split(",")[0].split("-", -1);
        try {
          if (r[0].isEmpty()) {
            start = Math.max(0, size - Long.parseLong(r[1]));
          } else {
            start = Long.parseLong(r[0]);
            if (r.length > 1 && !r[1].isEmpty()) end = Math.min(size - 1, Long.parseLong(r[1]));
          }
          partial = true;
        } catch (NumberFormatException ignored) {
          // Whole file.
        }
        if (start >= size || start > end) {
          String hdr = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
          out.write(hdr.getBytes(StandardCharsets.ISO_8859_1));
          return;
        }
      }
      long length = end - start + 1;
      StringBuilder hdr = new StringBuilder();
      hdr.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
      hdr.append("Content-Type: ").append(type(fs.fileName(index))).append("\r\n");
      hdr.append("Accept-Ranges: bytes\r\n");
      hdr.append("Content-Length: ").append(length).append("\r\n");
      if (partial) hdr.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(size).append("\r\n");
      hdr.append("Connection: close\r\n\r\n");
      out.write(hdr.toString().getBytes(StandardCharsets.ISO_8859_1));
      if (head) return;
      send(out, h, ti, index, file, start, end);
    } catch (SocketException ignored) {
      // The player closed the connection (seek, stop): normal.
    } catch (Exception ignored) {
      // Best effort.
    }
  }

  private static void status(OutputStream out, int code, String text) throws IOException {
    out.write(("HTTP/1.1 " + code + " " + text + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
  }

  /** Writes [start, end] of the file, waiting for (and hurrying) pieces not downloaded yet. */
  private void send(OutputStream out, TorrentHandle h, TorrentInfo ti, int index, File file, long start, long end)
      throws IOException, InterruptedException {
    long fileOffset = ti.files().fileOffset(index);
    int pl = ti.pieceLength();
    byte[] buf = new byte[64 * 1024];
    long pos = start;
    int lastPiece = -1;
    RandomAccessFile raf = null;
    try {
      while (pos <= end) {
        int piece = (int) ((fileOffset + pos) / pl);
        if (piece != lastPiece) {
          waitFor(h, ti, piece);
          lastPiece = piece;
        }
        long pieceEnd = (long) (piece + 1) * pl - fileOffset - 1; // last byte of this piece within the file
        long chunkEnd = Math.min(end, Math.min(pieceEnd, pos + buf.length - 1));
        if (raf == null) {
          while (!file.exists()) Thread.sleep(100);
          raf = new RandomAccessFile(file, "r");
        }
        raf.seek(pos);
        int n = (int) (chunkEnd - pos + 1);
        raf.readFully(buf, 0, n);
        out.write(buf, 0, n);
        pos += n;
      }
      out.flush();
    } finally {
      if (raf != null) raf.close();
    }
  }

  private void waitFor(TorrentHandle h, TorrentInfo ti, int piece) throws IOException, InterruptedException {
    if (h.havePiece(piece)) return;
    // This piece now, the next few right after.
    int n = ti.numPieces();
    for (int i = 0; i < 8 && piece + i < n; i++) h.setPieceDeadline(piece + i, i * 400);
    long until = System.currentTimeMillis() + PIECE_WAIT_MS;
    while (!h.havePiece(piece)) {
      if (System.currentTimeMillis() > until) throw new IOException("Timed out waiting for piece " + piece);
      Thread.sleep(150);
    }
  }
}
