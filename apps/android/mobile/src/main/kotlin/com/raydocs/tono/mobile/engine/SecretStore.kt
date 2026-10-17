package com.raydocs.tono.mobile.engine

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small secret store for the engine: AES-256-GCM with a non-exportable Android Keystore key, random
 * 96-bit IV per write, ciphertext in private SharedPreferences (app backup is disabled). Same scheme
 * as the Tono vault in android/security, without its internal-profile machinery, so this app has no
 * dependency on the legacy modules. Plaintext buffers are zeroed after use.
 */
class SecretStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val keyStore by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }

    fun put(name: String, plaintext: ByteArray) {
        require(name.matches(NAME))
        try {
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
            val ciphertext = cipher.doFinal(plaintext)
            val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(cipher.iv + ciphertext)
            check(prefs.edit().putString(name, encoded).commit()) { "SECRET_PERSIST_FAILED" }
            ciphertext.fill(0)
        } finally {
            plaintext.fill(0)
        }
    }

    /** Null when absent or when it no longer decrypts (e.g. the Keystore key was wiped). */
    fun get(name: String): ByteArray? {
        val stored = prefs.getString(name, null) ?: return null
        return runCatching {
            val combined = Base64.getUrlDecoder().decode(stored)
            require(combined.size > IV_BYTES)
            try {
                Cipher.getInstance(TRANSFORM).run {
                    init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, combined, 0, IV_BYTES))
                    doFinal(combined, IV_BYTES, combined.size - IV_BYTES)
                }
            } finally {
                combined.fill(0)
            }
        }.getOrNull()
    }

    fun delete(names: Set<String>): Boolean {
        require(names.all { it.matches(NAME) })
        val editor = prefs.edit()
        names.forEach(editor::remove)
        return editor.commit()
    }

    private fun key(): SecretKey {
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val PREFS = "tono_mobile_secure_v1"
        const val ALIAS = "tono.mobile.aes.v1"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        val NAME = Regex("^[a-z0-9_.-]{1,64}$")
    }
}
