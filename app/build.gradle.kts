plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.jiuguan.sillytavern"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jiuguan.sillytavern.android"
        minSdk = 26
        targetSdk = 34
        versionCode = 11911
        versionName = "1.19.0-update.12"

        ndk {
            // ARM64 covers 99%+ of modern Android phones
            abiFilters += listOf("arm64-v8a")
        }
    }

    // Stable debug key for reproducible Android update builds.
    // Updating an already installed app also requires the SAME certificate
    // as that particular existing APK; matching applicationId alone is not enough.
    val stableDebugKeyStore = System.getenv("STABLE_DEBUG_KEYSTORE")
    if (!stableDebugKeyStore.isNullOrBlank()) {
        signingConfigs {
            create("stableDebug") {
                storeFile = file(stableDebugKeyStore)
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        // Keep the original app package for a potential in-place update.
        // Android still refuses installation if the old APK used another signing key.
        debug {
            versionNameSuffix = "-debug"
            if (!stableDebugKeyStore.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("stableDebug")
            }
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    // Don't compress bundled zip files (already compressed)
    androidResources {
        noCompress += listOf("zip")
    }

    // Force native libs to be extracted to disk (needed to execute libnode.so)
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.webkit:webkit:1.9.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.preference:preference-ktx:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
