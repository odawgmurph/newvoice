# NewVoice — Staged Build Plan

Nov 17, 2026 · built from *NewVoice — Recommended Tech Stack* and the *Transfeminine Voice Training Domain Handbook*

## What "complete" means

**v1 (launch):** native iOS + Android app, fully offline, no account. A shared Rust analysis core gives live, baseline-relative feedback on pitch, resonance, a weight/clarity proxy and intonation, with no gender labels by default. It runs a sequenced curriculum (Units 0–10) with ear training, spaced-repetition refreshers, hard-coded vocal-safety limits, and privacy/discretion features (PIN, discreet icon, quick exit, encrypted local storage). Every analysis number is CI-validated against Praat.

**Post-v1 ("complete"):** forced alignment for free-speech resonance, optional E2EE sync, a web/desktop companion, neural pitch fallback, and scoring weights fitted to a consented listener-rating study.

The order follows the tech-stack doc: **risky DSP first → prove capture on real phones → then build the product on top.** Each stage has exit criteria that must pass before the next stage depends on it.

## Progress

| Stage | Status | Notes |
|---|---|---|
| 0 Foundations | Done | Expo/React Native chosen (D1). No advisors for now, so safety limits are fixed in code (D2). Norms come from raw data (D6). CI builds every target (D7). |
| 1 Analysis core + Praat harness | Done | Exit criteria met, except low-end ARM timing, which moved to Stage 2 (needs the device matrix). Evidence: [`validation/stage1-synthetic.md`](validation/stage1-synthetic.md) and [`validation/stage1-real.md`](validation/stage1-real.md); decisions D8–D11. |
| 2 Capture spike | In progress | iOS first (D12): measurement-mode capture into the Rust core, live pitch trace + F2, capability and latency diagnostics, unsigned `.ipa` for AltStore ([`install-iphone.md`](install-iphone.md)). Works on the owner's iPhone (sideloaded, Nov 18). Device testing is the owner's iPhone only; the device matrix is dropped and other devices are community-tested via PRs (D14). Diagnostics export (D13): the app records a 30 s test clip and exports it with timing, cost and live frames; `harness/validation/device.py` scores it against Praat and the desktop core into [`validation/device-matrix.md`](validation/device-matrix.md). Android capture (to be built, not tested) and the go/no-go are still to come. |
| 4 App shell | In progress | Started before the Stage 2 go/no-go; none of it depends on capture results. First iteration (D15): Expo Router shell; encrypted SQLite (SQLCipher + Drizzle, handbook data model, migrations); PIN/Face ID lock with retry wait; quick exit; app-switcher shield; delete-all-data; onboarding (goal, playback comfort, environment, optional context, PIN, safety primer). Baseline capture, discreet name/icon and the privacy policy are still to come. Not yet run on a phone. |

**Stage 1, as built:**
- YIN/MPM live and pYIN for recordings.
- Semitone statistics.
- Multi-ceiling Burg formants, with known-boundary vowel measurement.
- ΔF/aVTL.
- CPPS, H1*–H2*, alpha, Hammarberg, L/H, HNR, jitter and shimmer.
- The weight index and the resonance score, both versioned heuristics.
- Fitted formant confidence.
- Streaming and batch FFI.
- Golden tests against Praat:
  - synthetic corpus with known truth;
  - Hillenbrand vowels against hand-checked values;
  - 20 LibriSpeech utterances, clean, noisy and through a telephone channel;
  - WASM output checked against native.

Differences from the plan:
- VCTK is not in the corpus; LibriSpeech and Hillenbrand cover read speech and vowels.
- "Codec" degradation is an emulated telephone channel (band-pass, 8 kHz, μ-law), not real codecs. Real codecs and Bluetooth paths come in with the Stage 2 device matrix.

---

## Stage 0 — Foundations and decisions (≈1–2 weeks)

**Goal:** remove decisions that would otherwise block or fork later work.

- **Pick the app framework:** React Native (Expo dev build) or Flutter + flutter_rust_bridge, based on what the team knows. The Rust core is the same either way.
- **Recruit advisors:** at least one SLP experienced in gender-affirming voice, plus a small trans community co-design group. Agree how they review curriculum copy, safety rules and UX.
- **Legal posture:** frame the product as general wellness/education. No "therapy", diagnosis or dysphonia-treatment claims. Get early counsel on biometric-data law (BIPA, TX, WA) and GDPR Art. 9.
- **Licensing rules:** Praat/Parselmouth stay in test tooling only (GPL). AcousticGender.space is reference only (AGPL). The Duolingo HLR code is MIT and can be adapted.
- **Reference data:** compute vowel F1/F2/F3 group means and spreads directly from Hillenbrand `vowdata.dat` / phonTools `h95`. This replaces the handbook values it flags as unverified (sex F0 means, F3, /ɔ/, /ɝ/). Store the results as versioned JSON in the repo.
- **Repo and CI skeleton:** a monorepo with `core/` (Rust), `app/`, `harness/` (Python), `content/` (curriculum JSON), and CI that builds Rust for iOS, Android and WASM targets.

