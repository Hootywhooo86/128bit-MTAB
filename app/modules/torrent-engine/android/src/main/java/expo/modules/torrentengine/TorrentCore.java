package expo.modules.torrentengine;

import com.frostwire.jlibtorrent.Priority;
import com.frostwire.jlibtorrent.SessionHandle;
import com.frostwire.jlibtorrent.SessionManager;
import com.frostwire.jlibtorrent.SessionParams;
import com.frostwire.jlibtorrent.SettingsPack;
import com.frostwire.jlibtorrent.Sha1Hash;
import com.frostwire.jlibtorrent.FileStorage;
import com.frostwire.jlibtorrent.TorrentFlags;
import com.frostwire.jlibtorrent.TorrentHandle;
import com.frostwire.jlibtorrent.TorrentInfo;
import com.frostwire.jlibtorrent.TorrentStatus;
import com.frostwire.jlibtorrent.swig.settings_pack;
import com.frostwire.jlibtorrent.swig.torrent_flags_t;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The on-device torrent engine (libtorrent via jlibtorrent), with no Android code so it can be
 * tested on a computer. Torrents are added by magnet; each gets a small number id (shown to JS
 * as a negative TorBox-style id). Files are served by {@link StreamServer} on 127.0.0.1, so the
 * player can stream a video while it downloads and audiobooks / comics read straight from disk.
 */
public final class TorrentCore {
  /** One torrent we manage. */
  public static final class Entry {
    public int id;
    public String hash;
    public String name;
    public String magnet;
    /** File indexes to download; null = all. */
    public int[] wanted;
    public boolean userPaused;
  }

  private final File baseDir;
  private final File stateFile;
  private final SessionManager session = new SessionManager(false);
  private final Map<String, Entry> entries = new LinkedHashMap<>();
  private int nextId = 1;
  private StreamServer server;
  private volatile boolean gateOpen = true;
  /** Upload until this ratio (x100) before stopping; 0 = stop as soon as it's done. */
  private volatile int seedRatioPct = 0;

  public TorrentCore(File baseDir) {
    this.baseDir = baseDir;
    this.stateFile = new File(baseDir, "torrents.tsv");
    baseDir.mkdirs();
  }

  // --- Lifecycle -------------------------------------------------------------------------

  public synchronized void start(Map<String, String> proxy) throws IOException {
    if (session.isRunning()) return;
    SettingsPack sp = new SettingsPack();
    sp.setEnableDht(true);
    sp.activeDownloads(4);
    sp.activeSeeds(2);
    sp.setString(settings_pack.string_types.user_agent.swigValue(), "128bitPlay/1.0 libtorrent/2.0");
    if (proxy != null && proxy.get("host") != null) {
      // Testing / restricted networks: everything through an HTTP proxy.
      sp.setInteger(settings_pack.int_types.proxy_type.swigValue(), settings_pack.proxy_type_t.http.swigValue());
      sp.setString(settings_pack.string_types.proxy_hostname.swigValue(), proxy.get("host"));
      sp.setInteger(settings_pack.int_types.proxy_port.swigValue(), Integer.parseInt(proxy.get("port")));
      sp.setBoolean(settings_pack.bool_types.proxy_peer_connections.swigValue(), true);
    }
    session.start(new SessionParams(sp));
    load();
    for (Entry e : entries.values()) readd(e);
    server = new StreamServer(this);
    server.start();
  }

  public synchronized void stop() {
    if (server != null) server.stop();
    if (session.isRunning()) session.stop();
  }

  public int port() {
    return server == null ? 0 : server.port();
  }

  // --- Torrents ---------------------------------------------------------------------------

  private static final Pattern BTIH = Pattern.compile("xt=urn:btih:([0-9a-zA-Z]+)");

  /** 40-hex info hash from a magnet (hex or base32). */
  static String hashOf(String magnet) {
    Matcher m = BTIH.matcher(magnet);
    if (!m.find()) throw new IllegalArgumentException("Not a magnet link");
    String h = m.group(1);
    if (h.length() == 40) return h.toLowerCase(Locale.ROOT);
    if (h.length() == 32) return base32ToHex(h.toUpperCase(Locale.ROOT));
    throw new IllegalArgumentException("Bad info hash in magnet");
  }

