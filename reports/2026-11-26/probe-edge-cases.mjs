import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createServer } from 'vite'

// Read-only audit of application logic. No real Google Sheets requests.
const require = createRequire(import.meta.url)
const { Spreadsheet, createContext } = require('../../tests/support/apps-script-harness.cjs')
const values = new Map()
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) }
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {} }
const server = await createServer({ configFile:false, envDir:false, logLevel:'silent', plugins:[], resolve:{alias:{'@':resolve('src')}}, server:{middlewareMode:true,hmr:false,ws:false,watch:null},appType:'custom' })
try {
  const s = await server.ssrLoadModule('/src/stores/poker.ts')
  const g = await server.ssrLoadModule('/src/domain/game.ts')
  const base = () => ({ ...JSON.parse(JSON.stringify(s.createTournament())), participantIds:['a','b','c'], initialDealerId:'a', gameInitialized:true, status:'live', stacks:{a:100,b:500,c:500}, hands:[], startedAt:Date.parse('2026-11-26T11:00:00Z') })
  const probes = []

  const side = base()
  const sh = g.createPokerHand(1,side.participantIds)
  for (const id of side.participantIds) sh.players[id].bets.preflop[0]=side.stacks[id]
  sh.players.a.takesPot=true; sh.players.b.takesPot=true
  assert.equal(g.settlePokerHand(side,sh),true)
  probes.push({id:'side-pots',actual:side.stacks,expected:{a:300,b:800,c:0},confirmed:side.stacks.a===550})

  const unmatched = base(); unmatched.participantIds=['a','b']; unmatched.stacks={a:100,b:500}
  const uh = g.createPokerHand(1,unmatched.participantIds)
  uh.players.a.bets.preflop[0]=100;uh.players.b.bets.preflop[0]=500;uh.players.a.takesPot=true
  assert.equal(g.settlePokerHand(unmatched,uh),true)
  probes.push({id:'uncalled-return',actual:unmatched.stacks,expected:{a:200,b:400},confirmed:unmatched.stacks.a===600})

  const short=base();short.stacks={a:1000,b:1000,c:10}
  const bh=g.createPokerHand(1,short.participantIds,{dealer:'a',smallBlind:'b',bigBlind:'c'});g.postBlinds(bh,{small:25,big:50,minutes:30},short.stacks)
  bh.players.a.bets.preflop[0]=25;bh.players.a.actions.preflop[0]='call';bh.players.b.actions.preflop[1]='check';short.hands=[bh]
  probes.push({id:'short-big-blind',actualRequirements:g.streetActionRequirements(short,bh,'preflop'),actualAdvance:s.setHandStreet(short,'flop'),expected:'a and b must contribute 50 each, not 25'})

  const invalid=base();invalid.gameInitialized=false;invalid.status='upcoming';invalid.startingStack=-10
  s.startTimer(invalid)
  probes.push({id:'negative-starting-stack',actual:{status:invalid.status,stacks:invalid.stacks},expected:'Reject start; show validation error'})

  const del=base();s.state.players.push({id:'a',name:'Audit A'},{id:'b',name:'Audit B'},{id:'c',name:'Audit C'});s.state.tournaments.push(del)
  const reactiveDel=s.state.tournaments.at(-1);s.removePlayerFromSeason('a')
  probes.push({id:'delete-active-player',actual:{participants:reactiveDel.participantIds,totalChips:Object.values(reactiveDel.stacks).reduce((a,b)=>a+b,0)},expected:'Block deletion of participant in live tournament; preserve 1100 chips'})

  const early=base();early.stacks={a:1000,b:1000,c:1000};const eh=g.createPokerHand(1,early.participantIds)
  for(const id of early.participantIds){eh.players[id].bets.preflop[0]=50;eh.players[id].actions.preflop[0]='call'}
  eh.players.a.takesPot=true;early.hands=[eh]
  probes.push({id:'premature-settlement',actual:s.settleCurrentHand(early),street:eh.street,contenders:3,expected:'Require explicit showdown/confirmation while multiple contenders remain'})

  const timer=base();timer.gameInitialized=false;timer.status='upcoming';timer.participantIds=['a','b'];timer.levels=[{small:25,big:50,minutes:1},{small:50,big:100,minutes:1}];timer.secondsRemaining=60
  const originalNow=Date.now;let now=Date.parse('2026-11-26T11:00:00Z')+900;Date.now=()=>now
  try {for(let i=0;i<10;i++){s.startTimer(timer);now+=200;s.pauseTimer(timer);now+=800}probes.push({id:'fractional-pause-loss',actual:timer.secondsRemaining,expected:58,elapsedActiveMilliseconds:2000,explanation:'Ten runs of 200 ms starting at xx.900 consume ten seconds because each start rounds down to whole second'})} finally {Date.now=originalNow}

  const last=base();last.currentLevel=last.levels.length-1;last.timerStartedAt=Date.now();s.nextLevel(last)
  probes.push({id:'next-on-last-level',actual:{level:last.currentLevel,timerStartedAt:last.timerStartedAt},expected:'Disable next level button; do not pause running timer when no next level exists'})

  const storage=base();const h=g.createPokerHand(1,storage.participantIds);h.players.a.bets.preflop=[50,0,0,0];h.players.a.actions.preflop=[null,null,null,null];storage.hands=[h]
  const scripts=createContext({spreadsheet:new Spreadsheet(),adminKey:'audit-local-only'})
  scripts.doPost({parameter:{action:'write',adminKey:'audit-local-only',payload:JSON.stringify({players:storage.participantIds.map(id=>({id,name:id})),tournaments:[storage]})}})
  const restored=JSON.parse(scripts.doGet({parameter:{action:'read'}}).getContent()).state.tournaments[0].hands[0].players.a
  probes.push({id:'sheets-null-actions',actual:restored,expected:h.players.a,explanation:'All-null action objects are omitted. Browser normalizeState restores them; this structural mismatch explains existing failing test.'})

  writeFileSync(new URL('./edge-probes.json',import.meta.url),JSON.stringify({environment:'Node/Vite SSR and in-memory Apps Script harness; no remote writes',probes},null,2)+'\n')
  console.log(JSON.stringify(probes,null,2))
} finally {await server.close()}