**Exit:** framework chosen; advisors engaged; `reference_norms.json` generated from raw data; CI builds an empty Rust crate for all targets.

---

## Stage 1 — Rust analysis core + Praat validation harness (≈4–6 weeks) ⚠️ highest risk

**Goal:** one library that produces correct, consistent numbers on every platform.

**Core modules**
- Framing/ring buffer (32–46 ms windows, 10 ms hop) and VAD (RMS gate + voicing probability).
- **Pitch:** MPM/YIN for live use and pYIN for utterance scoring, searching 60–500 Hz. Includes a median filter (5–7 frames) and a jump guard (>7 ST unless sustained >50 ms).
- **Pitch stats in semitones:** median, p10/p90, SD, 5–95 range, plus note/cents helpers.
- **Formants:** Burg LPC with pre-emphasis and resampling to 2× ceiling. **Multi-ceiling sweep** (4500–6500 Hz in 250 Hz steps) choosing the lowest-variance track, Fast-Track style. Measures only steady-state vowel midpoints when boundaries are known.
- **Vocal tract length:** ΔF via zero-intercept regression, then aVTL = c/2ΔF.
- **Voice quality:** CPPS, H1–H2 (with Iseli/Hanson correction), alpha ratio, Hammarberg index, L/H ratio, HNR, jitter and shimmer.
- **Composite scores (versioned, labelled as heuristics):** the vowel-normalised resonance score (0 = male ref, 1 = female ref) and the weight index (z of −H1*–H2*, alpha and CPPS vs baseline).
- **Confidence output** on every measure, to be used later to hide unreliable readouts (especially formants at high F0).
- **FFI surface:** a streaming API (push samples, pull ~100 results/s) and a batch API (analyse a finished recording).

**Validation harness (Python, in CI)**
- Corpus: synthetic sines/sawtooths at known F0; synthesised vowels with known formants at F0 100–300 Hz; Hillenbrand tokens; VCTK and LibriSpeech clips (CC BY); added noise and codec degradations.
- Golden comparisons against Parselmouth. **The build fails beyond ±1% F0 or ±5–8% F1/F2.**
- A specific high-F0 test set, so formant error versus F0 is measured rather than assumed.
- Performance benchmarks on a low-end ARM target: per-frame cost must fit easily inside the 10 ms hop.

**Exit:** all golden tests green on native and WASM builds; error-vs-F0 curve documented; real-time budget met on low-end hardware.

---

## Stage 2 — Native capture spike + device matrix (≈3–4 weeks)

**Goal:** prove the product's main bet, unprocessed mic → accurate live feedback, works on real phones.

- Native module (Swift/Kotlin) that opens the mic unprocessed: iOS AVAudioSession `.measurement`; Android `UNPROCESSED`, falling back to `VOICE_RECOGNITION`.
- Audio flows mic → Rust on a native thread. Only computed results reach JS/Dart, never raw audio.
- Bare app with a live pitch trace on a semitone axis plus a live F2 readout, drawn with react-native-skia + Reanimated (or the Flutter equivalent).
- **Capability detection:** report whether the device actually honoured unprocessed mode. Where it didn't, flag reduced accuracy and record it in diagnostics.
- **Real-time budget on low-end ARM** (moved from Stage 1): run `newvoice-cli bench` (or the same loop through the FFI) on the cheapest phones in the matrix; per-frame cost must fit easily inside the 10 ms hop. It is about 0.55 ms per frame on x86.
- ~~**Device matrix:**~~ *Dropped (D14): testing is on the owner's iPhone only; anyone else sideloads and sends PRs for device-specific fixes.* Was: test across roughly 15–25 phones covering budget and flagship Android brands and several iPhone generations, with built-in mic, wired headset and Bluetooth. Compare readings against a reference recording run through Praat.

