import Foundation

/// What a recorded task asks of the voice, which decides how it's measured.
enum TaskKind: String {
  /// A sustained vowel: steady-state formants, ΔF/aVTL and the formant
  /// ceiling, plus pitch and voice quality.
  case vowel
  /// A pitch glide: pitch percentiles give the comfortable range (handbook E2).
  case glide
  /// Connected speech (reading or spontaneous): pitch statistics, voice
  /// quality and the weight-index baseline.
  case speech
}

/// Batch analysis of a finished task recording (baseline tasks now,
/// exercises later). Runs the Rust core's recording path, which uses pYIN
/// over the whole utterance (D11), and returns plain JSON-safe values. Raw
/// audio never reaches JavaScript: at most it is written to a file under
/// Documents when the user keeps audio.
enum TaskAnalysis {
  /// Bumped when the result's layout changes; stored with every recording.
  static let formatVersion = 1

  static func analyse(clip: TestClip, kind: TaskKind, saveAs: URL?) throws -> [String: Any] {
    let rate = UInt32(clip.sampleRate.rounded())
    let samples = clip.samples
    let settings = defaultRecordingSettings()

    let analysis = try analyseRecording(samples: samples, sampleRate: rate, settings: settings)
    let quality = try measureVoiceQuality(samples: samples, sampleRate: rate, settings: settings)
    var vowel: VowelResult? = nil
    if kind == .vowel {
      vowel = try measureSustainedVowel(samples: samples, sampleRate: rate)
    }

    var savedUri: String? = nil
    if let saveAs {
      try FileManager.default.createDirectory(
        at: saveAs.deletingLastPathComponent(), withIntermediateDirectories: true)
      // Complete file protection: unreadable while the phone is locked.
      try Diagnostics.wavData(samples, sampleRate: Int(rate))
        .write(to: saveAs, options: [.atomic, .completeFileProtection])
      savedUri = saveAs.absoluteString
    }

    let result: [String: Any?] = [
      "formatVersion": formatVersion,
      "kind": kind.rawValue,
      "coreVersion": coreVersion(),
      "durationS": analysis.durationS,
      "sampleRate": clip.sampleRate,
      "capture": capture(clip),
      "levels": levels(samples, analysis.frames),
      "pitch": analysis.pitch.map(pitch),
      "quality": qualityJson(quality),
      "vowel": vowel.map(vowelJson),
      "audioUri": savedUri,
    ]
    // swiftlint:disable:next force_cast
    return Diagnostics.jsonSafe(result) as! [String: Any]
  }

  /// Whether iOS honoured the unprocessed mode for the whole recording.
  private static func capture(_ clip: TestClip) -> [String: Any?] {
    func flag(_ key: String) -> Bool {
      let a = (clip.startInfo[key] ?? nil) as? Bool ?? false
      let b = (clip.endInfo[key] ?? nil) as? Bool ?? false
      return a || b
    }
    let measurement =
      ((clip.startInfo["measurementMode"] ?? nil) as? Bool ?? false)
      && ((clip.endInfo["measurementMode"] ?? nil) as? Bool ?? true)
    return [
      "measurementMode": measurement,
      "bluetoothInput": flag("bluetoothInput"),
      "microphoneMode": (clip.startInfo["microphoneMode"] ?? nil) as? String,
      "droppedSamples": clip.droppedSamples,
      "stoppedEarly": !clip.reachedLimit,
    ]
  }

  /// Peak, clipping and the median level of voiced frames. Phone mics aren't
  /// calibrated, so levels only mean something against the user's own
  /// baseline (handbook §3.1).
  private static func levels(_ samples: [Float], _ frames: [FrameResult]) -> [String: Any?] {
    var peak: Float = 0
    var clipped = 0
    for x in samples {
      let a = abs(x)
      if a > peak { peak = a }
      if a >= 0.999 { clipped += 1 }
    }
    let voiced = frames.filter { $0.f0Hz != nil }.map { $0.levelDbfs }.sorted()
    let peakDbfs: Double? = peak > 0 ? 20 * log10(Double(peak)) : nil
    let voicedMedian: Double? = voiced.isEmpty ? nil : voiced[voiced.count / 2]
    let clippedFraction = samples.isEmpty ? 0 : Double(clipped) / Double(samples.count)
    return [
      "peakDbfs": peakDbfs,
      "clippedFraction": clippedFraction,
      "voicedLevelMedianDbfs": voicedMedian,
    ]
  }

  private static func pitch(_ p: PitchSummary) -> [String: Any?] {
    [
      "voicedS": p.voicedS,
      "medianHz": p.medianHz,
      "medianSt": p.medianSt,
      "p5St": p.p5St,
      "p10St": p.p10St,
      "p90St": p.p90St,
      "p95St": p.p95St,
      "sdSt": p.sdSt,
    ]
  }

  private static func stats(_ s: FeatureStats?) -> [String: Any?]? {
    s.map { ["mean": $0.mean, "sd": $0.sd] }
  }

  private static func qualityJson(_ q: VoiceQualityResult) -> [String: Any?] {
    [
      "qualityVersion": q.qualityVersion,
      "weightIndexVersion": q.weightIndexVersion,
      "voicedS": q.voicedS,
      "h1H2Db": q.h1H2Db,
      "h1cH2cDb": q.h1cH2cDb,
      "alphaRatioDb": q.alphaRatioDb,
      "hammarbergDb": q.hammarbergDb,
      "lhRatioDb": q.lhRatioDb,
      "cppsDb": q.cppsDb,
      "hnrDb": q.hnrDb,
      "jitterLocal": q.jitterLocal,
      "shimmerLocal": q.shimmerLocal,
      "periods": q.periods,
      "weightBaseline": [
        "h1cH2cDb": stats(q.weightBaseline.h1cH2cDb),
        "alphaRatioDb": stats(q.weightBaseline.alphaRatioDb),
        "cppsDb": stats(q.weightBaseline.cppsDb),
      ] as [String: Any?],
    ]
  }

  private static func vowelJson(_ v: VowelResult) -> [String: Any?] {
    [
      "f0MedianHz": v.f0MedianHz,
      "ceilingHz": v.ceilingHz,
      "f1Hz": v.f1Hz,
      "f2Hz": v.f2Hz,
      "f3Hz": v.f3Hz,
      "f4Hz": v.f4Hz,
      "deltaFHz": v.deltaFHz,
      "avtlCm": v.avtlCm,
      "deltaFPosition": v.deltaFPosition,
      "confidence": v.confidence,
    ]
  }

  /// Resolves a path the app asked to save audio at. It must stay inside
  /// Documents/recordings, so JavaScript can't write anywhere else.
  static func recordingURL(_ relative: String) throws -> URL {
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count >= 2, parts.first == "recordings",
          parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
          relative.hasSuffix(".wav")
    else { throw CaptureError.badSavePath(relative) }
    let docs = try FileManager.default.url(
      for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return parts.reduce(docs) { $0.appendingPathComponent(String($1)) }
  }
}
