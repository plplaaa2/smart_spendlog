package com.spendlog.android

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import com.spendlog.android.data.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import com.spendlog.android.parser.AIConfig
import com.spendlog.android.parser.NotificationParser
import java.text.SimpleDateFormat
import java.util.*

/**
 * @file MainActivity.kt
 * @summary 안드로이드 SpendLog 앱 메인 컴포넌트 액티비티
 * @description WebView를 로드하고 JavaScript 네이티브 브릿지(AndroidBridge)를 마운트하여 웹뷰 상에서
 *              네이티브 데이터베이스 조회 및 권한 설정을 제어할 수 있도록 돕는 코어 액티비티입니다.
 * @dependencies
 *   - AndroidApiHandler.kt: 분리된 API 처리 로직 핸들러
 *   - SpendLogDatabase: Room 기반 SQLite DB 연동
 */
class MainActivity : ComponentActivity() {

    private lateinit var db: SpendLogDatabase
    private var webView: WebView? = null
    private var filePathCallback: ValueCallback<Array<android.net.Uri>>? = null

    private val fileChooserActivityLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val intent = result.data
            if (intent != null && filePathCallback != null) {
                val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, intent)
                filePathCallback?.onReceiveValue(uris)
            } else {
                filePathCallback?.onReceiveValue(null)
            }
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    companion object {
        @SuppressLint("StaticFieldLeak")
        private var instance: MainActivity? = null

        /**
         * 웹뷰 UI를 강제 갱신(자료 리프레시)하는 전역 메인 스레드 호출 인터페이스
         * 의존성: AndroidApiHandler.kt 등에서 트랜잭션이 완결된 후 갱신 전송을 수행합니다.
         */
        fun refreshUI() {
            instance?.runOnUiThread {
                instance?.webView?.evaluateJavascript(
                    "if(typeof refreshCurrentTabData === 'function') refreshCurrentTabData(); if(typeof loadLogs === 'function') loadLogs();",
                    null
                )
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this
        db = SpendLogDatabase.getDatabase(this)

        lifecycleScope.launch {
            com.spendlog.android.parser.FranchisePresets.loadPresets(applicationContext)
            DatabaseSeeder.seedIfEmpty(applicationContext)
        }

        setContent {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        webView = this
                        setupWebView(this)
                        loadUrl("https://appassets.androidplatform.net/assets/index.html")
                    }
                }
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) instance = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(webView: WebView) {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.clearCache(true)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // Skip login and force init
                view?.evaluateJavascript(
                    "if(typeof initApp === 'function') initApp();",
                    null
                )
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                val builder = android.app.AlertDialog.Builder(this@MainActivity)
                builder.setTitle("알림")
                    .setMessage(message)
                    .setPositiveButton("확인") { _, _ -> result?.confirm() }
                    .setCancelable(false)
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                val builder = android.app.AlertDialog.Builder(this@MainActivity)
                builder.setTitle("확인")
                    .setMessage(message)
                    .setPositiveButton("확인") { _, _ -> result?.confirm() }
                    .setNegativeButton("취소") { _, _ -> result?.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }

            override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?): Boolean {
                val builder = android.app.AlertDialog.Builder(this@MainActivity)
                val input = android.widget.EditText(this@MainActivity)
                input.setText(defaultValue ?: "")
                builder.setTitle("입력")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("확인") { _, _ -> result?.confirm(input.text.toString()) }
                    .setNegativeButton("취소") { _, _ -> result?.cancel() }
                    .setCancelable(false)
                    .show()
                return true
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<android.net.Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = fileChooserParams?.createIntent()
                try {
                    fileChooserActivityLauncher.launch(intent)
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    return false
                }
                return true
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (consoleMessage != null) {
                    android.util.Log.d(
                        "WebConsole",
                        "${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}"
                    )
                }
                return true
            }
        }

        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")
    }

    inner class AndroidBridge {
        /**
         * 웹뷰 JS단에서 callApi를 통해 가상 REST API 요청을 보낼 때 작동하는 브릿지 메서드
         * @param url 가상 엔드포인트 URL (예: "/api/transactions")
         * @param optionsJson HTTP Method와 Body 정보가 담긴 JSON 문자열
         */
        @JavascriptInterface
        fun callApi(url: String, optionsJson: String): String {
            val options = Json.parseToJsonElement(optionsJson).jsonObject
            val method = options["method"]?.jsonPrimitive?.content ?: "GET"
            val body = options["body"]?.jsonPrimitive?.content

            return kotlinx.coroutines.runBlocking {
                val result = com.spendlog.android.api.AndroidApiHandler.handleApiRequest(
                    applicationContext,
                    db,
                    url,
                    method,
                    body
                )
                val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
                json.encodeToString(ApiResponse.serializer(), result)
            }
        }

        @JavascriptInterface
        fun shareText(text: String, title: String) {
            instance?.runOnUiThread {
                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(android.content.Intent.EXTRA_SUBJECT, title)
                    putExtra(android.content.Intent.EXTRA_TEXT, text)
                }
                val chooser = android.content.Intent.createChooser(intent, title)
                chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                this@MainActivity.startActivity(chooser)
            }
        }
    }

    @Serializable
    data class ApiResponse(
        val status: Int = 200,
        val body: JsonElement
    )
}