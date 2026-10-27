import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// libbox.aar is built from the pinned sing-box alpha by supply-chain/sing-box/build-libbox.sh and is
// not committed. The build refuses any other bytes.
val libbox = layout.projectDirectory.file("libs/libbox.aar")
val libboxPin = rootProject.layout.projectDirectory.file("supply-chain/sing-box/libbox.aar.sha256")
val singBoxPin = rootProject.layout.projectDirectory.file("supply-chain/sing-box/sing-box.pin")
val singBoxVersion = singBoxPin.asFile.readLines().first { it.startsWith("SING_BOX_VERSION=") }.substringAfter('=')

val verifyLibbox by tasks.registering {
    group = "verification"
    description = "Verifies libs/libbox.aar against the pinned SHA-256."
    inputs.file(libboxPin)
    doLast {
        val aar = libbox.asFile
        check(aar.isFile) {
            "Missing ${aar.relativeTo(rootDir)}. Build it with: supply-chain/sing-box/build-libbox.sh android/mobile/libs"
        }
        val expected = libboxPin.asFile.readText().trim().substringBefore(' ')
        val actual = MessageDigest.getInstance("SHA-256").digest(aar.readBytes()).joinToString("") { "%02x".format(it) }
        check(actual == expected) { "libbox.aar SHA-256 $actual does not match pinned $expected" }
    }
}

android {
    namespace = "com.raydocs.tono.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.raydocs.tono.mobile"
        minSdk = 29
        targetSdk = 36
        versionCode = 4
        versionName = "0.3.1"
        buildConfigField("String", "SING_BOX_VERSION", "\"$singBoxVersion\"")
        buildConfigField("String", "API_BASE", "\"https://api.afk.ccwu.cc/api/v1/\"")
        ndk.abiFilters += listOf("arm64-v8a", "x86_64")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // EVIDENCE BRANCH ONLY (amp/android-size-probe): -Ptono.sizeProbe shrinks the test build with R8
    // and splits it per ABI, to measure size and run the device suite against shrunk code. Not a release
    // variant; nothing here is published.
    val sizeProbe = project.hasProperty("tono.sizeProbe")
    if (sizeProbe) {
        splits {
            abi {
                isEnable = true
                reset()
                include("arm64-v8a", "x86_64")
                isUniversalApk = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".test"
            versionNameSuffix = "-test"
            isDebuggable = true
            if (sizeProbe) {
                isMinifyEnabled = true
                isShrinkResources = true
                proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "size-probe-rules.pro")
                testProguardFiles("size-probe-rules.pro")
            }
        }
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
        aidl = true
    }

    packaging {
        jniLibs.useLegacyPackaging = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // Screenshot rendering (Robolectric native graphics + Roborazzi) is opt-in: -Ptono.screenshots
            it.systemProperty("tono.screenshots", project.hasProperty("tono.screenshots").toString())
            it.systemProperty("roborazzi.test.record", "true")
            it.systemProperty("roborazzi.output.dir", layout.buildDirectory.dir("screenshots").get().asFile.absolutePath)
            it.maxHeapSize = "1536m"
        }
    }
}

// Delivery gate for this round: only test builds exist. This is a product choice (internal testing,
// no store release authorised), not a licence prohibition; see docs/mobile/README.md.
androidComponents {
    beforeVariants(selector().withBuildType("release")) { it.enable = false }
}

tasks.named("preBuild") { dependsOn(verifyLibbox) }

dependencies {
    implementation(files("libs/libbox.aar"))
    // ":android:routing" in rw8/Tono-droid, ":routing" in the raydocs/tono export (apps/android).
    implementation(project(rootProject.findProject(":android:routing")?.path ?: ":routing"))

    val composeBom = platform("androidx.compose:compose-bom:2026.06.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4-accessibility")

    testImplementation("junit:junit:4.13.2")
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("androidx.compose.ui:ui-test-junit4-accessibility")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.76.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.76.0")
}
