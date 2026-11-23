import ExpoModulesCore
import UIKit

struct StartOptions: Record {
  /// Live formant ceiling; ideally the one the user's baseline vowels chose.
  @Field
  var formantCeilingHz: Double? = nil

  /// Record a test clip of this many seconds for the diagnostics export;
  /// capture stops by itself at the end.
  @Field
  var recordSeconds: Double? = nil

  /// The vowel an exercise asks for (Hillenbrand code or IPA); enables
  /// resonance scores on frames and utterances.
  @Field
  var vowel: String? = nil

  /// The user's weight-index baseline; enables weight indexes.
  @Field
  var weightBaseline: WeightBaselineOptions? = nil
}

struct FeatureStatsOptions: Record {
  @Field
  var mean: Double = 0

  @Field
  var sd: Double = 0

  var core: FeatureStats { FeatureStats(mean: mean, sd: sd) }
}

/// `WeightBaseline` from JavaScript (see NewVoiceAudio.types.ts).
struct WeightBaselineOptions: Record {
  @Field
  var h1cH2cDb: FeatureStatsOptions? = nil

  @Field
  var alphaRatioDb: FeatureStatsOptions? = nil

  @Field
  var cppsDb: FeatureStatsOptions? = nil

  var core: WeightBaseline {
    WeightBaseline(h1cH2cDb: h1cH2cDb?.core, alphaRatioDb: alphaRatioDb?.core, cppsDb: cppsDb?.core)
  }
}

struct AnalyseOptions: Record {
  /// "vowel", "glide" or "speech" (see `TaskKind`).
  @Field
  var kind: String = "speech"

  /// Where to keep the audio, relative to Documents and inside
  /// "recordings/", e.g. "recordings/baseline-1/vowel-a.wav". Omit to keep
  /// no audio (metrics-only).
  @Field
  var saveAs: String? = nil
}

struct ResonanceTokenRecord: Record {
  @Field
  var vowel: String = ""
  @Field
  var f1Hz: Double? = nil
  @Field
  var f2Hz: Double? = nil
  @Field
  var f3Hz: Double? = nil
  @Field
  var weight: Double = 1
}

/// The JavaScript face of `CaptureSession`. Only computed frames and
/// capture diagnostics cross into JavaScript, never audio.
public class NewVoiceAudioModule: Module {
  private let capture = CaptureSession()

  public func definition() -> ModuleDefinition {
    Name("NewVoiceAudio")

    Events("onFrames", "onCaptureInfo", "onUtterance")

    OnCreate {
      self.capture.onFrames = { [weak self] batch in
        self?.sendEvent("onFrames", batch)
      }
      self.capture.onInfo = { [weak self] info in
        self?.sendEvent("onCaptureInfo", info)
      }
      self.capture.onUtterance = { [weak self] utterance in
        self?.sendEvent("onUtterance", utterance)
      }
    }

    Function("coreVersion") {
      return coreVersion()
    }

    AsyncFunction("start") { (options: StartOptions, promise: Promise) in
      CaptureSession.requestPermission { granted in
        guard granted else {
          promise.reject("E_MIC_PERMISSION", "Microphone permission was not granted.")
          return
        }
        self.capture.start(
          formantCeilingHz: options.formantCeilingHz,
          recordSeconds: options.recordSeconds,
          vowel: options.vowel,
          weightBaseline: options.weightBaseline?.core
        ) { result in
          switch result {
          case .success(let info): promise.resolve(info)
          case .failure(let error): promise.reject("E_CAPTURE", error.localizedDescription)
          }
        }
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.capture.stop { promise.resolve(nil) }
    }

    AsyncFunction("getCaptureInfo") { (promise: Promise) in
      self.capture.currentInfo { promise.resolve($0) }
    }

    // Writes the last test clip's files and opens the share sheet (AirDrop,
    // Save to Files, Mail…). The files leave the phone only if the user
    // picks a destination there.
    AsyncFunction("exportDiagnostics") { (appReport: [String: Any], promise: Promise) in
      self.capture.exportDiagnostics(appReport: appReport) { result in
        switch result {
        case .failure(let error):
          promise.reject("E_EXPORT", error.localizedDescription)
        case .success(let urls):
          DispatchQueue.main.async {
            self.share(urls, promise: promise)
          }
        }
      }
    }

    // Batch analysis of the clip just recorded with `start({recordSeconds})`.
    AsyncFunction("analyseLastClip") { (options: AnalyseOptions, promise: Promise) in
      guard let kind = TaskKind(rawValue: options.kind) else {
        promise.reject("E_ANALYSE", "Unknown task kind \(options.kind).")
        return
      }
      let saveAs: URL?
      do {
        saveAs = try options.saveAs.map(TaskAnalysis.recordingURL)
      } catch {
        promise.reject("E_ANALYSE", error.localizedDescription)
        return
      }
      self.capture.analyseLastClip(kind: kind, saveAs: saveAs) { result in
        switch result {
        case .success(let value): promise.resolve(value)
        case .failure(let error): promise.reject("E_ANALYSE", error.localizedDescription)
        }
      }
    }

    AsyncFunction("discardLastClip") { (promise: Promise) in
      self.capture.discardLastClip { promise.resolve(nil) }
    }

    // The resonance score over measured vowel tokens (D11). Null score when
    // no token has a scorable formant.
    Function("resonanceScore") { (tokens: [ResonanceTokenRecord]) throws -> [String: Any] in
      let result = try resonanceScore(tokens: tokens.map {
        ResonanceToken(vowel: $0.vowel, f1Hz: $0.f1Hz, f2Hz: $0.f2Hz, f3Hz: $0.f3Hz, weight: $0.weight)
      })
      let value: [String: Any?] = [
        "version": result?.version,
        "score": result?.score,
        "f1": result?.f1,
        "f2": result?.f2,
        "f3": result?.f3,
        "tokensUsed": result?.tokensUsed ?? 0,
      ]
      // swiftlint:disable:next force_cast
      return Diagnostics.jsonSafe(value) as! [String: Any]
    }

    OnDestroy {
      self.capture.stop {}
    }
  }

  private func share(_ urls: [URL], promise: Promise) {
    guard let presenter = appContext?.utilities?.currentViewController() else {
      promise.reject("E_EXPORT", CaptureError.noViewController.localizedDescription)
      return
    }
    let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
    var settled = false
    sheet.completionWithItemsHandler = { activity, completed, _, _ in
      guard !settled else { return }
      settled = true
      promise.resolve([
        "shared": completed,
        "activity": activity?.rawValue ?? "",
        "files": urls.map { $0.lastPathComponent },
      ] as [String: Any])
    }
    // iPad shows the sheet as a popover, which needs an anchor.
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = presenter.view
      popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
      popover.permittedArrowDirections = []
    }
    presenter.present(sheet, animated: true)
  }
}
