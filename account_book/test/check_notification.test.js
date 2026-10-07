// Exercise the actual webhook core with SQLite; no production DB or network.
// Related: routes/webhook.js, database/check_notification.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {DatabaseSync} = require('node:sqlite');
const path = require('node:path');
function harness(preference, merchantMapping = null) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE pay_methods(id INTEGER PRIMARY KEY,name TEXT UNIQUE);
    CREATE TABLE rules(id INTEGER PRIMARY KEY,name,pattern,pay_type,pay_method,category,type,priority INTEGER DEFAULT 100,enabled INTEGER DEFAULT 1);
    CREATE TABLE pass_rules(id,pattern);
    CREATE TABLE package_pay_methods(package,pay_method);
    CREATE TABLE notification_logs(id INTEGER PRIMARY KEY,sender,raw_text,title,text,parsed_status,matched_rule_id);
    CREATE TABLE transactions(id INTEGER PRIMARY KEY,type,amount,merchant,category,pay_method,pay_type,datetime,memo,raw_text,used_point,original_amount,currency,exchange_rate);`);
  sql.prepare('INSERT INTO settings VALUES (?,?)').run('check_notification_priority',preference);
  for(const [pkg,provider] of [['card.app','하나카드'],['bank.app','하나은행'],['other.bank','국민은행']]) sql.prepare('INSERT INTO package_pay_methods VALUES (?,?)').run(pkg,provider);
  for(const [id,signal,type] of [[1,'체크','CHECK'],[2,'출금','TRANSFER']]) sql.prepare('INSERT INTO rules(id,name,pattern,pay_type,pay_method,category,type) VALUES (?,?,?,?,?,?,?)').run(id,signal,`${signal} (?<amount>[0-9,]+)원 (?<merchant>.+?)(?: / (?<time>\\d{2}/\\d{2} \\d{2}:\\d{2}))?$`,type,'_AUTO_MAPPING_','외식비','EXPENSE');
  const db={get:async(q,p=[])=>sql.prepare(q).get(...p),all:async(q,p=[])=>sql.prepare(q).all(...p),run:async(q,p=[])=>{const r=sql.prepare(q).run(...p);return {lastID:Number(r.lastInsertRowid),changes:r.changes};}};
  let now=Date.parse('2026-09-21T03:00:00Z');
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));} static now(){return now;}}
  const source=path.resolve(__dirname,'../routes/webhook.js');
  const realRequire=createRequire(source),mod={exports:{}};
  const noop=async()=>{};
  vm.runInNewContext(fs.readFileSync(source,'utf8')+'\nmodule.exports.core=processNotificationCore;',{
    module:mod,Buffer,Date:Clock,console:{log(){},warn(){},error(){}},
    require(n){
      if(n==='express') return {Router:()=>({post(){}}),json:()=>noop};
      if(n==='../database')return {getDB:async()=>db,findCategoryByMerchant:async()=>merchantMapping,updateHASensors:noop,sendHANotification:noop,createInAppNotification:noop};
      if(n==='../crypto_helper')return {};
      if(n==='../parser')return {...require('../parser/text_parser'),...require('../parser/utils')};
      return realRequire(n);
    }
  });
  return {sql,send:async(source,delay=0,amount=1000,pkg,transactionTime,merchant)=>{
    now+=delay;
    return mod.exports.core({title:'',text:`${source==='card'?'체크':'출금'} ${amount}원 ${merchant || (source==='card'?'카드가맹점':'은행가맹점')}${transactionTime ? ' / '+transactionTime : ''}`,packageVal:pkg||`${source}.app`,username:'admin'});
  }};
}
// Learned mappings override generic categories without replacing specific rule categories.
// Related: routes/webhook.js, routes/rules.js, database/merchants.js.
for (const [ruleCategory, mapping, expected] of [
  ['기타','생활/잡화','생활/잡화'],
  ['_AUTO_MAPPING_','마트/편의점','마트/편의점'],
  ['기타',null,'기타'],
  ['외식비','생활/잡화','외식비'],
  ['이체/송금','생활/잡화','이체/송금']
]) test(`category ${ruleCategory} with mapping ${mapping} resolves to ${expected}`,async()=>{
  const h=harness('bank',mapping);
  h.sql.prepare('UPDATE rules SET category = ?').run(ruleCategory);
  await h.send('bank');
  assert.equal(h.sql.prepare('SELECT category FROM transactions').get().category,expected);
  h.sql.close();
});
// Settlement stays in the bank ledger but must not add a second consumption expense.
// Related: parser/payment_resolver.js, routes/webhook.js, routes/analytics.js.
test('bank card bill is excluded from spending without merchant mappings',async()=>{
  const h=harness('bank');
  await h.send('bank',0,536693,undefined,undefined,'하나카드결제');
  const row=h.sql.prepare('SELECT * FROM transactions').get();
  assert.equal(row.category,'이체/송금');
  assert.equal(row.pay_method,'하나은행');
  assert.equal(row.amount,536693);
  assert.equal(h.sql.prepare("SELECT SUM(CASE WHEN type='EXPENSE' AND category!='이체/송금' THEN amount ELSE 0 END) n FROM transactions").get().n,0);
  assert.equal(h.sql.prepare("SELECT SUM(CASE WHEN type='EXPENSE' THEN -amount ELSE amount END) n FROM transactions WHERE pay_method='하나은행'").get().n,-536693);
  h.sql.close();
});
test('ordinary purchase and loan repayment are not bank card settlements',()=>{
  const {isBankCardSettlement}=require('../parser/payment_resolver');
  assert.equal(isBankCardSettlement('하나카드','하나카드결제','승인 1000원','EXPENSE'),false);
  assert.equal(isBankCardSettlement('하나은행','주택금융공사','출금 1000원','EXPENSE'),false);
  assert.equal(isBankCardSettlement('하나은행','하나카드결제','입금 1000원','INCOME'),false);
  assert.equal(isBankCardSettlement('하나은행','하나카드결제서비스점','출금 1000원','EXPENSE'),false);
});
// Registry repair must preserve historical labels, settings and deliberate wallet exclusion.
// Related: parser/payment_resolver.js, database/connection.js, routes/transactions.js.
test('registry reconciliation repairs concrete labels and excludes wallet and placeholder names',async()=>{
  const {reconcilePayMethods,ensureRegisteredPayMethod}=require('../parser/payment_resolver');
  const h=harness('bank');
  const db={all:async(q,p=[])=>h.sql.prepare(q).all(...p),run:async(q,p=[])=>h.sql.prepare(q).run(...p)};
  const labels=['KB국민은행','국민은행','토스페이머니','카드','_AUTO_MAPPING_',null,''];
  for(const pay_method of labels) h.sql.prepare('INSERT INTO transactions(pay_method) VALUES (?)').run(pay_method);
  await reconcilePayMethods(db);
  await reconcilePayMethods(db);
  assert.deepEqual(h.sql.prepare('SELECT name FROM pay_methods ORDER BY name').all().map(r=>r.name),['KB국민은행','국민은행']);
  assert.deepEqual(h.sql.prepare('SELECT pay_method FROM transactions ORDER BY id').all().map(r=>r.pay_method),labels);
  await ensureRegisteredPayMethod(db,'하나은행');
  assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM pay_methods WHERE name='하나은행'").get().n,1);
  h.sql.close();
});
test('new webhook transactions register their resolved provider',async()=>{
  const h=harness('bank');
  await h.send('bank');
  assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM pay_methods WHERE name='하나은행'").get().n,1);
  h.sql.close();
});
// New wallet payments require real providers; stale ATM mappings require explicit source evidence.
// Related: parser/payment_resolver.js, routes/webhook.js, routes/transactions.js, routes/rules.js.
test('wallet label stays in merchant when the package identifies a real bank',async()=>{
  const h=harness('bank');
  h.sql.prepare("UPDATE rules SET pay_method='토스페이머니' WHERE id=2").run();
  await h.send('bank');
  const row=h.sql.prepare('SELECT * FROM transactions').get();
  assert.equal(row.pay_method,'하나은행');
  assert.equal(row.merchant,'토스페이머니 / 은행가맹점');
  h.sql.close();
});
test('unresolved new wallet payments are logged as failed rather than saved',async()=>{
  const h=harness('bank');
  h.sql.prepare("UPDATE rules SET pay_method='토스페이머니' WHERE id=2").run();
  h.sql.prepare("DELETE FROM package_pay_methods WHERE package='bank.app'").run();
  await h.send('bank');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,0);
  assert.equal(h.sql.prepare('SELECT parsed_status FROM notification_logs').get().parsed_status,'FAILED');
  h.sql.close();
});
test('ordinary bank withdrawals do not inherit stale ATM category mappings',async()=>{
  const h=harness('bank','ATM/출금');
  h.sql.prepare("UPDATE rules SET category='기타'").run();
  await h.send('bank',0,100000,undefined,undefined,'큐브소프');
  assert.equal(h.sql.prepare('SELECT category FROM transactions').get().category,'기타');
  h.sql.close();
});
test('explicit ATM cash withdrawal is recognized',async()=>{
  const h=harness('bank');
  await h.send('bank',0,100000,undefined,undefined,'ATM 현금 인출');
  assert.equal(h.sql.prepare('SELECT category FROM transactions').get().category,'ATM/출금');
  h.sql.close();
});
test('unknown-merchant bank withdrawals are ATM under user preference',async()=>{
  const h=harness('bank');
  await h.send('bank',0,100000,undefined,undefined,'알수없음');
  assert.equal(h.sql.prepare('SELECT category FROM transactions').get().category,'ATM/출금');
  h.sql.close();
});
test('unknown ATM fallback requires an unknown label and a bank provider',()=>{
  const {resolveAutomaticAtmCategory}=require('../parser/payment_resolver');
  assert.equal(resolveAutomaticAtmCategory('기타','출금 100000원','EXPENSE','알 수 없음','하나은행'),'ATM/출금');
  for(const provider of ['하나카드','NH농협카드','계좌이체','카드','']) {
    assert.equal(resolveAutomaticAtmCategory('기타','출금 100000원','EXPENSE','알수없음',provider),'기타');
  }
  assert.equal(resolveAutomaticAtmCategory('기타','출금 100000원','EXPENSE','','하나은행'),'기타');
});
test('ATM evidence does not turn deposits into withdrawal categories',()=>{
  const {resolveAutomaticAtmCategory}=require('../parser/payment_resolver');
  assert.equal(resolveAutomaticAtmCategory('기타수입','ATM 입금 100000원','INCOME'),'기타수입');
  assert.equal(resolveAutomaticAtmCategory('ATM/출금','결제 9000원 주식회사비케이알','EXPENSE'),'기타');
});
for(const preferred of ['card','bank']) for(const first of ['card','bank']) {
  test(`${preferred} preference, ${first} arrives first: one bank debit and two logs`,async()=>{
    const h=harness(preferred);
    await h.send(first);
    await h.send(first==='card'?'bank':'card',60000);
    const rows=h.sql.prepare('SELECT * FROM transactions').all();
    assert.equal(rows.length,1);
    assert.equal(rows[0].pay_method,'하나은행');
    assert.equal(rows[0].pay_type,'CHECK');
    assert.equal(rows[0].merchant,preferred==='card'?'카드가맹점':'은행가맹점');
    assert.equal(rows[0].amount,1000);
    const logs=h.sql.prepare('SELECT parsed_status FROM notification_logs').all();
    assert.equal(logs.length,2);
    assert.equal(logs.filter(x=>x.parsed_status==='SUCCESS').length,1);
    assert.equal(logs.filter(x=>x.parsed_status==='IGNORED_DUPLICATE').length,1);
    h.sql.close();
  });
}
for(const scenario of ['late','different-amount','different-bank']) test(`do not pair ${scenario}`,async()=>{
  const h=harness('card'); await h.send('card');
  await h.send('bank',scenario==='late'?60001:1000,scenario==='different-amount'?2000:1000,scenario==='different-bank'?'other.bank':undefined);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM transactions').get().n,2); h.sql.close();
});

// Delayed delivery requires explicit transaction time; fallback receipt times are insufficient.
// Related: database/check_notification.js, routes/webhook.js.
for (const preference of ['card', 'bank']) for (const first of ['card', 'bank']) {
  test(`delayed 274-second pair: ${preference} preference, ${first} first`, async () => {
    const h = harness(preference);
    await h.send(first, 0, 1800, undefined, '09/28 15:54');
    await h.send(first === 'card' ? 'bank' : 'card', 274000, 1800, undefined, '09/28 15:54');
    const rows = h.sql.prepare('SELECT * FROM transactions').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pay_type, 'CHECK');
    assert.equal(rows[0].merchant, preference === 'card' ? '카드가맹점' : '은행가맹점');
    assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM notification_logs WHERE parsed_status='SUCCESS'").get().n, 1);
    h.sql.close();
  });
}
for (const scenario of ['different-time', 'over-five-minutes', 'missing-time']) {
  test(`do not merge delayed ${scenario}`, async () => {
    const h = harness('bank');
    await h.send('bank', 0, 1800, undefined, '09/28 15:54');
    await h.send('card', scenario === 'over-five-minutes' ? 300001 : 274000, 1800, undefined,
      scenario === 'missing-time' ? undefined : scenario === 'different-time' ? '09/28 15:55' : '09/28 15:54');
    assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM transactions').get().n, 2);
    h.sql.close();
  });
}

test('ambiguous same-amount and same-time candidates are not merged', async () => {
  const { findPair, remember } = require('../database/check_notification');
  const h = harness('bank');
  const db = {
    run: async (q,p=[]) => h.sql.prepare(q).run(...p),
    all: async (q,p=[]) => h.sql.prepare(q).all(...p)
  };
  const now = Date.now();
  await findPair(db, null, 1800, now);
  for (const id of [1,2]) {
    const raw = `출금 1800원 가맹점${id} 09/28 15:54`;
    h.sql.prepare('INSERT INTO transactions(id,type,amount,category,datetime,raw_text) VALUES (?,?,?,?,?,?)')
      .run(id,'EXPENSE',1800,'외식비','2026-09-28 15:54:00',raw);
    await remember(db,id,{source:'bank',bank:'하나은행'},1800,now-274000,'bank.app',raw);
  }
  assert.equal(await findPair(db,{source:'card',bank:'하나은행'},1800,now,'2026-09-28 15:54:00','체크 1800원 가맹점 09/28 15:54'),null);
  h.sql.close();
});
