# LibriSpeech validation subset

Twenty utterances (10 men, 10 women, 3.5–6 s each) from LibriSpeech
dev-clean, copied unmodified. They are test data for the real-speech pitch
tests (`harness/tests/test_real_speech.py`) and are never shipped in the app.

- Source: Panayotov, V., Chen, G., Povey, D., & Khudanpur, S. (2015).
  LibriSpeech: an ASR corpus based on public domain audio books. ICASSP.
  <https://www.openslr.org/12/>
- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- `manifest.json` lists each file's speaker, sex label (from LibriSpeech's
  `SPEAKERS.TXT`), duration, transcript and SHA-256, and the pinned tarball.

Rebuild or verify the subset from `harness/`:

```bash
uv run python -m corpus.build_librispeech
```

```bash
uv run python -m corpus.build_librispeech --check
```
