# Market Screener Context

定量筛选领域词汇。规则和运行方式见 README；本文只解释术语。

## 筛选与资格

**Quantitative Funnel（定量漏斗）**：用适用的财务事实和固定条件缩小证券研究范围。slug: `quantitative_funnel`

**Investable Universe（筛选总体）**：一次筛选所核对的证券身份集合，包含最终未能判断或不符合范围的身份。slug: `investable_universe`

**Financial Method（财务方法）**：与主要经济业务和报告口径相匹配的衡量方式；行业标签相同不保证适用方法相同。slug: `financial_method`

**Quality Pool（基础质量池）**：满足基础必要条件的完整公司集合。它比研究名单宽，不表示具备明显投资吸引力。slug: `quality_pool`

**Research Candidate（研究候选）**：满足本策略财务研究条件的公司，研究资格独立于价格是否便宜或已知。slug: `research_candidate`

**Strict-price Opportunity（严格低价机会）**：研究候选中同时满足明确价格条件的公司，是同一质量策略的子集。slug: `strict_price_opportunity`

**Display Limit（展示上限）**：展示给使用者的数量边界，不改变完整合格集合。slug: `display_limit`

## 未知与证据

**Unknown（未知）**：可靠证据不足以判断一个适用条件；既不代表通过，也不代表公司差。slug: `condition_unknown`

**Fail（不达标）**：可靠事实证明条件不满足。与缺数据不同。slug: `condition_fail`

**Not Applicable（不适用）**：已确定该条件不适用于公司。与尚不能确定方法不同。slug: `condition_not_applicable`

**Not Evaluated（未评估）**：本次没有执行该条件，常见于已知前置不达标后的停止；不能解读为该条件失败。slug: `condition_not_evaluated`

**Too Hard（太难）**：必要数据或适用方法在本次有限能力内仍不可判断的视图，不是对生意质量的永久评价。slug: `too_hard`

**Conservative Bound（保守界限）**：可靠证据限定未知真值的范围，足以证明某个方向的条件；界限不能冒充精确值。slug: `conservative_bound`

**Evidence Trace（证据链）**：结论与适用规则、计算口径、报告期间及原始事实之间的可核对关系。slug: `evidence_trace`

**Replay（重放）**：以某次运行当时保存的规则和事实重现判断；不同于用新规则重新筛选。slug: `run_replay`

## 独立策略与研究

**Financial Discount Lead（金融破净修复线索）**：可靠基本财务数字与破净修复条件同时成立，但专门业务风险仍待核验的研究线索。其研究优先级低于证据充分的候选，不等同于清算价值折价。slug: `financial_discount_lead`

**Earnings Repair（盈利修复）**：以保守历史盈利相对价格的吸引力取得独立研究资格，不要求先证明好生意或破净。slug: `earnings_repair`

**Research Queue（研究队列）**：质量研究资格成立的公司按价格吸引力及可解释回报信号排列的集合；价格偏贵或待判断不取消研究资格。slug: `research_queue`

**Discount Backup（折价备选）**：质量未确认或未通过、但独立资产或盈利折价条件成立的公司，使用主研究名单之外的独立容量。slug: `discount_backup`

**Reference Price Band（参考价格档）**：模型对价格吸引力的低估、正常／合理、偏贵分档；证据不足另列价格未知，不等于已确认内在价值。slug: `reference_price_band`

**NCAV Strategy（净流动资产折价策略）**：比较普通股可归属净流动资产与股票价值的资产折价思路，区别于盈利收益率和 PE×PB。slug: `ncav_strategy`

**Audit Hint（审计提示）**：供独立定性研究复核的问题和上下文，不是研究必须执行的工作指令。slug: `audit_hint`

**Landmine Price（限价观察价）**：根据已有审计输入和指定公式计算的观察价格，不是市场筛选资格。slug: `landmine_price`

## 模板筛选

美股模板策略的路径、支持条件和展示集合。

**Funnel Track（模板路径）**：模板内的 quality 或 mispricing 条件组合。slug: `funnel_track`

**Supporting Vote（支持项投票）**：模板所规定的支持条件计数。slug: `supporting_vote`

**Winning Template（入选模板）**：赋予某条模板路径通过资格的模板。slug: `winning_template`

**Template Seat Allocation（模板名额）**：模板路径之间的展示席位分配。slug: `template_seat_allocation`

**Deferred Candidate（延后候选）**：已通过模板但因展示容量而延后的公司，区别于缺数据的太难公司。slug: `deferred_candidate`

**Metric Snapshot（指标快照）**：模板结果当时使用的指标记录，供复核而非永久真实标签。slug: `metric_snapshot`
