import ExpoModulesCore
import UIKit

/// Records when the iPhone is unlocked, so Nodara can count phone use while driving.
///
/// iOS posts `protectedDataDidBecomeAvailableNotification` when the device is
/// unlocked (once its data-protection keys were discarded, about 10 seconds
/// after locking). Nodara keeps running in the background while it shares
/// location, so it hears this even when another app is in front. Times are kept
/// in UserDefaults until the JavaScript side uploads them with the next batch
/// of locations; the server decides whether the person was moving at the time.
public class PhoneUseModule: Module {
  static let storageKey = "nodara.phoneUnlocks"
  static let maxStored = 500

  public func definition() -> ModuleDefinition {
    Name("PhoneUse")

    OnCreate {
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.phoneUnlocked),
        name: UIApplication.protectedDataDidBecomeAvailableNotification,
        object: nil
      )
    }

    OnDestroy {
      NotificationCenter.default.removeObserver(
        self,
        name: UIApplication.protectedDataDidBecomeAvailableNotification,
        object: nil
      )
    }

    // Returns the recorded unlock times (epoch milliseconds) and clears them.
    Function("takeUnlocks") { () -> [Double] in
      let defaults = UserDefaults.standard
      let times = defaults.array(forKey: PhoneUseModule.storageKey) as? [Double] ?? []
      defaults.removeObject(forKey: PhoneUseModule.storageKey)
      return times
    }

    Function("pendingCount") { () -> Int in
      let times = UserDefaults.standard.array(forKey: PhoneUseModule.storageKey) as? [Double] ?? []
      return times.count
    }
  }

  @objc
  func phoneUnlocked() {
    let defaults = UserDefaults.standard
    var times = defaults.array(forKey: PhoneUseModule.storageKey) as? [Double] ?? []
    times.append(Date().timeIntervalSince1970 * 1000)
    if times.count > PhoneUseModule.maxStored {
      times.removeFirst(times.count - PhoneUseModule.maxStored)
    }
    defaults.set(times, forKey: PhoneUseModule.storageKey)
  }
}
