package app.newvoice.audio

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.Executors
import uniffi.newvoice_ffi.FeatureStats
import uniffi.newvoice_ffi.ResonanceToken
import uniffi.newvoice_ffi.WeightBaseline
import uniffi.newvoice_ffi.coreVersion
import uniffi.newvoice_ffi.resonanceScore

class FeatureStatsOptions : Record {
  @Field var mean: Double = 0.0
  @Field var sd: Double = 0.0
  fun core() = FeatureStats(mean, sd)
}

class WeightBaselineOptions : Record {
  @Field var h1cH2cDb: FeatureStatsOptions? = null
  @Field var alphaRatioDb: FeatureStatsOptions? = null
  @Field var cppsDb: FeatureStatsOptions? = null
  fun core() = WeightBaseline(h1cH2cDb?.core(), alphaRatioDb?.core(), cppsDb?.core())
}

class StartOptions : Record {
  @Field var formantCeilingHz: Double? = null
  @Field var recordSeconds: Double? = null
  @Field var vowel: String? = null
  @Field var weightBaseline: WeightBaselineOptions? = null
}

class AnalyseOptions : Record {
  @Field var kind: String = "speech"
  @Field var saveAs: String? = null
}

class ResonanceTokenRecord : Record {
  @Field var vowel: String = ""
  @Field var f1Hz: Double? = null
  @Field var f2Hz: Double? = null
  @Field var f3Hz: Double? = null
  @Field var weight: Double = 1.0
}

/**
 * The JavaScript face of `CaptureSession` on Android, with the same API as
 * the iOS module (NewVoiceAudioModule.ts). Only computed frames and capture
 * diagnostics cross into JavaScript, never audio. The diagnostics export is
 * iOS-only for now (D25).
 */
class NewVoiceAudioModule : Module() {
  private val capture by lazy { CaptureSession(appContext.reactContext!!.applicationContext) }
  private val background = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("NewVoiceAudio")

    Events("onFrames", "onCaptureInfo", "onUtterance")

    OnCreate {
      capture.onFrames = { sendEvent("onFrames", it) }
      capture.onInfo = { sendEvent("onCaptureInfo", it) }
      capture.onUtterance = { sendEvent("onUtterance", it) }
    }

    Function("coreVersion") { coreVersion() }

    AsyncFunction("start") { options: StartOptions, promise: Promise ->
      withMicrophone(promise) {
        background.execute {
          try {
            promise.resolve(capture.start(options.formantCeilingHz, options.recordSeconds, options.vowel, options.weightBaseline?.core()))
          } catch (e: Exception) {
            promise.reject("E_CAPTURE", e.message ?: e.toString(), e)
          }
        }
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      background.execute {
        capture.stop()
        promise.resolve(null)
      }
    }

    AsyncFunction("getCaptureInfo") { capture.currentInfo() }

    AsyncFunction("exportDiagnostics") { _: Map<String, Any?>, promise: Promise ->
      promise.reject("E_EXPORT", "The diagnostics export isn't available on Android yet.", null)
    }

    AsyncFunction("analyseLastClip") { options: AnalyseOptions, promise: Promise ->
      background.execute {
        try {
          val clip = capture.takeLastClip() ?: throw IllegalStateException("Nothing has been recorded yet.")
          promise.resolve(TaskAnalysis.analyse(appContext.reactContext!!, clip, options.kind, options.saveAs))
        } catch (e: Exception) {
          promise.reject("E_ANALYSE", e.message ?: e.toString(), e)
        }
      }
    }

    AsyncFunction("discardLastClip") { capture.discardLastClip() }

    Function("resonanceScore") { tokens: List<ResonanceTokenRecord> ->
      val r = resonanceScore(tokens.map { ResonanceToken(it.vowel, it.f1Hz, it.f2Hz, it.f3Hz, it.weight) })
      mapOf(
        "version" to r?.version?.toInt(),
        "score" to r?.score,
        "f1" to r?.f1,
        "f2" to r?.f2,
        "f3" to r?.f3,
        "tokensUsed" to (r?.tokensUsed?.toInt() ?: 0),
      )
    }

    OnDestroy { capture.stop() }
  }

  /** Asks for RECORD_AUDIO if needed, then runs `then`. */
  private fun withMicrophone(promise: Promise, then: () -> Unit) {
    val ctx = appContext.reactContext ?: return promise.reject("E_CAPTURE", "No context.", null)
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return then()
    val permissions = appContext.permissions ?: return promise.reject("E_MIC_PERMISSION", "Microphone permission was not granted.", null)
    permissions.askForPermissions(
      { result ->
        if (result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED) then()
        else promise.reject("E_MIC_PERMISSION", "Microphone permission was not granted.", null)
      },
      Manifest.permission.RECORD_AUDIO,
    )
  }
}
