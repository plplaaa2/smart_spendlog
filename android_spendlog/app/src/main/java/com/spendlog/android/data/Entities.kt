package com.spendlog.android.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.ColumnInfo
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
@Entity(tableName = "transactions")
data class Transaction(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: String, // INCOME, EXPENSE
    val amount: Long,
    val merchant: String,
    val category: String,
    @SerialName("pay_method") @ColumnInfo(name = "pay_method") val payMethod: String,
    @SerialName("pay_type") @ColumnInfo(name = "pay_type") val payType: String = "CREDIT",
    val datetime: String, // YYYY-MM-DD HH:mm:ss
    val memo: String = "",
    @SerialName("raw_text") @ColumnInfo(name = "raw_text") val rawText: String = "",
    @SerialName("used_point") @ColumnInfo(name = "used_point") val usedPoint: Long = 0
)

@Serializable
@Entity(tableName = "rules")
data class Rule(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val name: String,
    val pattern: String,
    val category: String,
    @SerialName("pay_method") @ColumnInfo(name = "pay_method") val payMethod: String,
    @SerialName("pay_type") @ColumnInfo(name = "pay_type") val payType: String = "CREDIT",
    @SerialName("merchant_template") @ColumnInfo(name = "merchant_template") val merchantTemplate: String = "${"$"}{merchant}",
    val type: String = "EXPENSE"
)

@Serializable
@Entity(tableName = "pass_rules")
data class PassRule(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val name: String,
    val pattern: String
)

@Serializable
@Entity(tableName = "categories")
data class Category(
    @PrimaryKey val name: String,
    val type: String = "EXPENSE", // INCOME, EXPENSE
    val icon: String = "help-circle",
    val color: String = "#9e9e9e"
)

@Serializable
@Entity(tableName = "pay_methods")
data class PayMethod(
    @PrimaryKey val name: String,
    val type: String = "CARD" // CARD, BANK
)

@Serializable
@Entity(tableName = "settings")
data class Settings(
    @PrimaryKey val id: Int = 0,
    @ColumnInfo(name = "monthly_budget") val monthlyBudget: Long = 0,
    @ColumnInfo(name = "user_real_name") val userRealName: String = "",
    @ColumnInfo(name = "auto_rule_generation") val autoRuleGeneration: Boolean = true,
    @ColumnInfo(name = "initial_balance") val initial_balance: Long = 0,
    @ColumnInfo(name = "initial_balances") val initial_balances: String? = null,
    @ColumnInfo(name = "initial_points") val initial_points: String? = null,
    @ColumnInfo(name = "card_performance_days") val card_performance_days: String? = null,
    @ColumnInfo(name = "pay_methods_order") val pay_methods_order: String? = null,
    @ColumnInfo(name = "card_performance_goals") val card_performance_goals: String? = null,
    @ColumnInfo(name = "ai_enabled") val ai_enabled: Boolean = false,
    @ColumnInfo(name = "ai_parsing_enabled") val ai_parsing_enabled: Boolean = false,
    @ColumnInfo(name = "ai_provider") val ai_provider: String = "gemini",
    @ColumnInfo(name = "ai_api_key") val ai_api_key: String = "",
    @ColumnInfo(name = "ai_local_ip") val ai_local_ip: String = "",
    @ColumnInfo(name = "ai_local_model") val ai_local_model: String = ""
)

@Serializable
@Entity(tableName = "notification_logs")
data class NotificationLog(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sender: String,
    @ColumnInfo(name = "raw_text") val rawText: String,
    val title: String,
    val text: String,
    @ColumnInfo(name = "parsed_status") val parsedStatus: String, // SUCCESS, FAILED, PASS, IGNORED_DUPLICATE
    @ColumnInfo(name = "matched_rule_id") val matchedRuleId: Int? = null,
    val timestamp: Long = System.currentTimeMillis()
)

@Serializable
@Entity(
    tableName = "merchant_categories",
    indices = [androidx.room.Index(value = ["merchant"], unique = true)]
)
data class MerchantCategory(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val merchant: String,
    val category: String
)

@Serializable
@Entity(
    tableName = "package_pay_methods",
    indices = [androidx.room.Index(value = ["package"], unique = true)]
)
data class PackagePayMethod(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val `package`: String,
    @SerialName("pay_method") val pay_method: String
)
