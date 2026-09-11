import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const calls:{universe:unknown[];evidence:unknown[];snapshot:unknown[];legacy:unknown[]}={universe:[],evidence:[],snapshot:[],legacy:[]};
const control:{emitSigintDuringEvidence:boolean;runStatus:'complete'|'partial'}={emitSigintDuringEvidence:false,runStatus:'complete'};
vi.mock('../src/cn/sources/listings.js',()=>({collectCnUniverse:vi.fn(async(...args:unknown[])=>{calls.universe.push(args);return {inputFile:'/identity.json',status:'complete',count:1};})}));
vi.mock('../src/cn/collection.js',()=>({collectCnEvidence:vi.fn(async(...args:unknown[])=>{calls.evidence.push(args);if(control.emitSigintDuringEvidence)process.emit('SIGINT');return {inputFile:'/collected.json',status:control.runStatus};})}));
vi.mock('../src/cn/run-archive.js',()=>({
 runEvidenceSnapshot:vi.fn(async(...args:unknown[])=>{calls.snapshot.push(args);}),
 openEvidenceRun:vi.fn(async()=>({manifest:{status:control.runStatus,selection:{}},summary:{inputCount:1}})),
}));
vi.mock('../src/us/screening.js',()=>({runCommand:vi.fn(async(...args:unknown[])=>{calls.legacy.push(args);})}));
vi.mock('../src/policy/loader.js',()=>({loadCnPolicy:vi.fn(async()=>({}))}));

