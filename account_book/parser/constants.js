const BRAND_MAP = {
  VIPS: '빕스', STARBUCKS: '스타벅스', MCDONALD: '맥도날드', KFC: 'KFC', CU: 'CU',
  YES24: '예스24', 'BURGER KING': '버거킹', BURGERKING: '버거킹', SUBWAY: '써브웨이',
  COUPANG: '쿠팡', AMAZON: '아마존', NETFLIX: '넷플릭스', UBER: '우버',
  '7-ELEVEN': '세븐일레븐', '7ELEVEN': '세븐일레븐', E_MART: '이마트', 'E-MART': '이마트',
  HOMEPLUS: '홈플러스', COSTCO: '코스트코', DAISO: '다이소', IKEA: '이케아'
};

const CARD_TO_BANK_MAP = {
  'KB국민카드': '국민은행', '국민카드': '국민은행', 'KB국민체크카드': '국민은행', '국민체크카드': '국민은행',
  '신한카드': '신한은행', '신한체크카드': '신한은행', '하나카드': '하나은행', '하나체크카드': '하나은행',
  '우리카드': '우리은행', '우리체크카드': '우리은행', 'NH농협카드': '농협은행', '농협카드': '농협은행',
  '삼성카드': '삼성카드', '현대카드': '현대카드', '롯데카드': '롯데카드', 'BC카드': '기업은행'
};

const BANK_HINTS = {
  국민: '국민은행', KB국민: '국민은행', 신한: '신한은행', 우리: '우리은행', 하나: '하나은행',
  농협: '농협은행', NH: '농협은행', 기업: '기업은행', IBK: '기업은행', 우체국: '우체국',
  새마을금고: '새마을금고', 신협: '신협', 수협: '수협', 카카오뱅크: '카카오뱅크', 토스뱅크: '토스뱅크'
};

let franchisePresets = [];
try { franchisePresets = require('../franchise_presets').FRANCHISE_PRESETS || []; } catch (e) { /* optional */ }

module.exports = { BRAND_MAP, CARD_TO_BANK_MAP, BANK_HINTS, franchisePresets };
