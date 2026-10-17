// Exported from rw8/Tono-droid by scripts/export-android-monorepo.sh; module build files are
// byte-identical to the source repository.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "TonoAndroid"

include(":routing", ":mobile")