**Exit (D14: judged on the owner's iPhone):** <100 ms mic-to-screen latency; steady 60 fps; accuracy against a Praat reference recorded for that phone; a supported-device policy decided, including a Bluetooth-mic warning.

**Go/no-go:** if unprocessed capture proves unreliable on too many devices, revisit scope before building the product layer. Options: a Chrome-first PWA fallback, or a narrower device list.

---

## Stage 3 — Feedback engine and visualisations (≈3–4 weeks)

**Goal:** turn numbers into feedback that is useful, robust and dysphoria-safe.

- **Views:** live semitone pitch trace with a target band; 2D pitch × resonance map; F1×F2 vowel chart with reference ellipses; optional LPC "wave" view.
- **Baseline-relative zones:** targets derived from the user's baseline and goal, raised gradually (e.g. +1 ST or +3% F2 per mastered level).
- **Robustness UX:** medians, a minimum voiced duration (1–2 s) before showing utterance scores, and readouts hidden or greyed when confidence is low.
- **Default labels:** lighter/heavier, brighter/darker, higher/lower. Male/female bands only if the user opts in.
- **Strain monitor (safety coupling):** in-session trends in jitter/shimmer, falling CPPS, F0 above the user's comfortable p90, and self-reported effort ≥6/10. Any one triggers a rest prompt. Never reward F0 above the comfortable p90.
- **Feedback-fading support:** each view can run as live, summary-only or delayed, so the curriculum can fade feedback.

**Exit:** advisors and co-design group review the views; strain triggers tested with deliberately strained recordings; no gendered labels appear without opt-in.

---

## Stage 4 — App shell, storage, privacy, onboarding (≈3–4 weeks; can overlap Stage 3)

- **Storage:** SQLite (op-sqlite/expo-sqlite) + Drizzle + SQLCipher. Tables follow the handbook model: `User`, `Session`, `Recording` (local file URI + feature vector + confidence), `SkillState`, `Journal`. Migrations from day one.
- **Privacy and discretion:** PIN/biometric lock, discreet app name and icon, quick-exit gesture, quiet/whisper practice modes, playback opt-in, "metrics-only" mode, and delete-all-data. No ad SDKs. Analytics off or self-hosted (PostHog) with no audio and no identity data.
- **Onboarding:** goal (feminine / androgynous / flexible / my own), playback comfort, environment, language/dialect, optional hormone/surgery and SLP status, and a safety primer.
- **Baseline capture:** sustained /a/ /i/ /u/, a glide, a reading passage and 30 s of spontaneous speech. Comfortable range comes from the glide; baseline features are stored.

**Exit:** a fresh install reaches a stored baseline fully offline; encrypted DB verified; quick exit and PIN tested; privacy policy drafted.

---

## Stage 5 — Curriculum engine, exercises, ear training, safety layer (≈6–8 weeks)

**Goal:** the lesson system plus Units 0–6, which form the core training path.

- **Content schema (JSON, bundled, OTA-updatable via EAS Update):** units → skills → lessons → exercise instances, each with target parameters and a **machine-checkable pass criterion** (e.g. "median F0 within ±50 cents for ≥600 ms on 8/10 items").
- **Exercise renderers** covering handbook E1–E19 by type: match-the-pitch, hold-the-target, sirens/slides, whisper (formant-only scoring), read-aloud, repeat-after-me, self-rating vs metrics, and opt-in A/B against past recordings.
- **Ear training:** an offline Python pipeline (pyworld/WORLD, or Praat-generated audio, which is fine to ship as audio output) creates stimuli with F0 held and formants shifted ±5–20%, and the reverse. Item types are AB, odd-one-out and slider. An adaptive staircase targets ~80%.
- **Units 0–6:** Setup → Hearing → Pitch → Light weight → Size → Brightness → Combine, with the unlock criteria from handbook §4.1.
- **Safety layer (hard-coded, not configurable away):** required SOVT warm-up and cool-down; ~20-minute soft session cap and a daily maximum; in-app hard stop on pain, rawness, hoarseness or rising effort; referral copy (ENT + SLP) for hoarseness lasting more than about 2 weeks, pain or blood.
- **Alternate track:** a TVL-style resonance-first ordering that users can choose instead.

**Exit:** an SLP has signed off on exercise wording and safety rules; every unlock criterion is unit-tested against recorded fixtures; a user can go from Unit 0 to Unit 6 end to end.

---

## Stage 6 — Learning loop and motivation (≈3 weeks)

- **Scheduler (TypeScript, on device):** half-life regression adapted to motor skills. Recall probability is replaced by *measured performance decay* on refresher items, and skill refreshers are scheduled from it. Mastery decays with time since last success.
- **Motor-learning rules in the engine:** random over blocked practice once a skill is acquired; feedback fades from 100% live to 50% to end-of-utterance only; knowledge of performance early, knowledge of results later; challenge point adaptation keeps success around 70–80%.
- **Gamification with guardrails:** streaks with credited rest days and a voice-rest/illness freeze; capped daily XP for voice use; no hearts on production tasks; process metrics such as minutes, consistency and range comfort celebrated.

**Exit:** simulated multi-week usage shows refreshers scheduled sensibly and caps enforced; no path rewards practising past the safety limits.

---

## Stage 7 — Units 7–10 and carryover (v1 scope) (≈4–5 weeks)

- **Unit 7, Melody:** rising contours, semitone range per utterance, % rising terminals. Framed as a style choice.
- **Unit 8, Articulate:** forward consonants and nonverbal drills (laugh, "oops", cough, calling out). The /s/ spectral centre of gravity is shown only where the device supports a high enough sample rate; otherwise this unit is self-rated.
- **Unit 9, Carryover:** reading → prompts → 60 s spontaneous speech. **v1 limitation (from the tech-stack doc):** without forced alignment, free-speech scoring uses F0 stats, intonation and the weight proxy. Resonance is scored only on known-target segments such as prompted vowels and words.
- **Unit 10, Life:** phone voice, loud voice, emotional voice and self-reported "voice in the wild" missions.
- **Journal**, plus an opt-in progress timeline comparing past recordings.

**Exit:** the full Units 0–10 path is playable; carryover metrics are stable on test recordings; the copy has passed stereotype review with the co-design group.

---

## Stage 8 — Hardening, review and closed beta (≈4–6 weeks)

- **Reviews:** SLP clinical-safety review; legal review of wellness claims, privacy policy, biometric consent and data deletion; accessibility (screen readers, colour-blind-safe charts, captions on audio).
- **Closed beta** through TestFlight and Play internal testing, recruited with the co-design group. Collect usage, crash and device-accuracy diagnostics with **no audio uploaded**, plus TWVQ/VENI and Gender Voice Index self-reports at the start and after 4 weeks.
- **Store readiness:** microphone-permission copy, privacy nutrition labels and data-safety forms, and the discreet-icon implementation checked against store rules.
- **Performance:** battery and thermal checks during 20-minute sessions; checks on low-end devices.

**Exit:** no open safety or privacy issues; crash-free sessions ≥99.5%; beta users can complete Units 0–6; feedback triaged.

---

## Stage 9 — v1 launch (≈1–2 weeks)

Public release on iOS and Android, with curriculum fixes delivered OTA. Publish a plain-language "how the numbers work and their limits" page, covering heuristic weight, formant confidence at high F0, and the absence of any pass/fail claim.

---

## Stage 10 — Post-launch, toward "complete"

Roughly in priority order:

1. **Forced alignment** (whisper.cpp timestamps on device) so resonance can be scored on vowels in free speech and reading passages. This unlocks full carryover scoring.
2. **Listener-rating validation study:** consented, ethically reviewed and community-overseen. Use it to fit the composite score weights and to validate (or revise) the weight index. Until then, make no claims about perceived gender.
3. **Neural pitch fallback** (CREPE/FCPE via ONNX Runtime Mobile) for noisy environments, behind the same confidence gate.
4. **Optional sync** (Supabase or similar) with end-to-end encryption. Audio is never uploaded by default.
5. **Web/desktop companion:** the Rust core compiled to WASM, running in an AudioWorklet (Chrome-class browsers).
6. **Non-English and dialect norms**, and localisation.
7. **Optional, user-requested ML "listener estimate"**, clearly framed, never a default.

---

## Cross-cutting tracks (every stage)

- **Accuracy:** each Rust change runs the Praat golden suite, and the device matrix is re-run each release.
- **Safety:** an SLP reviews any new exercise or scoring change that could reward pushing F0 or effort.
- **Privacy:** audio stays on device; data minimisation; deletion works; no third-party SDK added without review.
- **Community:** the co-design group reviews copy, labels and goals (nonbinary and "switchable" goals are first-class).

## Key risks and mitigations

| Risk | Where it bites | Mitigation |
|---|---|---|
| Phones ignore unprocessed-mic requests | Stage 2 | Capability detection, device policy, go/no-go gate, PWA fallback |
| Formant error at high F0 / voices in transition | Stages 1, 3 | Multi-ceiling LPC, frame averaging, whisper-mode sizing, confidence gating |
| "Weight index" doesn't track perceived weight | Stage 3 onward | Label as a proxy; Stage 10 validation study |
| Training pushes users into strain | Stages 5–6 | Hard caps, strain monitor, no hearts, SLP review |
| Stereotyped or gendering UX causes harm | All | Neutral labels by default, opt-in bands, co-design review |
| Regulatory drift into medical-device territory | Stages 0, 8 | Wellness positioning, legal review of all claims |
| Small or English-centric evidence base | Content | Present thresholds as graded and descriptive; localise norms later |

## Rough total

For a team of about 3 (one Rust/DSP engineer, one or two app engineers, with part-time design and SLP input), v1 is roughly **8–11 months**. Stages 3 and 4 overlap, and content authoring for Stage 5 can start during Stage 2. These durations are estimates for planning, not commitments.
