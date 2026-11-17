# Transfeminine Voice Training: A Domain Handbook for Building a Duolingo-Style Voice App

The most important thing to know is that a voice usually sounds feminine because of several cues working together. The main ones are pitch (F0), vocal-tract resonance (formants, sometimes called "size" or "R1/F2 brightness") and vocal weight (fold-contact "heaviness"). Intonation, articulation and learned "microbehaviours" sit on top of those. No single number makes a voice sound feminine. Pitch is the strongest single predictor in the research but is not enough on its own.\[1\] Pitch and resonance together are needed to reliably change how listeners hear a speaker's gender.\[2\] An app should therefore train and measure several dimensions continuously, and should not give a binary "passes / doesn't pass" verdict.

## TL;DR

- **What to target:** In the research, speaking F0 is the strongest single cue. A meta-analysis found it explained 41.6% of the variance in gender perception. Studies of trans speakers found that no one was heard as female below about 145–164 Hz, and ratings were reliably feminine from about 180 Hz. Resonance (higher F1/F2, shorter apparent vocal tract) is the necessary partner: shifting F0 or formants alone usually fails, while shifting both changed perceived sex in about 82% of cases. Vocal weight, intonation (more upward contours, wider semitone range) and articulation refine the result.
- **How to train it:** Use a sequenced curriculum. Start with ear training. Then teach weight and pitch together (coaches like Sumian warn that resonance-first training often causes constriction), then resonance and size, then combining the parameters, prosody and articulation, and finally carryover into conversation. Apply motor-learning principles: varied practice, feedback that fades over time, and short sessions spread across the day. Treat vocal health as a hard limit, not a suggestion.
- **How to measure it:** Track F0 with pYIN/YIN/MPM, reporting the median and distribution in semitones. Estimate formants with LPC (Burg), using a speaker-adaptive ceiling. Estimate vocal tract length from formant spacing (aVTL = c/2ΔF). Measure weight and breathiness with CPPS, H1–H2 and spectral tilt. Show all of these on a 2D or 3D map relative to the user's own baseline and goal, without "male/female" labels by default. TruVox (NYU/Cincinnati), a peer-reviewed browser tool, is the closest existing model for real-time resonance biofeedback.

---

## Key Findings

1. **F0 is the strongest single predictor, but not sufficient on its own.** Leung, Oates & Chan (2018, JSLHR 61(2):266–297) reviewed 38 articles.\[3\] They found that speaking F0 accounted for 41.6% of the variance in gender perception, that tempo and stress were not significantly associated, and that the evidence on breathiness was mixed.\[1\]\[3\] In Hillenbrand & Clark (2009), shifting both F0 and formants changed perceived sex in about 82% of utterances, but shifting either one alone usually did not.\[2\] Gelfer & Bennett (2013) found the same pattern: shifting only the formant envelope changed perception in 18.9% of male samples, while shifting both changed it in 81.9%.\[4\]
2. **Pitch thresholds for trans women are graded, not a cliff.** In older studies, trans speakers at about 145 Hz or below (Wolfe et al.) or 160 Hz or below (Spencer) were heard as male. The lowest F0 at which a trans speaker was heard as female was about 164 Hz (Gelfer & Schofield, 2000).\[4\] Feminine ratings were associated with about 180 Hz or more.\[5\] In Gelfer & Schofield, speakers heard consistently as male still had F0s as high as 181 Hz.\[4\] This is direct evidence that pitch alone fails.
3. **Resonance is trainable with visual biofeedback.** Kawitzky & McAllister (2020, J Voice 34(1):53–67) showed that trans women could raise F2 using a real-time LPC display, and that higher F2 went with higher femininity ratings.\[6\]\[7\] TruVox's resonance module scored a mean System Usability Scale of 75.25 (SD 10.7).\[8\] In single-session testing, 8 of 10 participants trended toward higher F2.\[9\]
4. **Coaches and researchers disagree about the order of training and whether pitch matters.** Peer-reviewed perception studies rank F0 first. Sumian's pedagogy says the opposite: "pitch isn't a gendered factor, but is very useful as a tool to modify other components". It recommends starting with weight and pitch together.\[10\] TransVoiceLessons calls R1 (pharyngeal resonance) "the single most powerful element".\[11\]\[12\] The two positions can be reconciled. Lab studies measure *perception* using synthesized or natural speech in which F0 and weight are confounded. Coaches describe *production*, where raising pitch without managing weight sounds strained or falsetto-like. An app should treat all of these as interacting dimensions.
5. **Breathiness is a weak, contested cue.** Van Borsel et al. found that breathy samples were judged more feminine.\[13\] Cis women are measurably breathier on CPP and H1–H2.\[14\]\[15\] But Leung's meta-analysis found mixed effects.\[3\] McKenna, Gustin, Novak et al. (J Voice 2026; 16 clients) found mean F0 rose by 5.4 semitones and F2 rose after therapy, with no change in HNR or CPP. In other words, successful feminization did not require added breathiness. Do not reward breathiness on its own. A breathy voice over a heavy configuration sounds "hollow".
6. **Surgery mainly raises pitch.** Wendler glottoplasty raised speaking F0 by 83.48 Hz (about 8.36 semitones) in a meta-analysis of 20 studies and 656 patients (Rogalska et al., Eur Arch Otorhinolaryngol 2024). A phonosurgery meta-analysis (Nolan et al., J Craniofac Surg 2019) found average F0 gains of 31 Hz (voice therapy), 39 Hz (cricothyroid approximation) and 72 Hz (endoscopic shortening). Surgery does not change resonance, so training is still needed afterwards. Estrogen does not reverse testosterone-driven fold growth or vocal tract lengthening.

---

## Part 1 — The Perceptual Markers

### 1.1 A note on "dissonance"
"Dissonance" in the request almost certainly means **resonance**, which is covered in depth in 1.3. Two related ideas could also be meant. Mismatched configurations (for example high pitch with heavy weight and dark resonance) sound "off", and coaches describe this as an imbalance. Roughness (jitter, shimmer, low HNR) is aperiodic noise that coaches want removed first. Sumian's axiom: "If we have roughness, we should eliminate that before using the voice wherever possible".\[10\]

### 1.2 Pitch / Fundamental Frequency (F0)

**Physiology.** F0 is the rate at which the vocal folds vibrate. It is set by fold length, tension (the cricothyroid muscle lengthens the folds; the thyroarytenoid shortens and thickens them) and vibrating mass. Testosterone at puberty lengthens and thickens the folds, which lowers F0 by roughly an octave. Estrogen in adulthood does not reverse this.

**Typical ranges (general literature; summary values):**

