# JNA and the UniFFI bindings are reached by reflection and by name from native code.
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
-keep class uniffi.newvoice_ffi.** { *; }
-dontwarn java.awt.**
