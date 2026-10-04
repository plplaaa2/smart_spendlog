function escapeRegexChars(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function cleanMerchantName(merchant) {
  if (!merchant) return '알수없음';
  let cleaned = merchant.split('\n')[0].split('\r')[0].trim();
  
  cleaned = cleaned.replace(/^\((주|합|유|재|사)\)|^\(주식회사\)/g, '');
  cleaned = cleaned.replace(/\((주|합|유|재|사)\)$|\(주식회사\)$/g, '');
  cleaned = cleaned.replace(/^주식회사\s+|\s+주식회사$/g, '');
  
  cleaned = cleaned.replace(/^[\s,.\-_#@*&()\[\]{}]+|[\s,.\-_#@*&()\[\]{}]+$/g, '');
  return cleaned.trim() || '알수없음';
}

let supportsDFlag = false;
try {
  new RegExp('a', 'd');
  supportsDFlag = true;
} catch (e) {
  supportsDFlag = false;
}

function sanitizePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return pattern;
  // Repair only the exact legacy settlement pattern that captured the old-account marker as merchant.
  // Related: text_parser.js, routes/rules.js, database/backup.js, test/capture_direction.test.js.
  const legacySettlement = String.raw`출금\s*(?<amount>[\d,]+)원\s*하나카드결제\s*(?:잔액|잔고)\s*:?\s*(?<balance>[\d,]+)원\s*(?<time>\d{2}\/\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s*(?<account>[\d*-]+)(?<merchant>.+?)(?:\s+[\d,]+)?(?:[\d*-]+)`;
  if (pattern === legacySettlement) {
    pattern = pattern.replace('하나카드결제', '(?<merchant>하나카드결제)')
      .replace(String.raw`(?<account>[\d*-]+)(?<merchant>.+?)(?:\s+[\d,]+)?(?:[\d*-]+)`, String.raw`(?<account>[\d*-]+)(?:\(구\)[\d*-]+)?`);
  }
  if (!pattern.includes('(?<')) return pattern;
  
  // (?<group_name>...) 에서 group_name 에 언더바(_)가 들어있을 때 이를 카멜케이스로 치환
  // 예: (?<merchant_name>.*?) -> (?<merchantName>.*?)
  return pattern.replace(/\(\?<([a-zA-Z0-9_]+)>/g, (match, groupName) => {
    if (groupName.includes('_')) {
      const camel = groupName.split('_').map((part, index) => {
        if (index === 0) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      }).join('');
      return `(?<${camel}>`;
    }
    return match;
  });
}

// Validate restored rules before destructive DB operations; never include pattern text in errors.
// Related: database/backup.js, routes/rules.js, text_parser.js.
function validateBackupRulePatterns(data) {
  for (const table of ['rules', 'pass_rules']) {
    for (const rule of data[table] || []) {
      try {
        if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) throw new Error('empty pattern');
        new RegExp(sanitizePattern(rule.pattern), table === 'rules' ? (supportsDFlag ? 'ds' : 's') : '');
      } catch (_) {
        throw new Error(`백업의 ${table} 규칙 ID ${rule.id}에 잘못된 정규식이 있습니다. 규칙을 수정한 후 복원해 주세요.`);
      }
    }
  }
}

module.exports = {
  validateBackupRulePatterns,
  escapeRegexChars,
  cleanMerchantName,
  supportsDFlag,
  sanitizePattern
};
