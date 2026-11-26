import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {Spreadsheet,createContext}=require('../../tests/support/apps-script-harness.cjs')
const state=JSON.parse(readFileSync(new URL('./game-state.json',import.meta.url),'utf8'))
const scripts=createContext({spreadsheet:new Spreadsheet(),adminKey:'audit-local-only'})
const write=JSON.parse(scripts.doPost({parameter:{action:'write',adminKey:'audit-local-only',payload:JSON.stringify(state)}}).getContent())
assert.equal(write.ok,true)
const actual=JSON.parse(scripts.doGet({parameter:{action:'read'}}).getContent()).state
let restoredEmptyActionObjects=0
for(const t of actual.tournaments)for(const h of t.hands)for(const p of Object.values(h.players)){
  if(!p.actions){restoredEmptyActionObjects++;p.actions=Object.fromEntries(Object.entries(p.bets).map(([street,bets])=>[street,bets.map(()=>null)]))}
}
assert.deepEqual(actual,state,'All completed game data must round-trip after browser-equivalent empty action normalization')
const t=state.tournaments[0]
assert.equal(t.status,'finished')
assert.equal(t.hands.length,10)
assert.equal(t.participantIds.length,8)
assert.equal(new Set(Object.values(t.places)).size,8)
assert.equal(Object.values(t.stacks).reduce((a,b)=>a+b,0),18000)
assert.equal(Object.values(t.rebuys).reduce((a,b)=>a+b,0),1)
const active=new Set(t.participantIds)
const reconstructed=Object.fromEntries(t.participantIds.map(id=>[id,2000]))
for(const h of t.hands){
  assert.equal(h.settled,true)
  assert.ok(active.has(h.roles.dealer)&&active.has(h.roles.smallBlind)&&active.has(h.roles.bigBlind))
  const before=Object.values(reconstructed).reduce((a,b)=>a+b,0)
  let pot=0;const winners=[]
  for(const [id,p] of Object.entries(h.players)){
    const contribution=Object.values(p.bets).flat().reduce((a,b)=>a+b,0)
    assert.ok(contribution<=reconstructed[id],`Hand ${h.number} exceeds stack`)
    reconstructed[id]-=contribution;pot+=contribution
    if(p.takesPot&&!p.folded)winners.push(id)
  }
  for(let i=0;i<winners.length;i++)reconstructed[winners[i]]+=Math.floor(pot/winners.length)+(i<pot%winners.length?1:0)
  assert.equal(Object.values(reconstructed).reduce((a,b)=>a+b,0),before)
  if(h.number===3)reconstructed['player-8']+=2000
  for(const [id,n] of Object.entries(t.eliminatedInHand))if(n===h.number)active.delete(id)
}
assert.deepEqual(reconstructed,t.stacks)
assert.equal(t.hands[9].roles.dealer,t.hands[9].roles.smallBlind)
const results={checks:['finished','10 settled hands','8 distinct places','18000 chips','1 rebuy','per-hand chip reconstruction','heads-up dealer equals SB','Sheets normalized full-state equality'],restoredEmptyActionObjects,remoteGoogleSheetsTested:false}
writeFileSync(new URL('./verification.json',import.meta.url),JSON.stringify(results,null,2)+'\n')
console.log(JSON.stringify(results,null,2))
