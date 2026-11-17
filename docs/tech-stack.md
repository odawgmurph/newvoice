# NewVoice — Recommended Tech Stack

Nov 17, 2026 · @Verona

## Summary

Build native mobile apps from day one, with all the voice analysis in one shared Rust library. The handbook makes the case for this itself: reliable feedback needs the raw microphone signal, and browsers don't guarantee it. Safari has a history of ignoring the setting that turns off echo cancellation, and TruVox's resonance tool only works in Chrome. A web app (PWA) would be quicker to ship, but it would be shaky on exactly the feature that sets this app apart.

## Voice analysis core: Rust

- One library handles pitch tracking (MPM/YIN live, pYIN for scoring), voice detection, formant estimation, and the weight/breathiness measures (CPPS, H1–H2, alpha).
- Rust builds for iOS, Android and the web (as WebAssembly) from the same code, so every platform gets the same numbers.
- Do the scoring here rather than in JavaScript so it's fast and consistent everywhere.

## App: React Native (Expo, using a custom development build)

- Write a small native module in Swift and Kotlin that opens the mic in its unprocessed mode: AVAudioSession `.measurement` on iOS, `UNPROCESSED` (or `VOICE_RECOGNITION`) on Android.
- That module feeds audio straight into the Rust core on a native thread. Only the computed results (about 100 per second) go to JavaScript, never the raw audio.
- Draw the live pitch and resonance displays with **react-native-skia** and **Reanimated** to get smooth 60 fps visuals.
- **Flutter with flutter\_rust\_bridge** is an equally good alternative. Pick whichever your team knows better; the Rust core stays the same either way.

## Storage: on the device, offline-first

- Use SQLite (op-sqlite or expo-sqlite) with Drizzle, plus SQLCipher encryption to back up the PIN lock and discretion features.
- Keep recordings as local files and record their location in the database, following the `Recording` / `SkillState` model in the handbook.
- Run the spaced-repetition scheduler (half-life regression adapted to practice skills) on the device in TypeScript.

## Backend: as little as possible at launch

- No account required. Ship the curriculum as JSON bundled with the app and update it over the air with EAS Update.
- If you add sync later, use Supabase (or similar) with end-to-end encryption, and never upload audio by default.
- Leave out ad SDKs. If you need analytics, use something self-hosted such as PostHog with no audio and no identity data.

## Testing the analysis: Python, run in CI

- Use Parselmouth (Python access to Praat) as the reference. Run synthetic tones and vowels plus real recordings through both the Rust core and Praat, and fail the build if they differ by more than about ±1% on F0 or ±5–8% on F1/F2.
- Praat is GPL-licensed. Keeping it in the test harness only means none of its code ships in the app.
- AcousticGender.space is AGPL, so treat it as a reference and don't copy its code.

## Later additions

- A web or desktop companion: compile the same Rust core to WebAssembly and run it in an AudioWorklet (Chrome-class browsers only).
- Neural pitch tracking (CREPE/FCPE) via ONNX Runtime Mobile, if the classic algorithms struggle with noise.
- Analysing read passages and spontaneous speech needs forced alignment, which is hard to do on the phone. For v1, build exercises around known targets (sustained vowels, single words) so you don't need it. Add alignment later with whisper.cpp timestamps.

## Sequencing

1. Build the Rust core and the Praat comparison tests first. They're the riskiest part and everything depends on them.
2. Build a bare iOS and Android app that shows a live pitch and F2 readout, and test it across a range of real phones.
3. Add lessons, scheduling, safety caps and onboarding on top.

## Fallback

If reaching people quickly matters more than accuracy at first, the fallback is a Chrome-first PWA built on the same Rust/WebAssembly core. Most of that work would carry over to the native apps later.
