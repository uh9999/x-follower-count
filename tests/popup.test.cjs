const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../popup.js'),'utf8');
async function diagnose(data, reject = false) {
  const nodes = Object.fromEntries(['enabled','mode','status','preview','diagnostic'].map(id => [id,{checked:true,value:'compact',textContent:'',addEventListener(){}}]));
  const context = { document:{getElementById:id=>nodes[id]},chrome:{storage:{local:{get:async()=>({}),set:async()=>{}}},tabs:{query:async()=>[{id:1}],sendMessage:async()=>{if(reject)throw new Error('no receiver');return data;}}}};
  vm.runInNewContext(source,context);
  for(let i=0;i<8;i++)await Promise.resolve();
  return nodes.diagnostic.textContent;
}
test('诊断准确区分未注入、桥接未就绪、无数据、无用户行和正常显示', async()=>{
  assert.match(await diagnose(null,true),/当前页未连接插件/);
  assert.match(await diagnose({enabled:true,bridge:null,rows:3,records:0,badges:0}),/数据观察脚本尚未就绪/);
  assert.match(await diagnose({enabled:true,bridge:{},rows:3,records:0,badges:0}),/尚未读取到粉丝数据/);
  assert.match(await diagnose({enabled:true,bridge:{},rows:0,records:2,badges:0}),/当前没有用户或推文作者/);
  assert.match(await diagnose({enabled:true,bridge:{},rows:3,records:3,badges:3}),/插件正在正常显示/);
});
