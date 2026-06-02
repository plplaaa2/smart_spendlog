/**
 * @file crypto_helper.js
 * @summary 민감 정보 및 구글 백업 데이터의 암호화/복호화 헬퍼 모듈
 * @description options.json 내 가계부 token을 기반으로 AES-256-CBC 대칭키 암복호화를 수행합니다.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let secretKey = 'accountbook_secret_token_default_fallback';
let keySource = 'Default Fallback';

try {
  const isWin = process.platform === 'win32';
  // options.json 경로 판정 (윈도우 로컬 개발 시에는 __dirname/data/options.json, HA 배포 시에는 /data/options.json)
  const optionsPath = isWin ? path.join(__dirname, 'data', 'options.json') : '/data/options.json';
  if (fs.existsSync(optionsPath)) {
    const fileConfig = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));
    if (fileConfig.token) {
      secretKey = fileConfig.token;
      keySource = `options.json (Length: ${secretKey.length})`;
    } else {
      keySource = 'options.json exists but no token field found';
    }
  } else {
    keySource = `options.json not found at ${optionsPath} (Using Fallback)`;
  }
} catch (err) {
  console.error('[Crypto Helper] options.json 토큰 로드 실패, 기본값 사용:', err);
  keySource = `Error reading options.json: ${err.message}`;
}

console.log(`[Crypto Helper] Encryption Key Source: ${keySource}`);

// 256비트(32바이트) 키 생성
const KEY = crypto.createHash('sha256').update(secretKey).digest();
const IV_LENGTH = 16;
const ALGORITHM = 'aes-256-cbc';

/**
 * 평문 텍스트 암호화
 * @param {string} text 
 * @returns {string} iv_hex:encrypted_hex 형식
 */
function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const result = iv.toString('hex') + ':' + encrypted;
    console.log(`[Crypto Helper] Encryption succeeded. Output format matches iv:encrypted.`);
    return result;
  } catch (err) {
    console.error('[Crypto Helper] 암호화 실패:', err.message);
    return '';
  }
}

/**
 * 암호화된 텍스트 복호화
 * @param {string} text iv_hex:encrypted_hex 형식
 * @returns {string} 복호화된 평문
 */
function decrypt(text) {
  if (!text) return '';
  try {
    const textParts = text.split(':');
    if (textParts.length !== 2) {
      console.warn(`[Crypto Helper] Input format is not iv:encrypted (parts count: ${textParts.length}). Returning raw text.`);
      return text;
    }
    const iv = Buffer.from(textParts[0], 'hex');
    const encryptedText = Buffer.from(textParts[1], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // 보안 준수를 위해 복호화 키 전체가 아닌 마스킹 형태로 디버깅 로그 출력
    const maskedResult = decrypted.substring(0, 4) + '*'.repeat(Math.max(0, decrypted.length - 4));
    console.log(`[Crypto Helper] Decryption succeeded. Masked Result: ${maskedResult} (Length: ${decrypted.length})`);
    
    return decrypted;
  } catch (err) {
    console.error('[Crypto Helper] 복호화 실패:', err.message);
    console.error('[Crypto Helper] Decryption key used (Source):', keySource);
    // 복호화 실패 시 기존 평문일 수 있으므로 일단 원본 반환
    return text;
  }
}

module.exports = {
  encrypt,
  decrypt
};
