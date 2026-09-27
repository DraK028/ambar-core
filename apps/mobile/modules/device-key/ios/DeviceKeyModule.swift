import ExpoModulesCore
import LocalAuthentication
import Security

struct PromptOptions: Record {
  @Field var title: String = ""
  @Field var subtitle: String?
  @Field var cancel: String = "Cancelar"
}

/// Encabezado ASN.1 de SubjectPublicKeyInfo para EC P-256. Secure Enclave exporta el punto
/// crudo (65 bytes, 0x04‖X‖Y); con este prefijo queda en SPKI DER, igual que en Android.
private let p256SpkiHeader: [UInt8] = [
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
  0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]

final class DeviceKeyException: GenericException<(code: String, message: String)> {
  override var code: String { param.code }
  override var reason: String { param.message }
}

/// Llave ECDSA P-256 en Secure Enclave. Cada firma exige Face ID / Touch ID con el conjunto
/// actual de biometría (.biometryCurrentSet): si se agrega un rostro o huella, la llave deja
/// de funcionar y hay que volver a activar el dispositivo.
public class DeviceKeyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceKey")

    AsyncFunction("getAvailabilityAsync") { () -> [String: Any] in
      let context = LAContext()
      var error: NSError?
      let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
      if ok { return ["available": true, "hardwareBacked": Self.hasSecureEnclave] }
      let reason: String
      switch LAError.Code(rawValue: error?.code ?? 0) {
      case .biometryNotEnrolled: reason = "NOT_ENROLLED"
      case .biometryNotAvailable: reason = "NO_HARDWARE"
      default: reason = "UNAVAILABLE"
      }
      return ["available": false, "hardwareBacked": Self.hasSecureEnclave, "reason": reason]
    }

    AsyncFunction("hasKeyAsync") { (alias: String) -> Bool in
      Self.privateKey(alias: alias, context: nil) != nil
    }

    AsyncFunction("createKeyAsync") { (alias: String) -> String in
      Self.delete(alias: alias)
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        Self.hasSecureEnclave ? [.privateKeyUsage, .biometryCurrentSet] : [.biometryCurrentSet],
        &error
      ) else {
        throw DeviceKeyException((code: "FAILED", message: "No se pudo crear el control de acceso"))
      }
      var attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecPrivateKeyAttrs as String: [
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: Self.tag(alias),
          kSecAttrAccessControl as String: access,
        ],
      ]
      // El simulador no tiene Secure Enclave: ahí la llave vive en el Keychain (solo para desarrollo).
      if Self.hasSecureEnclave {
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
      }
      guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
            let publicKey = SecKeyCopyPublicKey(privateKey),
            let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
        throw DeviceKeyException((code: "FAILED", message: error?.takeRetainedValue().localizedDescription ?? "No se pudo crear la llave"))
      }
      return (Data(p256SpkiHeader) + raw).base64EncodedString()
    }

    AsyncFunction("signAsync") { (alias: String, payload: String, prompt: PromptOptions) -> String in
      let context = LAContext()
      context.localizedCancelTitle = prompt.cancel
      context.localizedReason = prompt.subtitle.map { "\(prompt.title). \($0)" } ?? prompt.title
      guard let key = Self.privateKey(alias: alias, context: context) else {
        throw DeviceKeyException((code: "NO_KEY", message: "No hay llave de dispositivo registrada"))
      }
      var error: Unmanaged<CFError>?
      // SecKeyCreateSignature dispara Face ID / Touch ID por el control de acceso de la llave.
      guard let signature = SecKeyCreateSignature(
        key,
        .ecdsaSignatureMessageX962SHA256,
        Data(payload.utf8) as CFData,
        &error
      ) as Data? else {
        let nsError = error?.takeRetainedValue() as Error? as NSError?
        throw DeviceKeyException((code: Self.code(for: nsError), message: nsError?.localizedDescription ?? "No se pudo firmar"))
      }
      return signature.base64EncodedString() // DER, igual que SHA256withECDSA en Android
    }

    AsyncFunction("deleteKeyAsync") { (alias: String) in
      Self.delete(alias: alias)
    }
  }

  private static var hasSecureEnclave: Bool {
    #if targetEnvironment(simulator)
      return false
    #else
      return true
    #endif
  }

  private static func tag(_ alias: String) -> Data {
    Data("mx.ambar.devicekey.\(alias)".utf8)
  }

  private static func privateKey(alias: String, context: LAContext?) -> SecKey? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(alias),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    if let context { query[kSecUseAuthenticationContext as String] = context }
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let item else { return nil }
    return (item as! SecKey)
  }

  private static func delete(alias: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(alias),
    ]
    SecItemDelete(query as CFDictionary)
  }

  private static func code(for error: NSError?) -> String {
    guard let error else { return "FAILED" }
    if error.domain == LAErrorDomain {
      switch LAError.Code(rawValue: error.code) {
      case .userCancel, .appCancel, .systemCancel, .userFallback: return "CANCELLED"
      case .biometryLockout: return "LOCKOUT"
      default: return "FAILED"
      }
    }
    if error.code == Int(errSecUserCanceled) { return "CANCELLED" }
    if error.code == Int(errSecItemNotFound) { return "NO_KEY" }
    return "FAILED"
  }
}
