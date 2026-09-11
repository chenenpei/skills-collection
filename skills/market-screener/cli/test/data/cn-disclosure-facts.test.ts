import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { parseCnDisclosureFacts } from '../../src/cn/sources/annual-reports.js';

const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/fuyao-2025-consolidated-lines.json', import.meta.url), 'utf8'));
const hengrui = JSON.parse(await fs.readFile(new URL('../fixtures/hengrui-2025-financing-lines.json', import.meta.url), 'utf8'));
const businessReports=JSON.parse(await fs.readFile(new URL('../fixtures/business-breakdown-lines.json',import.meta.url),'utf8'));
const hengruiRestatement=JSON.parse(await fs.readFile(new URL('../fixtures/hengrui-2023-accounting-policy-restatement.json',import.meta.url),'utf8'));

it('preserves an explicit consolidated CAS-16 historical restatement bridge without promoting it to every historical metric',()=>{
 const parse=(document:typeof hengruiRestatement.document)=>parseCnDisclosureFacts(document,{sourceId:'hengrui-2023',basis:'CAS-FY2023'});
 const facts=parse(hengruiRestatement.document);
 for(const [metric,original,restated,adjustment] of [
  ['deferredTaxAssets',223_030_661.62,238_897_431.88,15_866_770.26],
  ['deferredTaxLiabilities',84_332_759.81,100_447_078.12,16_114_318.31],
  ['retainedEarnings',25_520_455_210.66,25_520_207_662.61,-247_548.05],
  ['incomeTaxExpense',153_421_215.81,153_350_539.23,-70_676.58],
 ] as const) {
  expect(facts.find(f=>f.field===`earnings.restatement.original.${metric}`)).toMatchObject({year:2022,value:original,unit:'CNY'});
  expect(facts.find(f=>f.field===`earnings.restatement.restated.${metric}`)).toMatchObject({year:2022,value:restated,unit:'CNY'});
  expect(facts.find(f=>f.field===`earnings.restatement.adjustment.${metric}`)).toMatchObject({year:2022,value:adjustment,unit:'CNY'});
 }
 const context=JSON.parse(String(facts.find(f=>f.field==='earnings.restatementContext')?.value));
 expect(context).toMatchObject({reportYear:2023,restatedYear:2022,scope:'consolidated',method:'retrospective',trigger:{kind:'accounting_policy_change',standard:'CAS-Interpretation-16',effectiveDate:'2023-01-01'}});
 expect(facts.find(f=>f.id===context.metrics.retainedEarnings.originalFactId)?.value).toBe(25_520_455_210.66);
 expect(facts.find(f=>f.field==='earnings.restatement.original.deferredTaxAssets')).toMatchObject({evidence:[{locator:'/pages/180/lines/5'}],reason:'explicit_consolidated_CAS_interpretation_16_restatement_bridge;original_reported;reported_unit:元人民币;unit_source:/pages/145/lines/3;precision:2'});
 expect(facts.find(f=>f.field==='earnings.restatement.original.incomeTaxExpense')).toMatchObject({evidence:[{locator:'/pages/180/lines/11'}],reason:'explicit_consolidated_CAS_interpretation_16_restatement_bridge;original_reported;reported_unit:元人民币;unit_source:/pages/147/lines/3;precision:2'});
 expect(facts.some(f=>['netProfit','parentProfit','equity','parentEquity'].includes(f.field)&&f.year===2022)).toBe(false);
 for(const fact of facts) for(const ref of fact.evidence) {
  const match=ref.locator.match(/^\/pages\/(\d+)\/(?:lines\/(\d+)|text)$/)!;
  expect(ref.raw).toBe(match[2]===undefined?hengruiRestatement.document.pages[match[1]].text:hengruiRestatement.document.pages[match[1]].lines[Number(match[2])]);
 }
 const wrongYear=structuredClone(hengruiRestatement.document);wrongYear.pages['180'].lines[3]=wrongYear.pages['180'].lines[3].replace('2022 年','2021 年');wrongYear.pages['180'].text=wrongYear.pages['180'].lines.join('\n');
 expect(parse(wrongYear).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
 const parent=structuredClone(hengruiRestatement.document);parent.pages['180'].lines[2]='母公司资产负债表项目';parent.pages['180'].text=parent.pages['180'].lines.join('\n');
 expect(parse(parent).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
 const arithmetic=structuredClone(hengruiRestatement.document);arithmetic.pages['180'].lines[5]=arithmetic.pages['180'].lines[5].replace('15,866,770.26','15,866,770.25');arithmetic.pages['180'].text=arithmetic.pages['180'].lines.join('\n');
 expect(parse(arithmetic).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
 const wrongUnit=structuredClone(hengruiRestatement.document);wrongUnit.pages['145'].lines[3]='单位:万元 币种:人民币';wrongUnit.pages['145'].text=wrongUnit.pages['145'].lines.join('\n');
 expect(parse(wrongUnit).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
 const bridgeUnitConflict=structuredClone(hengruiRestatement.document);bridgeUnitConflict.pages['180'].lines.splice(2,0,'单位:万元 币种:人民币');bridgeUnitConflict.pages['180'].text=bridgeUnitConflict.pages['180'].lines.join('\n');
 expect(parse(bridgeUnitConflict).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
 const wrongPosition=structuredClone(hengruiRestatement.document),dta=wrongPosition.pages['180'].lines[5];wrongPosition.pages['180'].lines[5]='';wrongPosition.pages['180'].lines.splice(12,0,dta);wrongPosition.pages['180'].text=wrongPosition.pages['180'].lines.join('\n');
 expect(parse(wrongPosition).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
 const wrongEffectiveDate=structuredClone(hengruiRestatement.document);wrongEffectiveDate.pages['179'].lines[5]=wrongEffectiveDate.pages['179'].lines[5].replace('2023年1月1日起施行','2024年1月1日起施行');wrongEffectiveDate.pages['179'].text=wrongEffectiveDate.pages['179'].lines.join('\n');
 expect(parse(wrongEffectiveDate).some(f=>f.field.startsWith('earnings.restatement'))).toBe(false);
});

it('preserves original business breakdowns and distinguishes products, internal eliminations and totals from group segments',()=>{
 const document=businessReports.find((r:{ticker:string})=>r.ticker==='600660').document;
 const facts=parseCnDisclosureFacts(document,{sourceId:'business-report',basis:'test'});
 const contextFact=facts.find(f=>f.field==='business.breakdown')!;
 expect(contextFact).toBeDefined();
 const context=JSON.parse(String(contextFact.value));
 expect(context).toMatchObject({scope:'main_business',dimension:'product'});
 expect(context.rows.map((r:{name:string;role:string})=>[r.name,r.role])).toEqual([['汽车玻璃','business'],['浮法玻璃','business'],['其他','business'],['减:集团内部抵销','elimination'],['合计','total']]);
 expect(facts.find(f=>f.id===context.rows[0].revenueFactId)).toMatchObject({field:'business.revenue',value:41889226037,unit:'CNY'});
 expect(facts.find(f=>f.id===context.rows[3].revenueFactId)?.value).toBe(-8007186332);
 expect(facts.find(f=>f.id===context.rows[4].costFactId)?.value).toBe(28498495232);
 expect(facts.some(f=>f.field==='scope.method' || f.field==='scope.cycle' || f.field==='business.profit')).toBe(false);
 expect(facts.filter(f=>f.field==='business.breakdown')).toHaveLength(1); // Region rows are not another set of business segments.
});

it('keeps industry and product axes separate and does not invent missing costs or currency in business tables',()=>{
 const document=businessReports.find((r:{ticker:string})=>r.ticker==='600276').document;
 const facts=parseCnDisclosureFacts(document,{sourceId:'business-report',basis:'test'});
 const contexts=facts.filter(f=>f.field==='business.breakdown').map(f=>JSON.parse(String(f.value)));
 expect(contexts.map(c=>[c.dimension,c.rows.length])).toEqual([['industry',1],['product',6]]);
 expect(facts.find(f=>f.id===contexts[0].rows[0].revenueFactId)?.value).toBe(28013448347.68);
 const missing=documentWith(['单位：万元 币种：人民币','主营业务分产品情况','分产品 营业收入 营业成本 毛利率','制造业务 200 — 50','其他业务 0 0 0','主营业务分地区情况']);
 const parsed=parseCnDisclosureFacts(missing,{sourceId:'missing-cost',basis:'test'});
 const table=JSON.parse(String(parsed.find(f=>f.field==='business.breakdown')?.value));
 expect(parsed.find(f=>f.id===table.rows[0].revenueFactId)?.value).toBe(2000000);
 expect(table.rows[0].costFactId).toBeUndefined();expect(parsed.find(f=>f.id===table.rows[1].costFactId)?.value).toBe(0);
 expect(parseCnDisclosureFacts(documentWith(missing.pages['1'].lines.map(l=>l.replace('币种：人民币','币种：美元'))),{sourceId:'dollars',basis:'test'}).some(f=>f.field.startsWith('business.'))).toBe(false);
 expect(parseCnDisclosureFacts(documentWith(missing.pages['1'].lines.map(l=>l.replace('营业收入 营业成本','营业成本 营业收入'))),{sourceId:'reordered',basis:'test'}).some(f=>f.field.startsWith('business.'))).toBe(false);
});

it('identifies the listed legal entity as licensed financial leasing from its basic disclosure, not its name or a subsidiary license',()=>{
 const lines=['江苏金融租赁股份有限公司','财务报表附注','一、公司基本情况','江苏金融租赁股份有限公司（以下简称“本公司”）。本公司持有','M0005H232010001 号金融许可证，统一社会信用代码为 913200001347585460。','本公司 A 股股票在上海证券交易所上市交易，股份代号为 600901。','本公司经原中国银行业监督管理委员会批准，按照《金融租赁公司管理办法》（国家金融监督管理总局令2024年第6号）的规定，其经营范围的业务为：融资租赁业务；转让和受让融资租赁资产。','二、财务报表的编制基础'];
 const parse=(rows:string[])=>parseCnDisclosureFacts({...documentWith(rows),entity:'600901'},{sourceId:'lease-report',basis:'test'});
 expect(parse(lines).find(f=>f.field==='business.licensedMethod')).toMatchObject({entity:'600901',year:2025,state:'observed',value:'financial_lease',evidence:[{sourceId:'lease-report',locator:'/pages/1/text',raw:lines.join('\n')}]});
 expect(parse(lines.map(l=>l.replace('本公司持有','子公司持有'))).some(f=>f.field==='business.licensedMethod')).toBe(false);
 expect(parse(lines.map(l=>l.replace('股份代号为 600901','股份代号为 600902'))).some(f=>f.field==='business.licensedMethod')).toBe(false);
 expect(parse(lines.filter(l=>!l.includes('金融租赁公司管理办法'))).some(f=>f.field==='business.licensedMethod')).toBe(false);
});

it('identifies a commercial bank only from its own charter, license and listed code in the basic disclosure',()=>{
 const lines=['宁波银行股份有限公司','财务报表附注','一、基本情况','1、公司的历史沿革','宁波银行股份有限公司（以下简称“本公司”）系经中国人民银行批准设立的股份制商业银行。','本公司在深圳证券交易所上市，股票代码“002142”。','本公司经原银监会批准领有00638363号金融许可证。','2、机构设置'];
 const parse=(rows:string[])=>parseCnDisclosureFacts({...documentWith(rows),entity:'002142'},{sourceId:'bank-report',basis:'test'});
 expect(parse(lines).find(f=>f.field==='business.licensedMethod')).toMatchObject({value:'bank',entity:'002142'});
 expect(parse(lines.map(l=>l.replace('本公司经原银监会批准领有','子公司经原银监会批准领有'))).some(f=>f.field==='business.licensedMethod')).toBe(false);
 expect(parse(lines.map(l=>l.replace('股份制商业银行','金融租赁公司'))).some(f=>f.field==='business.licensedMethod')).toBe(false);
});

it('extracts a broker’s comparable opening and closing risk table without inventing applicable requirements',()=>{
 const lines=['十三、母公司净资本及有关风险控制指标','单位：元','项目 2025 年末 2025 年初 本年末比本年初增减','风险覆盖率 373.25% 226.00% 上升 147.25 个百分点','资本杠杆率 40.52% 33.89% 上升 6.63 个百分点','流动性覆盖率 392.92% 217.37% 上升 175.55 个百分点','净稳定资金率 230.89% 172.57% 上升 58.32 个百分点','备注：2025 年初相关数据已根据 2025 年 1 月 1 日执行的《证券公司风险控制指标计算标准规定》（证监会公告〔2024〕13 号）口径进行调整。'];
 const document={entity:'002945',periodEnd:'2025-12-31',publishedAt:'2026-04-28',pages:{'18':{text:lines.join('\n'),lines}}};
 const facts=parseCnDisclosureFacts(document,{sourceId:'broker-report',basis:'test'});
 expect(facts.find(f=>f.field==='business.licensedMethod')?.value).toBe('broker');
 expect(facts.find(f=>f.field==='regulatory.actual.riskCoverage' && f.year===2025)).toMatchObject({value:3.7325,unit:'ratio',evidence:[{sourceId:'broker-report',locator:'/pages/18/lines/3',raw:lines[3]}]});
 const contexts=facts.filter(f=>f.field==='regulatory.context').map(f=>JSON.parse(String(f.value)));
 expect(contexts).toHaveLength(2);
 expect(contexts.find(c=>c.position==='opening')).toMatchObject({subject:'002945',scope:'legal_entity',regime:'CSRC-2024-13',reportYear:2025});
 expect(facts.filter(f=>f.field.startsWith('regulatory.requirement.'))).toEqual([]);
 lines[0]='合并口径风险指标';document.pages['18'].text=lines.join('\n');
 expect(parseCnDisclosureFacts(document,{sourceId:'broker-report',basis:'test'}).filter(f=>f.field==='regulatory.context')).toEqual([]);
});

it('distinguishes explicit absent borrowing from remaining lease debt in a second real disclosure', () => {
  const facts = parseCnDisclosureFacts(hengrui.document, { sourceId: 'hengrui-report', basis: 'CAS-FY2025' });
  for (const field of ['shortBorrowings', 'longBorrowings', 'bondsPayable', 'notesPayable', 'longPayables']) {
    expect(facts.find(f => f.field === `${field}AbsentAtYearEnd`), field).toMatchObject({ year: 2025, value: true });
    expect(facts.some(f => f.field === `${field}AbsentAtYearEnd` && f.year === 2024)).toBe(false);
  }
  expect(facts.find(f => f.field === 'leaseLiabilities' && f.year === 2025)?.value).toBe(43_307_401.28);
  expect(facts.find(f => f.field === 'currentLeaseLiabilities' && f.year === 2025)?.value).toBe(30_925_675.25);
  expect(facts.find(f => f.field === 'derecognizedBills')).toMatchObject({year:2025,value:5_036_746_990.24,period:{start:'2025-12-31',end:'2025-12-31'}});
  expect(facts.some(f => ['debt', 'additionalFinancing', 'availableCash'].includes(f.field))).toBe(false);
  for (const fact of facts) for (const ref of fact.evidence) {
    const [, , page, , line] = ref.locator.split('/');
    expect(ref.raw).toBe(hengrui.document.pages[page].lines[Number(line)]);
  }
});

it('preserves all reported business segments and signed profit without treating them as the licensed-entity inventory',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/business-segment-lines.json',import.meta.url),'utf8'));
 const bank=fixture[0].document,facts=parseCnDisclosureFacts(bank,{sourceId:'bank-segments',basis:'test'});
 const current=facts.find(f=>f.field==='business.segments' && f.year===2025),prior=facts.find(f=>f.field==='business.segments' && f.year===2024);
 expect(current).toBeDefined();expect(prior).toBeDefined();
 const context=JSON.parse(String(current!.value));
 expect(context).toMatchObject({scope:'reported_segments',declaredCount:4});
 expect(context.rows.map((r:{name:string})=>r.name)).toEqual(['公司业务','个人业务','资金业务','其他业务']);
 expect(facts.find(f=>f.id===context.rows[2].assetsFactId)).toMatchObject({value:1870745000000,unitScale:1000000,evidence:[{sourceId:'bank-segments',locator:'/pages/186/lines/30'}]});
 expect(facts.find(f=>f.id===JSON.parse(String(prior!.value)).rows[3].profitFactId)).toMatchObject({value:-461000000});
 expect(facts.some(f=>f.field.startsWith('scope.') || f.field==='business.licensedMethod')).toBe(false);
 const withoutUnit=structuredClone(bank);delete withoutUnit.pages['100'];
 expect(parseCnDisclosureFacts(withoutUnit,{sourceId:'bank-segments',basis:'test'}).some(f=>f.field==='business.segmentAssets')).toBe(false);
});

it('records an explicit single operating segment without inferring the absence of licensed subsidiaries or exposures',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/business-segment-lines.json',import.meta.url),'utf8'));
 const document=fixture[1].document,parse=()=>parseCnDisclosureFacts(document,{sourceId:'lease-segments',basis:'test'});
 const fact=parse().find(f=>f.field==='business.segments');
 expect(fact).toBeDefined();expect(JSON.parse(String(fact!.value))).toMatchObject({scope:'reported_segments',declaredCount:1,rows:[{name:'租赁业务'}]});
 expect(parse().some(f=>f.field.startsWith('scope.') || f.field==='business.licensedMethod')).toBe(false);
 document.pages['115'].lines[14]=document.pages['115'].lines[14].replace('本集团专注于','子公司专注于');
 document.pages['115'].text=document.pages['115'].lines.join('\n');
 expect(parse().some(f=>f.field==='business.segments')).toBe(false);
});

it('does not apply a report-wide RMB unit to a segment table with a different local currency',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/business-segment-lines.json',import.meta.url),'utf8'));
 const document=fixture[0].document;
 document.pages['186'].lines[16]='单位：美元';document.pages['186'].text=document.pages['186'].lines.join('\n');
 const facts=parseCnDisclosureFacts(document,{sourceId:'segment-unit',basis:'test'});
 expect(facts.some(f=>f.field==='business.segmentAssets')).toBe(false);
});

function documentWith(lines: string[]) {
  return { entity: 'TEST', periodEnd: '2025-12-31', publishedAt: '2026-03-18', pages: { '1': { text: lines.join('\n'), lines } } };
}

// Ningbo FY2025 annual report, PDF page 10 (printed page 9).
const bankRatios = ['四、补充财务指标', '监管指标 监管标准 2025 年 12 月 31 日 2024 年 12 月 31 日 2023 年 12 月 31 日',
  '资本充足率(%) ≥10.75 14.30 15.32 15.01', '一级资本充足率(%) ≥8.75 10.40 11.03 11.01',
  '核心一级资本充足率(%) ≥7.75 9.34 9.84 9.64', '流动性比率(本外币)(%) ≥25 81.28 94.09 84.28',
  '流动性覆盖率(%) ≥100 144.79 190.00 244.48', '不良贷款比率(%) ≤5 0.76 0.76 0.76', '拨备覆盖率(%) ≥150 373.16 389.35 461.04'];

it('preserves bank regulatory actuals and explicitly reported standards without claiming an unresolved scope or regime', () => {
  const facts = parseCnDisclosureFacts(documentWith(bankRatios), {sourceId:'bank',basis:'test'});
  for (const [metric,value] of Object.entries({cet1:0.0934,tier1:0.104,totalCapital:0.143,liquidityRatio:0.8128,lcr:1.4479,loanNpl:0.0076,loanProvisionCoverage:3.7316})) {
    const fact=facts.find(f=>f.field===`regulatory.actual.${metric}` && f.year===2025);
    expect(fact,metric).toMatchObject({unit:'ratio'});
    expect(fact?.value,metric).toBeCloseTo(value,10);
  }
  expect(facts.find(f=>f.field==='regulatory.actual.loanProvisionCoverage' && f.year===2023)?.value).toBe(4.6104);
  expect(facts.find(f=>f.field==='regulatory.requirement.cet1' && f.year===2025)).toMatchObject({value:0.0775});
  expect(facts.find(f=>f.field==='regulatory.requirement.loanNpl')?.reason).toContain('direction:maximum');
  expect(facts.find(f=>f.field==='reportedFinancial.lcr' && f.year===2025)).toMatchObject({value:1.4479,unit:'ratio',evidence:[{sourceId:'bank',locator:'/pages/1/lines/6',raw:bankRatios[6]}]});
  expect(facts.find(f=>f.field==='reportedFinancial.requirement.lcr' && f.year===2025)).toMatchObject({value:1,reason:expect.stringContaining('direction:minimum')});
  // The undated standards column is not proof of the applicable requirements in earlier years.
  expect(facts.filter(f=>f.field.startsWith('regulatory.requirement.')).every(f=>f.year===2025)).toBe(true);
  expect(facts.some(f=>f.field==='regulatory.context' || f.field.startsWith('scope.'))).toBe(false);
});

// Jiangsu Financial Leasing FY2025, PDF page 14 (printed page 13).
const leaseRatios=['( 二 ) 主要财务指标','主要财务指标 2025 年 2024 年 本期比上年同期增减 (%) 2023 年',
  '2025 年末 2024 年末 本期末比上年同期末增减 2023 年末','资本充足率和杠杆率指标',
  '资本充足率（%） 16.90 19.08 减少 2.18 个百分点 15.70','一级资本充足率（%） 15.70 17.92 减少 2.22 个百分点 14.55',
  '核心一级资本充足率（%） 15.68 17.91 减少 2.23 个百分点 14.55','融资租赁资产质量指标',
  '不良融资租赁资产率（%） 0.88 0.91 减少 0.03 个百分点 0.91','拨备覆盖率（%） 421.22 430.27 减少 9.05 个百分点 448.39'];

it('reads lease credit metrics across a change column without inventing a licence, requirements or loan metrics',()=>{
  const facts=parseCnDisclosureFacts(documentWith(leaseRatios),{sourceId:'lease',basis:'test'});
  expect(facts.find(f=>f.field==='regulatory.actual.leaseNpl' && f.year===2025)?.value).toBeCloseTo(0.0088,10);
  expect(facts.find(f=>f.field==='reportedFinancial.leaseNpl' && f.year===2025)).toMatchObject({value:0.0088,unit:'ratio',evidence:[{sourceId:'lease',locator:'/pages/1/lines/8',raw:leaseRatios[8]}]});
  expect(facts.filter(f=>f.field.startsWith('reportedFinancial.'))).toHaveLength(6);
  expect(facts.find(f=>f.field==='regulatory.actual.leaseProvisionCoverage' && f.year===2023)?.value).toBeCloseTo(4.4839,10);
  expect(facts.find(f=>f.field==='regulatory.actual.cet1' && f.year===2024)?.value).toBeCloseTo(0.1791,10);
  expect(facts.some(f=>f.field.startsWith('regulatory.requirement.') || f.field.includes('loan') || f.field==='regulatory.context' || f.field.startsWith('scope.') || f.field.includes('license'))).toBe(false);
});

// Ningbo PDF pages 184–185; the requirement sentence wraps across lines.
const bankCapitalBasis=['七、 资本管理','自2024年起，本集团按照《商业银行资本管理办法》规定，进行资本充足率信息',
  '披露工作并持续完善信息披露内容。根据上述要求，其核',
  '心一级资本充足率不得低于7.75%，一级资本充足率不得低于8.75%，资本充足率',
  '不得低于10.75%。本报告期内，本集团遵守了监管部门规定的资本要求。',
  '本集团按照《商业银行资本管理办法》及其他相关规定计算的核心一级资本充足',
  '率、一级资本充足率及资本充足率如下：'];
const bankCapitalRows=['七、 资本管理 (续)','2025 年 12 月 31 日 2024 年 12 月 31 日',
  '核心一级资本充足率 9.34% 9.84%','一级资本充足率 10.40% 11.03%','资本充足率 14.30% 15.32%'];
function pagesDocument(pages:Record<string,string[]>) {
  return {...documentWith([]),pages:Object.fromEntries(Object.entries(pages).map(([page,lines])=>[page,{text:lines.join('\n'),lines}]))};
}

it('binds a bank capital table to its contiguous group regime and current applicable requirements, leaving liquidity unresolved',()=>{
  const facts=parseCnDisclosureFacts(pagesDocument({'184':bankCapitalBasis,'185':bankCapitalRows}),{sourceId:'bank-capital',basis:'test'});
  const current=facts.find(f=>f.field==='regulatory.context' && f.year===2025);
  expect(current).toBeDefined();
  const context=JSON.parse(String(current!.value));
  expect(context).toMatchObject({subject:'TEST',scope:'regulatory_consolidated',reportYear:2025,position:'closing',liquidityMetrics:[]});
  expect(facts.find(f=>f.id===context.metrics.cet1.actualFactId)?.value).toBeCloseTo(0.0934,10);
  expect(facts.find(f=>f.id===context.metrics.cet1.requirementFactId)?.value).toBeCloseTo(0.0775,10);
  expect(facts.find(f=>f.id===context.metrics.totalCapital.requirementFactId)?.value).toBeCloseTo(0.1075,10);
  const historical=JSON.parse(String(facts.find(f=>f.field==='regulatory.context' && f.year===2024)!.value));
  expect(historical.metrics.cet1.requirementFactId).toBeUndefined();
  expect(context.metrics.loanNpl).toBeUndefined();
});

it('retains an annual NSFR from its formal table without turning a September observation into last year or inventing a minimum',()=>{
  // Ningbo PDF page 38. The opening prose is deliberately less precise.
  const lines=['3、净稳定资金比例','截至 2025 年末，公司净稳定资金比例约103%。',
    '项目 2025 年 12 月 31 日 2025 年 9 月 30 日','可用的稳定资金 1,837,491 1,840,521',
    '所需的稳定资金 1,780,594 1,728,861','净稳定资金比例 103.20% 106.46%'];
  const facts=parseCnDisclosureFacts(documentWith(lines),{sourceId:'nsfr',basis:'test'});
  expect(facts.filter(f=>f.field==='regulatory.actual.nsfr')).toHaveLength(1);
  expect(facts.find(f=>f.field==='regulatory.actual.nsfr')).toMatchObject({year:2025,value:1.032,evidence:[{locator:'/pages/1/lines/5',raw:lines[5]}]});
  expect(facts.find(f=>f.field==='reportedFinancial.nsfr')).toMatchObject({year:2025,value:1.032,evidence:[{locator:'/pages/1/lines/5',raw:lines[5]}],reason:expect.stringContaining('reported_bank_liquidity_ratio;scope_not_asserted')});
  expect(facts.some(f=>f.field==='regulatory.context' || f.field.startsWith('regulatory.requirement.'))).toBe(false);
});

it('preserves actual bank values when its reported standard is blank and binds reordered years to their columns',()=>{
  const lines=bankRatios.map(l=>l.replace('≥7.75','—').replace('2025 年 12 月 31 日 2024 年 12 月 31 日','2024 年 12 月 31 日 2025 年 12 月 31 日'));
  const facts=parseCnDisclosureFacts(documentWith(lines),{sourceId:'unknown-standard',basis:'test'});
  expect(facts.find(f=>f.field==='regulatory.actual.cet1' && f.year===2025)?.value).toBeCloseTo(0.0984,10);
  expect(facts.some(f=>f.field==='regulatory.requirement.cet1')).toBe(false);
});

it('does not supply a percent unit from an equal adjacent capital cell',()=>{
  const lines=bankCapitalRows.map(l=>l.replace('9.34% 9.84%','9.34 9.34%'));
  const facts=parseCnDisclosureFacts(pagesDocument({'184':bankCapitalBasis,'185':lines}),{sourceId:'missing-percent',basis:'test'});
  expect(facts.some(f=>f.field==='regulatory.actual.cet1')).toBe(false);
});

it('does not carry a group capital basis into an explicitly parent-only table on the next page',()=>{
  for(const title of ['母公司资本管理','母公司资本管理（续）']) {
    const facts=parseCnDisclosureFacts(pagesDocument({'184':bankCapitalBasis,'185':[title,...bankCapitalRows.slice(1)]}),{sourceId:'scope-switch',basis:'test'});
    expect(facts.find(f=>f.field==='regulatory.actual.cet1')?.value).toBeCloseTo(0.0934,10);
    expect(facts.some(f=>f.field==='regulatory.context')).toBe(false);
  }
});

it('keeps explicitly disclosed capital minima as raw facts when the note lacks a verified regime',()=>{
  const basis=bankCapitalBasis.map(l=>l.replaceAll('《商业银行资本管理办法》','相关规定'));
  const facts=parseCnDisclosureFacts(pagesDocument({'184':basis,'185':bankCapitalRows}),{sourceId:'missing-regime',basis:'test'});
  expect(facts.find(f=>f.field==='regulatory.requirement.cet1')?.value).toBeCloseTo(0.0775,10);
  expect(facts.find(f=>f.field==='regulatory.actual.cet1')?.value).toBeCloseTo(0.0934,10);
  expect(facts.some(f=>f.field==='regulatory.context')).toBe(false);
});

it('reads the real lease capital note with wrapped annual dates and its explicit 2023 regime, without requirements or liquidity exemptions',()=>{
  // Jiangsu Financial Leasing PDF page 214 (financial supplement page 135).
  const lines=['3、 资本管理','本集团依据国家金融监督管理总局 2023 年 10 月下发的《商业银行资本管理办法》(2023 年第',
    '4 号) 计算的资本充足率如下：','本集团','2025 年','12 月 31 日','2024 年','12 月 31 日',
    '核心一级资本充足率 15.68% 17.91%','一级资本充足率 15.70% 17.92%','资本充足率 16.90% 19.08%'];
  const document=pagesDocument({'214':lines});
  const facts=parseCnDisclosureFacts(document,{sourceId:'lease-capital',basis:'test'});
  const contexts=facts.filter(f=>f.field==='regulatory.context').map(f=>JSON.parse(String(f.value)));
  expect(contexts).toHaveLength(2);
  expect(contexts[0]).toMatchObject({regime:'NFRA-2023-4',scope:'regulatory_consolidated',liquidityMetrics:[]});
  expect(facts.find(f=>f.field==='regulatory.actual.totalCapital' && f.year===2024)?.value).toBeCloseTo(0.1908,10);
  expect(facts.some(f=>f.field.startsWith('regulatory.requirement.') || f.field.startsWith('scope.'))).toBe(false);
  for(const fact of facts) for(const ref of fact.evidence) {
    const match=ref.locator.match(/^\/pages\/(\d+)\/(?:lines\/(\d+)|text)$/)!;
    expect(ref.raw).toBe(match[2]===undefined?document.pages[match[1]].text:document.pages[match[1]].lines[Number(match[2])]);
  }
});

it('keeps ambiguous dates, absent percent units and missing capital context separate from valid year-end raw observations',()=>{
  for(const lines of [bankRatios.map(l=>l.replaceAll('(%)','')),bankRatios.slice(2)]) {
    expect(parseCnDisclosureFacts(documentWith(lines),{sourceId:'invalid-table',basis:'test'})).toEqual([]);
  }
  for(const document of [pagesDocument({'183':bankCapitalBasis,'185':bankCapitalRows}),pagesDocument({'185':bankCapitalRows})]) {
    const facts=parseCnDisclosureFacts(document,{sourceId:'missing-page',basis:'test'});
    expect(facts.find(f=>f.field==='regulatory.actual.cet1')?.value).toBeCloseTo(0.0934,10);
    expect(facts.some(f=>f.field==='regulatory.context')).toBe(false);
  }
  // Ningbo PDF page 43 has two scopes per year. A two-column reader must not choose the parent cell as prior-year data.
  const mixed=['（一）资本充足率情况','项目 2025 年 12 月 31 日 2024 年 12 月 31 日','并表 非并表 并表 非并表',
    '5.核心一级资本充足率 9.34% 8.71% 9.84% 9.28%'];
  expect(parseCnDisclosureFacts(documentWith(mixed),{sourceId:'mixed-scopes',basis:'test'})).toEqual([]);
});

it('extracts both dated consolidated cash columns from real report lines, including a wrapped capex label', () => {
  const facts = parseCnDisclosureFacts(fixture.document, { sourceId: 'fuyao-report', basis: 'FY2025-disclosure' });
  expect(facts.find(f => f.field === 'operatingCashFlow' && f.year === 2025)).toMatchObject({ value: 12_055_090_552, entity: '600660', publishedAt: '2026-03-18', unit: 'CNY' });
  expect(facts.find(f => f.field === 'capex' && f.year === 2025)).toMatchObject({ value: 6_164_082_209, period: { start: '2025-01-01', end: '2025-12-31' } });
  expect(facts.find(f => f.field === 'capex' && f.year === 2024)?.value).toBe(5_480_872_166);
  for (const fact of facts) for (const ref of fact.evidence) {
    const [, , page, , line] = ref.locator.split('/');
    expect(ref.raw).toBe(fixture.document.pages[page].lines[Number(line)]);
  }
});

it('does not mistake a bare numeric note plus one reported amount for two annual amounts', () => {
  const document = documentWith(['合并现金流量表', '单位：元 币种：人民币', '项目 附注 2025年度 2024年度', '经营活动产生的现金流量净额 7 12,000']);
  expect(parseCnDisclosureFacts(document, { sourceId: 'ambiguous-note', basis: 'test' })).toEqual([]);
});

it('keeps consolidated profit, equity and financing components distinct from parent-only tables and empty rows', () => {
  const facts = parseCnDisclosureFacts(fixture.document, { sourceId: 'fuyao-report', basis: 'FY2025-disclosure' });
  const values: Record<string, number> = { netProfit: 9_316_796_494, parentProfit: 9_312_304_150, equity: 37_552_160_390, parentEquity: 37_556_465_111, assets: 70_062_354_686, shortBorrowings: 7_609_694_417, longBorrowings: 3_669_044_516, leaseLiabilities: 378_561_402, notesPayable: 4_199_931_921, currentNoncurrentLiabilities: 5_232_452_147, interestExpense: 321_414_072, creditImpairment: 3_034_781, assetImpairment: -13_790_829 };
  for (const [field, value] of Object.entries(values)) {
    const observations=facts.filter(f=>f.field===field && f.year===2025);
    expect(observations.length,field).toBeGreaterThan(0);
    expect(observations.every(f=>f.value===value),field).toBe(true);
  }
  expect(facts.find(f => f.field === 'equity')?.period.start).toBe('2025-12-31');
  expect(facts.some(f => f.field === 'bondsPayable')).toBe(false); // Report is blank, not zero.
  expect(facts.some(f => ['debt', 'bookDebt', 'availableCash', 'ordinaryEquity'].includes(f.field))).toBe(false);
});

it('reads financing note balances without adding inclusive totals or treating an ambiguous payable as debt',()=>{
  const facts=parseCnDisclosureFacts(fixture.document,{sourceId:'fuyao-report',basis:'CAS-FY2025'});
  const expected={currentBorrowings:5_081_033_177,currentLeaseLiabilities:145_728_540,currentLongPayables:5_690_430,otherCurrentLiabilities:604_338_794,longPayables:48_164_622};
  for(const [field,value] of Object.entries(expected)) {
    expect(facts.filter(f=>f.field===field && f.year===2025)).toEqual(expect.arrayContaining([expect.objectContaining({value,period:{start:'2025-12-31',end:'2025-12-31'},unit:'CNY'})]));
  }
  expect(facts.find(f=>f.field==='bondsPayableAbsentAtYearEnd')).toMatchObject({value:true,unit:'boolean',year:2025});
  expect(facts.some(f=>['currentFinancingLiabilities','noncurrentFinancingPayables','debt'].includes(f.field))).toBe(false);
  const noUnit=structuredClone(fixture.document);
  noUnit.pages['145'].lines=noUnit.pages['145'].lines.map((line:string)=>line.includes('单位：')?'':line);
  expect(parseCnDisclosureFacts(noUnit,{sourceId:'missing-unit',basis:'CAS'}).some(f=>f.field==='currentBorrowings')).toBe(false);
  const parent=structuredClone(fixture.document);parent.pages['145'].lines.splice(2,0,'十九、母公司财务报表项目注释');
  expect(parseCnDisclosureFacts(parent,{sourceId:'parent',basis:'CAS'}).some(f=>f.field==='currentBorrowings')).toBe(false);
});

it('requires an explicit consolidated header, currency, unit and two dated columns, and resets across missing pages', () => {
  const valid = ['合并现金流量表', '单位：元 币种：人民币', '项目 2025年度 2024年度', '经营活动产生的现金流量净额 10.00 8.00'];
  for (const lines of [valid.slice(1), valid.filter((_, i) => i !== 1), valid.filter((_, i) => i !== 2), valid.map(l => l.replace('人民币', '美元')), valid.map(l => l.replace('2024年度', '2023年度')), valid.map(l => l.replace('合并', '母公司')), valid.map(l => l.replace('10.00 8.00', '8.00')), valid.map(l => l.replace('10.00 8.00', '— 8.00'))]) {
    expect(parseCnDisclosureFacts(documentWith(lines), { sourceId: 'ambiguous', basis: 'test' })).toEqual([]);
  }
  const doc = documentWith(valid.slice(0, 3));
  Object.assign(doc.pages, { '3': { text: valid[3], lines: [valid[3]] } });
  expect(parseCnDisclosureFacts(doc, { sourceId: 'gap', basis: 'test' })).toEqual([]);
});

it('binds the actual header order and reported scale, retaining explicit zero and signed impairment', () => {
  const document = documentWith(['合并利润表', '单位：万元 币种：人民币', '项目 2024年度 2025年度', '五、净利润 2.00 3.00', '信用减值损失（损失以“-”号填列） 0 −1.50']);
  const facts = parseCnDisclosureFacts(document, { sourceId: 'scale', basis: 'test' });
  expect(facts.find(f => f.field === 'netProfit' && f.year === 2025)).toMatchObject({ value: 30_000, unitScale: 10_000 });
  expect(facts.find(f => f.field === 'netProfit' && f.year === 2024)?.value).toBe(20_000);
  expect(facts.find(f => f.field === 'creditImpairment' && f.year === 2024)?.value).toBe(0);
  expect(facts.find(f => f.field === 'creditImpairment' && f.year === 2025)?.value).toBe(-15_000);
});

it('reads explicitly stated CAS ordinary-share profit without using adjacent IFRS or parent-only profit', () => {
  const facts = parseCnDisclosureFacts(fixture.document, { sourceId: 'fuyao-report', basis: 'CAS-FY2025' });
  expect(facts.filter(f => f.field === 'ordinaryProfit')).toHaveLength(1);
  expect(facts.find(f => f.field === 'ordinaryProfit')).toMatchObject({
    entity: '600660', year: 2025, value: 9_312_304_150, unit: 'CNY', unitScale: 1,
    period: { start: '2025-01-01', end: '2025-12-31' }, publishedAt: '2026-03-18',
    evidence: [{ sourceId: 'fuyao-report', locator: '/pages/2/lines/12', raw: fixture.document.pages['2'].lines[12] }],
  });
  expect(facts.some(f => f.field.startsWith('scope.'))).toBe(false);
});

it('separates reported year-end absence from absence throughout the year, with explicit changes evidence', () => {
  const facts = parseCnDisclosureFacts(fixture.document, { sourceId: 'fuyao-report', basis: 'CAS-FY2025' });
  expect(facts.find(f => f.field === 'nonordinaryEquityAbsentAtYearEnd')).toMatchObject({
    entity: '600660', year: 2025, value: true, unit: 'boolean', period: { start: '2025-12-31', end: '2025-12-31' },
    evidence: [{ locator: '/pages/149/lines/30', raw: fixture.document.pages['149'].lines[30] }],
  });
  expect(facts.find(f => f.field === 'nonordinaryClaimsAbsentDuringYear')).toMatchObject({
    entity: '600660', year: 2025, value: true, unit: 'boolean', period: { start: '2025-01-01', end: '2025-12-31' },
    evidence: [{ locator: '/pages/149/lines/34', raw: fixture.document.pages['149'].lines[34] }],
  });
  const yearEndOnly = structuredClone(fixture.document);
  yearEndOnly.pages['149'].lines = yearEndOnly.pages['149'].lines.map((line: string, i: number) => i >= 31 && i <= 34 ? '' : line);
  const limited = parseCnDisclosureFacts(yearEndOnly, { sourceId: 'year-end-only', basis: 'CAS-FY2025' });
  expect(limited.find(f => f.field === 'nonordinaryEquityAbsentAtYearEnd')?.value).toBe(true);
  expect(limited.find(f => f.field === 'nonordinaryClaimsAbsentDuringYear')).toBeUndefined();
});

it('does not reconstruct ordinary profit without the dated CAS sentence, its amount unit, or the complete local passage', () => {
  for (const replace of [
    (line: string) => line.replace('中国企业会计准则', '国际财务报告会计准则'),
    (line: string) => line.replace('2025年度', '2024年度'),
    (line: string) => line.replace('9,312,304,150元', '9,312,304,150'),
    (line: string) => line.replace('人民币9,312,304,150', '港币9,312,304,150'),
    (line: string) => line.includes('中国企业会计准则') ? '' : line,
  ]) {
    const document = structuredClone(fixture.document);
    document.pages['2'].lines = document.pages['2'].lines.map(replace);
    expect(parseCnDisclosureFacts(document, { sourceId: 'incomplete', basis: 'CAS' }).filter(f => f.field === 'ordinaryProfit')).toEqual([]);
  }
  const missing = structuredClone(fixture.document);
  delete missing.pages['2'];
  expect(parseCnDisclosureFacts(missing, { sourceId: 'missing-page', basis: 'CAS' }).some(f => f.field === 'ordinaryProfit')).toBe(false);
  const split = structuredClone(fixture.document);
  split.pages['3'] = { text: split.pages['2'].lines[12], lines: [split.pages['2'].lines[12]] };
  split.pages['2'].lines[12] = '';
  expect(parseCnDisclosureFacts(split, { sourceId: 'split-page', basis: 'CAS' }).some(f => f.field === 'ordinaryProfit')).toBe(false);
});

it('does not infer annual absence from blank, stale, conflicting, or only year-end disclosures', () => {
  for (const position of [31, 32, 33, 34]) {
    const document = structuredClone(fixture.document);
    document.pages['149'].lines[position] = '';
    const facts = parseCnDisclosureFacts(document, { sourceId: 'incomplete-changes', basis: 'CAS' });
    expect(facts.find(f => f.field === 'nonordinaryEquityAbsentAtYearEnd')?.value).toBe(true);
    expect(facts.some(f => f.field === 'nonordinaryClaimsAbsentDuringYear')).toBe(false);
  }
  for (const change of [
    (lines: string[]) => { lines[0] = lines[0].replace('2025', '2024'); },
    (lines: string[]) => { lines[28] = ''; },
    (lines: string[]) => { lines[30] = ''; },
    (lines: string[]) => { lines[30] = '√适用 √不适用'; },
  ]) {
    const document = structuredClone(fixture.document);
    change(document.pages['149'].lines);
    expect(parseCnDisclosureFacts(document, { sourceId: 'unproved', basis: 'CAS' }).some(f => f.field.startsWith('nonordinary'))).toBe(false);
  }
  const missing = structuredClone(fixture.document);
  delete missing.pages['149'];
  expect(parseCnDisclosureFacts(missing, { sourceId: 'missing-page', basis: 'CAS' }).some(f => f.field.startsWith('nonordinary'))).toBe(false);
});

it('rejects a parent-company note with the same title and checkboxes', () => {
  const parentOnly = structuredClone(fixture.document);
  parentOnly.pages['149'].lines.splice(28, 0, '十九、母公司财务报表主要项目注释');
  expect(parseCnDisclosureFacts(parentOnly, { sourceId: 'parent-note', basis: 'CAS' }).some(f => f.field.startsWith('nonordinary'))).toBe(false);
});

it('requires continuous CAS-to-consolidated-note context and invalidates it on an IFRS switch', () => {
  const disconnected = structuredClone(fixture.document);
  disconnected.pages = { '149': disconnected.pages['149'] };
  expect(parseCnDisclosureFacts(disconnected, { sourceId: 'selected-note', basis: 'CAS' }).some(f => f.field.startsWith('nonordinary'))).toBe(false);
  for (const mutate of [
    (document: typeof fixture.document) => { delete document.pages['120']; },
    (document: typeof fixture.document) => { document.pages['96'].lines = document.pages['96'].lines.map((line: string) => line.includes('遵循企业会计准则') ? '' : line); },
    (document: typeof fixture.document) => { document.pages['116'].lines[2] = ''; },
    (document: typeof fixture.document) => { document.pages['148'].lines.push('按国际财务报告会计准则编制的财务报表附注'); },
  ]) {
    const document = structuredClone(fixture.document);
    mutate(document);
    expect(parseCnDisclosureFacts(document, { sourceId: 'unverified-scope', basis: 'CAS' }).some(f => f.field.startsWith('nonordinary'))).toBe(false);
  }
  const valid = parseCnDisclosureFacts(fixture.document, { sourceId: 'verified-context', basis: 'CAS' });
  expect(valid.find(f => f.field === 'nonordinaryEquityAbsentAtYearEnd')?.reason).toContain('CAS_declaration:/pages/96/lines/13;consolidated_notes:/pages/116/lines/2;continuous_pages_to:149');
});

it('reads reported ordinary-shareholder ROE from the CAS supplementary table without deriving it from EPS or parent equity',async()=>{
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/ordinary-return-pages.json',import.meta.url),'utf8'));
 for(const [i,document] of reports.slice(0,2).entries()) {
  const parse=(d:typeof document)=>parseCnDisclosureFacts(d,{sourceId:'ordinary-return-report',basis:'test'});
  const facts=parse(document),context=facts.find(f=>f.field==='earnings.returnContext');
  expect(facts.find(f=>f.field==='weightedRoe')).toMatchObject({year:2025,unit:'ratio',value:i===0?0.2556:0.1426});
  expect(facts.find(f=>f.field==='adjustedWeightedRoe')?.value).toBeCloseTo(i===0?0.2516:0.1371,12);
  expect(JSON.parse(String(context?.value))).toMatchObject({accountingStandard:'CAS',shareholderScope:'ordinary',reportYear:2025});
  expect(facts.some(f=>f.field==='scope.earnings')).toBe(false); // Annual scope is not a multi-year comparability approval.
  const wrong=structuredClone(document),tablePage=i===0?'188':'236';
  wrong.pages[tablePage].text=wrong.pages[tablePage].text.replace('益率（%）','益率（元）');wrong.pages[tablePage].lines=wrong.pages[tablePage].text.split('\n');
  expect(parse(wrong).some(f=>f.field==='weightedRoe')).toBe(false);
  const noDeclaration=structuredClone(document);delete noDeclaration.pages[i===0?'96':'145'];
  expect(parse(noDeclaration).some(f=>f.field==='earnings.returnContext')).toBe(false);
 }
});

it('rejects an ordinary-return table after a local IFRS or numbered parent-scope switch and never borrows a later CAS declaration',async()=>{
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/ordinary-return-pages.json',import.meta.url),'utf8'));
 const original=reports[1],parse=(d:typeof original)=>parseCnDisclosureFacts(d,{sourceId:'return-scope',basis:'test'});
 for(const inserted of ['按国际财务报告会计准则编制的补充资料','二十一、母公司财务报表补充资料']) {
  const d=structuredClone(original);d.pages['236'].text=d.pages['236'].text.replace('2、 \t净资产收益率及每股收益',inserted+'\n2、 \t净资产收益率及每股收益');d.pages['236'].lines=d.pages['236'].text.split('\n');
  expect(parse(d).some(f=>['weightedRoe','adjustedWeightedRoe','earnings.returnContext'].includes(f.field)),inserted).toBe(false);
 }
 const after=structuredClone(original);after.pages['237']=after.pages['145'];delete after.pages['145'];
 expect(parse(after).some(f=>['weightedRoe','adjustedWeightedRoe','earnings.returnContext'].includes(f.field))).toBe(false);
});

it('normalizes the same reported ROE consistently across an original PDF and structured statement source',async()=>{
 const {parseCnStatementFacts}=await import('../../src/cn/sources/market-data.js');
 const [original]=JSON.parse(await fs.readFile(new URL('../fixtures/ordinary-return-pages.json',import.meta.url),'utf8'));
 // 12.06 also occurs in the actual 2020 report: division and multiplication can differ by one ULP.
 for(const reported of [25.56,12.06]) {
  const document=structuredClone(original);document.pages['188'].text=document.pages['188'].text.replace('25.56',String(reported));document.pages['188'].lines=document.pages['188'].text.split('\n');
  const pdf=parseCnDisclosureFacts(document,{sourceId:'pdf',basis:'test'});
  const source=parseCnStatementFacts({data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-18',CURRENCY:'CNY',ROEJQ:reported,ROEKCJQ:25.16}]},{sourceId:'structured',entity:'600660',basis:'test',kind:'indicators'});
  for(const field of ['weightedRoe','adjustedWeightedRoe'])expect(pdf.find(f=>f.field===field)?.value).toBe(source.find(f=>f.field===field)?.value);
 }
});

it('reads earlier report numbering and a BSE dated-note return table while keeping shareholder and annual scope explicit',async()=>{
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/ordinary-return-pages.json',import.meta.url),'utf8')).slice(2);
 const expected=[[2023,0.1897,0.1863],[2023,0.1099,0.1058],[2025,0.0404,0.0385],[2021,0.1396,0.1294]];
 for(const [i,document] of reports.entries()) {
  const facts=parseCnDisclosureFacts(document,{sourceId:'historical-return',basis:'test'});
  expect(facts.find(f=>f.field==='weightedRoe')?.value).toBeCloseTo(expected[i][1],12);
  expect(facts.find(f=>f.field==='adjustedWeightedRoe')?.value).toBeCloseTo(expected[i][2],12);
  expect(JSON.parse(String(facts.find(f=>f.field==='earnings.returnContext')?.value))).toMatchObject({accountingStandard:'CAS',shareholderScope:'ordinary',reportYear:expected[i][0]});
 }
 const wrong=structuredClone(reports[2]);wrong.pages['149'].text=wrong.pages['149'].text.replaceAll('2025 年','2024 年');wrong.pages['149'].lines=wrong.pages['149'].text.split('\n');
 expect(parseCnDisclosureFacts(wrong,{sourceId:'wrong-note-date',basis:'test'}).some(f=>f.field==='weightedRoe')).toBe(false);
});

it('reads the issuer or group primary activity in its annual business section without certifying complete group scope',async()=>{
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/primary-activity-pages.json',import.meta.url),'utf8'));
 const expected=[
  {scope:'group',description:'汽车用玻璃制品、浮法玻璃及汽车饰件的生产及销售'},
  {scope:'issuer',description:'药品的研发、生产和销售'},
  {scope:'issuer',description:'城市管道天然气与压缩天然气销售、LNG储存销售及燃气设施、设备安装服务'},
 ];
 for(const [i,document] of reports.entries()) {
  const facts=parseCnDisclosureFacts(document,{sourceId:'primary-activity',basis:'test'});
  const activity=facts.filter(f=>f.field==='business.primaryActivity');
  expect(activity).toHaveLength(1);
  expect(JSON.parse(String(activity[0].value))).toEqual(expected[i]);
  expect(activity[0]).toMatchObject({entity:document.entity,year:2025,period:{start:'2025-01-01',end:'2025-12-31'},state:'observed'});
  expect(facts.some(f=>['scope.method','scope.cash','scope.cycle'].includes(f.field))).toBe(false);
 }
 const unrelated=structuredClone(reports[0]);
 unrelated.pages['95'].lines=unrelated.pages['95'].lines.map((l:string)=>l.replace('三、公司基本情况','三、董事履历').replace('公司概况','董事简历'));
 expect(parseCnDisclosureFacts(unrelated,{sourceId:'unrelated-section',basis:'test'}).some(f=>f.field==='business.primaryActivity')).toBe(false);
});

it('does not turn a subsidiary profile, future plan or registered permission into current issuer operations',()=>{
 for(const lines of [
  ['2025年年度报告','一、重要子公司情况','1、公司基本情况','本公司主要从事软件开发和销售。'],
  ['2025年年度报告','第三节管理层讨论与分析','一、报告期内公司从事的业务情况','（二）未来经营计划','公司的主要业务涉及拟开发的药品生产项目，尚未开展生产经营。'],
  ['2025年年度报告','三、公司基本情况','（一）营业执照经营范围','公司主要从事产品生产和销售（尚未实际开展）。'],
  ['2025年年度报告','三、公司基本情况','本公司主要从事拟开展的软件开发和销售。'],
 ]) {
  const document={entity:'600660',periodEnd:'2025-12-31',publishedAt:'2026-03-01',pages:{'1':{lines,text:lines.join('\n')}}};
  expect(parseCnDisclosureFacts(document,{sourceId:'not-current-issuer',basis:'test'}).some(f=>f.field==='business.primaryActivity'),lines.join('\n')).toBe(false);
 }
});
it('preserves each reported segment definition rather than only its label for method applicability',async()=>{
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/business-segment-lines.json',import.meta.url),'utf8'));
 const bank=parseCnDisclosureFacts(reports[0].document,{sourceId:'segment-definitions',basis:'test'});
 const current=JSON.parse(String(bank.find(f=>f.field==='business.segments'&&f.year===2025)!.value));
 expect(current.rows[0].definition).toContain('为公司客户提供的银行业务服务');
 expect(current.rows[0].definition).not.toContain('为个人客户');
 expect(current.rows[2].definition).toContain('外汇买卖等自营及代理业务');
 const prior=JSON.parse(String(bank.find(f=>f.field==='business.segments'&&f.year===2024)!.value));
 expect(prior.rows[2].definition).toBe(current.rows[2].definition);
 const lease=parseCnDisclosureFacts(reports[1].document,{sourceId:'sole-activity',basis:'test'});
 expect(JSON.parse(String(lease.find(f=>f.field==='business.segments')!.value)).rows[0].definition).toBe('在报告期内，本集团专注于租赁业务，因此只有一个经营分部，无需编制分部信息。');
});
it('does not treat a page-truncated segment definition as complete activity evidence',async()=>{
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/business-segment-lines.json',import.meta.url),'utf8'));
 const document=structuredClone(reports[0].document),page=document.pages['186'];
 const header=page.lines.findIndex((line:string)=>/^2025\s*年\s+/.test(line.trim()));
 expect(header).toBeGreaterThan(0);
 const table=page.lines.slice(header);page.lines=page.lines.slice(0,header);page.text=page.lines.join('\n');
 const lines=['十二、分部报告（续）','另通过子公司经营证券经纪业务。',...table];
 document.pages['187']={lines,text:lines.join('\n')};
 const facts=parseCnDisclosureFacts(document,{sourceId:'synthetic-cross-page',basis:'test'});
 const segments=JSON.parse(String(facts.find(f=>f.field==='business.segments'&&f.year===2025)!.value));
 expect(segments.rows).toHaveLength(4);
 expect(segments.rows.every((row:{definition?:string})=>row.definition===undefined)).toBe(true);
 expect(segments.rows[2].assetsFactId).toBeDefined();
});
