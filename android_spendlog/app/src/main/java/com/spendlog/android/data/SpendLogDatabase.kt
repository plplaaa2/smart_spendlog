package com.spendlog.android.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Transaction::class, Rule::class, PassRule::class, Category::class, PayMethod::class, Settings::class, NotificationLog::class, MerchantCategory::class, PackagePayMethod::class], version = 12, exportSchema = false)
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

    companion object {
        @Volatile
        private var INSTANCE: SpendLogDatabase? = null

        val MIGRATION_11_12 = object : androidx.room.migration.Migration(11, 12) {
            override fun migrate(database: androidx.sqlite.db.SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE transactions ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'CREDIT'")
                database.execSQL("ALTER TABLE rules ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'CREDIT'")
                
                // 백필 마이그레이션 실행
                database.execSQL("UPDATE transactions SET pay_type = 'CHECK' WHERE pay_method LIKE '%체크%' OR pay_method LIKE '%카카오페이%' OR pay_method LIKE '%토스%' OR pay_method LIKE '%네이버페이%'")
                database.execSQL("UPDATE transactions SET pay_type = 'TRANSFER' WHERE pay_method LIKE '%은행%' OR pay_method LIKE '%계좌%' OR pay_method = '계좌이체'")
                database.execSQL("UPDATE transactions SET pay_type = 'CASH' WHERE pay_method LIKE '%현금%' OR pay_method = 'CASH'")
                
                database.execSQL("UPDATE rules SET pay_type = 'CHECK' WHERE pay_method LIKE '%체크%' OR pay_method LIKE '%카카오페이%' OR pay_method LIKE '%토스%' OR pay_method LIKE '%네이버페이%'")
                database.execSQL("UPDATE rules SET pay_type = 'TRANSFER' WHERE pay_method LIKE '%은행%' OR pay_method LIKE '%계좌%' OR pay_method = '계좌이체'")
                database.execSQL("UPDATE rules SET pay_type = 'CASH' WHERE pay_method LIKE '%현금%' OR pay_method = 'CASH'")
            }
        }

        fun getDatabase(context: Context): SpendLogDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    SpendLogDatabase::class.java,
                    "spendlog_database"
                )
                .addMigrations(MIGRATION_11_12)
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
