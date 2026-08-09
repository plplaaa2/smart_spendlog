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

module.exports = {
  escapeRegexChars,
  cleanMerchantName,
  supportsDFlag,
  sanitizePattern
};
