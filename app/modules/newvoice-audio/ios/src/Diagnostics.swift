import AVFoundation
import UIKit

/// Time spent inside the Rust analyser (push + pull) on the analysis queue.
struct AnalysisCost {
  var ticks = 0
  var frames = 0
  var totalNs: UInt64 = 0
  var maxTickNs: UInt64 = 0

  mutating func add(nanoseconds: UInt64, frames produced: Int) {
    ticks += 1
    frames += produced
    totalNs += nanoseconds
    maxTickNs = max(maxTickNs, nanoseconds)
  }

  var report: [String: Any] {
    [
      "ticks": ticks,
      "frames": frames,
      "usPerFrame": frames > 0 ? Double(totalNs) / 1000 / Double(frames) as Any : NSNull(),
      "maxTickUs": Double(maxTickNs) / 1000,
    ]
  }
}

/// A recorded test clip: exactly the samples the live analyser received
/// (from capture start), and the frames it produced from them.
struct TestClip {
  let sampleRate: Double
  let settings: AnalysisSettings
  let startInfo: [String: Any?]
  let startedAt = Date()
  var samples: [Float] = []
  var frames: [FrameResult] = []
  var endInfo: [String: Any?] = [:]
  var droppedSamples = 0
  var cost = AnalysisCost()
  /// True when the clip ran to its length limit, false when stopped early.
  var reachedLimit = false

  init(sampleRate: Double, settings: AnalysisSettings, startInfo: [String: Any?]) {
    self.sampleRate = sampleRate
    self.settings = settings
    self.startInfo = startInfo
  }
}

enum Diagnostics {
  /// Bumped when the export's layout changes; `device.py` checks it.
  static let formatVersion = 1

  static func write(clip: TestClip, appReport: [String: Any]) throws -> [URL] {
    let fm = FileManager.default
    let dir = fm.temporaryDirectory.appendingPathComponent("diagnostics", isDirectory: true)
    try? fm.removeItem(at: dir)
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)

    let stamp = DateFormatter()
    stamp.locale = Locale(identifier: "en_US_POSIX")
    stamp.dateFormat = "yyyyMMdd-HHmmss"
    let name = [
      "nv",
      deviceModel().replacingOccurrences(of: ",", with: "_"),
      routeSlug(clip.startInfo),
      stamp.string(from: clip.startedAt),
    ].joined(separator: "-")

    let wav = dir.appendingPathComponent("\(name).wav")
    try wavData(clip.samples, sampleRate: Int(clip.sampleRate.rounded())).write(to: wav)

