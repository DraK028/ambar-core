package mx.ambar.devicekey

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

class PromptOptions : Record {
  @Field val title: String = ""
  @Field val subtitle: String? = null
  @Field val cancel: String = "Cancelar"
}

/**
 * Llave ECDSA P-256 en Android Keystore (StrongBox si el teléfono lo tiene).
 *  - Requiere biometría Clase 3 en CADA uso (timeout 0 → CryptoObject obligatorio).
 *  - Se invalida si se agrega una huella nueva (setInvalidatedByBiometricEnrollment).
 *  - La llave privada no es exportable: solo firma dentro del hardware.
 */
class DeviceKeyModule : Module() {
  private val keyStore: KeyStore
    get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  override fun definition() = ModuleDefinition {
    Name("DeviceKey")

    AsyncFunction("getAvailabilityAsync") {
      val context = appContext.reactContext ?: return@AsyncFunction mapOf("available" to false, "hardwareBacked" to false, "reason" to "UNAVAILABLE")
      val strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
      when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_SUCCESS -> mapOf("available" to true, "hardwareBacked" to strongBox)
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> mapOf("available" to false, "hardwareBacked" to strongBox, "reason" to "NOT_ENROLLED")
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> mapOf("available" to false, "hardwareBacked" to false, "reason" to "NO_HARDWARE")
        else -> mapOf("available" to false, "hardwareBacked" to strongBox, "reason" to "UNAVAILABLE")
      }
    }

    AsyncFunction("hasKeyAsync") { alias: String ->
      keyStore.containsAlias(alias)
    }

    AsyncFunction("createKeyAsync") { alias: String ->
      keyStore.deleteEntry(alias)
      val publicKey = try {
        generate(alias, strongBox = true)
      } catch (e: StrongBoxUnavailableException) {
        generate(alias, strongBox = false)
      }
      Base64.encodeToString(publicKey, Base64.NO_WRAP) // X.509 SubjectPublicKeyInfo DER
    }

    AsyncFunction("signAsync") { alias: String, payload: String, prompt: PromptOptions, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) {
        promise.reject("FAILED", "No hay una pantalla activa para mostrar la biometría", null)
        return@AsyncFunction
      }
      val privateKey = keyStore.getKey(alias, null) as? PrivateKey
      if (privateKey == null) {
        promise.reject("NO_KEY", "No hay llave de dispositivo registrada", null)
        return@AsyncFunction
      }
      val signature = try {
        Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }
      } catch (e: KeyPermanentlyInvalidatedException) {
        keyStore.deleteEntry(alias)
        promise.reject("KEY_INVALIDATED", "La biometría del teléfono cambió; vuelve a activar tu dispositivo", e)
        return@AsyncFunction
      }

      val callback = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          try {
            val signer = result.cryptoObject?.signature ?: throw IllegalStateException("Sin CryptoObject")
            signer.update(payload.toByteArray(Charsets.UTF_8))
            promise.resolve(Base64.encodeToString(signer.sign(), Base64.NO_WRAP))
          } catch (e: Exception) {
            promise.reject("FAILED", "No se pudo firmar", e)
          }
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          val code = when (errorCode) {
            BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "CANCELLED"
            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "LOCKOUT"
            else -> "FAILED"
          }
          promise.reject(code, errString.toString(), null)
        }
        // onAuthenticationFailed (huella no reconocida) no termina el diálogo: el usuario puede reintentar.
      }

      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(prompt.title)
        .apply { prompt.subtitle?.let { setSubtitle(it) } }
        .setNegativeButtonText(prompt.cancel)
        .setAllowedAuthenticators(BIOMETRIC_STRONG)
        .setConfirmationRequired(true)
        .build()

      BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
        .authenticate(info, BiometricPrompt.CryptoObject(signature))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("deleteKeyAsync") { alias: String ->
      keyStore.deleteEntry(alias)
    }
  }

  private fun generate(alias: String, strongBox: Boolean): ByteArray {
    val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
    }
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true)
    }
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(builder.build())
    return generator.generateKeyPair().public.encoded
  }
}
