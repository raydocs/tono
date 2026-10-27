# Evidence branch only. gomobile's Go code calls these Java classes by name over JNI.
-keep class go.** { *; }
-keep class io.nekohasekai.libbox.** { *; }
# Names kept so the instrumentation APK (built against unshrunk names) still links.
-dontobfuscate
-dontwarn **
# Round 2 (run 40577342282: NoClassDefFoundError kotlin.LazyKt in AndroidJUnitRunner): the
# instrumentation APK borrows these libraries from the app, so a shrunk app breaks the runner, not
# the app. Kept here only so the device suite runs against R8-processed app code; the strict sizes
# were measured without these lines.
-keep class kotlin.** { *; }
-keep class kotlinx.** { *; }
-keep class androidx.** { *; }
