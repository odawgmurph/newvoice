# NewVoice privacy policy

*Draft 1, 27 November 2026. A draft until counsel reviews it (decisions D3, D23). The app shows the same text under Settings → Privacy; it is generated from `app/src/content/privacyCopy.ts` by `scripts/copy-docs.mjs`.*

## In short

NewVoice has no account and no servers. Everything it stores stays on your phone, encrypted. Nothing is uploaded, sold or shared, and there are no ads or analytics.

## What is stored on your phone

Measurements of your voice: numbers such as pitch, formants and voice-quality measures, worked out on the phone from the microphone.

Recordings, only if you chose to keep audio in onboarding or Settings. By default only numbers are kept.

Your answers in onboarding: your goal, practice environment and language, and, only if you chose to answer, hormone or surgery status and whether you work with a speech-language pathologist.

Your progress, lesson attempts, journal entries, how your voice felt at check-ins, and your settings.

Your PIN, as a salted hash in the phone’s secure Keychain, never as the PIN itself.

## How it is protected

The database is encrypted with SQLCipher. Its key is a random key kept in the phone’s Keychain and never leaves this phone, so a backup restored to another phone can’t be read. Kept recordings use the phone’s file protection, so they can’t be read while the phone is locked.

With a PIN set, NewVoice locks whenever you leave it, and hides its contents in the app switcher.

## The microphone

NewVoice listens only while an exercise, a practice screen or a starting-point recording is running, and stops when you leave it. Sound is turned into numbers on the phone. Audio never leaves the phone.

## What leaves your phone

Nothing, unless you send it. The only export is the developer tools’ diagnostics clip, which is off by default and goes only where you choose in the share sheet.

NewVoice makes no network requests for your data. If a future version downloads curriculum updates, those requests will carry no personal data, and this policy will say so first.

## Sensitive information

Voice measurements and information about gender can be sensitive, and some laws treat voice data as biometric. NewVoice doesn’t create voiceprints and can’t identify anyone. Because the data never reaches us, we can’t see, disclose or lose it.

## Deleting your data

Settings → Delete all data erases the database and its key, kept recordings and your PIN at once. Deleting the app removes everything too; a reinstall starts fresh.

Individual journal entries can be deleted from the journal.

## Changes and contact

Changes to this policy ship with app updates and are listed in the project’s history. Questions: open an issue on the NewVoice GitHub repository.
