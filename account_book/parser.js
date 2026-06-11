// parser.js 요약: 알림 텍스트를 등록된 규칙들과 대조하여 결제 정보(금액, 사용처, 일시, 결제수단 등)를 추출합니다. (서브모듈 파사드)

const {
  parseNotification,
  generatePatternFromText
} = require('./parser/text_parser');

const {
  parseNotificationWithAI,
  generatePatternWithAI,
  generateConsumptionReportWithAI
} = require('./parser/ai_parser');

module.exports = {
  parseNotification,
  generatePatternFromText,
  parseNotificationWithAI,
  generatePatternWithAI,
  generateConsumptionReportWithAI
};
