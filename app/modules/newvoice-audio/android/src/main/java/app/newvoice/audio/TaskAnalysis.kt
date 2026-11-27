package app.newvoice.audio

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import uniffi.newvoice_ffi.FeatureStats
import uniffi.newvoice_ffi.FrameResult
import uniffi.newvoice_ffi.PitchSummary
import uniffi.newvoice_ffi.VoiceQualityResult
import uniffi.newvoice_ffi.VowelResult
import uniffi.newvoice_ffi.analyseRecording
import uniffi.newvoice_ffi.coreVersion
import uniffi.newvoice_ffi.defaultRecordingSettings
import uniffi.newvoice_ffi.measureSustainedVowel
import uniffi.newvoice_ffi.measureVoiceQuality

/**
 * Batch analysis of a finished task recording (baseline tasks), the Android
 * twin of TaskAnalysis.swift (D20): the Rust core's recording path (pYIN),
 * voice quality and, for vowels, the sustained-vowel measurement. Returns
 * the same JSON shape (`TaskResult` in NewVoiceAudio.types.ts). Audio is
 * written only when `saveAs` is given (the user keeps audio).
 */
object TaskAnalysis {
  const val FORMAT_VERSION = 1

  fun analyse(context: Context, clip: CaptureSession.Clip, kind: String, saveAs: String?): Map<String, Any?> {
    require(kind == "vowel" || kind == "glide" || kind == "speech") { "Unknown task kind $kind." }
    val target = saveAs?.let { recordingFile(context, it) }
    val samples = clip.samples()
    val list = samples.toList()
    val rate = clip.sampleRate.toUInt()
    val settings = defaultRecordingSettings()
    val analysis = analyseRecording(list, rate, settings)
    val quality = measureVoiceQuality(list, rate, settings)
    val vowel = if (kind == "vowel") measureSustainedVowel(list, rate) else null

    var savedUri: String? = null
    if (target != null) {
      target.parentFile?.mkdirs()
      writeWav(target, samples, clip.sampleRate)
      savedUri = "file://" + target.absolutePath
    }
    return mapOf(
      "formatVersion" to FORMAT_VERSION,
      "kind" to kind,
      "coreVersion" to coreVersion(),
      "durationS" to analysis.durationS,
      "sampleRate" to clip.sampleRate.toDouble(),
      "capture" to captureJson(clip),
      "levels" to levels(samples, analysis.frames),
      "pitch" to analysis.pitch?.let(::pitchJson),
      "quality" to qualityJson(quality),
      "vowel" to vowel?.let(::vowelJson),
      "audioUri" to savedUri,
    )
  }

  private fun captureJson(clip: CaptureSession.Clip): Map<String, Any?> = mapOf(
    "measurementMode" to ((clip.startInfo["measurementMode"] as? Boolean ?: false) && (clip.endInfo["measurementMode"] as? Boolean ?: true)),
    "bluetoothInput" to ((clip.startInfo["bluetoothInput"] as? Boolean ?: false) || (clip.endInfo["bluetoothInput"] as? Boolean ?: false)),
    "microphoneMode" to (clip.startInfo["mode"] as? String),
    "droppedSamples" to clip.droppedSamples,
    "stoppedEarly" to !clip.reachedLimit,
  )

  private fun levels(samples: FloatArray, frames: List<FrameResult>): Map<String, Any?> {
    var peak = 0f
    var clipped = 0
    for (x in samples) {
      val a = abs(x)
      if (a > peak) peak = a
      if (a >= 0.999f) clipped++
    }
    val voiced = frames.filter { it.f0Hz != null }.map { it.levelDbfs }.sorted()
    return mapOf(
      "peakDbfs" to if (peak > 0) 20 * log10(peak.toDouble()) else null,
      "clippedFraction" to if (samples.isEmpty()) 0.0 else clipped.toDouble() / samples.size,
      "voicedLevelMedianDbfs" to voiced.getOrNull(voiced.size / 2),
    )
  }

  private fun pitchJson(p: PitchSummary): Map<String, Any?> = mapOf(
    "voicedS" to p.voicedS,
    "medianHz" to p.medianHz,
    "medianSt" to p.medianSt,
    "p5St" to p.p5St,
    "p10St" to p.p10St,
    "p90St" to p.p90St,
    "p95St" to p.p95St,
    "sdSt" to p.sdSt,
  )

  private fun stats(s: FeatureStats?): Map<String, Any?>? = s?.let { mapOf("mean" to it.mean, "sd" to it.sd) }

  private fun qualityJson(q: VoiceQualityResult): Map<String, Any?> = mapOf(
    "qualityVersion" to q.qualityVersion.toInt(),
    "weightIndexVersion" to q.weightIndexVersion.toInt(),
    "voicedS" to q.voicedS,
    "h1H2Db" to q.h1H2Db,
    "h1cH2cDb" to q.h1cH2cDb,
    "alphaRatioDb" to q.alphaRatioDb,
    "hammarbergDb" to q.hammarbergDb,
    "lhRatioDb" to q.lhRatioDb,
    "cppsDb" to q.cppsDb,
    "hnrDb" to q.hnrDb,
    "jitterLocal" to q.jitterLocal,
    "shimmerLocal" to q.shimmerLocal,
    "periods" to q.periods.toInt(),
    "weightBaseline" to mapOf(
      "h1cH2cDb" to stats(q.weightBaseline.h1cH2cDb),
      "alphaRatioDb" to stats(q.weightBaseline.alphaRatioDb),
      "cppsDb" to stats(q.weightBaseline.cppsDb),
    ),
  )

  private fun vowelJson(v: VowelResult): Map<String, Any?> = mapOf(
    "f0MedianHz" to v.f0MedianHz,
    "ceilingHz" to v.ceilingHz,
    "f1Hz" to v.f1Hz,
    "f2Hz" to v.f2Hz,
    "f3Hz" to v.f3Hz,
    "f4Hz" to v.f4Hz,
    "deltaFHz" to v.deltaFHz,
    "avtlCm" to v.avtlCm,
    "deltaFPosition" to v.deltaFPosition,
    "confidence" to v.confidence,
  )

  /**
   * Resolves a save path inside filesDir/recordings (expo-file-system's
   * `Paths.document` on Android), so JavaScript can't write anywhere else.
   */
  fun recordingFile(context: Context, relative: String): File {
    val parts = relative.split("/")
    require(parts.size >= 2 && parts[0] == "recordings" && parts.all { it.isNotEmpty() && it != "." && it != ".." } && relative.endsWith(".wav")) {
      "Can't save a recording at $relative."
    }
    return parts.fold(context.filesDir) { dir, p -> File(dir, p) }
  }

  /** Mono 32-bit float WAV, the layout the harness reads. */
  fun writeWav(file: File, samples: FloatArray, rate: Int) {
    val data = samples.size * 4
    val buf = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
    buf.put("RIFF".toByteArray()).putInt(36 + data).put("WAVE".toByteArray())
    buf.put("fmt ".toByteArray()).putInt(16).putShort(3).putShort(1).putInt(rate).putInt(rate * 4).putShort(4).putShort(32)
    buf.put("data".toByteArray()).putInt(data)
    for (x in samples) buf.putFloat(x)
    FileOutputStream(file).use { it.write(buf.array()) }
  }
}
