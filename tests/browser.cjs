// Isolated browser fixtures: never contacts X or uses the user's real profile.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../extension');
const artifact=path.resolve(__dirname,'../artifacts');fs.mkdirSync(artifact,{recursive:true});
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const tweet=(user,id,body='Fixture post')=>`<article data-testid="tweet"><div data-testid="User-Name"><a href="/${user}">@${user}</a><a href="/${user}/status/${id}"><time>Now</time></a></div><div data-testid="tweetText">${body}</div><div role="group"><button data-testid="reply">Reply</button></div></article>`;
const html=posts=>`<!doctype html><html><head><style>body{background:#15202b;color:#fff;font:15px system-ui;margin:0}nav{padding:16px;width:200px;position:fixed}nav a{display:block;color:#ddd;padding:10px}main{margin-left:230px;width:590px;padding:15px}article{position:relative;min-height:100px;padding:20px;border:1px solid #445568;margin-bottom:12px}a{color:#aacfee}button{cursor:pointer}</style></head><body><nav aria-label="Primary"><a aria-label="Home" href="/home">Home</a><a aria-label="Profile" data-testid="AppTabBar_Profile_Link" href="/myself">Profile</a></nav><main>${posts}</main></body></html>`;
async function storage(context,data) {
  await context.addInitScript(initial=> {
    window.__stored=structuredClone(initial);window.__writes=[];
    window.chrome={storage:{local:{get:async key=>({[key]:window.__stored[key]}),set:async values=>{window.__writes.push(values);Object.assign(window.__stored,structuredClone(values));}}}};
  },data);
}
function state(extra={}) {
  const entry=(country,region=null,ts=Date.now())=>({accountCountry:country,accountRegion:region,usernameChanges:null,ts,v:2});
  return {xCountryBlocker:{schema:2,blockedCountries:['IN'],blockedRegions:['South Asia'],blockedLangs:[],filterMode:'block',knownUsers:{blocked:entry('IN'),broad:entry(null,'South Asia'),local:entry('US'),myself:entry('IN'),stale:entry('IN',null,Date.now()-86400001)},...extra}};
}
(async()=> {
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try {
    const context=await browser.newContext({viewport:{width:1100,height:950}});
    await storage(context,state());
    await context.route('**/*',route=>route.request().url()==='https://x.com/home'?route.fulfill({contentType:'text/html',body:html(tweet('blocked',100,'India fixture')+tweet('broad',101,'South Asia fixture')+tweet('local',102,'US fixture')+tweet('myself',103,'Own fixture')+tweet('stale',104,'Expired fixture'))}):route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://x.com/home');
    for(const file of ['page.js','cleanx.js']) await page.addScriptTag({content:read(file)});
    await page.waitForSelector('#xcb-button',{timeout:8000}).catch(async error=> {console.error('Page errors:',errors);console.error(await page.locator('body').innerText());throw error;});
    assert.equal(await page.locator('article[data-blocked="1"]').count(),2);
    assert.equal(await page.getByText('Own fixture',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('Expired fixture',{exact:true}).isVisible(),true);
    assert.equal(await page.getByText('US fixture',{exact:true}).isVisible(),true);
    assert.ok((await page.locator('article').nth(1).textContent()).includes('South Asia (region only)'));
    assert.ok(!(await page.locator('article').nth(1).textContent()).includes('Somalia'));
    await page.locator('#xcb-button').click();
    await page.locator('input[value="highlight"]').check();
    await page.waitForFunction(()=>document.querySelectorAll('article[data-xcb-mode="highlight"]').length===2);
    assert.equal(await page.getByText('India fixture',{exact:true}).isVisible(),true);
    await page.waitForFunction(()=>window.__stored.xCountryBlocker.filterMode==='highlight');
    // Existing UI remains usable and a country can be added without reloading.
    await page.locator('#add-c').fill('United States');await page.locator('#add-c').press('Enter');
    await page.waitForFunction(()=>document.querySelectorAll('article[data-xcb-mode="highlight"]').length===3);
    await page.waitForFunction(()=>window.__stored.xCountryBlocker.blockedCountries.includes('US'));
    assert.equal(await page.evaluate(()=>localStorage.length),0);
    assert.equal(await page.evaluate(async()=>(await indexedDB.databases()).length),0);
    // The footer and markings must reset if X recycles a node for another author.
    await page.locator('#close').click();
    await page.evaluate(()=>{
      const a=document.querySelector('article');a.querySelectorAll('a')[0].href='/myself';a.querySelectorAll('a')[0].textContent='@myself';a.querySelectorAll('a')[1].href='/myself/status/200';
    });
    await page.waitForFunction(()=>!document.querySelector('article').dataset.xcbMode);
    assert.equal(await page.locator('article').first().locator('[id^="xcb-footer"]').count(),0);
    await page.locator('#xcb-button').click();
    await page.locator('#xcb-modal > div').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:path.join(artifact,'cleanx-settings.png')});
    await page.locator('#xcb-clear-cache').click();
    await page.waitForFunction(()=>Object.keys(window.__stored.xCountryBlocker.knownUsers).length===0);
    assert.equal(await page.locator('article[data-blocked="1"]').count(),0);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS existing CleanX UI: country/region filters, highlight, private storage, expired cache, own posts, recycled nodes, cache clear');
    const lookup=await browser.newContext();await storage(lookup,{xCountryBlocker:{schema:2,blockedCountries:['IN'],blockedRegions:[],blockedLangs:[],filterMode:'block',knownUsers:{}}});
    await lookup.addCookies([{name:'ct0',value:'fixture-csrf',domain:'x.com',path:'/'}]);
    let requests=0;
    await lookup.route('**/*',route=> {
      const u=new URL(route.request().url());
      if(u.href==='https://x.com/home')return route.fulfill({contentType:'text/html',body:html(tweet('author',300,'Looked up fixture'))});
      if(u.origin==='https://x.com'&&u.pathname.endsWith('/HomeTimeline'))return route.fulfill({json:{}});
      if(u.origin==='https://x.com'&&u.pathname.endsWith('/AboutAccountQuery')) {requests++;return route.fulfill({json:{data:{user_result_by_screen_name:{result:{core:{screen_name:'author'},about_profile:{account_based_in:'India',username_changes:0}}}}}});}
      return route.abort();
    });
    const p=await lookup.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('https://x.com/home');
    for(const file of ['page.js','cleanx.js'])await p.addScriptTag({content:read(file)});
    await p.evaluate(()=>fetch('/i/api/graphql/fixture/HomeTimeline',{headers:{authorization:'Bearer fixture-session'}}));
    await p.waitForSelector('article[data-blocked="1"]',{state:'attached'});
    await p.waitForFunction(()=>window.__stored.xCountryBlocker.knownUsers.author?.accountCountry==='IN');
    assert.equal(requests,1);
    const saved=await p.evaluate(()=>JSON.stringify(window.__stored));assert.ok(!saved.includes('fixture-csrf'));assert.ok(!saved.includes('fixture-session'));
    assert.equal(await p.evaluate(()=>window.__stored.xCountryBlocker.knownUsers.author.usernameChanges),0);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS lookup integration: captured session, fixed endpoint GET, filtering, zero username changes, no saved credentials');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
