const { BRAND_MAP } = require('./constants');
const { escapeRegexChars } = require('./utils');

const BRAND_KEYS_SORTED = Object.keys(BRAND_MAP).sort((a, b) => b.length - a.length);
const BRAND_ENG_REGEX = new RegExp(`(?:${BRAND_KEYS_SORTED.map(escapeRegexChars).join('|')})[a-zA-Z]*`, 'i');

function addKoreanBrandName(merchant) {
  if (!merchant) return merchant;

  const match = BRAND_ENG_REGEX.exec(merchant);
  if (match) {
    const matchedEng = match[0];
    const brandKey = matchedEng.toUpperCase();
    const originalKey = BRAND_KEYS_SORTED.find(k => brandKey.startsWith(k));
    const kor = BRAND_MAP[originalKey];
    if (kor && !merchant.includes(kor)) {
      const replaceRegex = new RegExp(escapeRegexChars(matchedEng), 'i');
      return merchant.replace(replaceRegex, `${matchedEng}(${kor})`);
    }
  }

  return merchant;
}

module.exports = {
  addKoreanBrandName
};
