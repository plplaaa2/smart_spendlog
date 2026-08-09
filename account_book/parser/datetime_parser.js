function parseFlexibleDatetime(timeStr, currentYear) {
  if (!timeStr) return '';
  
  let cleanStr = timeStr.replace(/\([가-힣a-zA-Z]{1,3}\)/g, '').replace(/\[[가-힣a-zA-Z]{1,3}\]/g, '').trim();
  
  let isPM = false;
  if (/오후|PM/i.test(cleanStr)) {
    isPM = true;
  }
  cleanStr = cleanStr.replace(/오전|오후|AM|PM/ig, '').replace(/\s+/g, ' ').trim();
  
  const stdMatch = cleanStr.match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (stdMatch) {
    const year = stdMatch[1] ? parseInt(stdMatch[1], 10) : currentYear;
    const month = stdMatch[2].padStart(2, '0');
    const day = stdMatch[3].padStart(2, '0');
    let hour = parseInt(stdMatch[4], 10);
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    const minute = stdMatch[5].padStart(2, '0');
    const second = stdMatch[6] ? stdMatch[6].padStart(2, '0') : '00';
    return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
  }
  
  const krMatch = cleanStr.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분(?:\s*(\d{1,2})초)?/);
  if (krMatch) {
    const year = krMatch[1] ? parseInt(krMatch[1], 10) : currentYear;
    const month = krMatch[2].padStart(2, '0');
    const day = krMatch[3].padStart(2, '0');
    let hour = parseInt(krMatch[4], 10);
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    const minute = krMatch[5].padStart(2, '0');
    const second = krMatch[6] ? krMatch[6].padStart(2, '0') : '00';
    return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
  }

  const digitMatch = cleanStr.match(/^\b(\d{8}|\d{12}|\d{14})\b$/);
  if (digitMatch) {
    const val = digitMatch[1];
    if (val.length === 8) {
      // YYYYMMDD 검증
      const yearA = parseInt(val.slice(0, 4), 10);
      const monthA = parseInt(val.slice(4, 6), 10);
      const dayA = parseInt(val.slice(6, 8), 10);
      const isValidYYYYMMDD = (yearA >= 1900 && yearA <= 2100) && (monthA >= 1 && monthA <= 12) && (dayA >= 1 && dayA <= 31);

      // MMDDHHmm 검증
      const monthB = parseInt(val.slice(0, 2), 10);
      const dayB = parseInt(val.slice(2, 4), 10);
      const hourB = parseInt(val.slice(4, 6), 10);
      const minuteB = parseInt(val.slice(6, 8), 10);
      const isValidMMDDHHmm = (monthB >= 1 && monthB <= 12) && (dayB >= 1 && dayB <= 31) && (hourB >= 0 && hourB <= 23) && (minuteB >= 0 && minuteB <= 59);

      if (isValidYYYYMMDD) {
        const monthStr = String(monthA).padStart(2, '0');
        const dayStr = String(dayA).padStart(2, '0');
        return `${yearA}-${monthStr}-${dayStr} 00:00:00`;
      } else if (isValidMMDDHHmm) {
        const monthStr = String(monthB).padStart(2, '0');
        const dayStr = String(dayB).padStart(2, '0');
        let hour = hourB;
        if (isPM && hour < 12) hour += 12;
        const hourStr = String(hour).padStart(2, '0');
        const minuteStr = String(minuteB).padStart(2, '0');
        return `${currentYear}-${monthStr}-${dayStr} ${hourStr}:${minuteStr}:00`;
      }
    } else if (val.length === 12) {
      const year = '20' + val.slice(0, 2);
      const month = val.slice(2, 4);
      const day = val.slice(4, 6);
      let hour = parseInt(val.slice(6, 8), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = val.slice(8, 10);
      const second = val.slice(10, 12);
      return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
    } else if (val.length === 14) {
      const year = val.slice(0, 4);
      const month = val.slice(4, 6);
      const day = val.slice(6, 8);
      let hour = parseInt(val.slice(8, 10), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = val.slice(10, 12);
      const second = val.slice(12, 14);
      return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:${second}`;
    }
  }

  return '';
}

module.exports = {
  parseFlexibleDatetime
};
