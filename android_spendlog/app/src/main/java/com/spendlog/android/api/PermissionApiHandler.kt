package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import kotlinx.serialization.json.*

/**
 * @file PermissionApiHandler.kt
 * @summary 안드로이드 권한 제어 API 요청 처리 모듈
 * @description WebView 인터페이스에서 요청되는 알림 리스너 서비스 활성화 상태 조회/요청,
 *              백그라운드 유지를 위한 배터리 최적화 제외 권한 조회/요청,
 *              안드로이드 13(Tiramisu) 이상에서의 포스트 알림 권한 팝업 호출 등을 담당합니다.
 * @dependencies
 *   - MainActivity.kt (runOnUiThread, ActivityCompat 권한 요청 API 및 팩키지 정보 사용)
 *   - AndroidApiHandler.kt (API 통신 응답 조립 사용)
 */
object PermissionApiHandler {

    fun handlePermissionRequest(
        context: Context,
        path: String
    ): ApiResponse {
        return when {
            path.startsWith("permissions/notification") -> {
                if (path.endsWith("request")) {
                    val intent = android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                    ApiResponse(body = buildJsonObject { put("success", true) })
                } else {
                    val packageName = context.packageName
                    val flat = android.provider.Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
                    val isGranted = flat?.contains(packageName) == true
                    ApiResponse(body = buildJsonObject { put("granted", isGranted) })
                }
            }
            path.startsWith("permissions/battery") -> {
                if (path.endsWith("request")) {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        val intent = android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = android.net.Uri.parse("package:${context.packageName}")
                            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        try {
                            context.startActivity(intent)
                            ApiResponse(body = buildJsonObject { put("success", true) })
                        } catch (e: Exception) {
                            val fallbackIntent = android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            context.startActivity(fallbackIntent)
                            ApiResponse(body = buildJsonObject { put("success", true); put("fallback", true) })
                        }
                    } else {
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    }
                } else {
                    val powerManager = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                    val isIgnoring = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        powerManager.isIgnoringBatteryOptimizations(context.packageName)
                    } else {
                        true
                    }
                    ApiResponse(body = buildJsonObject { put("granted", isIgnoring) })
                }
            }
            path.startsWith("permissions/post_notification") -> {
                if (path.endsWith("request")) {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        val mainActivity = context as? MainActivity
                        mainActivity?.runOnUiThread {
                            androidx.core.app.ActivityCompat.requestPermissions(
                                mainActivity,
                                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                                1001
                            )
                        }
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    }
                } else {
                    val isGranted = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        androidx.core.content.ContextCompat.checkSelfPermission(
                            context,
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                    } else {
                        true
                    }
                    ApiResponse(body = buildJsonObject { put("granted", isGranted) })
                }
            }
            else -> ApiResponse(status = 404, body = buildJsonObject { put("error", "Not Found") })
        }
    }
}