    let report: [String: Any?] = [
      "format": "newvoice-diagnostics",
      "formatVersion": formatVersion,
      "wav": wav.lastPathComponent,
      "createdAt": ISO8601DateFormatter().string(from: Date()),
      "recordedAt": ISO8601DateFormatter().string(from: clip.startedAt),
      "device": device(),
      "coreVersion": coreVersion(),
      "settings": [
        "f0MinHz": clip.settings.f0MinHz,
        "f0MaxHz": clip.settings.f0MaxHz,
        "pitchAlgorithm": String(describing: clip.settings.pitchAlgorithm),
        "formantCeilingHz": clip.settings.formantCeilingHz,
        "silenceDbfs": clip.settings.silenceDbfs,
      ] as [String: Any?],
      "clip": [
        "sampleRate": clip.sampleRate,
        "samples": clip.samples.count,
        "seconds": Double(clip.samples.count) / clip.sampleRate,
        "reachedLimit": clip.reachedLimit,
        "droppedSamples": clip.droppedSamples,
      ] as [String: Any],
      "captureAtStart": clip.startInfo,
      "captureAtEnd": clip.endInfo,
      "liveCost": clip.cost.report,
      "benchmark": try benchmark(clip),
      "app": appReport,
      "frames": frameColumns(clip.frames),
    ]
    let json = dir.appendingPathComponent("\(name).json")
    try JSONSerialization.data(withJSONObject: jsonSafe(report), options: [.sortedKeys]).write(to: json)
    return [json, wav]
  }

  /// The live frames as columns (null where a value is missing).
  private static func frameColumns(_ frames: [FrameResult]) -> [String: Any] {
    func formant(_ f: FrameResult, _ k: Int) -> Any {
      f.formants.count > k ? f.formants[k].frequencyHz as Any : NSNull()
    }
    return [
      "t": frames.map { $0.timeS },
      "levelDbfs": frames.map { $0.levelDbfs },
      "periodicity": frames.map { $0.periodicity },
      "voiced": frames.map { $0.voiced },
      "f0Hz": frames.map { f -> Any in f.f0Hz.map { $0 as Any } ?? NSNull() },
      "f1Hz": frames.map { formant($0, 0) },
      "f2Hz": frames.map { formant($0, 1) },
      "f3Hz": frames.map { formant($0, 2) },
      "formantConfidence": frames.map { $0.formantConfidence },
    ]
  }

  /// Runs the clip through a fresh analyser as fast as possible, in 5 ms
  /// chunks like the live loop, and keeps the best of three runs: the
  /// per-frame cost on this phone, comparable with `newvoice-cli bench`.
  private static func benchmark(_ clip: TestClip) throws -> [String: Any] {
    let chunk = max(Int(clip.sampleRate * 0.005), 1)
    let rate = UInt32(clip.sampleRate.rounded())
    var best = Double.infinity
    var frames = 0
    for _ in 0..<3 {
      let analyser = try LiveAnalyser(sampleRate: rate, settings: clip.settings)
      frames = 0
      let started = DispatchTime.now().uptimeNanoseconds
      var i = 0
      while i < clip.samples.count {
        let end = min(i + chunk, clip.samples.count)
        analyser.push(samples: Array(clip.samples[i..<end]))
        frames += analyser.pull().count
        i = end
      }
      frames += analyser.finish().count
      best = min(best, Double(DispatchTime.now().uptimeNanoseconds - started) / 1e9)
    }
    return [
      "repeats": 3,
      "chunkSamples": chunk,
      "frames": frames,
      "seconds": best,
      "usPerFrame": frames > 0 ? 1e6 * best / Double(frames) as Any : NSNull(),
      "hopUs": 10_000,
      "thermalState": thermalState(),
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ]
  }

  // MARK: - Device

  /// Hardware model identifier, e.g. "iPhone15,2" (the simulator reports
  /// the model it simulates).
  static func deviceModel() -> String {
    if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return sim
    }
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
    }
  }

  private static func device() -> [String: Any] {
    [
      "model": deviceModel(),
      "system": "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
      "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? NSNull(),
      "appBuild": Bundle.main.infoDictionary?["CFBundleVersion"] ?? NSNull(),
      "processors": ProcessInfo.processInfo.activeProcessorCount,
      "thermalState": thermalState(),
    ]
  }

  private static func thermalState() -> String {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  /// Short label for the input route, for the file name.
  private static func routeSlug(_ info: [String: Any?]) -> String {
    let inputs = (info["inputs"] ?? nil) as? [[String: String]] ?? []
    switch inputs.first?["type"] ?? "" {
    case AVAudioSession.Port.builtInMic.rawValue: return "builtin"
    case AVAudioSession.Port.headsetMic.rawValue: return "wired"
    case AVAudioSession.Port.bluetoothHFP.rawValue, AVAudioSession.Port.bluetoothLE.rawValue: return "bluetooth"
    case AVAudioSession.Port.usbAudio.rawValue: return "usb"
    case "": return "none"
    default: return "other"
    }
  }

  // MARK: - Encoding

  /// Mono 32-bit float WAV, the same layout as the harness's
  /// `synth.write_wav`.
  static func wavData(_ samples: [Float], sampleRate: Int) -> Data {
    var d = Data()
    func u32(_ v: Int) { withUnsafeBytes(of: UInt32(v).littleEndian) { d.append(contentsOf: $0) } }
    func u16(_ v: Int) { withUnsafeBytes(of: UInt16(v).littleEndian) { d.append(contentsOf: $0) } }
    let bytes = samples.count * 4
    d.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes)
    d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8)); u32(16)
    u16(3) // IEEE float
    u16(1) // mono
    u32(sampleRate)
    u32(sampleRate * 4)
    u16(4)
    u16(32)
    d.append(contentsOf: Array("data".utf8)); u32(bytes)
    // Float32 is little-endian on every iOS device.
    samples.withUnsafeBytes { d.append(contentsOf: $0) }
    return d
  }

  /// Makes a value JSONSerialization accepts: nil and non-finite numbers
  /// become null, nested optionals are unwrapped.
  static func jsonSafe(_ value: Any?) -> Any {
    guard let value else { return NSNull() }
    let mirror = Mirror(reflecting: value)
    if mirror.displayStyle == .optional {
      return mirror.children.first.map { jsonSafe($0.value) } ?? NSNull()
    }
    switch value {
    case let n as NSNumber:
      // Booleans bridge to kCFBoolean and keep their type.
      if CFGetTypeID(n) == CFBooleanGetTypeID() { return n }
      return n.doubleValue.isFinite ? n : NSNull()
    case let s as String:
      return s
    case let dict as [String: Any?]:
      return dict.mapValues { jsonSafe($0) }
    case let dict as [String: Any]:
      return dict.mapValues { jsonSafe($0) }
    case let array as [Any?]:
      return array.map { jsonSafe($0) }
    case let array as [Any]:
      return array.map { jsonSafe($0) }
    default:
      return String(describing: value)
    }
  }
}
