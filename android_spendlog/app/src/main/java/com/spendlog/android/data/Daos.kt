package com.spendlog.android.data

import androidx.room.*

@Dao
interface TransactionDao {
    @Query("SELECT * FROM transactions ORDER BY datetime DESC")
    suspend fun getAllTransactions(): List<Transaction>

    @Query("SELECT * FROM transactions WHERE datetime LIKE :month || '%' ORDER BY datetime DESC")
    suspend fun getTransactionsByMonth(month: String): List<Transaction>

    // 중복 거래 감지: 동일 amount+merchant 조합이 지정 datetime 기준 1분 이내 존재하면 반환
    // 의존성: SpendLogListenerService.kt에서 알림 자동 파싱 후 DB 저장 전 중복 체크에 사용
    @Query("SELECT COUNT(*) FROM transactions WHERE amount = :amount AND merchant = :merchant AND datetime >= :minDatetime")
    suspend fun countDuplicateNear(amount: Long, merchant: String, minDatetime: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTransaction(transaction: Transaction): Long

    @Delete
    suspend fun deleteTransaction(transaction: Transaction)

    @Update
    suspend fun updateTransaction(transaction: Transaction)
}

@Dao
interface RuleDao {
    @Query("SELECT * FROM rules")
    suspend fun getAllRules(): List<Rule>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRule(rule: Rule): Long

    @Delete
    suspend fun deleteRule(rule: Rule)

    @Query("DELETE FROM rules WHERE id = :id")
    suspend fun deleteRuleById(id: Int)
}

@Dao
interface PassRuleDao {
    @Query("SELECT * FROM pass_rules")
    suspend fun getAllPassRules(): List<PassRule>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPassRule(rule: PassRule): Long

    @Query("DELETE FROM pass_rules WHERE id = :id")
    suspend fun deletePassRuleById(id: Int)
}

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories ORDER BY name ASC")
    suspend fun getAllCategories(): List<Category>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCategory(category: Category)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCategories(categories: List<Category>)
}

@Dao
interface PayMethodDao {
    @Query("SELECT * FROM pay_methods ORDER BY name ASC")
    suspend fun getAllPayMethods(): List<PayMethod>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPayMethod(payMethod: PayMethod)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPayMethods(payMethods: List<PayMethod>)
}

@Dao
interface SettingsDao {
    @Query("SELECT * FROM settings WHERE id = 0")
    suspend fun getSettings(): Settings?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSettings(settings: Settings)
}

@Dao
interface NotificationLogDao {
    @Query("SELECT * FROM notification_logs ORDER BY timestamp DESC LIMIT 100")
    suspend fun getRecentLogs(): List<NotificationLog>

    @Insert
    suspend fun insertLog(log: NotificationLog): Long
}

@Dao
interface MerchantCategoryDao {
    @Query("SELECT * FROM merchant_categories ORDER BY id DESC")
    suspend fun getAllMerchantCategories(): List<MerchantCategory>

    @Query("SELECT * FROM merchant_categories WHERE merchant = :merchant LIMIT 1")
    suspend fun getMerchantCategoryByMerchant(merchant: String): MerchantCategory?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMerchantCategory(merchantCategory: MerchantCategory): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMerchantCategories(merchantCategories: List<MerchantCategory>)

    @Query("DELETE FROM merchant_categories WHERE id = :id")
    suspend fun deleteMerchantCategoryById(id: Int)

    @Query("DELETE FROM merchant_categories")
    suspend fun deleteAllMerchantCategories()
}

@Dao
interface PackagePayMethodDao {
    @Query("SELECT * FROM package_pay_methods ORDER BY id DESC")
    suspend fun getAllPackagePayMethods(): List<PackagePayMethod>

    @Query("SELECT * FROM package_pay_methods WHERE `package` = :packageName LIMIT 1")
    suspend fun getPackagePayMethodByPackage(packageName: String): PackagePayMethod?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPackagePayMethod(packagePayMethod: PackagePayMethod): Long

    @Query("DELETE FROM package_pay_methods WHERE id = :id")
    suspend fun deletePackagePayMethodById(id: Int)
}
