// Validate notification timestamps before returning a database datetime string.
// Related flow: parser/text_parser.js -> routes/webhook.js -> transactions.datetime.
function isValidDateTimeParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  if (!Number.isInteger(second) || second < 0 || second > 59) return false;

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

function normalizeMeridiemHour(hour, isAM, isPM) {
  if (isAM && hour === 12) return 0;
  if (isPM && hour < 12) return hour + 12;
  return hour;
}

function parseFlexibleDatetime(timeStr, currentYear) {
  if (!timeStr) return '';
  
  let cleanStr = timeStr.replace(/\([가-힣a-zA-Z]{1,3}\)/g, '').replace(/\[[가-힣a-zA-Z]{1,3}\]/g, '').trim();
  
  const isAM = /오전|AM/i.test(cleanStr);
  const isPM = /오후|PM/i.test(cleanStr);
  cleanStr = cleanStr.replace(/오전|오후|AM|PM/ig, '').replace(/\s+/g, ' ').trim();
  
  const stdMatch = cleanStr.match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (stdMatch) {
    const year = stdMatch[1] ? parseInt(stdMatch[1], 10) : currentYear;
    const month = parseInt(stdMatch[2], 10);
    const day = parseInt(stdMatch[3], 10);
    const hour = normalizeMeridiemHour(parseInt(stdMatch[4], 10), isAM, isPM);
    const minute = parseInt(stdMatch[5], 10);
    const second = stdMatch[6] ? parseInt(stdMatch[6], 10) : 0;
    if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }
  
  const krMatch = cleanStr.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분(?:\s*(\d{1,2})초)?/);
  if (krMatch) {
    const year = krMatch[1] ? parseInt(krMatch[1], 10) : currentYear;
    const month = parseInt(krMatch[2], 10);
    const day = parseInt(krMatch[3], 10);
    const hour = normalizeMeridiemHour(parseInt(krMatch[4], 10), isAM, isPM);
    const minute = parseInt(krMatch[5], 10);
    const second = krMatch[6] ? parseInt(krMatch[6], 10) : 0;
    if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  }

  const digitMatch = cleanStr.match(/^\b(\d{8}|\d{12}|\d{14})\b$/);
  if (digitMatch) {
    const val = digitMatch[1];
    if (val.length === 8) {
      // YYYYMMDD 검증
      const yearA = parseInt(val.slice(0, 4), 10);
      const monthA = parseInt(val.slice(4, 6), 10);
      const dayA = parseInt(val.slice(6, 8), 10);
      const isValidYYYYMMDD = isValidDateTimeParts(yearA, monthA, dayA);

      // MMDDHHmm 검증
      const monthB = parseInt(val.slice(0, 2), 10);
      const dayB = parseInt(val.slice(2, 4), 10);
      const hourB = parseInt(val.slice(4, 6), 10);
      const minuteB = parseInt(val.slice(6, 8), 10);
      const isValidMMDDHHmm = isValidDateTimeParts(currentYear, monthB, dayB, hourB, minuteB);

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
      const year = parseInt('20' + val.slice(0, 2), 10);
      const month = parseInt(val.slice(2, 4), 10);
      const day = parseInt(val.slice(4, 6), 10);
      let hour = parseInt(val.slice(6, 8), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = parseInt(val.slice(8, 10), 10);
      const second = parseInt(val.slice(10, 12), 10);
      if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return '';
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    } else if (val.length === 14) {
      const year = parseInt(val.slice(0, 4), 10);
      const month = parseInt(val.slice(4, 6), 10);
      const day = parseInt(val.slice(6, 8), 10);
      let hour = parseInt(val.slice(8, 10), 10);
      if (isPM && hour < 12) hour += 12;
      const minute = parseInt(val.slice(10, 12), 10);
      const second = parseInt(val.slice(12, 14), 10);
      if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return '';
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    }
  }

  return '';
}

module.exports = {
  parseFlexibleDatetime
};
