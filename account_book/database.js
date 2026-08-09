// database.js 요약: 사용자별로 독립된 SQLite 데이터베이스 파일을 생성하고 관리하는 다중 테넌트 DB 핸들러 (서브모듈 파사드)

const {
  initDB,
  resetAllData,
  getDB,
  getActiveUsers,
  migrateCategoriesAndData,
  seedDefaultData
} = require('./database/connection');

const {
  getLoginSecurity,
  updateLoginSecurity,
  clearLoginSecurity
} = require('./database/security');

const {
  findCategoryByMerchant,
  seedFranchisePresets,
  FRANCHISE_PRESETS
} = require('./database/merchants');

const {
  createInAppNotification
} = require('./database/notifications');

const {
  updateHASensors,
  cleanupOrphanedHASensors,
  sendHANotification
} = require('./database/ha_sync');

const {
  backupUserDB,
  startBackupScheduler,
  getUserBackups,
  restoreUserDBBackup,
  deleteUserBackup,
  backupToNetwork,
  testNetworkBackup,
  executeRestore
} = require('./database/backup');

module.exports = {
  initDB,
  resetAllData,
  getDB,
  getActiveUsers,
  getLoginSecurity,
  updateLoginSecurity,
  clearLoginSecurity,
  findCategoryByMerchant,
  seedFranchisePresets,
  FRANCHISE_PRESETS,
  updateHASensors,
  cleanupOrphanedHASensors,
  sendHANotification,
  createInAppNotification,
  backupUserDB,
  startBackupScheduler,
  migrateCategoriesAndData,
  getUserBackups,
  restoreUserDBBackup,
  deleteUserBackup,
  backupToNetwork,
  testNetworkBackup,
  executeRestore
};
