// "How the numbers work and their limits" (build plan Stage 9). Shown in the
// app (about-numbers) and published as docs/how-the-numbers-work.md; a test
// checks the two agree. Education-only wording (D3), neutral labels (D2).

export type NumbersSection = { title: string; body: string[]; limits?: string };

export const NUMBERS_SECTIONS: NumbersSection[] = [
  {
    title: 'What NewVoice measures, and what it doesn’t',
    body: [
      'Every number is worked out on your phone from the sound of your voice. Audio is never uploaded.',
      'The numbers describe sound: how high, how bright, how heavy, how much the melody moves. They don’t say how anyone will hear you, and there is no pass or fail. Listeners differ, and research on how voices are heard is small and mostly in English.',
    ],
  },
  {
    title: 'Pitch',
    body: [
      'Pitch is how fast your vocal folds vibrate (F0), shown in hertz and on a musical scale in semitones, because we hear pitch on a scale like that.',
      'Live pitch uses the YIN method; finished recordings use pYIN, which looks at the whole recording. Both are checked against Praat, the standard research tool, and agree within 1% on test recordings.',
      'Your comfortable range comes from the slide in your starting point. Its top 10% is a limit: nothing above it is ever rewarded.',
    ],
    limits: 'very breathy or creaky voice, background noise and Bluetooth microphones can all make pitch readings jump.',
  },
  {
    title: 'Brightness (resonance)',
    body: [
      'Brightness comes from the resonances of your throat and mouth, called formants. NewVoice mostly shows the second one, F2, which follows where your tongue and lips are. It is measured with linear prediction (the Burg method), trying several settings and keeping the steadiest.',
      'Each reading has a confidence. Below 0.5 it is hidden; between 0.5 and 0.7 it is dimmed.',
      'The brightness score places a vowel between two reference averages from a 1995 American English study. It is a heuristic, kept as a number in the app’s workings rather than shown as a score.',
    ],
    limits:
      'at higher pitches there are fewer harmonics, so formant readings get less reliable (confidence drops from about 250 Hz); whispered vowels are measured with uncalibrated confidence. One vowel on its own is noisy, so exercises use several.',
  },
  {
    title: 'Weight',
    body: [
      'Weight is how heavy or buzzy a voice sounds. NewVoice estimates it from three features of the sound’s spectrum (H1*–H2*, the alpha ratio and CPPS), each compared with your own starting point.',
    ],
    limits:
      'no study has yet shown that any acoustic measure tracks how heavy listeners hear a voice. Treat the weight number as a hint, not a measurement.',
  },
  {
    title: 'Melody',
    body: [
      'Melody looks at how much your pitch moves within a phrase (its range in semitones) and whether phrases end rising: the last 300 ms climbing faster than 2 semitones a second.',
    ],
    limits: 'without speech recognition, the app can’t tell which word is which, so melody is measured over whole phrases.',
  },
  {
    title: 'Signs of a tired voice',
    body: [
      'During practice the app watches for jitter and shimmer rising (small irregularities in each vibration), CPPS falling (more noise in the voice), pitch above your comfortable range, and effort you report of 6 out of 10 or more. Any one of these asks you to rest.',
      'The thresholds sit above the largest changes seen in 44 ordinary reading sessions, and below deliberately strained test voices.',
    ],
    limits: 'the strained test voices are synthetic, and the trend checks need about six phrases before they can start.',
  },
  {
    title: 'Your phone',
    body: [
      'NewVoice asks the phone for its least processed microphone mode and tells you when it doesn’t get it, or when a Bluetooth microphone is in use.',
    ],
    limits: 'accuracy has been checked on one iPhone. Other phones and microphones may read differently.',
  },
];
