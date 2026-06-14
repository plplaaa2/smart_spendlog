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
    private var isFirstRunSetupInProgress = false
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

    private val requestNotificationPermissionLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { _ ->
        // 시스템 알림 권한 허용 여부와 무관하게, 팝업이 닫히면 이어서 알림 리스너 권한 안내 다이얼로그를 띄움
        checkAndRequestNotificationListener()
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

        val prefs = getSharedPreferences("com.spendlog.android.prefs", MODE_PRIVATE)
        val isFirstRun = prefs.getBoolean("is_first_run", true)
        if (isFirstRun) {
            isFirstRunSetupInProgress = true
        }

        lifecycleScope.launch {
            com.spendlog.android.parser.FranchisePresets.loadPresets(applicationContext)
            DatabaseSeeder.seedIfEmpty(applicationContext)
            checkAndRequestPermissionsOnFirstRun()
        }

        setContent {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        webView = this
                        // 초기 WebView 로드 시 흰색 번쩍임(White Flash) 방지를 위해 배경색을 다크로 사전 지정
                        setBackgroundColor(android.graphics.Color.parseColor("#0a0e1a"))
                        setupWebView(this)
                        loadUrl("https://appassets.androidplatform.net/assets/index.html")
                    }
                }
            )
        }
    }

    private fun checkAndRequestPermissionsOnFirstRun() {
        val prefs = getSharedPreferences("com.spendlog.android.prefs", MODE_PRIVATE)
        val isFirstRun = prefs.getBoolean("is_first_run", true)
        if (isFirstRun) {
            // 1. 앱 알림 권한 (Post Notifications) 요청 - Android 13+
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                val hasPostNotificationPermission = androidx.core.content.ContextCompat.checkSelfPermission(
                    this,
                    android.Manifest.permission.POST_NOTIFICATIONS
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                
                if (!hasPostNotificationPermission) {
                    requestNotificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    checkAndRequestNotificationListener()
                }
            } else {
                checkAndRequestNotificationListener()
            }

            // 첫 실행 완료 플래그 저장
            prefs.edit().putBoolean("is_first_run", false).apply()
        }
    }

    private fun checkAndRequestNotificationListener() {
        // 2. 알림 리스너 (Notification Listener) 권한 상태 체크 및 안내 다이얼로그
        val packageName = packageName
        val flat = android.provider.Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        val isNotiListenerGranted = flat?.contains(packageName) == true

        if (!isNotiListenerGranted) {
            android.app.AlertDialog.Builder(this)
                .setTitle("알림 접근 권한 안내")
                .setMessage("금융 알림(카드 결제 문자 및 금융 앱 푸시)을 실시간으로 분석하여 가계부에 등록하기 위해 '알림 접근 권한(Notification Listener)' 허용이 필요합니다.\n\n확인을 누르시면 설정 화면으로 이동합니다. Smart Spendlog를 찾아서 권한을 허용해 주세요.")
                .setPositiveButton("설정하기") { _, _ ->
                    val intent = android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(intent)
                    finishFirstRunSetup()
                }
                .setNegativeButton("나중에") { dialog, _ ->
                    dialog.dismiss()
                    finishFirstRunSetup()
                }
                .setCancelable(false)
                .show()
        } else {
            finishFirstRunSetup()
        }
    }

    private fun finishFirstRunSetup() {
        isFirstRunSetupInProgress = false
        runOnUiThread {
            webView?.evaluateJavascript(
                "if(typeof hideSplashScreen === 'function') hideSplashScreen();",
                null
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
        @JavascriptInterface
        fun isFirstRunSetupInProgress(): Boolean {
            return isFirstRunSetupInProgress
        }

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