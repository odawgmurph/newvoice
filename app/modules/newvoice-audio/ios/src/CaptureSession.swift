import AVFoundation

/// Microphone → Rust analysis on a native thread → computed frames out.
///
/// The session is opened in `.measurement` mode, which asks iOS for the
/// least processed input it offers (no voice processing, AGC or EQ). Audio
/// arrives on the realtime thread through an `AVAudioSinkNode`, which only
/// copies channel 0 into a ring. Every 5 ms the analysis queue drains the
/// ring into the Rust `LiveAnalyser` and collects finished frames, sending
/// them out in batches about every 16 ms. Raw audio never reaches JavaScript.
///
/// A capture can also record a test clip for the device matrix: the audio
/// the analyser saw, the frames it produced and what they cost. The clip is
/// kept in memory and only written to disk when the user exports it (see
/// `exportDiagnostics`).
final class CaptureSession {
  /// Receives each batch of frames (on the analysis queue).
  var onFrames: (([String: Any?]) -> Void)?
  /// Receives capture info when the route changes or capture stops.
  var onInfo: (([String: Any?]) -> Void)?

  private let queue = DispatchQueue(label: "app.newvoice.analysis", qos: .userInteractive)
  private let ring = SampleRing(capacity: 2 * 96_000)
  private var engine: AVAudioEngine?
  private var timer: DispatchSourceTimer?
  private var analyser: LiveAnalyser?
  private var sampleRate: Double = 0
  private var samplesPushed = 0
  private var droppedSamples = 0
  private var chunk: [Float] = []
  private var pending: [[String: Any?]] = []
  private var newestFrameS: Double = 0
  private var lastSend = DispatchTime.now()
  private var observers: [NSObjectProtocol] = []
  private var settings = defaultSettings()
  private var cost = AnalysisCost()
  private var recording: TestClip?
  private var recordingLimit = 0
  private var lastClip: TestClip?

  // MARK: - Permission

