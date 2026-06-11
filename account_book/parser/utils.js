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

module.exports = {
  escapeRegexChars,
  cleanMerchantName,
  supportsDFlag
};
