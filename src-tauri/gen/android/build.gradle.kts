buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }

    // javac's own "source/target value 8 is obsolete" lint, which AGP's
    // suppressSourceTargetDeprecationWarning flag (gradle.properties) does not
    // cover. :app compiles at 17, but :tauri-android and
    // :tauri-plugin-safe-area-insets-css come from the cargo registry and
    // :tauri-plugin-notification is vendored, so their compileOptions cannot be
    // fixed durably here — verified on a clean build that :tauri-android is
    // what still emits it. Applied to every module rather than per-project for
    // that reason.
    tasks.withType<JavaCompile>().configureEach {
        options.compilerArgs.add("-Xlint:-options")
    }
}

tasks.register("clean").configure {
    delete("build")
}

