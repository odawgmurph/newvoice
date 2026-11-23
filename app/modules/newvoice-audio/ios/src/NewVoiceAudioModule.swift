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