  static func requestPermission(_ done: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: done)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(done)
    }
  }

  // MARK: - Start / stop (serialised on the analysis queue)

  /// With `recordSeconds`, the capture also records a test clip and stops
  /// itself after that long.
  func start(
    formantCeilingHz: Double?,
    recordSeconds: Double?,
    completion: @escaping (Result<[String: Any?], Error>) -> Void
  ) {
    queue.async {
      do {
        try self.startOnQueue(formantCeilingHz: formantCeilingHz, recordSeconds: recordSeconds)
        completion(.success(self.info()))
      } catch {
        self.stopOnQueue()
        completion(.failure(error))
      }
    }
  }

  func stop(completion: @escaping () -> Void) {
    queue.async {
      self.stopOnQueue()
      completion()
    }
  }

  func currentInfo(completion: @escaping ([String: Any?]) -> Void) {
    queue.async { completion(self.info()) }
  }

  private func startOnQueue(formantCeilingHz: Double?, recordSeconds: Double?) throws {
    stopOnQueue()

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [])
    try session.setPreferredSampleRate(48_000)
    try session.setPreferredIOBufferDuration(0.005)
    try session.setActive(true)

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw CaptureError.noInput
    }
    guard format.commonFormat == .pcmFormatFloat32 else {
      throw CaptureError.unsupportedFormat(String(describing: format))
    }

    var settings = defaultSettings()
    if let ceiling = formantCeilingHz {
      settings.formantCeilingHz = ceiling
    }
    analyser = try LiveAnalyser(sampleRate: UInt32(format.sampleRate.rounded()), settings: settings)
    self.settings = settings
    sampleRate = format.sampleRate
    samplesPushed = 0
    droppedSamples = 0
    cost = AnalysisCost()
    pending.removeAll()
    ring.reset()

    let ring = self.ring
    let sink = AVAudioSinkNode { _, frameCount, audioBufferList -> OSStatus in
      let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: audioBufferList))
      guard let first = buffers.first, let data = first.mData else { return noErr }
      // Non-interleaved audio has one channel per buffer; interleaved audio
      // has them all in the first, so step over the others.
      let stride = max(Int(first.mNumberChannels), 1)
      ring.write(data.assumingMemoryBound(to: Float.self), count: Int(frameCount), stride: stride)
      return noErr
    }
    engine.attach(sink)
    engine.connect(input, to: sink, format: format)
    engine.prepare()
    try engine.start()
    self.engine = engine

    if let seconds = recordSeconds, seconds > 0 {
      // Starts with the capture, so clip sample 0 is analyser sample 0 and
      // frame times line up with the clip exactly.
      recordingLimit = Int(seconds * format.sampleRate)
      lastClip = nil
      var clip = TestClip(sampleRate: format.sampleRate, settings: settings, startInfo: info())
      clip.samples.reserveCapacity(recordingLimit + 4096)
      recording = clip
    }

    observe(session)

    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + .milliseconds(5), repeating: .milliseconds(5), leeway: .milliseconds(1))
    timer.setEventHandler { [weak self] in self?.tick() }
    timer.resume()
    self.timer = timer
  }

  private func stopOnQueue() {
    timer?.cancel()
    timer = nil
    finishRecording()
    if let engine {
      engine.stop()
      self.engine = nil
    }
    for o in observers {
      NotificationCenter.default.removeObserver(o)
    }
    observers.removeAll()
    analyser = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  // MARK: - Analysis loop

  private func tick() {
    guard let analyser else { return }
    droppedSamples = ring.drain(into: &chunk)
    let started = DispatchTime.now().uptimeNanoseconds
    if !chunk.isEmpty {
      analyser.push(samples: chunk)
      samplesPushed += chunk.count
    }
    let frames = analyser.pull()
    cost.add(nanoseconds: DispatchTime.now().uptimeNanoseconds - started, frames: frames.count)

    if recording != nil {
      recording!.samples.append(contentsOf: chunk)
      recording!.frames.append(contentsOf: frames)
      if recording!.samples.count >= recordingLimit {
        recording!.reachedLimit = true
        stopOnQueue()
        onInfo?(info())
        return
      }
    }

    for f in frames {
      pending.append(Self.payload(f))
      newestFrameS = f.timeS
    }
    let now = DispatchTime.now()
    guard !pending.isEmpty, now.uptimeNanoseconds - lastSend.uptimeNanoseconds >= 16_000_000
    else { return }

    let session = AVAudioSession.sharedInstance()
    let receivedS = Double(samplesPushed) / sampleRate
    onFrames?([
      "frames": pending,
      // Audio received after the newest frame's centre: the analyser's own
      // look-ahead plus this loop's polling delay.
      "analysisLagMs": (receivedS - newestFrameS) * 1000,
      // Hardware and I/O buffering before samples reach the ring.
      "inputLatencyMs": (session.inputLatency + session.ioBufferDuration) * 1000,
      "droppedSamples": droppedSamples,
      "sentAtMs": Date().timeIntervalSince1970 * 1000,
    ])
    pending.removeAll(keepingCapacity: true)
    lastSend = now
  }

  private static func payload(_ f: FrameResult) -> [String: Any?] {
    let f1 = f.formants.count > 0 ? f.formants[0].frequencyHz : nil
    let f2 = f.formants.count > 1 ? f.formants[1].frequencyHz : nil
    return [
      "t": f.timeS,
      "levelDbfs": f.levelDbfs,
      "periodicity": f.periodicity,
      "voiced": f.voiced,
      "f0Hz": f.f0Hz,
      "f0St": f.f0St,
      "f1Hz": f1,
      "f2Hz": f2,
      "formantConfidence": f.formantConfidence,
    ]
  }

  /// Moves the clip being recorded (if any) to `lastClip`, with what the
  /// session looked like at the end. Call before the engine stops.
  private func finishRecording() {
    guard var clip = recording else { return }
    recording = nil
    clip.endInfo = info()
    clip.droppedSamples = droppedSamples
    clip.cost = cost
    lastClip = clip
  }

  // MARK: - Diagnostics export

  /// Writes the last test clip as `<name>.wav` (mono 32-bit float, the audio
  /// the analyser saw) and `<name>.json` (device, capture info, the live
  /// frames, analysis cost, a benchmark, plus `appReport` from JavaScript),
  /// and returns both URLs. Earlier exports are deleted first, so at most
  /// one clip is ever on disk. `harness/validation/device.py` reads them.
  func exportDiagnostics(
    appReport: [String: Any],
    completion: @escaping (Result<[URL], Error>) -> Void
  ) {
    queue.async {
      do {
        guard self.engine == nil else { throw CaptureError.stillRunning }
        guard let clip = self.lastClip else { throw CaptureError.noTestClip }
        completion(.success(try Diagnostics.write(clip: clip, appReport: appReport)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  // MARK: - Task analysis

  /// Analyses the last recorded clip as a task (see `TaskAnalysis`) on a
  /// background queue, optionally keeping its audio at `saveAs`. The clip
  /// is dropped from memory first, so its audio is analysed once and never
  /// kept unless the user asked to keep audio.
  func analyseLastClip(
    kind: TaskKind,
    saveAs: URL?,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    queue.async {
      guard self.engine == nil else {
        completion(.failure(CaptureError.stillRunning))
        return
      }
      guard let clip = self.lastClip else {
        completion(.failure(CaptureError.noClip))
        return
      }
      self.lastClip = nil
      DispatchQueue.global(qos: .userInitiated).async {
        completion(Result { try TaskAnalysis.analyse(clip: clip, kind: kind, saveAs: saveAs) })
      }
    }
  }

  /// Forgets the last clip without analysing it (a cancelled task).
  func discardLastClip(completion: @escaping () -> Void) {
    queue.async {
      self.lastClip = nil
      completion()
    }
  }

  // MARK: - Capability report

  /// What iOS actually gave us. `measurementMode` false, a non-standard
  /// microphone mode, or a Bluetooth input means readings may be processed.
  private func info() -> [String: Any?] {
    let session = AVAudioSession.sharedInstance()
    let inputs = session.currentRoute.inputs
    let bluetooth: Set<AVAudioSession.Port> = [.bluetoothHFP, .bluetoothLE, .bluetoothA2DP]
    var microphoneMode = "unknown"
    if #available(iOS 15.0, *) {
      switch AVCaptureDevice.activeMicrophoneMode {
      case .standard: microphoneMode = "standard"
      case .wideSpectrum: microphoneMode = "wideSpectrum"
      case .voiceIsolation: microphoneMode = "voiceIsolation"
      @unknown default: microphoneMode = "other"
      }
    }
    return [
      "running": engine?.isRunning ?? false,
      "category": session.category.rawValue,
      "mode": session.mode.rawValue,
      "measurementMode": session.mode == .measurement,
      "microphoneMode": microphoneMode,
      "inputs": inputs.map { ["type": $0.portType.rawValue, "name": $0.portName] },
      "bluetoothInput": inputs.contains { bluetooth.contains($0.portType) },
      "sessionSampleRate": session.sampleRate,
      "analysisSampleRate": sampleRate,
      "ioBufferMs": session.ioBufferDuration * 1000,
      "inputLatencyMs": session.inputLatency * 1000,
      "inputGainSettable": session.isInputGainSettable,
      "inputGain": Double(session.inputGain),
      "coreVersion": coreVersion(),
      "recording": recording != nil,
      "testClipS": lastClip.map { Double($0.samples.count) / $0.sampleRate } ?? 0,
    ]
  }

  private func observe(_ session: AVAudioSession) {
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: session, queue: nil
    ) { [weak self] _ in
      guard let self else { return }
      self.queue.async { self.onInfo?(self.info()) }
    })
    observers.append(center.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: nil
    ) { [weak self] note in
      guard let self,
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            AVAudioSession.InterruptionType(rawValue: raw) == .began
      else { return }
      self.queue.async {
        self.stopOnQueue()
        self.onInfo?(self.info())
      }
    })
  }
}

enum CaptureError: LocalizedError {
  case noInput
  case unsupportedFormat(String)
  case stillRunning
  case noTestClip
  case noClip
  case badSavePath(String)
  case noViewController

  var errorDescription: String? {
    switch self {
    case .noInput: return "No microphone input is available."
    case .unsupportedFormat(let f): return "Unsupported input format: \(f)"
    case .stillRunning: return "Stop listening before exporting."
    case .noTestClip: return "Record a test clip first."
    case .noClip: return "Nothing has been recorded yet."
    case .badSavePath(let p): return "Can't save a recording at \(p)."
    case .noViewController: return "Couldn't open the share sheet."
    }
  }
}
