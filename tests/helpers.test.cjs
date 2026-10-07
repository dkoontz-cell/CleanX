const {test}=require('node:test');
const assert=require('node:assert/strict');
const Helpers=require('../extension/helpers.js');
const json=(country,changes)=>({data:{user_result_by_screen_name:{result:{about_profile:{account_based_in:country,username_changes:changes}}}}});
test('broad regions never become country codes',()=> {
  for(const region of ['South Asia','Asia','Europe','Western Europe','Africa']) {
    assert.deepEqual(Helpers.classify(region),{accountCountry:null,accountRegion:region});
  }
  assert.equal(Helpers.classify('South Asia').accountCountry,null);
  assert.deepEqual(Helpers.classify('Unrecognized place'),{accountCountry:null,accountRegion:null});
});
test('exact countries and aliases still work',()=> {
  assert.equal(Helpers.classify('India').accountCountry,'IN');
  assert.equal(Helpers.classify('Türkiye').accountCountry,'TR');
  assert.equal(Helpers.classify('United States of America').accountCountry,'US');
  assert.equal(Helpers.classify('Delhi, India').accountCountry,null);
  assert.equal(Helpers.classify('India enthusiast').accountCountry,null);
});
test('username-change zero is valid; missing counts are unknown',()=> {
  assert.equal(Helpers.parse(json('India',0)).usernameChanges,0);
  assert.equal(Helpers.parse(json('India')).usernameChanges,null);
  assert.equal(Helpers.parse(json('India',null)).usernameChanges,null);
  assert.equal(Helpers.parse(json('India','3')).usernameChanges,3);
  assert.equal(Helpers.parse(json('India',-1)).usernameChanges,null);
});
test('confirmed cache expires after 24 hours, unknowns after 10 minutes',()=> {
  const now=1e9;
  assert.equal(Helpers.fresh({accountCountry:'IN',ts:now-86399999,v:2},now),true);
  assert.equal(Helpers.fresh({accountCountry:'IN',ts:now-86400000,v:2},now),false);
  assert.equal(Helpers.fresh({accountRegion:'Asia',ts:now-86400000,v:2},now),false);
  assert.equal(Helpers.fresh({accountCountry:null,ts:now-600000,v:2},now),false);
  assert.equal(Helpers.fresh({accountCountry:'IN',ts:now+1,v:2},now),false);
});
test('old upstream cache is not trusted and cache has a size limit',()=> {
  const now=1e9;
  assert.equal(Helpers.fresh({accountCountry:'SO',ts:now},now),false);
  const cache=Object.fromEntries(Array.from({length:2500},(_,i)=>['user'+i,{accountCountry:'IN',ts:now-i,v:2}]));
  cache['bad/user']={accountCountry:'IN',ts:now,v:2};
  const pruned=Helpers.prune(cache,now);
  assert.equal(Object.keys(pruned).length,2000);
  assert.equal(pruned['bad/user'],undefined);
});