  private static String base32ToHex(String s) {
    String alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    StringBuilder bits = new StringBuilder();
    for (char c : s.toCharArray()) {
      String b = Integer.toBinaryString(alpha.indexOf(c));
      bits.append("00000".substring(b.length())).append(b);
    }
    StringBuilder hex = new StringBuilder();
    for (int i = 0; i + 4 <= bits.length(); i += 4) hex.append(Integer.toHexString(Integer.parseInt(bits.substring(i, i + 4), 2)));
    return hex.toString();
  }

  /** Adds a magnet (or returns the one already added). */
  public synchronized Entry add(String magnet, String name) throws IOException {
    String hash = hashOf(magnet);
    Entry e = entries.get(hash);
    if (e == null) {
      e = new Entry();
      e.id = nextId++;
      e.hash = hash;
      e.name = name == null || name.isEmpty() ? hash : name;
      e.magnet = magnet;
      entries.put(hash, e);
      save();
      readd(e);
    } else if (e.userPaused) {
      e.userPaused = false;
      TorrentHandle h = handle(e);
      if (h != null && gateOpen) h.resume();
      save();
    }
    return e;
  }

  private void readd(Entry e) {
    File dir = dirOf(e);
    dir.mkdirs();
    File meta = new File(baseDir, e.hash + ".torrent");
    torrent_flags_t flags = new torrent_flags_t();
    if (meta.exists()) {
      // Known metadata: start straight away and check what's already on disk.
      TorrentInfo ti = new TorrentInfo(meta);
      Priority[] prio = priorities(e, ti.numFiles());
      session.download(ti, dir, null, prio, null, flags);
    } else {
      session.download(e.magnet, dir, flags);
    }
    TorrentHandle h = handle(e);
    if (h != null && (e.userPaused || !gateOpen)) h.pause();
  }

  private static Priority[] priorities(Entry e, int n) {
    Priority[] p = new Priority[n];
    for (int i = 0; i < n; i++) p[i] = e.wanted == null ? Priority.NORMAL : Priority.IGNORE;
    if (e.wanted != null) for (int i : e.wanted) if (i >= 0 && i < n) p[i] = Priority.NORMAL;
    return p;
  }

  File dirOf(Entry e) {
    return new File(baseDir, e.hash);
  }

  TorrentHandle handle(Entry e) {
    if (!session.isRunning()) return null;
    TorrentHandle h = session.find(new Sha1Hash(e.hash));
    return h != null && h.isValid() ? h : null;
  }

  public synchronized Entry byId(int id) {
    for (Entry e : entries.values()) if (e.id == id) return e;
    return null;
  }

  synchronized Entry byHash(String hash) {
    return entries.get(hash);
  }

  public synchronized List<Entry> all() {
    return new ArrayList<>(entries.values());
  }

  /** The torrent's metadata (file list), once peers have sent it. Saved for restarts. */
  TorrentInfo info(Entry e) {
    TorrentHandle h = handle(e);
    if (h == null) return null;
    TorrentStatus st = h.status();
    if (!st.hasMetadata()) return null;
    TorrentInfo ti = h.torrentFile();
    if (ti == null) return null;
    File meta = new File(baseDir, e.hash + ".torrent");
    if (!meta.exists()) {
      try (FileOutputStream out = new FileOutputStream(meta)) {
        out.write(ti.bencode());
      } catch (Exception ignored) {
        // Next time.
      }
      if (e.name.equals(e.hash)) {
        e.name = ti.name();
        try { save(); } catch (IOException ignored) {}
      }
    }
    return ti;
  }

