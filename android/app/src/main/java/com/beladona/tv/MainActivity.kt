package com.beladona.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.StatFs
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Player de sinalizacao para Fire TV / Android TV.
 *
 * Estrategia OFFLINE-FIRST:
 *  - A INTERFACE (player.html) roda a partir dos assets empacotados no APK — carrega mesmo sem internet.
 *  - Os VIDEOS sao baixados pelo Kotlin para filesDir/videos e tocados por file:// — continuam
 *    tocando mesmo se a internet da loja cair. A cada sync, baixa os novos e apaga os que sairam.
 *
 * O servidor (painel) fica em @string/server_url. A tela é identificada por um "device code"
 * digitado na primeira abertura (guardado em SharedPreferences).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    @Volatile private var currentScreen = "PLAYER"
    @Volatile private var syncing = false

    private val serverUrl: String by lazy { getString(R.string.server_url).trimEnd('/') }
    private val videosDir: File by lazy { File(filesDir, "videos").apply { mkdirs() } }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this).apply {
            setBackgroundColor(0xFF000000.toInt())
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false          // autoplay do video
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
            }
            addJavascriptInterface(Bridge(), "Android")
        }
        setContentView(web)

        // Carrega a interface dos assets (offline-first).
        web.loadUrl("file:///android_asset/web/player.html")
        hideSystemUi()
    }

    private fun prefs() = getSharedPreferences("tv_beladona", Context.MODE_PRIVATE)

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    /** Encaminha as teclas do controle remoto para a interface (window.__remote / char:). */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val cmd = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> "up"
                KeyEvent.KEYCODE_DPAD_DOWN -> "down"
                KeyEvent.KEYCODE_DPAD_LEFT -> "left"
                KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
                KeyEvent.KEYCODE_BUTTON_A -> "ok"
                KeyEvent.KEYCODE_BACK -> "back"
                else -> null
            }
            // Letras/numeros para digitar o codigo da tela no pareamento.
            val ch = event.unicodeChar
            if (cmd == null && ch != 0) {
                val c = ch.toChar()
                if (c.isLetterOrDigit()) {
                    sendRemote("char:" + c.uppercaseChar())
                    return true
                }
            }
            if (cmd != null) {
                sendRemote(cmd)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun sendRemote(cmd: String) {
        web.evaluateJavascript("window.__remote && window.__remote('$cmd')", null)
    }

    // ------------------------------------------------------------------ ponte JS
    inner class Bridge {
        @JavascriptInterface fun isNative(): Boolean = true

        @JavascriptInterface
        fun getConfig(): String {
            val o = JSONObject()
            o.put("device", prefs().getString("device", null))
            o.put("serverUrl", serverUrl)
            return o.toString()
        }

        @JavascriptInterface
        fun saveDevice(code: String) {
            prefs().edit().putString("device", code.trim().uppercase()).apply()
        }

        @JavascriptInterface fun onScreen(screen: String) { currentScreen = screen }

        /** Caminho local file:// se o video ja foi baixado; senao "" (o JS cai para streaming). */
        @JavascriptInterface
        fun localPathFor(id: String): String {
            val f = videosDir.listFiles()?.firstOrNull { it.name.startsWith("$id.") && it.length() > 0 }
            return if (f != null) "file://${f.absolutePath}" else ""
        }

        @JavascriptInterface
        fun storageFreeMb(): Int {
            return try {
                val st = StatFs(filesDir.absolutePath)
                (st.availableBytes / (1024 * 1024)).toInt()
            } catch (e: Exception) { -1 }
        }

        /** Recebe a playlist (JSON de itens {id,file,url}) e sincroniza os arquivos em background. */
        @JavascriptInterface
        fun sync(playlistJson: String) {
            if (syncing) return
            syncing = true
            Thread {
                try { syncFiles(playlistJson) } catch (_: Exception) {} finally { syncing = false }
            }.start()
        }
    }

    /** Baixa os videos que faltam e apaga os que nao estao mais na playlist. */
    private fun syncFiles(playlistJson: String) {
        val items = JSONArray(playlistJson)
        val wanted = HashSet<String>()

        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            val id = it.getString("id")
            val file = it.optString("file", "$id.mp4")
            wanted.add(file)
            val dest = File(videosDir, file)
            if (dest.exists() && dest.length() > 0) continue   // ja baixado
            val url = serverUrl + it.optString("url", "/media/$file")
            downloadTo(url, dest)
        }

        // Limpa arquivos que sairam da playlist (libera espaco no Fire Stick).
        videosDir.listFiles()?.forEach { f ->
            if (f.name !in wanted) f.delete()
        }
        // Avisa a interface que novos arquivos podem estar disponiveis localmente.
        runOnUiThread { web.evaluateJavascript("window.__filesReady && window.__filesReady()", null) }
    }

    private fun downloadTo(urlStr: String, dest: File) {
        val tmp = File(dest.absolutePath + ".part")
        val c = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000; readTimeout = 60000; requestMethod = "GET"
        }
        try {
            if (c.responseCode != 200) return
            c.inputStream.use { input -> tmp.outputStream().use { out -> input.copyTo(out, 64 * 1024) } }
            if (tmp.length() > 0) tmp.renameTo(dest) else tmp.delete()
        } finally {
            c.disconnect()
            if (tmp.exists()) tmp.delete()
        }
    }
}
