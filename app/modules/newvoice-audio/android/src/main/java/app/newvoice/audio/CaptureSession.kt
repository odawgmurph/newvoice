package app.newvoice.audio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.os.SystemClock
import java.util.concurrent.Executors
import uniffi.newvoice_ffi.FrameResult
import uniffi.newvoice_ffi.LiveAnalyser
import uniffi.newvoice_ffi.UtteranceSummary
import uniffi.newvoice_ffi.WeightBaseline
import uniffi.newvoice_ffi.coreVersion
import uniffi.newvoice_ffi.defaultSettings

/**
 * Microphone → Rust analysis on a native thread → computed frames out
 * (Stage 2, Android; decisions D12, D14, D25).
 *
 * Opens the mic with the `UNPROCESSED` source where the device says it
 * supports it, falling back to `VOICE_RECOGNITION` (which most devices leave
 * without AGC or noise suppression), and switches off any AGC, noise
 * suppressor or echo canceller attached to the session. A read thread pulls
 * 5 ms of float samples at a time into the Rust `LiveAnalyser` and sends
 * frames to JavaScript about every 16 ms; utterance summaries are measured
 * on a separate executor about every 250 ms. Raw audio never reaches
 * JavaScript. The same event payloads as iOS (CaptureSession.swift).
 *
 * Built in CI, not tested on a phone (D14).
 */
class CaptureSession(private val context: Context) {
  var onFrames: ((Map<String, Any?>) -> Unit)? = null
  var onInfo: ((Map<String, Any?>) -> Unit)? = null
  var onUtterance: ((Map<String, Any?>) -> Unit)? = null

  private val lock = Object()
  private val utterances = Executors.newSingleThreadExecutor()
  private var record: AudioRecord? = null
  private var thread: Thread? = null
  @Volatile private var running = false
  private var analyser: LiveAnalyser? = null
  private var sampleRate = 0
  private var source = "none"
  private var bufferFrames = 0
  private var samplesPushed = 0L
  private var droppedSamples = 0L
  private var recording: Clip? = null
  private var recordingLimit = 0
  var lastClip: Clip? = null
    private set

  class Clip(val sampleRate: Int, val startInfo: Map<String, Any?>) {
    val chunks = ArrayList<FloatArray>()
    var length = 0
    var reachedLimit = false
    var endInfo: Map<String, Any?> = emptyMap()
    var droppedSamples = 0L

    fun samples(): FloatArray {
      val out = FloatArray(length)
      var at = 0
      for (c in chunks) {
        System.arraycopy(c, 0, out, at, c.size)
        at += c.size
      }
      return out
    }
  }

  // MARK: start / stop

  fun start(formantCeilingHz: Double?, recordSeconds: Double?, vowel: String?, weightBaseline: WeightBaseline?): Map<String, Any?> {
    synchronized(lock) {
      stopLocked()
      val (rec, src) = openRecord()
      try {
        val settings = defaultSettings()
        if (formantCeilingHz != null) settings.formantCeilingHz = formantCeilingHz
        val a = LiveAnalyser(rec.sampleRate.toUInt(), settings)
        // Throws for an unknown vowel, which fails the start.
        a.setFeedbackContext(vowel, weightBaseline)
        analyser = a
      } catch (e: Exception) {
        rec.release()
        throw e
      }
      record = rec
      source = src
      sampleRate = rec.sampleRate
      samplesPushed = 0
      droppedSamples = 0
      disableEffects(rec.audioSessionId)
      if (recordSeconds != null && recordSeconds > 0) {
        recordingLimit = (recordSeconds * sampleRate).toInt()
        lastClip = null
        recording = Clip(sampleRate, info())
      }
      rec.startRecording()
      running = true
      thread = Thread({ loop() }, "newvoice-analysis").also { it.start() }
      return info()
    }
  }

  fun stop() {
    synchronized(lock) { stopLocked() }
    onInfo?.invoke(info())
  }

  fun currentInfo(): Map<String, Any?> = synchronized(lock) { info() }

  fun takeLastClip(): Clip? = synchronized(lock) {
    if (running) throw IllegalStateException("Stop listening first.")
    val c = lastClip
    lastClip = null
    c
  }

  fun discardLastClip() = synchronized(lock) { lastClip = null }

  private fun stopLocked() {
    running = false
    thread?.let { if (it !== Thread.currentThread()) it.join(500) }
    thread = null
    finishRecording()
    record?.let {
      try {
        it.stop()
      } catch (_: IllegalStateException) {
      }
      it.release()
    }
    record = null
    analyser?.let { a ->
      // Close the last utterance and measure it off this thread.
      a.finish()
      pollUtterances(a)
    }
    analyser = null
  }

  /** 48 kHz float mono, UNPROCESSED when the device supports it. */
  private fun openRecord(): Pair<AudioRecord, String> {
    val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val unprocessed = am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
    val sources =
      if (unprocessed) listOf(MediaRecorder.AudioSource.UNPROCESSED to "unprocessed", MediaRecorder.AudioSource.VOICE_RECOGNITION to "voiceRecognition")
      else listOf(MediaRecorder.AudioSource.VOICE_RECOGNITION to "voiceRecognition")
    for ((src, name) in sources) {
      for (rate in intArrayOf(48_000, 44_100)) {
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        if (min <= 0) continue
        val bytes = maxOf(min, rate / 10 * 4) // at least 100 ms of float samples
        try {
          @Suppress("MissingPermission")
          val rec = AudioRecord(src, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT, bytes)
          if (rec.state == AudioRecord.STATE_INITIALIZED) {
            bufferFrames = bytes / 4
            return rec to name
          }
          rec.release()
        } catch (_: Exception) {
        }
      }
    }
    throw IllegalStateException("No microphone input is available.")
  }

