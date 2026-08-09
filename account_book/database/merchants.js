// [merchants.js]
// - 요약: 가맹점 이름 기반 카테고리 매핑 및 프리셋 데이터 시딩을 처리하는 DB 헬퍼 모듈입니다.
// - 연결된 파일 목록:
//   - connection.js (getDB 호출)
//   - franchise_presets.js (FRANCHISE_PRESETS 로드)
//   - NotificationParser.kt (안드로이드측 동기화된 가맹점 매칭 로직)
const { getDB } = require('./connection');

let FRANCHISE_PRESETS = [];
try {
  FRANCHISE_PRESETS = require('../franchise_presets').FRANCHISE_PRESETS || [];
} catch (e) {
  console.warn('[DB] franchise_presets.js를 찾을 수 없습니다. 프리셋 없이 실행합니다.', e.message);
}

// 일반 명사성 키워드 목록: 고유 브랜드명(KFC, 스타벅스, 씨유 등) 뒤에 지점명이 붙을 때 오매칭 방지 로직에 걸려 분류가 누락되는 현상을 방지
const COMMON_NOUNS = new Set([
  '마트', '슈퍼', '상회', '유통', '청과', '정육', '수산', '시장', 
  '카페', '커피', '식당', '제과', '베이커리', '약국', '병원', '의원', 
  '상사', '산업', '건설', '학원', '독서실', '헬스', '미용', '뷰티'
]);

async function findCategoryByMerchant(db, merchantName) {
  if (!merchantName) return null;

  const exactRow = await db.get(
    'SELECT category FROM merchant_categories WHERE merchant = ?',
    [merchantName]
  );
  if (exactRow) return exactRow.category;

  const allMappings = await db.all('SELECT merchant, category FROM merchant_categories');
  const upperMerchant = merchantName.toUpperCase();
  for (const row of allMappings) {
    if (row.merchant) {
      const upperKeyword = row.merchant.toUpperCase();
      const idx = upperMerchant.indexOf(upperKeyword);
      if (idx !== -1) {
        if (upperKeyword === '마트' && upperMerchant.includes('스마트')) {
          continue;
        }
        const nextChar = upperMerchant.charAt(idx + upperKeyword.length);
        if (nextChar && /^[가-힣]$/.test(nextChar)) {
          if (COMMON_NOUNS.has(upperKeyword)) {
            continue;
          }
        }
        return row.category;
      }
    }
  }

  return null;
}

async function seedFranchisePresets(db, force = false) {
  let inserted = 0;
  let updated = 0;
  for (const preset of FRANCHISE_PRESETS) {
    if (force) {
      const existing = await db.get(
        'SELECT id FROM merchant_categories WHERE merchant = ?',
        [preset.keyword]
      );
      if (existing) {
        const result = await db.run(
          'UPDATE merchant_categories SET category = ? WHERE merchant = ?',
          [preset.category, preset.keyword]
        );
        if (result.changes > 0) updated++;
      } else {
        const result = await db.run(
          'INSERT INTO merchant_categories (merchant, category) VALUES (?, ?)',
          [preset.keyword, preset.category]
        );
        if (result.changes > 0) inserted++;
      }
    } else {
      const result = await db.run(
        'INSERT OR IGNORE INTO merchant_categories (merchant, category) VALUES (?, ?)',
        [preset.keyword, preset.category]
      );
      if (result.changes > 0) inserted++;
    }
  }

  let txUpdatedCount = 0;
  if (force) {
    for (const preset of FRANCHISE_PRESETS) {
      if (['편의점', '음료/카페', '배달음식', '디저트', '패션/의류', '병원/약국', '해외직구', '구독', '렌탈', '세금', '수도광열비', '주거', '통신비', '연금', '지원금/환급금', '기부금'].includes(preset.category)) {
        let sourceCategories = ["식비", "외식비"];
        if (preset.category === '패션/의류') {
          sourceCategories = ["식비", "외식비", "온라인쇼핑", "생활/마트"];
        } else if (preset.category === '해외직구') {
          sourceCategories = ["식비", "외식비", "온라인쇼핑", "생활/마트"];
        } else if (preset.category === '병원/약국') {
          sourceCategories = ["식비", "외식비", "기타", "의료/건강"];
        } else if (preset.category === '구독') {
          sourceCategories = ["식비", "외식비", "온라인쇼핑", "문화/여가", "기타"];
        } else if (preset.category === '렌탈') {
          sourceCategories = ["식비", "외식비", "온라인쇼핑", "생활/마트", "기타"];
        } else if (preset.category === '세금') {
          sourceCategories = ["수도광열비", "공과금", "주거/통신", "기타"];
        } else if (preset.category === '수도광열비') {
          sourceCategories = ["공과금", "주거/통신", "기타"];
        } else if (preset.category === '통신비') {
          sourceCategories = ["주거/통신", "주거", "기타"];
        } else if (preset.category === '주거') {
          sourceCategories = ["주거/통신", "기타"];
        } else if (preset.category === '연금') {
          sourceCategories = ["기타수입", "부수입", "기타"];
        } else if (preset.category === '지원금/환급금') {
          sourceCategories = ["기타수입", "부수입", "기타"];
        } else if (preset.category === '기부금') {
          sourceCategories = ["기타", "경조사/용돈"];
        }
        for (const srcCat of sourceCategories) {
          const txResult = await db.run(
            "UPDATE transactions SET category = ? WHERE category = ? AND merchant LIKE ?",
            [preset.category, srcCat, `%${preset.keyword}%`]
          );
          txUpdatedCount += txResult.changes;
        }
      }
    }
  }

  return { total: FRANCHISE_PRESETS.length, inserted, updated, txUpdated: txUpdatedCount };
}

module.exports = {
  findCategoryByMerchant,
  seedFranchisePresets,
  FRANCHISE_PRESETS
};
