// Read-only replay of the actual webhook core against isolated in-memory SQLite.
// Related: routes/webhook.js, parser/text_parser.js, database/merchants.js.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).data;
const sql = new DatabaseSync(':memory:');
const quote = s => '"' + s.replaceAll('"', '""') + '"';
for (const table of ['rules', 'pass_rules', 'merchant_categories', 'package_pay_methods', 'settings', 'transactions', 'notification_logs']) {
  const rows = data[table];
  const cols = [...new Set(rows.flatMap(Object.keys))];
  sql.exec(`CREATE TABLE ${quote(table)} (${cols.map(c => quote(c) + (c === 'id' ? ' INTEGER PRIMARY KEY' : '')).join(',')})`);
  if (['transactions', 'notification_logs'].includes(table)) continue;
  const stmt = sql.prepare(`INSERT INTO ${quote(table)} (${cols.map(quote)}) VALUES (${cols.map(() => '?')})`);
  for (const row of rows) stmt.run(...cols.map(c => row[c] ?? null));
}
for (const c of ['original_amount','currency','exchange_rate']) {
  if (!sql.prepare('PRAGMA table_info(transactions)').all().some(x => x.name === c)) sql.exec(`ALTER TABLE transactions ADD COLUMN ${c}`);
}
sql.prepare("UPDATE settings SET value = 'false' WHERE key IN ('ai_enabled','ai_parsing_enabled')").run();
sql.prepare("UPDATE settings SET value = 'true' WHERE key = 'auto_rule_generation'").run();
const db = {
  get: async (q,p=[]) => sql.prepare(q).get(...p),
  all: async (q,p=[]) => sql.prepare(q).all(...p),
  run: async (q,p=[]) => { const r=sql.prepare(q).run(...p); return {lastID:Number(r.lastInsertRowid),changes:r.changes}; }
};
const quiet = {log(){},warn(){},error(){}};
const merchants = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'database/merchants.js'),'utf8'), {
  module:merchants, console:quiet, require:()=>({})
});
const source = path.join(root,'routes/webhook.js');
const localRequire = createRequire(source);
const mod = {exports:{}};
let currentTime;
class ReplayDate extends Date { constructor(...a){super(...(a.length?a:[currentTime]));} }
const noop = async()=>{};
const parser = {...require('../parser/text_parser'), ...require('../parser/utils')};
const initialRules = data.rules.length;
vm.runInNewContext(fs.readFileSync(source,'utf8')+'\nmodule.exports.auditCore = processNotificationCore;', {
  module:mod, console:quiet, Buffer, Date:ReplayDate, AbortController,
  setTimeout:()=>0, clearTimeout(){}, setImmediate,
  fetch:async()=>({ok:false}),
  require(name){
    if(name==='express')return {Router:()=>({post(){}}),json:()=>noop};
    if(name==='../database')return {getDB:async()=>db,findCategoryByMerchant:merchants.exports.findCategoryByMerchant,updateHASensors:noop,sendHANotification:noop,createInAppNotification:noop};
    if(name==='../parser')return parser;
    if(name==='../crypto_helper')return {};
    return localRequire(name);
  }
});
(async()=>{
  const counts={}, errors=[], findings=[], atm=[];
  for(const log of data.notification_logs){
    currentTime=Date.parse(log.created_at.replace(' ','T')+'Z');
    try{
      const r=await mod.exports.auditCore({title:'',text:log.raw_text,packageVal:log.sender,username:'admin'});
      const kind=r.isPassed?'PASS':r.isIgnoredSec?'EXCLUDED':r.isDuplicate?'DUPLICATE':r.transaction?'SAVED':'FAILED';
      counts[kind]=(counts[kind]||0)+1;
      if(r.transaction){
        const t=r.transaction;
        if(t.category==='ATM/출금')atm.push(log.id);
        const mapped=await merchants.exports.findCategoryByMerchant(db,t.merchant);
        if(mapped && mapped!==t.category && !['이체/송금','이체/입금','ATM/출금'].includes(t.category)) findings.push({id:log.id,issue:'merchant-category-overridden',actual:t.category,expectedMapping:mapped});
        if(/은행|뱅크/.test(t.pay_method)&&t.payment_type==='CREDIT') findings.push({id:log.id,issue:'bank-credit',category:t.category});
      }
    }catch(e){counts.ERROR=(counts.ERROR||0)+1;errors.push({id:log.id,error:e.message});}
  }
  console.log(JSON.stringify({mode:'AI off; auto generation on; empty transaction DB; backup rules/mappings; original raw_text and sender',counts,generatedRules:sql.prepare('SELECT COUNT(*) n FROM rules').get().n-initialRules,atm,errors,findings},null,2));
})();