| Group | Typical mean speaking F0 | Notes |
|---|---|---|
| Cis men (adult) | ~100–140 Hz (≈G2–C#3) | Davies et al. call the cis male speaking range "roughly 100–140 Hz"\[16\] |
| "Gender-ambiguous" zone | ~145–175 Hz | Varies by study and language; this is where resonance and weight decide perception |
| Lowest heard as female in trans speakers | ~164 Hz (≈E3) | Gelfer & Schofield 2000\[4\] |
| Feminine ratings | ≥~180 Hz (≈F#3) | Associated with feminine ratings in older studies\[5\] |
| Cis women (adult) | ~180–230 Hz (≈F#3–A#3) | US norms. Computed from Hillenbrand (1995) raw data: per-speaker median F0 averages 130 Hz for men (n=45) and 219 Hz for women (n=48); the often-quoted 138/227 Hz are the /i/ "heed" means (`content/norms/reference_norms.json`) |
| Coach "sweet spot" for training | 170–200 Hz | Sumian; she suggests about 200 Hz (≈G3) as a training pitch for most learners\[10\]\[17\] |

**Interactions.** Sumian describes an inverse link between pitch and weight: going higher usually lightens the voice, and going lower adds weight.\[10\]\[18\] Raising pitch alone with a heavy voice produces strain or a falsetto-like "Mickey Mouse" quality. A higher comfortable range makes a given resonance easier to hold, but it "does not raise resonance directly" (Sumian).\[10\] Low-pitched feminine voices are possible but require very good control of weight and microbehaviours.\[19\]

**Semitones.** Perception of pitch is roughly logarithmic, so all pitch feedback and statistics should use semitones (ST). Formulas:
- ST relative to reference r: `st = 12 · log2(f / r)`. Common references are 100 Hz, 55 Hz (A1) and the user's baseline median.
- MIDI note: `m = 69 + 12 · log2(f / 440)`. Note name = `["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][round(m) % 12]`, octave = `floor(round(m)/12) − 1`.
- Cents deviation: `100 · (m − round(m))`.
- Hz from ST: `f = r · 2^(st/12)`.
- Example: 120 Hz to 200 Hz is 12·log2(1.667) ≈ 8.8 ST.

### 1.3 Resonance / Vocal Tract Size / "Brightness" / R1

**Physiology and acoustics.** The vocal tract (larynx to lips) works roughly like a tube closed at the glottis and open at the lips. Its resonances are the formants (F1, F2, F3, F4…). In a uniform tube, `Fi = (2i − 1) · c / (4L)`, where c ≈ 35,000 cm/s. Shorter tubes have higher, more widely spaced formants. Adult male vocal tracts average about 17 cm and female about 14.5 cm. Male formants are typically about 10–20% lower,\[20\] and male formant spacing (ΔF) is about 15–20% narrower.

**What the speaker can control:**
- **Larynx height.** Raising the larynx shortens the tract and raises all formants. TransVoiceLessons' "R1" is the pharyngeal resonance, which coaches treat as the main "gender knob".\[11\] Sumian notes that the larynx can be raised mainly with the stylohyoid muscles rather than also pulling with the thyrohyoid.\[10\]
- **Pharyngeal space.** A narrower pharynx (less "yawny" open throat) raises the pharyngeal resonance.
- **Tongue position.** A forward tongue raises F2, which is what Kawitzky & McAllister trained.\[7\]
- **Lip spreading / smiling.** Spread lips shorten the effective tract and raise the formants. Rounded or protruded lips lower them. Carew, Dacakis & Oates (2007) used forward tongue carriage and lip spreading in oral resonance therapy.\[21\]
- **Oral space and jaw.** Sumian lists "mouth space" and "OPC" (oral-pharyngeal constriction) as resonance levers.\[10\]

**Reference formant values (Hillenbrand et al. 1995, as reproduced by Yao, Tilsen, Sprouse & Johnson 2010, Table 6; F1/F2 in Hz):**\[22\]

| Vowel | Men F1 | Men F2 | Women F1 | Women F2 | F2 ratio W/M |
|---|---|---|---|---|---|
| /i/ heed | 342 | 2322 | 437 | 2761 | 1.19 |
| /ɪ/ hid | 427 | 2034 | 483 | 2365 | 1.16 |
| /e/ hayed | 476 | 2089 | 536 | 2530 | 1.21 |
| /ɛ/ head | 580 | 1799 | 731 | 2058 | 1.14 |
| /æ/ had | 588 | 1952 | 669 | 2349 | 1.20 |
| /ɑ/ hod | 768 | 1333 | 936 | 1551 | 1.16 |
| /ʌ/ hud | 623 | 1200 | 753 | 1426 | 1.19 |
| /o/ hoed | 497 | 910 | 555 | 1035 | 1.14 |
| /ʊ/ hood | 469 | 1122 | 519 | 1225 | 1.09 |
| /u/ who'd | 378 | 997 | 459 | 1105 | 1.11 |

**Verified against raw data (Nov 2026).** `harness/norms/build_norms.py` computes these means directly from Hillenbrand's per-token `vowdata.dat`, with unmeasurable values excluded rather than imputed, and writes them to `content/norms/reference_norms.json`. The app uses that file, not this table.\[24\] The table above agrees with the raw-data means within 2% for every vowel; /ɛ æ ɑ ʌ/ differ most, probably because of differences in which tokens were included. Raw-data F3 means: men /i/ 3001, /æ/ 2595, /ɑ/ 2535, /u/ 2355; women /i/ 3373, /æ/ 2973, /ɑ/ 2832, /u/ 2735. This confirms the secondary-source values within about 0.6%.\[20\] The raw data also gives the vowels missing above: /ɔ/ "hawed" is men 656 / 1023 and women 804 / 1188 (F1 / F2); /ɝ/ "heard" is men 475 / 1379 and women 524 / 1588, with a low F3 (1711 / 1930) characteristic of r-colouring. Peterson & Barney (1952) values remain unverified and are left out.\[23\]

**Coach target:** Sumian says an /a/ F1 of about 700–800 Hz "seems to be about the minimum that most people can do in a feminine configuration", and that F1 above about 1200 Hz "sounds out of place".\[10\] This matches the women's /ɑ/ F1 of 936 Hz above.

**Importance.** F2 correlates more strongly with masculinity/femininity ratings than F1 or F3 (as summarized in an arXiv voice-gender-scoring study).\[25\] Resonance and brightness are related but not the same thing. A high-resonance voice can sound dark because of breathiness or nasality, and a low-resonance voice can sound bright because of adduction and light weight (Sumian).\[10\]

### 1.4 Vocal Weight / Heaviness / Fold Mass / Closed Quotient

**Definition.** Vocal weight is a perceived "heaviness", which Sumian describes as heard in isolation as a "rumble-like" quality.\[10\] Physiologically it is thought to reflect thicker, more deeply contacting folds with a longer closed phase: a higher closed quotient (CQ) and more thyroarytenoid activity. It corresponds roughly to the **M1 (chest)** laryngeal mechanism with thick-fold vibration. Very light weight approaches **M2 (falsetto/head)**. Sumian calls this "**perceptual**, not a specific physical feature, but is likely from closed quotient".\[10\]

**Important nuances (community, Sumian):**
- "Pressing the vocal folds together does not necessarily increase weight; pressed phonation is not heavier in weight."\[10\]
- Weight needs more subglottal pressure but not more airflow.\[18\]
- High pitch with heavy weight means tension and effort. High pitch that is relaxed and not breathy probably means light weight.\[18\]
- Using breathiness to hide heavy weight at high pitch is a trap that becomes ingrained and hard to undo.\[18\]
- "Base pitch" is the pitch speech settles back to after intonation, and it is set mostly by weight.\[26\]

**Acoustic correlates (inferred, not validated against perceived "weight"):** a less negative spectral tilt (stronger high harmonics), lower H1–H2, higher CPP, a stronger "buzz". Because the term is perceptual, these correlates should be presented as proxies.

### 1.5 Breathiness, Clarity, Twang, Constriction, Fry

- **Breathiness.** This is incomplete glottal closure, giving turbulent noise and a dominant first harmonic.\[14\] Its most robust acoustic correlates are low CPP and high H1*–H2* (Hejná and colleagues).\[15\] Cis women are breathier on average. A Brazilian PLOS ONE study found cis women most breathy, followed by non-binary people and trans women.\[27\]\[28\] Breathiness may add femininity (Van Borsel 2009), but evidence is mixed (Leung 2018),\[3\]\[15\] it costs projection, and it can tire the voice. Teach it as an optional flavour, not a requirement.
- **Hollowness / "underfull".** This is a high-resonance, light-weight voice that lacks fullness. It comes from an over-opened pharynx with too much M2-like lightness. TransVoiceLessons has a module called "Hollow and Underfull!".\[12\] The fix is to build "fullness space" (TVL),\[12\] meaning a modest increase in fold contact and oral space without lowering the larynx.
- **Twang.** In Estill terms this is narrowing of the aryepiglottic sphincter. It adds a brilliant 2–4 kHz "ring" and can brighten the voice and help projection without extra weight.
- **False vocal fold (FVF) constriction.** The ventricular folds squeeze, producing a strangled or gritty sound and fatigue. This is a red flag in feminization attempts, and it is what Sumian warns resonance-first training can cause.\[10\]
- **Vocal fry (M0).** Low-frequency, creaky phonation. Sumian uses it as the floor at the bottom of downward weight slides.\[29\]
- **Nasality.** Hypernasality can make high resonance sound "dark" or covered.\[10\] Some users over-nasalize while trying to sound "forward".

### 1.6 Intonation / Prosody

- **What research shows.** Hancock, Colton & Douglas (2014, J Voice 28(2):203–209) found that speakers with more upward intonation and a larger semitone range per utterance were heard as female, "despite no significant differences between the actual intonation of the four gender groups". Trans women misgendered as male had fewer upward and more downward patterns.\[30\]\[31\]\[32\] Owen & Hancock (2010) found mean F0 and semitone range strongly related to femininity ratings.\[33\]
- **Stereotype vs. data.** Fitzsimons et al. (2001) found that cis women actually used a *smaller* semitone range than men in declarative and interrogative sentences.\[34\] "Women are more melodic" is therefore a perceptual stereotype that partly works, not an accurate description of cis speech. Present intonation as a style choice, not a requirement.
- **Clinical relevance.** In Hancock & Garabedian's chart review (2013, 25 clients), 68% had at least one intonation goal. Semitone range went from 27.3 ST to 31.8 ST, a mean gain of 4 ST.\[31\]\[34\]

### 1.7 Articulation

- Forward, lighter articulation raises F2 (Carew et al. 2007; Kawitzky & McAllister 2020).\[21\]\[35\]
- /s/ spectral centre of gravity (COG) is higher on average in female speech (general phonetics literature). It is a learnable sociophonetic cue but varies widely within each gender.
- Women on average produce "higher formant frequencies and slower speech rates" in some samples (PLOS ONE summary).\[28\]
- Lighter consonant contacts and softer onsets are taught clinically. Evidence for their contribution to gender perception is weak.

### 1.8 Loudness, Onsets, Flow

Intensity correlated moderately with femininity ratings in Dahl's (2018) small study of 12 trans women and 10 cis controls.\[36\] In Södersten et al., F0, average formant frequency and Leq most strongly predicted "female-sounding" ratings.\[37\] Softer, breathy onsets contrast with hard glottal attacks. Flow phonation, a balanced, non-pressed adduction, is the healthiest target. Shouting is a major failure point, because loudness naturally pulls back toward heavy weight.

### 1.9 Non-speech Vocalizations, Phone Voice, Singing

ASHA's practice portal lists "nonverbal vocalizations (such as laughing and coughing)" within gender-affirming assessment.\[38\] Coughs, sneezes, laughs, throat-clears and shouts are reflexive and fall back to the old configuration until deliberately practised. Phone voice removes visual cues and conventionally passes about 300–3400 Hz (narrowband), removing the fundamental itself, so formants and harmonics carry the signal. Telephone-test studies after glottoplasty found that trans women were still misgendered more often than controls.\[13\] Singing is a separate skill that does not transfer directly to speaking configuration.

### 1.10 Language, Sociolinguistics, Nonverbal Communication

Typical F0 differs across cultures. For example, Japanese women's speaking pitch is often reported to be higher than English-speaking women's. Formant norms are language- and dialect-specific: TruVox notes that dialect-specific targets were a usability concern.\[39\] Word choice, discourse markers and gesture are part of SLP practice (ASHA covers pragmatics).\[38\] These are the most stereotype-prone areas, so offer them as optional and descriptive, never prescriptive. Sumian's "microbehaviours" are what remains after pitch, weight, resonance, clarity and speech patterns are held constant. Her own description: "this entire concept is quite shakey". Her best available method is mimicry.\[10\]

### 1.11 Glossary: Community Term ↔ Clinical Term ↔ Acoustic Measure

| Community term | Clinical/physiological equivalent | Computable proxy |
|---|---|---|
| Pitch | Speaking F0 / SFF | Median F0 (Hz, ST) |
| Base pitch (Sumian) | Habitual lower F0 / floor | 10th–20th percentile F0 over voiced speech |
| Size / R1 / "gender knob" (TVL) | Pharyngeal resonance, larynx height, vocal tract length | F1 (and F2) per vowel; ΔF; aVTL |
| Brightness / R2 | Oral resonance, tongue fronting | F2 per vowel; spectral centroid (crude) |
| Weight / thickness / buzz | Fold mass, CQ, M1 vs M2 | Spectral tilt; H1–H2 (inverse); CPPS; energy 0–1 kHz vs 1–5 kHz |
| Fullness (TVL) | Adequate adduction and oral space | Moderate CPPS, H1–H2 not too high |
| Hollow / underfull | Over-open pharynx with too-light, M2-like weight | Very high H1–H2, low high-frequency energy, F1 low for vowel |
| Breathy | Incomplete closure | Low CPPS, high H1*–H2*, low HNR |
| Clarity | Complete, efficient closure | High CPPS/HNR |
| Strain / FVF / "squeeze" | Hyperfunction, ventricular constriction | High jitter/shimmer, low CPPS, irregular F0; self-report |
| Twang | Aryepiglottic narrowing | Peak energy at 2–4 kHz |
| Nasality | Velopharyngeal coupling | Nasal formant / anti-formant (hard to measure; nasometry ideal) |
| Falsetto / M2 | Laryngeal mechanism 2 | Very high H1–H2, weak harmonics above ~2 kHz |
| Fry / M0 | Laryngeal mechanism 0 | F0 < ~70 Hz, irregular periods |
| Microbehaviours (Sumian) | Fine prosodic/articulatory habits | Not directly computable; mimicry tasks only |
| Intonation / "sing-song" | Prosody, F0 contour | F0 SD (ST), ST range per utterance, % rising contours |

---

## Part 2 — How to Improve Each Marker

### 2.1 Curriculum Order: Schools of Thought

| School | Order | Rationale |
|---|---|---|
| Sumian (Scinguistics lineage) | Weight + pitch together, then resonance (if needed), then brightness, then microbehaviours and speech patterns, then mimicry\[10\] | "Learning resonance first often results in constriction"\[10\] |
| TransVoiceLessons (Zheanna Erose) | Ear training ("Hearing R1/R2") → R1/size → weight reduction (her "8 exercises to reduce vocal fold mass") → fullness → combining → "Heat From Fire" passage\[12\] | Resonance treated as the primary gender cue |
| Clinical SLP (Adler/Hirsch/Pickering; WPATH) | Vocal hygiene and baseline → pitch → resonance → intonation → articulation → nonverbal → carryover | Measurable, safe, staged |
| TruVox research tools | Pitch module + resonance module with tutorials\[40\]\[41\] | Biofeedback, unsupervised use |

**Recommended app order:** (0) safety and onboarding, (1) ear training, (2) pitch awareness and comfortable range, (3) light weight via pitch slides, (4) size/R1 via whisper and panting, (5) brightness/R2 via tongue and lips, (6) combining, (7) intonation, (8) articulation and nonverbal sounds, (9) structured-to-spontaneous carryover, (10) habituation and maintenance. Let users who prefer the TVL approach switch to a "resonance-first" track.

### 2.2 Exercise Library (step by step, with machine-checkable criteria)

**E1. Pitch matching.** The app plays a tone, starting with sine tones and moving to recorded voice. The user hums, then says "mmm-hmm" on the tone. *Check:* median F0 within ±50 cents of target for ≥600 ms of voiced audio. *Progression:* ±50 → ±25 cents; tones → spoken syllables.

**E2. Comfortable-range finder.** Glide from low to high and back on "ng" or a lip trill. *Measure:* the 5th–95th percentile of F0, in ST. Never push range in one session. Sumian: range expansion should be "slow and moderately comfortable".\[10\]

**E3. "Mhm" / "Hey!" / "Aww puppy" triggers (light weight, Sumian).** Say a natural, light "mm-hm?" or an "awww" like talking to a puppy, and use it as a seed for speech.\[42\] *Check:* F0 in the target band, and spectral tilt lighter than baseline.

**E4. Pitch slides for light weight (Sumian).** Slide upward from a neutral pitch and let the voice lighten, even into M2. Then gradually bring the light configuration down in pitch.\[18\] *Check:* the tilt or H1–H2 trend stays light as F0 descends. Stop on strain signals.

**E5. Weight layering (Sumian).** Slide down from neutral, letting the voice get heavier, then go up without lightening.\[18\]\[29\] This trains the ability to *feel* the weight dimension. Use it sparingly.

**E6. Whisper siren (size, TVL).** Whisper "ee" and slide the *whisper* pitch up and down, which moves the larynx and pharynx without phonating. *Check:* F0 cannot be measured in whisper, but formants can. Reward a rising spectral centroid or F2. Silent practice is possible.

**E7. Big dog / small dog panting (TVL).** Pant like a big dog (low larynx, dark), then a small dog (high larynx, bright). *Check:* whispered formants shift up in the "small dog" condition.

**E8. Swallow-hold / larynx awareness.** Feel the larynx rise during a swallow, then gently hold a partial rise while breathing, then while humming. Do not hold with force.

**E9. "Ee" brightness slide / tongue fronting (R2).** Alternate /u/ → /i/ while watching F2, then keep the tongue forward on /ɑ/ and /ʌ/. *Check:* F2 moves toward the women's reference value for that vowel, or at least +10% over the user's baseline.

**E10. Smile/lip-spread contrast.** Read a phrase with rounded lips and then with spread lips, and compare F2/F3.

**E11. SOVT warmups (straw phonation, lip trills, "ng", humming)** and **resonant voice** ("mm-hmm", "mee-mee-mee", Lessac-Madsen-style). These reduce effort and are safe warmups and weight trainers. Sumian uses humming slides for covert practice.\[29\]

**E12. Vocal Function Exercises (Stemple).** Sustained /i/, upward and downward glides, and sustained pitches. Use them as conditioning, not gender training.

**E13. Soft onsets / flow phonation.** "h-ah", "h-ee" with no glottal click. *Check:* attack time > ~30 ms.

**E14. Combining / "lock and speak".** Hold the target on a sustained vowel, then a word, phrase, sentence, passage and spontaneous speech. *Check:* stays within the personal target zones (F0, F2, weight proxy) for ≥70% of voiced frames.

**E15. Intonation contours.** Practise rising contours and a wider semitone range on emotionally coloured readings. *Check:* utterance ST range ≥ the user's goal (for example +3 ST over baseline).

**E16. Reading passages.** "Heat From Fire" (TVL), the Rainbow Passage, the Grandfather passage, "Please call Stella", and the CAPE-V sentences ("The blue spot is on the key again", "How hard did he hit him", "We were away a year ago", "We eat eggs every Easter", "My mama makes lemon muffins", "Peter will keep at the peak"). Each CAPE-V sentence stresses different phonetic content. Sumian notes conversation practice generalizes better than passages.\[10\]

**E17. Shadowing / mimicry.** Speak along with a target clip, using consented, licensed voices. Sumian treats mimicry as the best available method for microbehaviours.\[10\]

**E18. Negative practice.** Deliberately alternate old and new voices to sharpen the contrast. Use with care for dysphoric users.

**E19. Nonverbal drills.** Laugh, "oops!", "ouch!", fake cough and calling out, all in the target configuration.

### 2.3 Ear Training

Users cannot change what they cannot hear. TVL's sequence starts with "Hearing R1", "Hearing Resonances" and "Hearing R2".\[12\] App quiz types: AB discrimination between clips that differ in one parameter ("Which is brighter / lighter / higher?"), odd-one-out among three clips, slider ratings compared with measured values, and optional self-listening. Generate stimuli by holding F0 fixed and shifting formants ±5–20% (Praat's "Change gender" or WORLD/pyworld), or the reverse. Make items adaptive with a staircase that shrinks the difference after correct answers.

### 2.4 Vocal Health and Safety (hard limits)

- **Warmup** of 3–5 minutes of SOVT before training. **Cooldown** with gentle downward glides and hums.
- **Session dosage:** short sessions distributed through the day, for example 10–20 minutes, two or three times a day, rather than one marathon.
- **Stop rules (in-app hard stop):** pain, a raw throat, hoarseness after practice, rising effort, loss of upper range, or the voice "cutting out". Hoarseness lasting more than about 2 weeks, pain on speaking, or blood → refer to an ENT/laryngologist and an SLP.
- **Detectable warning signs:** rising jitter/shimmer over a session, falling CPPS, F0 pushed above the user's comfortable 90th percentile, and self-reported effort ≥ 6/10. Any of these triggers a rest prompt.
- **Muscle tension dysphonia** is the main risk from forced training. False-fold constriction is its signature sound.

### 2.5 Motor Learning Principles Applied

- **Practice variability.** Vary pitch, vowel, word and context. Random practice gives better retention than blocked practice, even though blocked practice gives faster in-session gains.
- **Feedback frequency.** Show high-frequency, real-time feedback early, then fade to summary or delayed feedback for retention: for example live visuals 100% of the time in early levels, then 50%, then only an end-of-utterance score.
- **Knowledge of results vs knowledge of performance.** KR is the score. KP is *why* ("your F2 dropped on 'o' vowels"). Use KP early and KR later.
- **External focus.** Cues like "make the dot move right" usually beat internal cues ("lift your larynx"), which are needed only to discover the movement.
- **Challenge point.** Keep success at about 70–80% by adapting targets. McAllister's lab has applied the challenge point framework to biofeedback.\[43\]\[44\]
- **Carryover.** Use a hierarchy from isolated sounds to real life, with scheduled "voice in the wild" missions.

### 2.6 Timelines, Plateaus and Failure Modes

Realistic expectation: noticeable change in weeks; a usable voice in months; automaticity often taking 1–2+ years. TVL's own "5 year voice transition timeline" shows how long full habituation can take.\[12\]

| Failure | Sound | Likely cause | Diagnostic metrics | Fix |
|---|---|---|---|---|
| Pitch-only / "Mickey Mouse" | High but heavy or falsetto | Weight not reduced; resonance unchanged | F0 high, F2 at male norms, tilt heavy | Weight slides, then size |
| Falsetto/hollow | Airy, hooty, underfull | M2 + over-open pharynx | Very high H1–H2, low F1 for vowel | Fullness work, more closure, raise R1 |
| Breathy cover | Whispery, weak | Hiding weight with air | Low CPPS | Clarity work: soft but complete closure |
| Strained / constricted | Squeezed, tight | FVF/hyperfunction; resonance-first effort | Jitter↑, CPPS↓, effort self-report | SOVT, rest, back off |
| Nasal | Honky | Velopharyngeal opening | Hard to compute; ear training | Oral/nasal contrast drills |
| Over-bright | Childlike, "cartoony" | Excess R1/R2 for the pitch | F1 /a/ > ~1200 Hz (Sumian)\[10\] | Balance size with weight and pitch |
| Over-dark | Covered | Low larynx, yawn | Low F1/F2 | Size exercises |
| "Gay male voice" outcome | Light, but read as male | Resonance unchanged, pitch moderate | F2 near male norms | Prioritize size/R1 |
| Monotone | Flat | Fear of breaking | F0 SD < ~2 ST | Intonation lessons |

### 2.7 Psychological Aspects

- **Dysphoria on playback** is common. Make playback opt-in, offer "metrics-only" mode, and use neutral descriptive labels.
- **Voice dissociation** (the voice "not feeling like mine") is normal early on and fades with use.
- **Goals vary.** Not everyone wants a cis-passing voice. The VENI questionnaire was developed because nonbinary people's needs differ from the TWVQ framing.\[45\]\[46\] Support androgynous, nonbinary and "switchable" targets.
- **Motivation:** celebrate process metrics (minutes, consistency, range comfort), not just outcomes.

### 2.8 Clinical Evidence Base

- **WPATH SOC 8** includes voice and communication guidance. Contributors include Jennifer Oates, Ulrika Nygren and David Azul.\[47\] Earlier WPATH-linked guidance came from Davies, Papp & Antoni (2015).\[48\]
- **ASHA** includes gender-affirming voice and communication within SLP scope, covering pitch, intonation, voice quality, resonance, fluency, articulation, pragmatics and nonverbal vocalizations.\[38\]
- **Outcome measures.** The **TWVQ** (formerly TVQ^MtF; Dacakis et al. 2013) has 30 items on a 4-point scale, giving a total of 30–120, with higher scores meaning worse.\[46\]\[49\] The simplified-Chinese version had Cronbach's α 0.97 and ICC 0.84.\[50\] Others include VENI (nonbinary), VHI/VHI-10, Gender Voice Index, Utah Gender Presentation Scale, listener ratings and self-ratings.
- **Therapy efficacy.** In McKenna, Gustin, Novak et al. (J Voice 2026; 16 clients), F0 rose 5.4 ST and F2 and the L/H ratio rose with no added breathiness. Gelfer & Tice (2013) followed up 15 months after therapy. Dacakis (2000) studied long-term maintenance of F0 gains. Carew et al. (2007) showed oral resonance therapy improved perceived femininity.\[51\] In TruVox's 4-week, 6-participant trial (terminated early, no control group), effect sizes were large on the Gender Voice Index and parts of the Utah scale.\[9\]\[40\]
- **Key text:** Adler, Hirsch & Pickering, *Voice and Communication Therapy for the Transgender/Gender Diverse Client* (Plural).

### 2.9 Surgery and Hormones (context)

- **Wendler glottoplasty** fuses the anterior folds, shortening the vibrating length. A 2024 meta-analysis (Rogalska et al.; 20 studies, 656 patients) found speaking F0 rose 83.48 Hz (+8.36 ST). In a Brazilian study (Braz J Otorhinolaryngol 2023) speaking F0 rose 24.6 ± 27.5 Hz, with no worsening of other acoustic measures. Voice therapy plus glottoplasty raised speaking F0 by 42 Hz versus 15 Hz for voice therapy alone (Chang et al., Laryngoscope 2021). Results vary widely (I² = 90% in one meta-analysis), and lower range and phonation time may be reduced.\[52\]\[53\]
- **Cricothyroid approximation** increases tension and gave about +39 Hz on average. It can lock the voice into falsetto, and gains may fade.\[54\]
- **Laser reduction glottoplasty** reduces fold mass (+26 Hz in Nolan et al. 2019).
- **Feminization laryngoplasty** can also shorten the vocal tract, but evidence is thinner. **Tracheal shave** is cosmetic only.
- **Surgery mainly changes F0.** Resonance and prosody still need training, and several studies report patients still feel their voice is not feminine enough afterwards.\[55\]
- **Estrogen/anti-androgens** do not shorten folds or vocal tracts in adults. **Puberty blockers** given before testosterone-driven puberty prevent laryngeal masculinization.

---

## Part 3 — Quantifying the Markers by Computer

### 3.1 Capture Pipeline

- **Sample rate:** at least 16 kHz. Prefer 44.1 or 48 kHz captured and resampled to 11–16 kHz for formant analysis; Praat resamples to twice the formant ceiling.\[56\]
- **Browser:** `getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}})`.\[57\]\[58\]\[59\] Check `MediaStreamTrack.getCapabilities()` and `getSettings()`, because support varies.\[60\] Historic WebKit bug reports show the echoCancellation constraint once had no effect on Safari.\[61\] Phone voice-processing DSP distorts pitch and spectral slope, and AGC destroys intensity measurements.\[57\]\[62\]
- **Native:** on iOS use the AVAudioSession `.measurement` mode. On Android use the `UNPROCESSED` or `VOICE_RECOGNITION` audio source.
- **Latency budget:** aim for under about 100 ms to screen. Analysis window 32–46 ms, hop 10 ms, UI at 30–60 fps.
- **VAD:** RMS gate plus a voicing probability. Compute statistics only on voiced frames, requiring ≥ 1–2 s of voiced audio for utterance-level scores.
- **Calibration:** phone microphones are not calibrated for dB SPL. Report intensity relative to the user's own baseline.

### 3.2 Pitch Tracking

| Algorithm | Type | Notes |
|---|---|---|
| Autocorrelation / Praat `To Pitch (ac)` | Time-domain | Praat's standard. Pitch floor 75 Hz → 40 ms window (3 periods) |
| YIN | Difference function + CMNDF threshold (~0.1–0.15) | Fast, real-time friendly |
| pYIN | Probabilistic YIN + HMM Viterbi | Robust, gives a voicing probability. Needs look-ahead. One comparison found about twice CREPE's/YAAPT's unvoiced→voiced errors\[63\]\[64\] |
| MPM (McLeod) | Normalized square difference | Good for browser real time (e.g., the `pitchy` JS library) |
| SWIPE / RAPT / REAPER | Spectral / NCCF + DP | Offline quality; SPTK provides RAPT and SWIPE |
| CREPE / torchcrepe / TF.js | CNN on waveform | Strong in noise; heavier\[65\]\[66\] |
| FCPE, RMVPE, SwiftF0 | Neural | Newer, fast. Validate on speech |

**Settings for this population:** search range 60–500 Hz (allow fry below and M2 above). Octave-error guard: median filter (5–7 frames) plus a jump constraint (reject jumps > 7 ST between adjacent frames unless sustained > 50 ms). Report **median F0**, **10th/90th percentiles**, **SD in ST** and **range (5–95th percentile) in ST**. The mean in Hz is biased by octave errors and skew.

### 3.3 Formant Estimation

- **Method:** LPC by Burg's method (Praat `To Formant (burg)`: time step 0 = auto, max formants 5, ceiling 5000 (male) / 5500 (female) / up to 8000 (child), window 25 ms, pre-emphasis from 50 Hz).\[56\]\[67\]\[68\] Praat resamples to twice the ceiling and removes formants below 50 Hz and above ceiling − 50 Hz.\[56\]
- **LPC order rule of thumb:** `p = 2 + fs/1000` (for example fs = 10 kHz → order 12).
- **The ceiling problem for voices in transition.** Users *change* their apparent tract length during practice. A fixed 5000 Hz ceiling under-reports raised formants. A fixed 5500 Hz ceiling can merge F1/F2 on back vowels: Praat warns that an [u] can come out as "a single formant near 500 Hz".\[56\]\[68\] **Recommendation:** run several ceilings (4500–6500 Hz in 250 Hz steps) and choose the one that minimizes track variance or best fits the expected vowel, as Barreda's "Fast Track" (2021) does.
- **High-F0 problem.** At high F0, harmonics are sparse and LPC peaks snap to harmonics, so error grows with F0 (one practitioner guide gives a rule of thumb of roughly F0/4; treat as approximate).\[20\] Mitigations: average over many frames, use whispered sizing for resonance-only measurements, or cross-check with spectral-envelope methods (cepstral smoothing, WORLD's CheapTrick).
- **Segment-aware measurement.** Measure formants on the steady-state middle 40–60% of vowels. Get vowel boundaries from forced alignment (Montreal Forced Aligner offline; wav2vec2-CTC or Whisper timestamps in apps). AcousticGender.space aligns a known transcript using CMUdict for exactly this purpose.\[69\]\[70\]

**Vocal tract length from formants:**
- **ΔF (Reby & McComb 2003):** regress observed Fi on `(2i−1)/2` with zero intercept; the slope is ΔF. Then `aVTL = c / (2·ΔF)` with c = 35,000 cm/s.\[71\]\[72\]
- Example values (Cartei/Reby sample): men ΔF ≈ 1061 Hz (≈16.5 cm), women ΔF ≈ 1192 Hz (≈14.7 cm).\[73\]
- **Lammert & Narayanan (2015):** a multiple regression on F1–F4 predicts MRI-measured VTL to within about 1 cm (about 6%). F4 is the most informative single formant.\[74\]
- **Implementation:** the soundgen R package `estimateVTL` returns aVTL and scale-invariant residuals.\[75\]\[76\]

**Resonance score (recommended):** for each vowel token v, compute `z_v = log(F2_v / F2_male_ref(v)) / log(F2_female_ref(v) / F2_male_ref(v))`, so that 0 = male mean and 1 = female mean. Do the same for F1 (where vowel-appropriate) and F3, and take a weighted median across tokens.

### 3.4 Weight, Breathiness and Voice Quality

| Measure | Definition | Interpretation | Tool |
|---|---|---|---|
| H1–H2 (and H1*–H2*, Iseli/Hanson corrected) | Amplitude difference of the first two harmonics (dB) | ↑ = breathier/lighter; ↓ = pressed/heavier\[14\] | VoiceSauce, Praat, DisVoice |
| H1–A1, H1–A3 | First harmonic vs formant-peak harmonics | Spectral tilt | VoiceSauce |
| CPP / CPPS | Height of the cepstral peak above the regression line | ↓ = breathy/dysphonic\[14\] | Praat, Parselmouth |
| HNR | Harmonics-to-noise ratio (dB) | ↓ = noisier | Praat |
| Jitter / shimmer | Cycle-to-cycle F0 / amplitude perturbation | Roughness; strain monitor | Praat |
| Alpha ratio | Energy 1–5 kHz vs 50 Hz–1 kHz | Less negative = more high-frequency energy | openSMILE eGeMAPS |
| Hammarberg index | Max energy 0–2 kHz minus 2–5 kHz | Tilt | eGeMAPS |
| L/H ratio | Low/high spectral energy ratio | Rose significantly after feminization therapy (McKenna et al., J Voice 2026) | Custom |
| NAQ, QOQ (IAIF inverse filtering) | Glottal-flow shape | ↑ NAQ = more relaxed/breathy | APARAT, DisVoice |
| EGG contact quotient | Gold standard for CQ | Requires hardware | Not in app |

**Recommended "weight index" (heuristic; must be validated with listener data):** a z-scored combination of (−H1*–H2*), alpha ratio and CPPS, relative to the user's baseline. No published study has validated an acoustic measure against perceived "vocal weight" in trans voices. This is an open research gap.

### 3.5 Articulation, Prosody and Intensity

- **/s/ spectral moments:** COG, SD, skewness and kurtosis on the middle 40 ms of /s/, with fs ≥ 22.05 kHz. Phone mics often roll off above about 8–10 kHz.
- **Vowel space area:** polygon area on /i, æ, ɑ, u/ in F1×F2.
- **Speech rate:** syllables per second (de Jong & Wempe Praat script, or ASR timestamps).
- **Intonation:** F0 SD in ST; utterance ST range; proportion of rising terminal contours (slope of the last 300 ms > +2 ST/s).

### 3.6 Perceived-Gender Scoring

- **Formula-based (transparent):** combine z-scores for median F0 (ST), the resonance score, the weight index and intonation. Start weights from the literature (F0 strongest, then formants with F2 > F1/F3), then fit them on your own listener-rated data.
- **ML classifiers:** GMMs on MFCCs, i-vectors/x-vectors, and wav2vec2/HuBERT/WavLM fine-tuned on binary-labelled corpora. They are trained on cis, binary-labelled data, confound gender with channel and language, give one opaque number, and encourage pass/fail anxiety. An arXiv voice gender scoring study argues for characterizing masculinity and femininity *independently*.\[25\] Use ML only as an optional, user-requested "listener estimate".
- **Never** label the user's live voice "male/female" by default. TruVox participants specifically liked that the app did not "gender" their voice and preferred it over Voice Tools, which shows a gender label.\[77\]

### 3.7 Existing Tools and Market Gaps

| Tool | What it measures | Notes |
|---|---|---|
| Praat (+ Parselmouth) | Everything | Reference standard; GPL |
| AcousticGender.space (Luna McNulty) | 2D pitch × resonance plot from a read transcript with alignment\[69\]\[78\] | AGPL-3.0. Renée Yoxon: good pitch tracking, "I don't know how perfect it is at tracking resonance"\[69\]\[78\] |
| TruVox (NYU BITS Lab + U. Cincinnati) | Real-time LPC resonance + pitch tools + tutorials\[41\] | Free; resonance module Chrome-only; peer-reviewed; participants wanted more explanation for unsupervised use\[9\]\[41\]\[79\] |
| Voice Tools (DevExtras) | Pitch with gender bands\[77\] | Criticized for gendering |
| Voice Pitch Analyzer, Vocal Pitch Monitor, Christella VoiceUp, Eva, Speechtools | Pitch / lessons | Consumer apps |
| Sonic Visualiser, Friture, VoceVista, Estill Voiceprint | Spectrograms | Pro/education |

**Market gaps:** validated real-time weight feedback; resonance tracking that holds up at high F0; structured, adaptive curricula with carryover and safety limits; dysphoria-safe UX; non-English norms.

### 3.8 Libraries and Stacks

- **Python/offline:** Parselmouth, librosa (pYIN), torchcrepe, pyworld, REAPER, openSMILE (eGeMAPS: 88 features), DisVoice, SPTK, Essentia, VoiceSauce.
- **Web:** Web Audio API + AudioWorklet (128-sample render quanta into a ring buffer) + WASM DSP, `pitchy` (MPM), Meyda, TF.js CREPE.
- **Mobile:** TarsosDSP (Android), AudioKit (iOS), Oboe, or a shared C++/Rust core via FFI.
- **Alignment:** Montreal Forced Aligner, wav2vec2 CTC (torchaudio), Whisper word timestamps.

### 3.9 Turning Measurements into Feedback

- **Views:** live pitch trace on a semitone axis with target band; a 2D map of pitch against resonance score, like AcousticGender.space;\[69\] an F1×F2 vowel chart with reference ellipses; an optional LPC spectrum "wave" like TruVox.\[41\]
- **Targets:** personalized zones from the baseline and goal, raised gradually (for example +1 ST or +3% F2 per mastered level).
- **Robustness:** medians, minimum voiced duration, outlier rejection, and a confidence indicator that suppresses the display when confidence is low.
- **Safety coupling:** never reward F0 above the user's comfortable 90th percentile; pair high F0 with strain checks.

---

## Part 4 — Designing the Duolingo-Style App

### 4.1 Skill Tree

| Unit | Skills | Example lesson | Unlock criterion (machine-checkable) |
|---|---|---|---|
| 0 Setup | Mic check, safety, goal, baseline | Read "Heat From Fire" + sustained vowels + glide | Baseline stored |
| 1 Hearing | Pitch, brightness, weight discrimination | 10 AB items | ≥80% on staircase at set difficulty |
| 2 Pitch | Matching, range, base pitch | Hum to tone; "mhm" at target | ±50 cents for 600 ms on 8/10 items |
| 3 Light weight | Slides, "aww", M2 bridging | Upward slides to M2 and back | Weight index ≥ baseline + 0.5 SD over 3 sessions |
| 4 Size | Whisper siren, small dog, larynx | Whispered "ee" slides | Whispered F2/centroid +8% vs baseline |
| 5 Brightness | Tongue/lip, vowel-by-vowel | F2 vowel ladder | Resonance score ≥ 0.5 on 6 vowels |
| 6 Combine | Hold all three on words | 20-word list | ≥70% of voiced frames in zone |
| 7 Melody | Rising contours, ST range | Question/statement pairs | ST range ≥ goal |
| 8 Articulate | /s/, forward consonants, nonverbal sounds | Laugh drill | Self-rated + metrics |
| 9 Carryover | Reading → prompts → conversation | 60 s spontaneous prompt | Stable metrics in free speech |
| 10 Life | Phone, loud voice, emotional voice | "Order coffee" role-play | Self-report missions |

Exercise types: listen-and-discriminate, match the pitch, hold the target, sirens, read aloud, repeat after me, free-speech prompts, self-rating compared with metrics, opt-in A/B against past recordings, and journal entries.

### 4.2 Gamification and Learning Science

- **Spaced repetition.** Duolingo's half-life regression (Settles & Meeder, ACL 2016): `h = 2^(Θ·x)`, `p = 2^(−Δ/h)`. It cut recall-prediction error by 45%+ versus baselines and raised daily engagement by 12% in an operational study (code and 13M learning traces are MIT-licensed on GitHub).\[80\]\[81\]\[82\] It was built for vocabulary memory. Motor skills decay differently, so adapt it to schedule *skill refreshers* from measured performance decay.
- **Streaks/XP** motivate but can drive over-practice. Cap daily voice-use XP, credit rest days, and add a "streak freeze" for voice rest and illness.
- **Hearts/lives:** avoid them for production tasks, because failing from strain should never push the user to keep forcing. Limit them to ear-training quizzes if used at all.
- **Session caps:** a soft cap of about 20 minutes per session and a daily maximum, with automatic cooldowns.
- **Mastery levels** decay with time since last successful performance.

### 4.3 Onboarding, UX and Privacy

- **Onboarding:** goals (feminine / androgynous / flexible / "my own"), comfort with playback, practice environment, language and dialect, optional hormone/surgery status, SLP involvement. Baseline: sustained /a/ /i/ /u/, a glide, a passage and 30 s of spontaneous speech.
- **Dysphoria-sensitive defaults:** labels "lighter/heavier", "brighter/darker", "higher/lower"; male/female bands opt-in only; opt-in playback; gentle copy.
- **Discretion:** discreet name and icon option, PIN lock, quick exit, audio processed on-device by default, quiet and whisper modes.

### 4.4 Legal, Ethical and Regulatory

- **Wellness vs. medical device:** position the app as general wellness/education and avoid diagnosing or treating dysphonia. "Therapy" claims can trigger FDA/EU MDR medical-device classification.
- **Data:** voice recordings may be biometric data (Illinois BIPA, Texas, Washington), and gender identity is sensitive. GDPR Art. 9 special-category data covers health and sex life/orientation, and gender-identity data is widely treated as sensitive. Apply minimization, local processing, explicit consent, deletion and no ad SDKs.
- **Consult SLPs and co-design with trans users.** Avoid prescribing stereotyped speech patterns.

### 4.5 Technical Architecture

- **Platform:** a PWA for reach, or React Native/Flutter with a native C++/Rust DSP core for lower latency and reliable unprocessed capture. Offline-first.
- **Pipeline:** mic → ring buffer → VAD → F0 (MPM/YIN live; pYIN/CREPE for scoring) → multi-ceiling LPC formants → CPPS, H1–H2, alpha → smoothing → UI, plus an alignment-aware second pass on finished utterances.
- **Testing DSP:** synthetic sine/sawtooth at known F0; synthesized vowels with known formants at F0 = 100–300 Hz; golden-file comparisons against Praat via Parselmouth (tolerance e.g. F0 ±1%, F1/F2 ±5–8%); noise/codec and device-matrix tests.
- **Datasets:** Hillenbrand 1995 vowel data; VCTK (CC BY 4.0); LibriSpeech (CC BY 4.0); Mozilla Common Voice (CC0, with self-reported gender). Few public trans voice datasets exist, so ethical collection with consent and community oversight is a prerequisite for validation.
- **Data model (sketch):** `User{goals, baseline_id, settings}`; `Session{start, duration, warmup_done, effort_rating}`; `Recording{task_id, local_uri, features:{f0_median_st, f0_p10, f0_p90, f0_sd_st, f1/f2/f3 by vowel, dF, aVTL, cpps, h1h2, alpha, jitter, shimmer}, confidence}`; `SkillState{skill_id, mastery, half_life, last_success}`; `Journal{text, mood}`.

---

## Recommendations (for the coding agent)

1. Build **multi-dimensional, baseline-relative** feedback: pitch (ST), resonance score (vowel-normalized F2/F1 + ΔF), a weight/clarity proxy, and intonation. Never offer binary pass/fail.
2. Default curriculum: **ear → pitch/weight → size → brightness → combine → prosody → carryover**, with a TVL-style resonance-first track as an option.
3. Use **pYIN/MPM** with semitone statistics, **multi-ceiling Burg LPC** on aligned vowels, and **CPPS/H1–H2/alpha ratio**. Validate everything against Praat.
4. Hard-code **vocal safety**: warmups, session caps, strain detection, referral prompts.
5. Make privacy and dysphoria-sensitive design defaults, not settings.
6. Run a listener-rating validation study, with community co-design, before claiming any score predicts perceived gender.

## Caveats and Open Questions

- Most perception studies are small, English-centric and use cis listeners. Thresholds such as 145/164/180 Hz come from older, small samples.
- "Vocal weight" and "microbehaviours" are community constructs with no validated acoustic definition. Treat the proposed indices as heuristics.
- Formant estimation at high F0 and for voices in transition is unreliable. Show confidence and prefer averaged, vowel-aligned measures.
- The coaching claim that pitch is not gendered conflicts with lab findings. Both likely capture part of the truth, because weight and F0 are confounded in natural speech.
- Hillenbrand F0, F3, /ɔ/ and /ɝ/ values have now been computed from the raw data (see `content/norms/reference_norms.json`). Peterson & Barney values remain unverified and are not used.
- The TruVox efficacy data come from a terminated, uncontrolled trial with 6 participants. Biofeedback efficacy for trans voice is promising but not established.
- Gamification evidence (Duolingo) concerns declarative learning. Its transfer to vocal motor learning is untested.

## Sources

1. [Voice, Articulation, and Prosody Contribute to Listener Perceptions of Speaker Gender: A Systematic Review and Meta-Analysis.](https://www.semanticscholar.org/paper/Voice,-Articulation,-and-Prosody-Contribute-to-of-A-Leung-Oates/8fb30ab1045e7572ce0a46bf7e570be9c01a2ebc)
2. [(PDF) The role of f0 and formant frequencies in distinguishing the voices of men and women](https://www.researchgate.net/publication/26291295_The_role_of_f0_and_formant_frequencies_in_distinguishing_the_voices_of_men_and_women)
3. [ERIC - EJ1171925 - Voice, Articulation, and Prosody Contribute to Listener Perceptions of Speaker Gender: A Systematic Review and Meta-Analysis, Journal of Speech, Language, and Hearing Research, 2018-Feb](https://eric.ed.gov/?id=EJ1171925)
4. [Speaking Fundamental Frequency and Vowel Formant Frequencies: Effects on Perception of Gender - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0892199712002056)
5. [Comparison of acoustic and perceptual measures of voice in MtF transsexuals perceived as female versus those perceived as males](https://www.researchgate.net/publication/12552637_Comparison_of_acoustic_and_perceptual_measures_of_voice_in_MtF_transsexuals_perceived_as_female_versus_those_perceived_as_males)
6. [The Effect of Formant Biofeedback on the Feminization of Voice in Transgender Women - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0892199718301905)
7. [AURORA Model of Formant-to-Tongue Inversion for Didactic and Clinical Applications](https://arxiv.org/pdf/2603.17543)
8. [Web-Based Application for Real-Time Biofeedback of Vocal Resonance in Gender-Affirming Voice Training: Design and Usability Evaluation — Lacuna](https://lacuna.tiptreesystems.com/work/web-based-application-for-real-time-biofeedback-of-vocal-resonance-in-gender/wrk_292b7b07f16986921c19d7f9cf810130)
9. [TruVox](https://www.vsmechlab.com/copy-of-speech-science)
10. [Sumi's Voice Lesson Pedagogy](https://sumianvoice.com/pedagogy.html)
11. [The Single MOST Powerful Element of Voice Feminization: The Gender Knob (R1)](https://www.patreon.com/posts/single-most-of-35683123)
12. [www.last.fm](https://www.last.fm/music/TransVoiceLessons/+tracks)
13. [Perceptual analysis of the male-to-female transgender voice after glottoplasty-the telephone test](https://www.researchgate.net/publication/304361466_Perceptual_analysis_of_the_male-to-female_transgender_voice_after_glottoplasty-the_telephone_test)
14. [Spectral and cepstral measurements in women with behavioral dysphonia](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10715576/)
15. [Breathiness as a Feminine Voice Characteristic: A Perceptual Approach](https://www.researchgate.net/publication/23144864_Breathiness_as_a_Feminine_Voice_Characteristic_A_Perceptual_Approach)
16. [(PDF) Voice and Communication Change for Gender Nonconforming Individuals: Giving Voice to the Person Inside](https://www.researchgate.net/publication/284216291_Voice_and_Communication_Change_for_Gender_Nonconforming_Individuals_Giving_Voice_to_the_Person_Inside)
17. [How Important is Pitch?](https://wiki.sumianvoice.com/wiki/pages/getting-started/pitch.html)
18. [Vocal Weight](https://wiki.sumianvoice.com/wiki/pages/vocal-weight/)
19. [How to do Low Fem Voices](https://wiki.sumianvoice.com/wiki/pages/various/low-fem-voices.html)
20. [Formant Analysis for Voice Clinicians: Beyond F0](https://www.phonalab.com/en/guides/posts/formant-analysis-clinicians)
21. [The Effect of Formant Biofeedback on the Feminization of Voice in Transgender Women](https://www.researchgate.net/publication/327340998_The_Effect_of_Formant_Biofeedback_on_the_Feminization_of_Voice_in_Transgender_Women)
22. <https://linguistics.berkeley.edu/~kjohnson/papers/Yao_et_al_2010.pdf>
23. [R: Hillenbrand et al. (1995) Vowel Data](https://search.r-project.org/CRAN/refmans/phonTools/html/h95.html)
24. [hdp-bayes-vowels/hillenbrand-data/vowdata.dat at master · kleinschmidt/hdp-bayes-vowels · GitHub](https://github.com/kleinschmidt/hdp-bayes-vowels/blob/master/hillenbrand-data/vowdata.dat)
25. [Voice Gender Scoring and Independent Acoustic Characterization of Perceived Masculinity and Femininity](https://arxiv.org/pdf/2102.07982)
26. [Base Pitch](https://wiki.sumianvoice.com/wiki/pages/PIPM/basepitch.html)
27. [Can acoustic measurements predict gender perception in the voice?](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0310794)
28. [Can acoustic measurements predict gender perception in the ...](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0310794&type=printable)
29. [Covert Practice](https://wiki.sumianvoice.com/wiki/pages/various/covert-practice.html)
30. [(PDF) Intonation and Gender Perception: Applications for Transgender Speakers](https://www.researchgate.net/publication/257461448_Intonation_and_Gender_Perception_Applications_for_Transgender_Speakers)
31. [Intonation and Gender Perception: Applications for Transgender Speakers - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0892199713001768)
32. [Transgender voice and communication - vocal health and considerations](https://transcare.ucsf.edu/guidelines/vocal-health)
33. [(PDF) Transgender voice and communication treatment: A retrospective chart review of 25 cases](https://www.researchgate.net/publication/234132422_Transgender_voice_and_communication_treatment_A_retrospective_chart_review_of_25_cases)
34. [INT J LANG COMMUN DISORD, JANUARY–FEBRUARY 2013, VOL. 48, NO. 1, 54–65](https://transreads.org/wp-content/uploads/2021/07/2021-07-23_60fa0f549f883_j.1460-6984.2012.00185.x.pdf)
35. [Acoustic Measures of Articulation and Vocal Quality in Transgender People Completing Vocal Feminization Therapy - PubMed](https://pubmed.ncbi.nlm.nih.gov/42156287)
36. [Gender and the Voice Research Papers - Academia.edu](https://www.academia.edu/Documents/in/Gender_and_the_Voice?page=last)
37. [Acoustic cues to femininity and masculinity in spontaneous ...](https://pubs.aip.org/asa/jasa/article-pdf/155/5/3090/19943369/3090_1_10.0025932.pdf)
38. [Gender Affirming Voice and Communication](https://www.asha.org/practice-portal/professional-issues/gender-affirming-voice-and-communication/)
39. [Web-Based Application for Real-Time Biofeedback of Vocal Resonance in](https://www.isca-archive.org/interspeech_2025/mcallister25_interspeech.pdf)
40. [Knowledge, Training, and Attitudes of Students and Speech-Language Pathologists About Providing Communication Services to Individuals Who Are Transgender](https://www.researchgate.net/publication/340869763_Knowledge_Training_and_Attitudes_of_Students_and_Speech-Language_Pathologists_About_Providing_Communication_Services_to_Individuals_Who_Are_Transgender)
41. [Visual biofeedback for gender-affirming voice training](https://wp.nyu.edu/byunlab/projects/can-computer-based-feedback-influence-listeners-perception-of-trans-womens-voices/)
42. [Getting Started](https://wiki.sumianvoice.com/wiki/pages/getting-started/)
43. [Auditory-Perceptual Training Via Telepractice](https://clinicaltrials.gov/study/NCT04858035)
44. [Visual-acoustic Intervention With Service Delivery In-person and Via Telepractice Trial](https://clinicaltrials.gov/study/NCT06517225)
45. [Voice-related Experiences of Nonbinary Individuals (VENI ...](https://scholarworks.sjsu.edu/cgi/viewcontent.cgi?article=1795&context=faculty_rsca)
46. [Voice-related Experiences of Nonbinary Individuals (VENI) Development and Content Validity - Journal of Voice](<https://www.jvoice.org/article/S0892-1997(21)00017-5/fulltext>)
47. [SOC8 Contributors Global Applicability of the Standards of Care](https://wpath.org/wp-content/uploads/2024/11/SOC8-Full-Contributor-List-FINAL-UPDATED-09232021.pdf)
48. [The Evidence Behind the Practice: A Review of WPATH Suggested Guidelines in Transgender Voice and Communication](https://www.researchgate.net/publication/320511243_The_Evidence_Behind_the_Practice_A_Review_of_WPATH_Suggested_Guidelines_in_Transgender_Voice_and_Communication)
49. [Development and Preliminary Evaluation of the Transsexual Voice Questionnaire for Male-to-Female Transsexuals](https://www.researchgate.net/publication/235647343_Development_and_Preliminary_Evaluation_of_the_Transsexual_Voice_Questionnaire_for_Male-to-Female_Transsexuals)
50. [\[Introduction and development of the Trans Woman Voice Questionnaire authorized simplified Chinese translation\] - PubMed](https://pubmed.ncbi.nlm.nih.gov/36404656)
51. [Effectiveness of Speech Therapy in Trans Women.](https://clinicaltrials.gov/study/NCT04708600)
52. [Transgender Phonosurgery: A Systematic Review and Meta-analysis](https://www.researchgate.net/publication/315704080_Transgender_Phonosurgery_A_Systematic_Review_and_Meta-analysis)
53. [Effect of Wendler glottoplasty on voice and quality of life of transgender women](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9874341/)
54. [Transgender voice surgery](https://en.wikipedia.org/wiki/Transgender_voice_surgery)
55. [Effect of Endoscopic Glottoplasty on Acoustic Measures and Quality of Voice: A Systematic Review and Meta-Analysis](https://www.researchgate.net/publication/347291092_Effect_of_Endoscopic_Glottoplasty_on_Acoustic_Measures_and_Quality_of_Voice_A_Systematic_Review_and_Meta-Analysis)
56. [Sound: To Formant (burg)...](https://www.fon.hum.uva.nl/praat/manual/Sound__To_Formant__burg____.html)
57. [Fretwork: pitch detection from the microphone · Issue #11 · djdietrick/mini-app-stack · GitHub](https://github.com/djdietrick/mini-app-stack/issues/11)
58. [Building a Zero-Dependency Audio Pitch Detector in TypeScript (Why Naive FFT Fails) - DEV Community](https://dev.to/nayeem_soundtest_6d2ce2a4/building-a-zero-dependency-audio-pitch-detector-in-typescript-why-naive-fft-fails-3e11)
59. [Issue with WebRTC Noise Reduction feature affecting audio quality · Issue #2 · miroslavpejic85/mirotalkbro · GitHub](https://github.com/miroslavpejic85/mirotalkbro/issues/2)
60. [MediaStreamTrack: getCapabilities() method](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities)
61. [179411](https://bugs.webkit.org/show_bug.cgi?id=179411)
62. [Audio Constraints in getUserMedia()](https://medium.com/@haochuan/audio-constraints-in-getusermedia-9d3601a95893)
63. [(PDF) LACOPE: Latency-Constrained Pitch Estimation for Speech Enhancement](https://www.researchgate.net/publication/354221662_LACOPE_Latency-Constrained_Pitch_Estimation_for_Speech_Enhancement)
64. [Comparing Conventional Pitch Detection Algorithms with a Neural Network Approach](https://arxiv.org/html/2206.14357v1)
65. [Comparing Conventional Pitch Detection Algorithms with a Neural Network Approach](https://www.alphaxiv.org/abs/2206.14357)
66. [CREPE: A Neural Network with Perfect Pitch](https://medium.com/center-for-data-science/crepe-a-neural-network-with-perfect-pitch-fc67ba99308c)
67. [A Tutorial on Extracting Formants in Praat](https://joeystanley.com/blog/a-tutorial-on-extracting-formants-in-praat/)
68. [Formant Settings](https://www.phon.ca/phon-manual/praat_plugin/formant_settings.html)
69. [Trans Voice: AcousticGender.Space](https://www.reneeyoxon.com/blog/acousticgender-space)
70. [GitHub - lmcnulty/gender-voice-visualization: An application generating 2D visualization of pitch and resonance for gender voice training](https://github.com/lmcnulty/gender-voice-visualization)
71. [Spontaneous Voice Gender Imitation Abilities in Adult Speakers - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3281965/)
72. [Volitional exaggeration of body size through fundamental and formant frequency modulation in humans](https://www.nature.com/articles/srep34389)
73. [Voice Cues Influence Children's Assessment of Adults' ...](https://d-nb.info/1230204768/34)
74. [Speaker Normalization in Speech Perception Keith Johnson Matthias Sjerps](https://escholarship.org/content/qt2fc6x1ph/qt2fc6x1ph_noSplash_532045dda339e6de723dfdc32288e108.pdf)
75. [(PDF) A practical guide to calculating vocal tract length and scale-invariant formant patterns](https://www.researchgate.net/publication/376980906_A_practical_guide_to_calculating_vocal_tract_length_and_scale-invariant_formant_patterns)
76. [A practical guide to calculating vocal tract length and scale- ...](https://d-nb.info/1323317422/34)
77. [Original Paper TruVox Web-Based Software for Vocal Pitch Training in](https://formative.jmir.org/2025/1/e73841/PDF)
78. [Luna McNulty / AcousticGender.space · GitLab](https://gitlab.com/lmcnulty/gender-voice-visualization)
79. [TruVox Web-Based Software for Vocal Pitch Training in Transgender Women: Development and Single-Session Evaluations - ScienceDirect](https://www.sciencedirect.com/org/science/article/pii/S2561326X25006365)
80. [halflife-regression/README.md at master · duolingo/halflife-regression · GitHub](https://github.com/duolingo/halflife-regression/blob/master/README.md?plain=1)
81. [Table 3 from A Trainable Spaced Repetition Model for Language Learning](https://www.semanticscholar.org/paper/A-Trainable-Spaced-Repetition-Model-for-Language-Settles-Meeder/cb836d2b8e126dc31ded5e674d73021604dcc6e0/figure/5)
82. [how we learn how you learn](https://blog.duolingo.com/how-we-learn-how-you-learn)
