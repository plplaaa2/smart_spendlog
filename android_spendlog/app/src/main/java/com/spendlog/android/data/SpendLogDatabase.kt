package com.spendlog.android.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Transaction::class, Rule::class, PassRule::class, Category::class, PayMethod::class, Settings::class, NotificationLog::class, MerchantCategory::class, PackagePayMethod::class], version = 11, exportSchema = false)
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

        fun getDatabase(context: Context): SpendLogDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    SpendLogDatabase::class.java,
                    "spendlog_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
