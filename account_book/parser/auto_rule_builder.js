// Build a locally generated rule only when its pattern is safe and reparses the source text.
// Related files: parser/pattern_generator.js, parser/pattern_validator.js, parser/text_parser.js.
const { generatePatternFromText } = require('./pattern_generator');
const { validateGeneratedPattern } = require('./pattern_validator');
const { parseNotification } = require('./text_parser');

function buildValidatedAutoRule(text, type = 'EXPENSE', fallbackDatetime = null) {
  const generatedPattern = generatePatternFromText(text);
  if (!generatedPattern) {
    return { valid: false, pattern: null, parsedResult: null, errors: ['pattern generation failed'] };
  }

  const validation = validateGeneratedPattern(generatedPattern);
  if (!validation.valid) {
    return { valid: false, pattern: null, parsedResult: null, errors: validation.errors };
  }

  const candidateRule = {
    id: 9999,
    name: '로컬 자동 생성 검증 규칙',
    pattern: validation.pattern,
    pay_method: '_AUTO_MAPPING_',
    category: '_AUTO_MAPPING_',
    type
  };
  const parsedResult = parseNotification(text, [candidateRule], fallbackDatetime);
  if (!parsedResult) {
    return { valid: false, pattern: null, parsedResult: null, errors: ['source notification reparse failed'] };
  }

  return { valid: true, pattern: validation.pattern, parsedResult, errors: [] };
}

module.exports = { buildValidatedAutoRule };
