function parseFlexibleDatetime(timeStr, currentYear) {
  if (!timeStr) return '';
  let cleanStr = String(timeStr)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const isPM = /오후|PM/i.test(cleanStr);
  cleanStr = cleanStr.replace(/오전|오후|AM|PM/ig, '').trim();

  const match = cleanStr.match(/(?:(\d{4})[년./-])?(\d{1,2})[월./-](\d{1,2})일?\s*(?:(\d{1,2})시\s*(\d{1,2})분?|([01]?\d|2[0-3]):([0-5]?\d)(?::([0-5]?\d))?)/);
  if (match) {
    const year = match[1] ? Number(match[1]) : currentYear;
    const month = Number(match[2]);
    const day = Number(match[3]);
    let hour = Number(match[4] || match[6] || 0);
    const minute = Number(match[5] || match[7] || 0);
    const second = Number(match[8] || 0);
    if (isPM && hour < 12) hour += 12;
    if (!isPM && /오전/.test(String(timeStr)) && hour === 12) hour = 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
  }

  const digits = cleanStr.match(/^\d{8}|^\d{12}|^\d{14}$/)?.[0];
  if (!digits) return '';
  if (digits.length === 8) {
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00`;
  }
  const year = digits.length === 12 ? `20${digits.slice(0, 2)}` : digits.slice(0, 4);
  const offset = digits.length === 12 ? 2 : 4;
  const pad = (value) => String(Number(value)).padStart(2, '0');
  return `${year}-${pad(digits.slice(offset, offset + 2))}-${pad(digits.slice(offset + 2, offset + 4))} ${pad(digits.slice(offset + 4, offset + 6))}:${pad(digits.slice(offset + 6, offset + 8))}:${digits.length === 14 ? pad(digits.slice(offset + 8, offset + 10)) : '00'}`;
}

module.exports = { parseFlexibleDatetime };
