function determineTransactionType(normalizedText, groups = {}, ruleType = 'EXPENSE') {
  const isDeposit = /입금|환불|입금완료|수입|저축/.test(normalizedText);
  const isWithdrawal = /출금|송금|지출|결제|승인|사용|신용|체크/.test(normalizedText);
  const isCancel = /취소|반품/.test(normalizedText);

  let preemptiveType = null;
  if (isCancel) {
    if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
      preemptiveType = 'EXPENSE';
    } else {
      preemptiveType = 'INCOME';
    }
  } else if (isDeposit && !isWithdrawal) {
    preemptiveType = 'INCOME';
  } else if (isWithdrawal && !isDeposit) {
    preemptiveType = 'EXPENSE';
  }

  let transactionType;
  let customMemo = '';

  if (preemptiveType) {
    transactionType = preemptiveType;
    if (isCancel) {
      if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
        customMemo = '[입금취소] ';
      } else {
        customMemo = '[승인취소] ';
      }
    }
  } else {
    transactionType = ruleType || 'EXPENSE';
    const matchedStatus = groups.status || groups.type_text;
    if (matchedStatus) {
      const cleanStatus = matchedStatus.trim();
      if (/입금|수입|저축|환불|입금완료/.test(cleanStatus)) {
        transactionType = 'INCOME';
      } else if (/출금|송금|지출|결제|승인|사용|신용|체크/.test(cleanStatus)) {
        transactionType = 'EXPENSE';
      }
      
      if (/취소|반품/.test(cleanStatus)) {
        if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
          transactionType = 'EXPENSE';
          customMemo = '[입금취소] ';
        } else {
          transactionType = 'INCOME';
          customMemo = '[승인취소] ';
        }
      }
    } else {
      const isDep = /입금|환불|입금완료|수입|저축/.test(normalizedText);
      const isWith = /출금|송금|지출|결제|승인|사용|신용|체크/.test(normalizedText);
      
      if (isDep && !isWith) {
        transactionType = 'INCOME';
      } else if (isWith && !isDep) {
        transactionType = 'EXPENSE';
      }
      
      if (/취소|승인취소|반품/.test(normalizedText)) {
        if (/입금취소|입금\s*취소|수입취소/.test(normalizedText)) {
          transactionType = 'EXPENSE';
          customMemo = '[입금취소] ';
        } else {
          transactionType = 'INCOME';
          customMemo = '[승인취소] ';
        }
      }
    }
  }

  return { transactionType, customMemo };
}

module.exports = {
  determineTransactionType
};
