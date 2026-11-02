package app.lotties.app.voice

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The voice sign-in on this phone ([VoiceConnection]: tokens and endpoints), the Android twin of the iOS Keychain item
 * `app.lotties.app.mcp`: AES-256-GCM with a key that never leaves the Android Keystore (androidx.security-crypto is
 * deprecated, so the Keystore API directly). The file is `noBackupFilesDir/lotties-voice/connection.bin` (12-byte IV,
 * then the ciphertext and tag); app backup is off anyway. It is not in `lotties-shared`, which the widgets read.
 * A file that does not decrypt (key gone after a restore or a lock-screen reset) counts as not connected and is removed.
 */
object VoiceTokenStore {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "app.lotties.app.voice"
    private const val DIRECTORY = "lotties-voice"
    private const val FILE = "connection.bin"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    private val lock = Any()

    private fun file(context: Context) = File(File(context.applicationContext.noBackupFilesDir, DIRECTORY), FILE)

    @JvmStatic
    fun load(context: Context): VoiceConnection? = synchronized(lock) {
        val file = file(context)
        if (!file.isFile) return null
        try {
            val bytes = file.readBytes()
            if (bytes.size <= IV_BYTES) throw GeneralSecurityException("short file")
            val key = existingKey() ?: throw GeneralSecurityException("no key")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
            val plain = cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES)
            VoiceConnection.fromJson(String(plain, Charsets.UTF_8))
        } catch (_: Exception) {
            file.delete()
            null
        }
    }

    @JvmStatic
    @Throws(GeneralSecurityException::class, java.io.IOException::class)
    fun save(context: Context, connection: VoiceConnection) = synchronized(lock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: newKey())
        val sealed = cipher.iv + cipher.doFinal(connection.toJson().toByteArray(Charsets.UTF_8))
        val target = file(context)
        target.parentFile?.mkdirs()
        val temp = File.createTempFile(FILE, ".tmp", target.parentFile)
        try {
            FileOutputStream(temp).use { out ->
                out.write(sealed)
                out.fd.sync()
            }
            if (!temp.renameTo(target)) throw java.io.IOException("Cannot replace $target")
        } finally {
            if (temp.exists()) temp.delete()
        }
    }

    /** Disconnect, sign-out and account erasure: the file and the key are gone. */
    @JvmStatic
    fun clear(context: Context) = synchronized(lock) {
        file(context).delete()
        try {
            keyStore().deleteEntry(KEY_ALIAS)
        } catch (_: Exception) {
            // No key, or no Keystore: nothing to remove.
        }
    }

    @JvmStatic
    fun isConnected(context: Context): Boolean = load(context) != null

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun existingKey(): SecretKey? = (keyStore().getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey

    private fun newKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }
}
