package com.spendlog.android.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Transaction::class, Rule::class, PassRule::class, Category::class, PayMethod::class, Settings::class, NotificationLog::class, MerchantCategory::class, PackagePayMethod::class, AiReport::class], version = 13, exportSchema = false)
abstract class SpendLogDatabase : RoomDatabase() {
    abstract fun transactionDao(): TransactionDao
    abstract fun ruleDao(): RuleDao
    abstract fun passRuleDao(): PassRuleDao
    abstract fun categoryDao(): CategoryDao
    abstract fun payMethodDao(): PayMethodDao
    abstract fun settingsDao(): SettingsDao
    abstract fun notificationLogDao(): NotificationLogDao
    abstract fun merchantCategoryDao(): MerchantCategoryDao
    abstract fun packagePayMethodDao(): PackagePayMethodDao
    abstract fun aiReportDao(): AiReportDao

    companion object {
        @Volatile
        private var INSTANCE: SpendLogDatabase? = null

        val MIGRATION_11_12 = object : androidx.room.migration.Migration(11, 12) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE transactions ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'CREDIT'")
                db.execSQL("ALTER TABLE rules ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'CREDIT'")
                
                // 백필 마이그레이션 실행
                db.execSQL("UPDATE transactions SET pay_type = 'CHECK' WHERE pay_method LIKE '%체크%' OR pay_method LIKE '%카카오페이%' OR pay_method LIKE '%토스%' OR pay_method LIKE '%네이버페이%'")
                db.execSQL("UPDATE transactions SET pay_type = 'TRANSFER' WHERE pay_method LIKE '%은행%' OR pay_method LIKE '%계좌%' OR pay_method = '계좌이체'")
                db.execSQL("UPDATE transactions SET pay_type = 'CASH' WHERE pay_method LIKE '%현금%' OR pay_method = 'CASH'")
                
                db.execSQL("UPDATE rules SET pay_type = 'CHECK' WHERE pay_method LIKE '%체크%' OR pay_method LIKE '%카카오페이%' OR pay_method LIKE '%토스%' OR pay_method LIKE '%네이버페이%'")
                db.execSQL("UPDATE rules SET pay_type = 'TRANSFER' WHERE pay_method LIKE '%은행%' OR pay_method LIKE '%계좌%' OR pay_method = '계좌이체'")
                db.execSQL("UPDATE rules SET pay_type = 'CASH' WHERE pay_method LIKE '%현금%' OR pay_method = 'CASH'")
            }
        }

        val MIGRATION_12_13 = object : androidx.room.migration.Migration(12, 13) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `ai_reports` (`report_type` TEXT NOT NULL, `target_year` INTEGER NOT NULL, `target_month` INTEGER NOT NULL, `summary` TEXT NOT NULL, `content` TEXT NOT NULL, `created_at` INTEGER NOT NULL, PRIMARY KEY(`report_type`, `target_year`, `target_month`))")
            }
        }

        fun getDatabase(context: Context): SpendLogDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    SpendLogDatabase::class.java,
                    "spendlog_database"
                )
                .addMigrations(MIGRATION_11_12, MIGRATION_12_13)
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
