const fs = require('fs');
const path = require('path');

const categoryFiles = {
  'dessert.json': '디저트',
  'cafe.json': '음료/카페',
  'delivery.json': '배달음식',
  'dining.json': '외식비',
  'mart.json': '마트/편의점',
  'living.json': '생활/잡화',
  'medical.json': '병원/약국',
  'shopping.json': '온라인쇼핑',
  'direct_buy.json': '해외직구',
  'fashion.json': '패션/의류',
  'traffic.json': '교통/주유',
  'telecom.json': '통신비',
  'subscription.json': '구독',
  'utilities.json': '수도광열비',
  'tax.json': '세금',
  'culture.json': '문화/여가',
  'travel.json': '문화/여가',
  'education.json': '교육/학습',
  'insurance.json': '보험',
  'rental.json': '렌탈',
  'pension.json': '연금',
  'refunds.json': '지원금/환급금',
  'donations.json': '기부금'
};

const FRANCHISE_PRESETS = [];
const presetsDir = path.join(__dirname, 'presets');

Object.entries(categoryFiles).forEach(([fileName, categoryName]) => {
  const filePath = path.join(presetsDir, fileName);
  if (fs.existsSync(filePath)) {
    try {
      const keywords = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(keywords)) {
        keywords.forEach(keyword => {
          FRANCHISE_PRESETS.push({ keyword, category: categoryName });
        });
      }
    } catch (err) {
      console.error(`[Presets] Failed to load preset file ${fileName}:`, err.message);
    }
  }
});

module.exports = { FRANCHISE_PRESETS };