describe('CLI policy dispatch',()=>{
 beforeEach(()=>{for(const value of Object.values(calls))value.length=0;control.emitSigintDuringEvidence=false;control.runStatus='complete';process.exitCode=undefined;vi.spyOn(console,'log').mockImplementation(()=>undefined);});
 afterEach(()=>vi.restoreAllMocks());
 it('defaults CN to bounded identity, collection, and evidence archival',async()=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--markets','CN','--output','/run']);
  expect(calls.universe[0]).toMatchObject(['/run.identity',{maxRequests:600,maxMs:1_800_000,requestMs:10_000}]);
  expect(calls.evidence[0]).toMatchObject(['/identity.json','/run.collection',{concurrency:4,pdfFallback:true,strategy:'all'}]);
  expect(calls.snapshot[0]).toMatchObject(['/collected.json','/run',expect.objectContaining({strategy:'all'})]);
  expect(calls.legacy).toHaveLength(0);
 });
 it('passes a configurable live annual cache interval and rejects invalid or offline combinations before collection',async()=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--output','/run','--cache-from','/old/input.json','--annual-cache-days','60']);
  expect(calls.evidence[0]).toMatchObject(['/identity.json','/run.collection',{cacheFile:'/old/input.json',annualCacheDays:60}]);
  for(const days of ['-1','NaN','366']) await expect(runCli(['node','screener','run','--annual-cache-days',days])).rejects.toThrow(/between 0 and 365/);
  await expect(runCli(['node','screener','run','--input','/old.json','--annual-cache-days','30'])).rejects.toThrow(/requires live CN/);
  await expect(runCli(['node','screener','run','--markets','US','--annual-cache-days','30','--quarter','2026-Q3','--output','/out','--spec','/spec'])).rejects.toThrow(/require CN/);
  expect(calls.universe).toHaveLength(1);expect(calls.evidence).toHaveLength(1);
 });
 it.each(['cn-screening','cn-quality'])('keeps %s offline and rejects mutually exclusive source inputs before collection',async(policy)=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--policy',policy,'--input','/saved.json','--output','/run']);
  expect(calls.universe).toHaveLength(0);expect(calls.evidence).toHaveLength(0);expect(calls.snapshot[0]?.slice(0,2)).toEqual(['/saved.json','/run']);
  await expect(runCli(['node','screener','run','--input','/saved.json','--collect-from','/identity.json','--output','/run-2'])).rejects.toThrow(/exactly one/);
  expect(calls.universe).toHaveLength(0);expect(calls.evidence).toHaveLength(0);
 });
 it.each(['ncav','all'] as const)('accepts %s as a saved-run strategy selector',async(strategy)=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--input','/saved.json','--output',`/run-${strategy}`,'--strategy',strategy]);
  expect(calls.snapshot[0]).toMatchObject(['/saved.json',`/run-${strategy}`,expect.objectContaining({strategy})]);
 });
 it('uses --collect-from as the CN evidence input and validates local options before automatic collection',async()=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--collect-from','/identity.json','--output','/run']);
  expect(calls.universe).toHaveLength(0);
  expect(calls.evidence[0]?.slice(0,2)).toEqual(['/identity.json','/run.collection']);
 await expect(runCli(['node','screener','run','--adapter','fixture','--output','/bad'])).rejects.toThrow(/adapter applies only/);
  await expect(runCli(['node','screener','run','--skip-cache','--output','/bad-cache'])).rejects.toThrow(/skip-cache applies only/);
  await expect(runCli(['node','screener','run','--enrich-concurrency','0','--output','/bad-2'])).rejects.toThrow(/between 1 and 12/);
  await expect(runCli(['node','screener','run','--limit','-1','--output','/bad-3'])).rejects.toThrow(/non-negative integer/);
 expect(calls.universe).toHaveLength(0);expect(calls.evidence).toHaveLength(1);
 });
 it('rejects an unknown legacy adapter before any collection or US dispatch',async()=>{
  const {runCli}=await import('../src/cli.js');
  await expect(runCli(['node','screener','run','--markets','US','--quarter','2026-Q3','--output','/out','--spec','/spec','--adapter','other'])).rejects.toThrow(/adapter must be fixture or live/);
  expect(calls.universe).toHaveLength(0);expect(calls.evidence).toHaveLength(0);expect(calls.legacy).toHaveLength(0);
 });
 it.each(['template-screening','legacy'])('keeps US on %s and rejects CN template selection',async(policy)=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--markets','US','--policy',policy,'--quarter','2026-Q3','--output','/out','--spec','/spec']);
  expect(calls.legacy[0]?.[0]).toMatchObject({markets:'US',quarter:'2026-Q3'});
  await expect(runCli(['node','screener','run','--markets','CN','--policy','legacy','--quarter','2026-Q3','--output','/out','--spec','/spec'])).rejects.toThrow(/CN legacy screening is retired/);
 });
 it('runs CN evidence then the retained US command for an explicit mixed scope, passing the US live adapter only to US',async()=>{
  const {runCli}=await import('../src/cli.js');
  await runCli(['node','screener','run','--markets','CN,US','--quarter','2026-Q3','--output','/out','--spec','/spec','--input','/saved.json','--adapter','live']);
  expect(calls.snapshot[0]?.slice(0,2)).toEqual(['/saved.json','/out/2026-Q3/CN']);
  expect(calls.legacy[0]?.[0]).toMatchObject({markets:'US',quarter:'2026-Q3',adapter:'live'});
 });
 it('does not start US after SIGINT leaves the CN side partial',async()=>{
  const {runCli}=await import('../src/cli.js');
  control.emitSigintDuringEvidence=true;control.runStatus='partial';
  await runCli(['node','screener','run','--markets','CN,US','--quarter','2026-Q3','--output','/out','--spec','/spec']);
  expect(calls.snapshot[0]?.slice(0,2)).toEqual(['/collected.json','/out/2026-Q3/CN']);
  expect(calls.legacy).toHaveLength(0);expect(process.exitCode).toBe(130);
 });
 it('rejects an incomplete mixed request before identity collection',async()=>{
  const {runCli}=await import('../src/cli.js');
  await expect(runCli(['node','screener','run','--markets','CN,US','--quarter','2026-Q3','--output','/out'])).rejects.toThrow(/Legacy US run requires/);
  expect(calls.universe).toHaveLength(0);expect(calls.evidence).toHaveLength(0);expect(calls.snapshot).toHaveLength(0);
 });
});