  /** Status for JS: shaped like a TorBox item. */
  public Map<String, Object> status(Entry e) {
    Map<String, Object> m = new HashMap<>();
    m.put("id", e.id);
    m.put("hash", e.hash);
    m.put("name", e.name);
    TorrentHandle h = handle(e);
    TorrentInfo ti = h == null ? null : info(e);
    List<Map<String, Object>> files = new ArrayList<>();
    double progress = 0;
    boolean finished = false;
    if (h != null) {
      TorrentStatus st = h.status();
      m.put("downloadRate", st.downloadPayloadRate());
      m.put("uploadRate", st.uploadPayloadRate());
      m.put("peers", st.numPeers());
      m.put("seeds", st.numSeeds());
      m.put("state", st.state().name().toLowerCase(Locale.ROOT));
      m.put("downloaded", st.totalWantedDone());
      m.put("total", st.totalWanted());
      m.put("hasMetadata", ti != null);
      if (ti != null) {
        long wanted = st.totalWanted();
        progress = wanted > 0 ? (double) st.totalWantedDone() / wanted : 0;
        finished = wanted > 0 && st.totalWantedDone() >= wanted;
        FileStorage fs = ti.files();
        long[] fp = h.fileProgress();
        for (int i = 0; i < fs.numFiles(); i++) {
          if (fs.padFileAt(i)) continue;
          Map<String, Object> f = new HashMap<>();
          f.put("id", i);
          f.put("name", fs.filePath(i));
          f.put("short_name", fs.fileName(i));
          f.put("size", fs.fileSize(i));
          f.put("done", fp != null && i < fp.length ? fp[i] : 0);
          f.put("wanted", h.filePriority(i) != Priority.IGNORE);
          files.add(f);
        }
      }
    } else {
      m.put("state", "stopped");
      m.put("hasMetadata", false);
    }
    m.put("progress", progress);
    m.put("finished", finished);
    m.put("paused", e.userPaused);
    m.put("files", files);
    return m;
  }

  /** Download only these files (null = all). */
  public synchronized void setWanted(Entry e, int[] wanted) throws IOException {
    e.wanted = wanted;
    save();
    TorrentHandle h = handle(e);
    TorrentInfo ti = info(e);
    if (h != null && ti != null) {
      Priority[] p = priorities(e, ti.numFiles());
      for (int i = 0; i < p.length; i++) h.filePriority(i, p[i]);
    }
  }

