import ExpoModulesCore
import UIKit

/// Discreet icon (Stage 4, handbook §4.3): switches the home-screen icon to
/// one of the alternate icons in the asset catalog, or back (nil). iOS
/// shows its own notice when the icon changes; the app name can't change
/// at runtime.
public class NewVoiceDiscreetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NewVoiceDiscreet")

    AsyncFunction("supportsIcons") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(UIApplication.shared.supportsAlternateIcons)
      }
    }

    AsyncFunction("currentIcon") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(UIApplication.shared.alternateIconName)
      }
    }

    AsyncFunction("setIcon") { (name: String?, promise: Promise) in
      DispatchQueue.main.async {
        guard UIApplication.shared.supportsAlternateIcons else {
          promise.reject("E_ICON_UNSUPPORTED", "This device can't change the app icon.")
          return
        }
        UIApplication.shared.setAlternateIconName(name) { error in
          if let error = error {
            promise.reject("E_ICON", error.localizedDescription)
          } else {
            promise.resolve(nil)
          }
        }
      }
    }
  }
}
