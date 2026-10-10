// 先在项目目录运行 python3 -m http.server 8769 --bind 127.0.0.1
// 再运行 ego-browser nodejs < tests/browser-smoke.js
const assert = await import('node:assert/strict');
const existingSpace = process.env.XFC_TASK_SPACE;
const task = await taskSpace(existingSpace ? Number(existingSpace) : 'X 粉丝标签 DOM 回归');
const page = existingSpace ? await task.newPage() : task.page('p1');
await page.goto('http://127.0.0.1:8769/tests/dom-fixture.html');
await page.evaluate(() => sendFixtureRecords([
  {screenName:'ALICE',followersCount:35000}, {screenName:'Zero',followersCount:0},
  {screenName:'Other',followersCount:999}, {screenName:'Unknown',followersCount:-1},
  {screenName:'TweetAuthor',followersCount:13799}, {screenName:'QuotedAuthor',followersCount:178},
  {screenName:'HeaderAuthor',followersCount:72}
]));
await page.waitForFunction(() => document.querySelector('#alice [data-xfc-badge]')?.textContent === '粉丝 3.5万');
assert.equal(await page.evaluate(() => document.querySelector('#zero [data-xfc-badge]').textContent),'粉丝 0');
assert.equal(await page.evaluate(() => document.querySelector('#unknown [data-xfc-badge]')),null);
await page.waitForFunction(() => document.querySelector('#tweet-author [data-xfc-badge]')?.textContent === '粉丝 1.3万' &&
  document.querySelector('#quoted-author [data-xfc-badge]')?.textContent === '粉丝 178' &&
  document.querySelector('#tweet-header [data-xfc-badge]')?.textContent === '粉丝 72');
assert.deepEqual(await page.evaluate(() => ['tweet-author','quoted-author','tweet-header'].map(id => {
  const badges = document.querySelectorAll(`#${id} [data-xfc-badge]`);
  return {id,count:badges.length,user:badges[0]?.dataset.xfcUser};
})),[
  {id:'tweet-author',count:1,user:'tweetauthor'},
  {id:'quoted-author',count:1,user:'quotedauthor'},
  {id:'tweet-header',count:1,user:'headerauthor'}
]);
assert.equal(await page.evaluate(() => document.querySelector('#tweet-unknown [data-xfc-badge]')),null);
assert.equal(await page.evaluate(() => document.querySelector('#tweet [data-xfc-user="other"]')),null);
assert.equal(await page.evaluate(() => document.querySelector('#tweet-author [data-xfc-user="oldauthor"]')),null);
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-xfc-badge]').length),5);
await page.evaluate(() => setFixtureSettings({enabled:true,mode:'exact'}));
await page.waitForFunction(() => document.querySelector('#alice [data-xfc-badge]')?.textContent === '粉丝 35,000');
assert.equal(await page.evaluate(() => document.querySelector('#tweet-author [data-xfc-badge]').textContent),'粉丝 13,799');
await page.evaluate(() => {
  const cell=document.querySelector('#alice');
  cell.innerHTML='<a href="/Bob"><div>复用昵称B</div></a><a href="/Bob">@Bob</a>';
  sendFixtureRecords([{screenName:'Bob',followersCount:7}]);
});
await page.waitForFunction(() => document.querySelector('#alice [data-xfc-badge]')?.dataset.xfcUser === 'bob');
assert.equal(await page.evaluate(() => document.querySelector('#alice [data-xfc-badge]').textContent),'粉丝 7');
await page.evaluate(() => sendFixtureRecords([{screenName:'Bob',followersCount:8}]));
await page.waitForFunction(() => document.querySelector('#alice [data-xfc-badge]')?.textContent === '粉丝 8');
assert.equal(await page.evaluate(() => document.querySelectorAll('#alice [data-xfc-badge]').length),1);
await page.evaluate(() => setFixtureSettings({enabled:false,mode:'compact'}));
await page.waitForFunction(() => document.querySelectorAll('[data-xfc-badge]').length === 0);
await page.evaluate(() => setFixtureSettings({enabled:true,mode:'compact'}));
await page.waitForFunction(() => document.querySelectorAll('[data-xfc-badge]').length === 5);
console.log('DOM 回归通过：用户列表/推文/引用/评论主贴作者、账号匹配、0/未知、with_replies、完整模式、旧标签回收、节点复用、计数更新、去重、关闭/恢复');
if (existingSpace) await page.close();
else await task.finish({keep:[]});