  private fun disableEffects(sessionId: Int) {
    try {
      if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(sessionId)?.enabled = false
      if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(sessionId)?.enabled = false
      if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(sessionId)?.enabled = false
    } catch (_: Exception) {
    }
  }

  // MARK: analysis loop

  private fun loop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val rec = record ?: return
    val a = analyser ?: return
    val chunk = FloatArray(maxOf(1, sampleRate / 200)) // 5 ms
    val pending = ArrayList<Map<String, Any?>>()
    var newestFrameS = 0.0
    var lastSend = SystemClock.elapsedRealtime()
    var lastPoll = lastSend
    while (running) {
      val n = rec.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING)
      if (n <= 0) {
        if (n < 0) break
        continue
      }
      val samples = if (n == chunk.size) chunk.copyOf() else chunk.copyOf(n)
      a.push(samples.toList())
      samplesPushed += n
      val frames = a.pull()
      val clip = recording
      if (clip != null) {
        clip.chunks.add(samples)
        clip.length += n
        if (clip.length >= recordingLimit) {
          clip.reachedLimit = true
          running = false
          Thread { stop() }.start()
          break
        }
      }
      for (f in frames) {
        pending.add(payload(f))
        newestFrameS = f.timeS
      }
      val now = SystemClock.elapsedRealtime()
      if (now - lastPoll >= 250) {
        lastPoll = now
        pollUtterances(a)
      }
      if (pending.isNotEmpty() && now - lastSend >= 16) {
        val receivedS = samplesPushed.toDouble() / sampleRate
        onFrames?.invoke(
          mapOf(
            "frames" to ArrayList(pending),
            "analysisLagMs" to (receivedS - newestFrameS) * 1000,
            "inputLatencyMs" to bufferFrames * 1000.0 / sampleRate,
            "droppedSamples" to droppedSamples,
            "sentAtMs" to System.currentTimeMillis().toDouble(),
          ),
        )
        pending.clear()
        lastSend = now
      }
    }
  }

  private fun pollUtterances(a: LiveAnalyser) {
    utterances.execute {
      for (u in a.pullUtterances()) onUtterance?.invoke(utterancePayload(u))
    }
  }

  private fun finishRecording() {
    val clip = recording ?: return
    recording = null
    clip.endInfo = info()
    clip.droppedSamples = droppedSamples
    lastClip = clip
  }

  // MARK: capability report

  /** What Android actually gave us; `measurementMode` is true only for UNPROCESSED. */
  private fun info(): Map<String, Any?> {
    val device = record?.routedDevice
    val bluetooth = device != null && (device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || device.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
    return mapOf(
      "running" to running,
      "category" to "android",
      "mode" to source,
      "measurementMode" to (source == "unprocessed"),
      "microphoneMode" to "standard",
      "inputs" to (device?.let { listOf(mapOf("type" to deviceType(it.type), "name" to it.productName.toString())) } ?: emptyList()),
      "bluetoothInput" to bluetooth,
      "sessionSampleRate" to sampleRate.toDouble(),
      "analysisSampleRate" to sampleRate.toDouble(),
      "ioBufferMs" to if (sampleRate > 0) bufferFrames * 1000.0 / sampleRate else 0.0,
      "inputLatencyMs" to 0.0,
      "inputGainSettable" to false,
      "inputGain" to 1.0,
      "coreVersion" to coreVersion(),
      "recording" to (recording != null),
      "testClipS" to (lastClip?.let { it.length.toDouble() / it.sampleRate } ?: 0.0),
    )
  }

  private fun deviceType(t: Int): String = when (t) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtInMic"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wiredHeadset"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth"
    else -> "other($t)"
  }

  companion object {
    fun payload(f: FrameResult): Map<String, Any?> = mapOf(
      "t" to f.timeS,
      "levelDbfs" to f.levelDbfs,
      "periodicity" to f.periodicity,
      "voiced" to f.voiced,
      "f0Hz" to f.f0Hz,
      "f0St" to f.f0St,
      "f1Hz" to f.formants.getOrNull(0)?.frequencyHz,
      "f2Hz" to f.formants.getOrNull(1)?.frequencyHz,
      "formantConfidence" to f.formantConfidence,
      "h1cH2cDb" to f.spectral?.h1cH2cDb,
      "alphaRatioDb" to f.spectral?.alphaRatioDb,
      "resonance" to f.resonance,
      "weightIndex" to f.weightIndex,
    )

    /** Matches `UtteranceSummary` in NewVoiceAudio.types.ts. */
    fun utterancePayload(u: UtteranceSummary): Map<String, Any?> = mapOf(
      "startS" to u.startS,
      "endS" to u.endS,
      "voicedS" to u.voicedS,
      "scored" to u.scored,
      "pitch" to u.pitch?.let { p ->
        mapOf(
          "medianHz" to p.medianHz,
          "medianSt" to p.medianSt,
          "p10St" to p.p10St,
          "p90St" to p.p90St,
          "sdSt" to p.sdSt,
          "range5to95St" to p.range595St,
        )
      },
      "terminalSlopeStPerS" to u.terminalSlopeStPerS,
      "f1Hz" to u.f1Hz,
      "f2Hz" to u.f2Hz,
      "f3Hz" to u.f3Hz,
      "formantConfidence" to u.formantConfidence,
      "resonance" to u.resonance,
      "weightIndex" to u.weightIndex,
      "h1cH2cDb" to u.h1cH2cDb,
      "alphaRatioDb" to u.alphaRatioDb,
      "cppsDb" to u.cppsDb,
      "hnrDb" to u.hnrDb,
      "jitterLocal" to u.jitterLocal,
      "shimmerLocal" to u.shimmerLocal,
      "periods" to u.periods.toInt(),
    )
  }
}
