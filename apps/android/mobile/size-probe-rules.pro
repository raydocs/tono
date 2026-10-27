# Evidence branch only. gomobile's Go code calls these Java classes by name over JNI.
-keep class go.** { *; }
-keep class io.nekohasekai.libbox.** { *; }
# Names kept so the instrumentation APK (built against unshrunk names) still links.
-dontobfuscate
-dontwarn **
