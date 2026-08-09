const {
  parseNotification,
  generatePatternFromText
} = require('./parser/text_parser');

const {
  parseNotificationWithAI,
  generatePatternWithAI,
  generateConsumptionReportWithAI
} = require('./parser/ai_parser');

const { sanitizePattern } = require('./parser/utils');
const { isValidDatabaseDatetime, validateParsingResult } = require('./parser/result_validator');
const { validateGeneratedPattern } = require('./parser/pattern_validator');

module.exports = {
  parseNotification,
  generatePatternFromText,
  parseNotificationWithAI,
  generatePatternWithAI,
  generateConsumptionReportWithAI,
  sanitizePattern,
  isValidDatabaseDatetime,
  validateParsingResult,
  validateGeneratedPattern
};
