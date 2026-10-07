const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const Core=require('../extension/core.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../extension/bridge.js'),'utf8');
function harness(responses=[]) {
  const calls=[],messages=[],listeners={}; let now=100000;
  class Clock extends Date {static now(){return now;}}
  class XHR {open(){} setRequestHeader(){} send(){}}
  const window={fetch:async(url,init)=> {calls.push({url,init}); return responses.shift() || new Response('{}',{status:200});},postMessage:data=>messages.push(data),addEventListener:(type,fn)=>listeners[type]=fn};
  const sandbox={window,globalThis:null,location:{origin:'https://x.com'},document:{cookie:'ct0=test-csrf',querySelectorAll:()=>[]},performance:{getEntriesByType:()=>[]},XMLHttpRequest:XHR,Headers,Request,Response,URL,AbortSignal,Date:Clock,XCountryCore:Core};
  sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);
  const send=data=>listeners.message({source:window,origin:'https://x.com',data:{channel:'cleanx-local-v1',direction:'to-page',...data}});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {calls,messages,send,settle,window,tick:ms=>{now+=ms;}};
}
async function ready(h) {
  await h.window.fetch('https://x.com/i/api/graphql/home/HomeTimeline',{headers:{authorization:'Bearer test-session'}});
  h.send({type:'config',active:true});h.calls.length=0;
}
test('missing session never sends account requests',async()=> {
  const h=harness();h.send({type:'config',active:true});h.send({type:'lookup',author:'author',id:'1'});await h.settle();
  assert.equal(h.calls.length,0);assert.equal(h.messages.at(-1).error,'waiting-session');
});
test('lookup uses same-origin GET, returns only public country, never credentials',async()=> {
  const h=harness([new Response('{}'),new Response(JSON.stringify({data:{user_result_by_screen_name:{result:{about_profile:{account_based_in:'India'}}}}}))]);
  await ready(h);h.send({type:'lookup',author:'author',id:'1'});await h.settle();
  assert.equal(h.calls.length,1); const call=h.calls[0];
  assert.match(call.url,/^https:\/\/x.com\/i\/api\/graphql\/[^/]+\/AboutAccountQuery\?/);
  assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'include');
  assert.equal(h.messages.at(-1).country,'India');
  assert.ok(!JSON.stringify(h.messages).includes('test-session'));assert.ok(!JSON.stringify(h.messages).includes('test-csrf'));
  h.send({type:'lookup',author:'another',id:'2'});await h.settle();assert.equal(h.calls.length,1);
});
test('rate limit honors a longer Retry-After and prevents more lookups',async()=> {
  const h=harness([new Response('{}'),new Response('{}',{status:429,headers:{'retry-after':'1800'}})]);await ready(h);
  h.send({type:'lookup',author:'author',id:'1'});await h.settle();assert.equal(h.messages.at(-1).error,'rate-limited');
  assert.equal(h.messages.at(-1).retryAt,100000+1800000);
  h.tick(900000);h.send({type:'lookup',author:'another',id:'2'});await h.settle();assert.equal(h.calls.length,1);
});
test('rejected session, malformed schema and network failure fail visibly',async()=> {
  for(const [response,expected] of [[new Response('{}',{status:403}),'session-rejected'],[new Response('{"data":{}}'),'endpoint-unavailable']]) {
    const h=harness([new Response('{}'),response]);await ready(h);h.send({type:'lookup',author:'author',id:'1'});await h.settle();
    assert.equal(h.messages.at(-1).error,expected);assert.equal(h.messages.at(-1).country,undefined);
  }
});
test('learns current endpoint from X requests and rejects invalid bridge messages',async()=> {
  const h=harness([new Response('{}'),new Response('{}'),new Response(JSON.stringify({data:{user_result_by_screen_name:{result:{about_profile:{account_based_in:'Europe'}}}}}))]);
  await ready(h);await h.window.fetch('https://x.com/i/api/graphql/CurrentID/AboutAccountQuery',{headers:{authorization:'Bearer test-session'}});h.calls.length=0;
  h.send({type:'lookup',author:'https://evil.test',id:'bad'});await h.settle();assert.equal(h.calls.length,0);
  h.send({type:'lookup',author:'author',id:'1'});await h.settle();assert.match(h.calls[0].url,/\/CurrentID\/AboutAccountQuery/);
  h.tick(3000);h.send({type:'config',active:false});h.send({type:'lookup',author:'other',id:'2'});await h.settle();assert.equal(h.calls.length,1);
});
