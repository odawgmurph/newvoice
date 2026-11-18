# Installing the test build on an iPhone (Windows + AltStore)

The Stage 2 capture spike is not on the App Store or TestFlight. GitHub builds an **unsigned** `NewVoice.ipa`, and you sign and install it with **AltStore** and a **free Apple ID**. You don't need a Mac, a paid Apple Developer account or a jailbreak. AltStore uses Apple's own free developer signing, the same mechanism Xcode uses for a developer's own phone.

**Limits of a free Apple ID:**
- An app signed this way stops opening after **7 days** until AltStore refreshes it. AltStore refreshes in the background while AltServer is running on your PC on the same Wi-Fi.
- Only a few sideloaded apps can be active at once.

AltStore's screens change between versions. Where these steps differ from what you see, follow the official guide at <https://altstore.io>. Only download AltServer and AltStore from that site; copies elsewhere have carried malware.

## One-time setup

1. **Make a separate Apple ID** just for signing, at <https://account.apple.com>. AltStore needs its password to ask Apple for a signing certificate. A spare account keeps your main one, with its purchases and iCloud data, out of it. Your iPhone stays signed in with your normal Apple ID.
2. **On the PC, install iTunes and iCloud from Apple's website**, not the Microsoft Store versions, which AltServer can't use. Then install **AltServer** from <https://altstore.io>.
3. **Connect the iPhone by USB**, unlock it, and tap *Trust This Computer*. In iTunes, turn on *Sync with this iPhone over Wi-Fi*, so AltServer can refresh apps without the cable.
4. **Install AltStore on the iPhone:** click the AltServer icon in the system tray, choose *Install AltStore*, pick your iPhone, and sign in with the **spare** Apple ID.
5. **On the iPhone, trust the certificate and turn on Developer Mode:**
   - Trust: *Settings → General → VPN & Device Management*, tap the spare Apple ID, then *Trust*.
   - Developer Mode: *Settings → Privacy & Security → Developer Mode*. Turn it on and let the phone restart. The switch appears once a sideloaded app is installed.

## Each new build

1. **Download the build:**
   - On GitHub, open the repository's **Actions** tab and choose the **iOS app (unsigned .ipa)** workflow.
   - Open the newest green run for the branch you want to test.
   - Under **Artifacts**, download **NewVoice-ipa**. You need to be signed in to GitHub.
   - It arrives as a `.zip`; unzip it to get `NewVoice.ipa`.
2. **Install it**, either way:
   - From the PC: with the iPhone connected, click the AltServer tray icon → *Sideload .ipa…* → pick the iPhone → choose `NewVoice.ipa`.
   - From the phone: put `NewVoice.ipa` in the Files app (for example through iCloud Drive), then in AltStore go to *My Apps*, tap **+** and choose it.
3. **Open NewVoice**, tap **Start listening** and allow the microphone.

A newer build installs over the old one.

## What to check and report

Use the built-in iPhone microphone in a quiet room, and hum or speak.

- **Capture panel:**
  - *Measurement mode* should say **yes**. If it says **no**, iOS didn't give the app the unprocessed microphone.
  - *Mic mode* should be **standard**. If it shows something else (for example Voice Isolation, chosen in Control Center), readings may be processed.
  - *Input* names the microphone in use.
- **Timing panel:**
  - *Mic → screen* is an estimate; the goal is under **100 ms**.
  - *UI frame rate* should hold at about **60 fps**.
  - *Dropped samples* should stay **0**.
- **The trace:** does it follow your voice smoothly? A steady note should be a flat line, and a slide a smooth curve.

A screenshot of the screen while you hold a note says most of this. If you can, also try wired earphones with a mic, and a Bluetooth headset (expect a warning there).

## Removing it

Delete the app from the home screen. You can also delete AltStore, and remove the spare Apple ID's certificate under *Settings → General → VPN & Device Management*.
