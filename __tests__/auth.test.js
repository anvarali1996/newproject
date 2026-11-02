import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../lib/auth.js';
const tok='123:TEST_TOKEN',now=1700000000;
function signed(id=42){
 const pairs={auth_date:String(now),user:JSON.stringify({id,first_name:'Test'})};
 const check=Object.entries(pairs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(tok).digest();
 const hash=createHmac('sha256',secret).update(check).digest('hex');
 return `${new URLSearchParams(pairs)}&hash=${hash}`;
}
test('accepts authentic Telegram data',()=>assert.equal(verifyTelegramInitData(signed(),tok,now).id,'42'));
test('rejects tampered id',()=>assert.throws(()=>verifyTelegramInitData(signed().replace('%22id%22%3A42','%22id%22%3A43'),tok,now)));
test('rejects stale auth',()=>assert.throws(()=>verifyTelegramInitData(signed(),tok,now+86401)));
