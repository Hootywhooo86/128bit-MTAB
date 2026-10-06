# libtorrent's JNI bindings are looked up by name from native code.
-keep class com.frostwire.jlibtorrent.** { *; }
-dontwarn com.frostwire.jlibtorrent.**
