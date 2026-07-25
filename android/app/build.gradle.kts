plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.beladona.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.beladona.tv"
        minSdk = 22          // Fire OS 5 (Fire TV Stick 2a geracao) em diante
        targetSdk = 36
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// WebView faz parte do Android; nao precisa de dependencias extras.
dependencies {
}
