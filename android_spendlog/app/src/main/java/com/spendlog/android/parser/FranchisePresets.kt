package com.spendlog.android.parser

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class PresetItem(
    val keyword: String,
    val category: String
)

/**
 * [FranchisePresets.kt]
 * - 요약: 앱 구동 시 assets/presets/ 폴더 내 카테고리별 JSON 파일들로부터 가맹점 사전 데이터를 로드하여 캐싱하고, 파싱 과정에서 가맹점 기반 카테고리 매핑 및 스코어 계산에 공유할 수 있도록 지원하는 모듈입니다.
 * - 연결된 파일 목록:
 *   - NotificationParser.kt (가맹점 힌트 스코어 계산 및 정규식 생성 시 가맹점 매칭용)
 *   - DatabaseSeeder.kt (가맹점 프리셋 DB 시딩 초기화 시 원본 데이터로 참조)
 */
object FranchisePresets {

    private val json = Json { ignoreUnknownKeys = true }
    
    @Volatile
    var presets: List<PresetItem> = emptyList()
        private set

    private val categoryFiles = mapOf(
        "dessert.json" to "디저트",
        "cafe.json" to "음료/카페",
        "delivery.json" to "배달음식",
        "dining.json" to "외식비",
        "mart.json" to "마트/편의점",
        "living.json" to "생활/잡화",
        "medical.json" to "병원/약국",
        "shopping.json" to "온라인쇼핑",
        "direct_buy.json" to "해외직구",
        "fashion.json" to "패션/의류",
        "traffic.json" to "교통/주유",
        "telecom.json" to "통신비",
        "subscription.json" to "구독",
        "utilities.json" to "수도광열비",
        "tax.json" to "세금",
        "culture.json" to "문화/여가",
        "travel.json" to "문화/여가",
        "education.json" to "교육/학습",
        "insurance.json" to "보험",
        "rental.json" to "렌탈",
        "pension.json" to "연금",
        "refunds.json" to "지원금/환급금",
        "donations.json" to "기부금"
    )

    /**
     * assets/presets 폴더에서 카테고리별 JSON 파일을 읽어 메모리에 캐시합니다.
     */
    fun loadPresets(context: Context): List<PresetItem> {
        if (presets.isNotEmpty()) return presets
        
        synchronized(this) {
            if (presets.isNotEmpty()) return presets
            val loadedPresets = mutableListOf<PresetItem>()
            for ((fileName, categoryName) in categoryFiles) {
                try {
                    val jsonString = context.assets.open("presets/$fileName")
                        .bufferedReader()
                        .use { it.readText() }
                    val keywords = json.decodeFromString<List<String>>(jsonString)
                    keywords.forEach { keyword ->
                        loadedPresets.add(PresetItem(keyword = keyword, category = categoryName))
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            presets = loadedPresets
        }
        return presets
    }

    /**
     * 캐시된 가맹점 프리셋 키워드 리스트를 반환합니다.
     */
    fun getKeywords(context: Context): List<String> {
        if (presets.isEmpty()) {
            loadPresets(context)
        }
        return presets.map { it.keyword }
    }

    /**
     * 가맹점명(merchant)에 포함된 키워드에 대응되는 카테고리를 찾아 반환합니다.
     */
    fun getCategoryFor(context: Context, merchant: String): String? {
        if (presets.isEmpty()) {
            loadPresets(context)
        }
        // 가장 긴 매칭 키워드가 더 정확할 가능성이 높으므로 키워드 길이 내림차순으로 검색
        val matched = presets.filter { merchant.contains(it.keyword, ignoreCase = true) }
            .maxByOrNull { it.keyword.length }
        return matched?.category
    }
}

