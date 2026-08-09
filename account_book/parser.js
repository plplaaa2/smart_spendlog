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

module.exports = {
  parseNotification,
  generatePatternFromText,
  parseNotificationWithAI,
  generatePatternWithAI,
  generateConsumptionReportWithAI,
  sanitizePattern
};
