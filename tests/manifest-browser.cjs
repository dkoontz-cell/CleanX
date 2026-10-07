// Test real Manifest V3 injection in a fresh temporary browser profile, with local X fixtures.
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const extension=path.resolve(__dirname,'../extension');
(async()=> {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cleanx-manifest-test-'));
  const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const page=await context.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await context.route('**/*',route=>route.request().url()==='https://x.com/home'?route.fulfill({contentType:'text/html',body:'<!doctype html><body><nav aria-label="Primary"><a href="/home" aria-label="Home">Home</a><a href="/myself" aria-label="Profile" data-testid="AppTabBar_Profile_Link">Profile</a></nav><main></main></body>'}):route.abort());
    await page.goto('https://x.com/home');
    await page.waitForSelector('#xcb-button',{timeout:10000}).catch(error=>{console.error('Manifest injection errors:',errors);throw error;});
    await page.locator('#xcb-button').click();await page.waitForSelector('#xcb-lookup-status');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS real Manifest V3: helper loading, isolated content script and settings UI');
  }finally {await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