  /** Makes sure a file is being downloaded, in order, and returns its local URL. */
  public synchronized String fileUrl(Entry e, int fileIndex, boolean stream) throws IOException {
    TorrentHandle h = handle(e);
    TorrentInfo ti = info(e);
    if (h == null || ti == null) throw new IOException("The torrent's file list hasn't arrived yet");
    if (fileIndex < 0 || fileIndex >= ti.numFiles()) throw new IOException("No such file in the torrent");
    if (h.filePriority(fileIndex) == Priority.IGNORE) {
      int[] w = e.wanted == null ? new int[0] : e.wanted;
      int[] next = java.util.Arrays.copyOf(w, w.length + 1);
      next[w.length] = fileIndex;
      e.wanted = next;
      save();
      h.filePriority(fileIndex, Priority.NORMAL);
    }
    if (stream) {
      h.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD);
      if (!e.userPaused && gateOpen) h.resume();
      // The start (and the end, where MP4s keep their index) first.
      FileStorage fs = ti.files();
      int pl = ti.pieceLength();
      int first = (int) (fs.fileOffset(fileIndex) / pl);
      int last = (int) ((fs.fileOffset(fileIndex) + Math.max(0, fs.fileSize(fileIndex) - 1)) / pl);
      for (int i = 0; i < 6 && first + i <= last; i++) h.setPieceDeadline(first + i, 500 + i * 300);
      h.setPieceDeadline(last, 1000);
    }
    String name = URLEncoder.encode(ti.files().fileName(fileIndex), "UTF-8").replace("+", "%20");
    return "http://127.0.0.1:" + port() + "/" + e.hash + "/" + fileIndex + "/" + name;
  }

  public synchronized void pause(Entry e) throws IOException {
    e.userPaused = true;
    save();
    TorrentHandle h = handle(e);
    if (h != null) h.pause();
  }

  public synchronized void resume(Entry e) throws IOException {
    e.userPaused = false;
    save();
    TorrentHandle h = handle(e);
    if (h != null && gateOpen) h.resume();
  }

  public synchronized void remove(Entry e, boolean deleteFiles) throws IOException {
    TorrentHandle h = handle(e);
    if (h != null) session.remove(h, deleteFiles ? SessionHandle.DELETE_FILES : new com.frostwire.jlibtorrent.swig.remove_flags_t());
    entries.remove(e.hash);
    save();
    new File(baseDir, e.hash + ".torrent").delete();
    if (deleteFiles) deleteTree(dirOf(e));
  }

  private static void deleteTree(File f) {
    File[] kids = f.listFiles();
    if (kids != null) for (File k : kids) deleteTree(k);
    f.delete();
  }

  /** Wi-Fi-only / VPN-only: everything stops while the network isn't allowed. */
  public synchronized void setGate(boolean open) {
    if (gateOpen == open) return;
    gateOpen = open;
    for (Entry e : entries.values()) {
      TorrentHandle h = handle(e);
      if (h == null) continue;
      if (open && !e.userPaused) h.resume();
      if (!open) h.pause();
    }
  }

  public boolean gateOpen() {
    return gateOpen;
  }

  public void setSeedRatio(int pct) {
    seedRatioPct = Math.max(0, pct);
  }

  /**
   * Housekeeping, every couple of seconds: stop finished torrents (no seeding unless asked).
   * Returns how many torrents are still downloading.
   */
  public synchronized int tick() {
    int active = 0;
    for (Entry e : entries.values()) {
      TorrentHandle h = handle(e);
      if (h == null) continue;
      TorrentStatus st = h.status();
      boolean done = st.hasMetadata() && st.totalWanted() > 0 && st.totalWantedDone() >= st.totalWanted();
      if (!done) {
        if (!e.userPaused) active++;
        continue;
      }
      long down = Math.max(1, st.allTimeDownload());
      boolean ratioMet = st.allTimeUpload() * 100 / down >= seedRatioPct;
      if (ratioMet) h.pause(); // done: stop (no seeding unless a ratio is set)
    }
    return active;
  }

  /** Total speeds, for the notification. */
  public synchronized long[] rates() {
    long down = 0;
    long up = 0;
    for (Entry e : entries.values()) {
      TorrentHandle h = handle(e);
      if (h == null) continue;
      TorrentStatus st = h.status();
      down += st.downloadPayloadRate();
      up += st.uploadPayloadRate();
    }
    return new long[] {down, up};
  }

  // --- State file --------------------------------------------------------------------------

  private void save() throws IOException {
    StringBuilder sb = new StringBuilder();
    sb.append("next\t").append(nextId).append('\n');
    for (Entry e : entries.values()) {
      sb.append(e.id).append('\t').append(e.hash).append('\t').append(enc(e.name)).append('\t').append(enc(e.magnet)).append('\t');
      if (e.wanted == null) sb.append('*');
      else for (int i = 0; i < e.wanted.length; i++) sb.append(i > 0 ? "," : "").append(e.wanted[i]);
      sb.append('\t').append(e.userPaused ? '1' : '0').append('\n');
    }
    File tmp = new File(baseDir, "torrents.tsv.tmp");
    try (FileOutputStream out = new FileOutputStream(tmp)) {
      out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
    }
    tmp.renameTo(stateFile);
  }

  private void load() throws IOException {
    if (!stateFile.exists()) return;
    byte[] raw = new byte[(int) stateFile.length()];
    try (java.io.FileInputStream in = new java.io.FileInputStream(stateFile)) {
      int off = 0;
      while (off < raw.length) {
        int n = in.read(raw, off, raw.length - off);
        if (n < 0) break;
        off += n;
      }
    }
    for (String line : new String(raw, StandardCharsets.UTF_8).split("\n")) {
      String[] p = line.split("\t", -1);
      if (p.length == 2 && p[0].equals("next")) {
        nextId = Integer.parseInt(p[1]);
        continue;
      }
      if (p.length < 6) continue;
      Entry e = new Entry();
      e.id = Integer.parseInt(p[0]);
      e.hash = p[1];
      e.name = dec(p[2]);
      e.magnet = dec(p[3]);
      if (!p[4].equals("*")) {
        String[] w = p[4].isEmpty() ? new String[0] : p[4].split(",");
        e.wanted = new int[w.length];
        for (int i = 0; i < w.length; i++) e.wanted[i] = Integer.parseInt(w[i]);
      }
      e.userPaused = p[5].equals("1");
      entries.put(e.hash, e);
      nextId = Math.max(nextId, e.id + 1);
    }
  }

  private static String enc(String s) {
    try {
      return URLEncoder.encode(s, "UTF-8");
    } catch (Exception x) {
      return s;
    }
  }

  private static String dec(String s) {
    try {
      return URLDecoder.decode(s, "UTF-8");
    } catch (Exception x) {
      return s;
    }
  }
}
