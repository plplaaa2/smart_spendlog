function determineTransactionType(normalizedText, groups = {}, ruleType = 'EXPENSE') {
  const text = String(normalizedText || '');
  const status = String(groups.status || groups.type_text || '');

  const isDeposit = /(입금|입금완료|수입|급여|저축|환불받음|환급)/.test(text);
  const isWithdrawal = /(출금|이체|송금|지출|결제|승인|사용|신용|체크)/.test(text);
  const isCancel = /(취소|반품)/.test(text);
  const isDepositCancel = /(입금\s*취소|수입\s*취소)/.test(text);

  let transactionType = null;
  let customMemo = '';

  if (isCancel) {
    transactionType = isDepositCancel ? 'EXPENSE' : 'INCOME';
    customMemo = isDepositCancel ? '[입금취소] ' : '[결제취소] ';
  } else if (isDeposit && !isWithdrawal) {
    transactionType = 'INCOME';
  } else if (isWithdrawal && !isDeposit) {
    transactionType = 'EXPENSE';
  }

  if (!transactionType && status) {
    if (/(입금|입금완료|수입|급여|저축|환불)/.test(status)) transactionType = 'INCOME';
    else if (/(출금|이체|송금|지출|결제|승인|사용|신용|체크)/.test(status)) transactionType = 'EXPENSE';
  }

  return {
    transactionType: transactionType || (ruleType === 'INCOME' ? 'INCOME' : 'EXPENSE'),
    customMemo
  };
}

module.exports = { determineTransactionType };
