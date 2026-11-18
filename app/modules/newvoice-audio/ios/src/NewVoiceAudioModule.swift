import ExpoModulesCore

struct StartOptions: Record {
  /// Live formant ceiling; ideally the one the user's baseline vowels chose.
  @Field
  var formantCeilingHz: Double? = nil
}

/// The JavaScript face of `CaptureSession`. Only computed frames and
/// capture diagnostics cross into JavaScript, never audio.
public class NewVoiceAudioModule: Module {
  private let capture = CaptureSession()

  public func definition() -> ModuleDefinition {
    Name("NewVoiceAudio")

    Events("onFrames", "onCaptureInfo")

    OnCreate {
      self.capture.onFrames = { [weak self] batch in
        self?.sendEvent("onFrames", batch)
      }
      self.capture.onInfo = { [weak self] info in
        self?.sendEvent("onCaptureInfo", info)
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
        self.capture.start(formantCeilingHz: options.formantCeilingHz) { result in
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

    OnDestroy {
      self.capture.stop {}
    }
  }
}
