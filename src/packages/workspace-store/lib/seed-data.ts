import {
  CONTRACT_LIFECYCLE_SUITE,
  CONTRACT_PROTOTYPE_HTML,
  MFT_ENTERPRISE_SUITE,
} from '../../ontology-core/index.js';
import type {
  AgentSession,
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityAgent,
  CapabilityChatSession,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  ProjectSnapshot,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementSession,
  SystemSettingsState,
  WritebackInterface,
} from './types.js';

const AUDIT_TS = '2026-11-10T09:00:00.000Z';

export interface SeedDictRow {
  id: string;
  dict_id: string;
  type_code: string;
  type_name: string;
  item_code: string;
  item_label: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export interface SeedCounterpartyRow {
  id: string;
  credit_code: string;
  company_name: string;
  industry: string;
  region: string;
  credit_rating: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export interface SeedContractRow {
  id: string;
  contract_no: string;
  title: string;
  contract_type: string;
  counterparty_id: string;
  region: string;
  department: string;
  industry: string;
  total_amount: number;
  risk_level: string;
  status: string;
  sign_period_json: string;
  overdue_days: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export interface SeedContractLineItemRow {
  id: string;
  contract_id: string;
  item_name: string;
  category: string;
  quantity: number;
  unit_price: number;
  subtotal_amount: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export interface SeedPaymentMilestoneRow {
  id: string;
  contract_id: string;
  phase_name: string;
  planned_ratio: number;
  planned_amount: number;
  due_date: string;
  milestone_status: string;
  overdue_days: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export interface SeedSettlementOrderRow {
  id: string;
  settlement_no: string;
  contract_ref: string;
  milestone_id: string | null;
  settlement_amount: number;
  settlement_status: string;
  overdue_days: number;
  settled_at: string | null;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export interface SeedMftWorkOrderRow {
  id: string;
  work_order_no: string;
  contract_ref: string | null;
  file_name: string;
  file_size_mb: number;
  security_domain: string;
  sha256_digest: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  flag: number;
}

export const SEED_DICT_ROWS: SeedDictRow[] = [
  { id: 'dict-status-draft', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_STATUS', type_name: '合同履约状态', item_code: 'DRAFT', item_label: '草稿', sort_order: 10, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-status-pending', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_STATUS', type_name: '合同履约状态', item_code: 'PENDING_APPROVAL', item_label: '审批会签中', sort_order: 20, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-status-exec', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_STATUS', type_name: '合同履约状态', item_code: 'EXECUTING', item_label: '履约执行中', sort_order: 30, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-status-comp', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_STATUS', type_name: '合同履约状态', item_code: 'COMPLETED', item_label: '已完结归档', sort_order: 40, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-credit-aaa', dict_id: 'DICT-COUNTERPARTY', type_code: 'CREDIT_RATING', type_name: '相对方资信等级', item_code: 'AAA', item_label: 'AAA级(特优资信)', sort_order: 10, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-credit-aa', dict_id: 'DICT-COUNTERPARTY', type_code: 'CREDIT_RATING', type_name: '相对方资信等级', item_code: 'AA', item_label: 'AA级(优良资信)', sort_order: 20, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-credit-a', dict_id: 'DICT-COUNTERPARTY', type_code: 'CREDIT_RATING', type_name: '相对方资信等级', item_code: 'A', item_label: 'A级(标准资信)', sort_order: 30, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-credit-b', dict_id: 'DICT-COUNTERPARTY', type_code: 'CREDIT_RATING', type_name: '相对方资信等级', item_code: 'B', item_label: 'B级(关注资信)', sort_order: 40, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-credit-c', dict_id: 'DICT-COUNTERPARTY', type_code: 'CREDIT_RATING', type_name: '相对方资信等级', item_code: 'C', item_label: 'C级(高危受限)', sort_order: 50, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-risk-high', dict_id: 'DICT-CONTRACT', type_code: 'RISK_LEVEL', type_name: '风险定级', item_code: 'HIGH', item_label: '高风险', sort_order: 10, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-risk-med', dict_id: 'DICT-CONTRACT', type_code: 'RISK_LEVEL', type_name: '风险定级', item_code: 'MEDIUM', item_label: '中风险', sort_order: 20, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-risk-low', dict_id: 'DICT-CONTRACT', type_code: 'RISK_LEVEL', type_name: '风险定级', item_code: 'LOW', item_label: '低风险', sort_order: 30, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-type-proc', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_TYPE', type_name: '合同类型', item_code: 'PROCUREMENT', item_label: '设备与物资采购', sort_order: 10, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-type-sales', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_TYPE', type_name: '合同类型', item_code: 'SALES', item_label: '产品销售合同', sort_order: 20, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-type-out', dict_id: 'DICT-CONTRACT', type_code: 'CONTRACT_TYPE', type_name: '合同类型', item_code: 'OUTSOURCING', item_label: '技术服务外包', sort_order: 30, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-stl-paid', dict_id: 'DICT-SETTLEMENT', type_code: 'SETTLEMENT_STATUS', type_name: '结算状态', item_code: 'PAID', item_label: '已核销付款', sort_order: 10, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-stl-pending', dict_id: 'DICT-SETTLEMENT', type_code: 'SETTLEMENT_STATUS', type_name: '结算状态', item_code: 'PENDING', item_label: '待核销结算', sort_order: 20, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'dict-stl-frozen', dict_id: 'DICT-SETTLEMENT', type_code: 'SETTLEMENT_STATUS', type_name: '结算状态', item_code: 'FROZEN', item_label: '风控冻结', sort_order: 30, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_COUNTERPARTY_ROWS: SeedCounterpartyRow[] = [
  { id: 'CP-01', credit_code: '91310115MA1K88010X', company_name: '中芯精工半导体设备（上海）有限公司', industry: '半导体设备', region: '华东区', credit_rating: 'AAA', status: 'ACTIVE', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CP-02', credit_code: '91320214MA1W99021A', company_name: '长三角微电子晶圆技术（无锡）有限公司', industry: '半导体封测', region: '华东区', credit_rating: 'A', status: 'ACTIVE', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CP-03', credit_code: '91320594MA1S77132B', company_name: '苏南光刻精密部件（苏州）股份有限公司', industry: '半导体材料与部件', region: '华东区', credit_rating: 'A', status: 'RESTRICTED', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CP-04', credit_code: '91110108MA01B2204C', company_name: '京津冀云智算信息技术（北京）有限公司', industry: '云计算与IT服务', region: '华北区', credit_rating: 'AA', status: 'ACTIVE', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CP-05', credit_code: '91120116MA06T5505D', company_name: '燕山智能装备制造（天津）有限公司', industry: '智能装备', region: '华北区', credit_rating: 'B', status: 'RESTRICTED', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CP-06', credit_code: '91440300MA5F33906E', company_name: '大湾区鹏城光通信科技（深圳）有限公司', industry: '光通信电子', region: '华南区', credit_rating: 'AAA', status: 'ACTIVE', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_CONTRACT_ROWS: SeedContractRow[] = [
  { id: 'CT-01', contract_no: 'CT-2026-0001', title: '12英寸晶圆刻蚀机核心腔体采购合同', contract_type: 'PROCUREMENT', counterparty_id: 'CP-01', region: '华东区', department: '半导体供应链部', industry: '半导体', total_amount: 4600000, risk_level: 'HIGH', status: 'EXECUTING', sign_period_json: '{"startDate":"2026-01-15","endDate":"2026-12-31"}', overdue_days: 0, created_by: 'u-spec-01', created_at: AUDIT_TS, updated_by: 'u-legal-01', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-02', contract_no: 'CT-2026-0002', title: '华东半导体洁净室CIM系统驻场开发外包合同', contract_type: 'OUTSOURCING', counterparty_id: 'CP-02', region: '华东区', department: '晶圆制造IT部', industry: '半导体', total_amount: 960000, risk_level: 'HIGH', status: 'EXECUTING', sign_period_json: '{"startDate":"2026-03-01","endDate":"2026-11-30"}', overdue_days: 24, created_by: 'u-spec-01', created_at: AUDIT_TS, updated_by: 'u-legal-01', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-03', contract_no: 'CT-2026-0003', title: '苏州光刻精密阀门批次维保与测试外包合同', contract_type: 'OUTSOURCING', counterparty_id: 'CP-03', region: '华东区', department: '光刻设备工程部', industry: '半导体', total_amount: 1850000, risk_level: 'HIGH', status: 'EXECUTING', sign_period_json: '{"startDate":"2026-02-10","endDate":"2026-10-31"}', overdue_days: 31, created_by: 'u-spec-02', created_at: AUDIT_TS, updated_by: 'u-legal-01', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-04', contract_no: 'CT-2026-0004', title: '上海临港半导体封测产线MES二期升级合同', contract_type: 'OUTSOURCING', counterparty_id: 'CP-02', region: '华东区', department: '晶圆制造IT部', industry: '半导体', total_amount: 2400000, risk_level: 'HIGH', status: 'EXECUTING', sign_period_json: '{"startDate":"2026-04-01","endDate":"2027-03-31"}', overdue_days: 19, created_by: 'u-spec-01', created_at: AUDIT_TS, updated_by: 'u-legal-01', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-05', contract_no: 'CT-2026-0005', title: '华北智算中心高速交换矩阵年度采购合同', contract_type: 'PROCUREMENT', counterparty_id: 'CP-04', region: '华北区', department: '基础设施采购部', industry: '云计算', total_amount: 3200000, risk_level: 'HIGH', status: 'COMPLETED', sign_period_json: '{"startDate":"2026-01-01","endDate":"2026-09-30"}', overdue_days: 0, created_by: 'u-spec-03', created_at: AUDIT_TS, updated_by: 'u-legal-02', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-06', contract_no: 'CT-2026-0006', title: '华北工业网关固件安全审计技术服务合同', contract_type: 'OUTSOURCING', counterparty_id: 'CP-05', region: '华北区', department: '平台安全部', industry: '智能制造', total_amount: 680000, risk_level: 'MEDIUM', status: 'PENDING_APPROVAL', sign_period_json: '{"startDate":"2026-10-01","endDate":"2027-03-31"}', overdue_days: 0, created_by: 'u-spec-03', created_at: AUDIT_TS, updated_by: 'u-spec-03', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-07', contract_no: 'CT-2026-0007', title: '华南光模块自动化检测设备销售主合同', contract_type: 'SALES', counterparty_id: 'CP-06', region: '华南区', department: '大客户销售部', industry: '光通信', total_amount: 5100000, risk_level: 'HIGH', status: 'EXECUTING', sign_period_json: '{"startDate":"2026-05-01","endDate":"2027-04-30"}', overdue_days: 0, created_by: 'u-sales-01', created_at: AUDIT_TS, updated_by: 'u-legal-02', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CT-08', contract_no: 'CT-2026-0008', title: '深圳研发中心EDA算力调度软件许可草稿', contract_type: 'PROCUREMENT', counterparty_id: 'CP-06', region: '华南区', department: '芯片研发中心', industry: '半导体', total_amount: 420000, risk_level: 'LOW', status: 'DRAFT', sign_period_json: '{"startDate":"2026-11-15","endDate":"2027-11-14"}', overdue_days: 0, created_by: 'u-spec-02', created_at: AUDIT_TS, updated_by: 'u-spec-02', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_CONTRACT_LINE_ITEM_ROWS: SeedContractLineItemRow[] = [
  { id: 'CLI-01', contract_id: 'CT-01', item_name: '12英寸等离子刻蚀真空反应腔体组件', category: '半导体核心设备', quantity: 2, unit_price: 2300000, subtotal_amount: 4600000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-02', contract_id: 'CT-02', item_name: '洁净室天车调度与EAP接口驻场开发人月', category: '半导体软件外包', quantity: 24, unit_price: 40000, subtotal_amount: 960000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-03', contract_id: 'CT-03', item_name: '超高纯特气波纹管阀门检测与校准批次服务', category: '半导体维保外包', quantity: 5, unit_price: 370000, subtotal_amount: 1850000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-04', contract_id: 'CT-04', item_name: '先进封测批次追溯MES核心引擎升级包', category: '工业软件外包', quantity: 1, unit_price: 2400000, subtotal_amount: 2400000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-05', contract_id: 'CT-05', item_name: '400G RoCEv2 无损算力核心交换机', category: '网络硬件', quantity: 16, unit_price: 200000, subtotal_amount: 3200000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-06', contract_id: 'CT-06', item_name: '工业边缘网关固件渗透测试与合规加固', category: '安全技术服务', quantity: 2, unit_price: 340000, subtotal_amount: 680000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-07', contract_id: 'CT-07', item_name: '800G硅光模块全温区耦合测试台', category: '自动化装备销售', quantity: 3, unit_price: 1700000, subtotal_amount: 5100000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'CLI-08', contract_id: 'CT-08', item_name: 'EDA分布式作业调度器企业年框订阅', category: '研发工具软件', quantity: 1, unit_price: 420000, subtotal_amount: 420000, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_PAYMENT_MILESTONE_ROWS: SeedPaymentMilestoneRow[] = [
  { id: 'PM-01', contract_id: 'CT-01', phase_name: '合同生效首付款 (30%)', planned_ratio: 0.3, planned_amount: 1380000, due_date: '2026-02-01', milestone_status: 'PAID', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-02', contract_id: 'CT-01', phase_name: '腔体到货与FAT验收款 (50%)', planned_ratio: 0.5, planned_amount: 2300000, due_date: '2026-08-15', milestone_status: 'PAID', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-03', contract_id: 'CT-02', phase_name: 'CIM接口联调里程碑款 (60%)', planned_ratio: 0.6, planned_amount: 576000, due_date: '2026-10-15', milestone_status: 'OVERDUE', overdue_days: 24, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-04', contract_id: 'CT-03', phase_name: '首批次光刻阀门洁净度认证款 (40%)', planned_ratio: 0.4, planned_amount: 740000, due_date: '2026-05-20', milestone_status: 'PAID', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-05', contract_id: 'CT-03', phase_name: '二期批量耐压测试里程碑款 (60%)', planned_ratio: 0.6, planned_amount: 1110000, due_date: '2026-10-10', milestone_status: 'OVERDUE', overdue_days: 31, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-06', contract_id: 'CT-04', phase_name: 'MES二期蓝图冻结首付款 (30%)', planned_ratio: 0.3, planned_amount: 720000, due_date: '2026-04-20', milestone_status: 'PAID', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-07', contract_id: 'CT-04', phase_name: '产线过站采集压测验收款 (50%)', planned_ratio: 0.5, planned_amount: 1200000, due_date: '2026-10-22', milestone_status: 'OVERDUE', overdue_days: 19, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-08', contract_id: 'CT-05', phase_name: '交换矩阵全量上架终验款 (100%)', planned_ratio: 1.0, planned_amount: 3200000, due_date: '2026-09-25', milestone_status: 'PAID', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-09', contract_id: 'CT-07', phase_name: '光模块测试台首期交付回款 (50%)', planned_ratio: 0.5, planned_amount: 2550000, due_date: '2026-07-30', milestone_status: 'PAID', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'PM-10', contract_id: 'CT-07', phase_name: '产线良率达标尾款 (50%)', planned_ratio: 0.5, planned_amount: 2550000, due_date: '2026-12-20', milestone_status: 'PENDING', overdue_days: 0, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_SETTLEMENT_ORDER_ROWS: SeedSettlementOrderRow[] = [
  { id: 'STL-01', settlement_no: 'STL-2026-0001', contract_ref: 'CT-01', milestone_id: 'PM-01', settlement_amount: 1380000, settlement_status: 'PAID', overdue_days: 0, settled_at: '2026-02-02T10:00:00.000Z', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-02', settlement_no: 'STL-2026-0002', contract_ref: 'CT-01', milestone_id: 'PM-02', settlement_amount: 2300000, settlement_status: 'PAID', overdue_days: 0, settled_at: '2026-08-14T15:20:00.000Z', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-03', settlement_no: 'STL-2026-0003', contract_ref: 'CT-02', milestone_id: 'PM-03', settlement_amount: 576000, settlement_status: 'PENDING', overdue_days: 24, settled_at: null, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-04', settlement_no: 'STL-2026-0004', contract_ref: 'CT-03', milestone_id: 'PM-04', settlement_amount: 740000, settlement_status: 'PAID', overdue_days: 0, settled_at: '2026-05-19T11:00:00.000Z', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-05', settlement_no: 'STL-2026-0005', contract_ref: 'CT-03', milestone_id: 'PM-05', settlement_amount: 1110000, settlement_status: 'PENDING', overdue_days: 31, settled_at: null, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-06', settlement_no: 'STL-2026-0006', contract_ref: 'CT-04', milestone_id: 'PM-06', settlement_amount: 720000, settlement_status: 'PAID', overdue_days: 0, settled_at: '2026-04-20T09:30:00.000Z', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-07', settlement_no: 'STL-2026-0007', contract_ref: 'CT-04', milestone_id: 'PM-07', settlement_amount: 1200000, settlement_status: 'PENDING', overdue_days: 19, settled_at: null, created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-08', settlement_no: 'STL-2026-0008', contract_ref: 'CT-05', milestone_id: 'PM-08', settlement_amount: 3200000, settlement_status: 'PAID', overdue_days: 0, settled_at: '2026-09-24T16:45:00.000Z', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
  { id: 'STL-09', settlement_no: 'STL-2026-0009', contract_ref: 'CT-07', milestone_id: 'PM-09', settlement_amount: 2550000, settlement_status: 'PAID', overdue_days: 0, settled_at: '2026-07-29T14:10:00.000Z', created_by: 'system', created_at: AUDIT_TS, updated_by: 'system', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_MFT_WORK_ORDER_ROWS: SeedMftWorkOrderRow[] = [
  { id: 'MFT-WO-01', work_order_no: 'MFT-2026-0412', contract_ref: 'CT-01', file_name: 'CT-2026-0001_刻蚀机腔体采购定稿签章版.pdf', file_size_mb: 48.6, security_domain: 'DMZ_TO_CORE_ARCHIVE', sha256_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', status: 'COMPLETED', created_by: 'mft-gateway', created_at: AUDIT_TS, updated_by: 'mft-gateway', updated_at: AUDIT_TS, flag: 1 },
  { id: 'MFT-WO-02', work_order_no: 'MFT-2026-0413', contract_ref: 'CT-02', file_name: 'CT-2026-0002_洁净室CIM驻场开发技术附件.zip', file_size_mb: 312.4, security_domain: 'PARTNER_TO_FAB_NET', sha256_digest: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4', status: 'EXECUTING', created_by: 'mft-gateway', created_at: AUDIT_TS, updated_by: 'mft-gateway', updated_at: AUDIT_TS, flag: 1 },
  { id: 'MFT-WO-03', work_order_no: 'MFT-2026-0414', contract_ref: 'CT-03', file_name: 'CT-2026-0003_光刻阀门氦质谱检漏原始报告.pdf', file_size_mb: 125.0, security_domain: 'PARTNER_TO_FAB_NET', sha256_digest: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae', status: 'EXECUTING', created_by: 'mft-gateway', created_at: AUDIT_TS, updated_by: 'mft-gateway', updated_at: AUDIT_TS, flag: 1 },
  { id: 'MFT-WO-04', work_order_no: 'MFT-2026-0415', contract_ref: 'CT-05', file_name: 'CT-2026-0005_华北智算交换矩阵终验归档包.tar.gz', file_size_mb: 842.0, security_domain: 'DMZ_TO_CORE_ARCHIVE', sha256_digest: '4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce', status: 'COMPLETED', created_by: 'mft-gateway', created_at: AUDIT_TS, updated_by: 'mft-gateway', updated_at: AUDIT_TS, flag: 1 },
  { id: 'MFT-WO-05', work_order_no: 'MFT-2026-0416', contract_ref: 'CT-07', file_name: 'CT-2026-0007_800G硅光耦合测试台出厂校准谱图.bin', file_size_mb: 1560.8, security_domain: 'LAB_TO_CUSTOMER_PORTAL', sha256_digest: '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b', status: 'COMPLETED', created_by: 'mft-gateway', created_at: AUDIT_TS, updated_by: 'mft-gateway', updated_at: AUDIT_TS, flag: 1 },
];

export const SEED_PROJECTS = [
  {
    id: 'proj-contract',
    name: '合同全生命周期管理系统',
    code: 'CONTRACT-CLM',
    center: 'APPLICATION' as const,
    domain: '合同全生命周期管理系统',
    description:
      '覆盖合同起草、相对方资信准入、金额分级法务会签、电子签章与首期履约结算联动的全套 11 模型标杆工程。',
    currentStage: 11,
    suite: CONTRACT_LIFECYCLE_SUITE,
    changelog: [
      '# Ontology Change Log - 合同全生命周期管理系统',
      '',
      '## [2026-11-10T09:00:00.000Z] Initial 11-Model Baseline',
      '- Authoring completed for M1, M2, M3, ME, M4, M5, M6, M7, MU, MM, MI.',
      '- Verified 0 consistency errors across all 11 ontology meta-models.',
      '',
    ].join('\n'),
  },
  {
    id: 'proj-mft',
    name: '企业文件安全传输系统 (MFT)',
    code: 'MFT-SEC',
    center: 'CAPABILITY' as const,
    domain: '企业文件安全传输系统 (MFT)',
    description:
      '通过存量系统本体萃取（Ontology Extraction）从既有 MFT 跨网文件传输系统 DDL 与接口规范提炼的领域本体工程。',
    currentStage: 5,
    suite: MFT_ENTERPRISE_SUITE,
    changelog: [
      '# Ontology Change Log - 企业文件安全传输系统 (MFT)',
      '',
      '## [2026-11-10T10:00:00.000Z] Ontology Extraction Baseline',
      '- Extracted M1, M2, M3, ME, M5 from MFT database DDL and OpenAPI 3.0 specification.',
      '',
    ].join('\n'),
  },
];

export const SEED_REQUIREMENT_SESSIONS: RequirementSession[] = [
  {
    id: 'req-sess-contract-01',
    projectId: 'proj-contract',
    title: '商务合同起草、资信准入与多级会签需求探索',
    status: 'CONVERGED',
    discoveredAggregates: ['Contract (合同)', 'Counterparty (签约相对方)', 'SettlementOrder (履约结算单)'],
    discoveredRules: [
      'RULE-01: 超过 100 万元的大额合同仅允许与 AA/AAA 级资信相对方签署',
      'RULE-02: 合同金额 >= 200万自动定级 HIGH，>= 50万定级 MEDIUM，其余 LOW',
      'RULE-03: 同一合同下所有履约结算单累计金额不得超过合同总金额',
    ],
    resolvedDecisions: [
      '采用两级校验：草稿保存时校验 RULE-01 资信准入，提交审批时根据 RULE-02 自动判定风险等级',
      '法务审批放行后通过 EVT-03 事件异步联动生成首期履约结算单（SCN-01）',
    ],
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content:
          '我们需要建设一套企业级合同全生命周期管理系统，支持商务专员起草采购和销售合同，关联客户/供应商资信，并根据合同金额走不同的法务审批流，审批通过后自动生成首期结算单。',
        timestamp: '2026-11-10T08:15:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content:
          '已识别核心聚合根：`Contract`（合同）、`Counterparty`（签约相对方）、`SettlementOrder`（履约结算单）。为了收敛 M3 规则模型与 M6 审批流程分支，请确认以下两个边界问题：\n1. 大额合同对签约相对方的资信等级（如 AAA/AA/A）是否有硬性准入拦截阈值？\n2. 合同审批通过后，首期结算单是同步阻塞生成还是通过领域事件（ME）触发生成？',
        timestamp: '2026-11-10T08:15:18.000Z',
        extractedHints: {
          aggregates: ['Contract', 'Counterparty', 'SettlementOrder'],
          behaviors: ['draftContract', 'submitContractApproval', 'approveContract'],
          openQuestions: ['大额合同资信准入阈值', '首期结算单触发机制'],
        },
      },
      {
        id: 'msg-3',
        role: 'user',
        content:
          '1. 合同总金额超过 100 万元时，相对方资信必须是 AA 或 AAA 级，黑名单相对方一律禁止起草。2. 审批通过后发送领域事件 Contract.ApprovedAndSigned，校验结算总额不超过合同金额后自动创建首期结算单。',
        timestamp: '2026-11-10T08:17:00.000Z',
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content:
          '需求边界已全部澄清！已为您同步生成结构化《软件需求说明书 (SRS)》并沉淀至 M1~MI 11 个业务本体模型。',
        timestamp: '2026-11-10T08:17:22.000Z',
        extractedHints: {
          rules: ['RULE-01', 'RULE-02', 'RULE-03'],
        },
      },
    ],
    updatedAt: '2026-11-10T08:18:00.000Z',
  },
];

export const SEED_REQUIREMENT_DOCS: RequirementDoc[] = [
  {
    id: 'req-doc-contract-srs',
    projectId: 'proj-contract',
    title: '合同全生命周期管理系统软件需求说明书 (SRS v5.0)',
    version: 'v5.0',
    status: 'CONFIRMED',
    content: `# 合同全生命周期管理系统 — 软件需求说明书 (SRS)

## 1. 业务目标与范围
构建基于 **11 元模型业务本体** 的企业级合同全生命周期管理系统（CLM），实现从相对方资信核验、合同起草、风险定级会签、CA 电子签章到首期履约结算的端到端闭环。

## 2. 核心领域对象 (对应 M1 对象模型)
- **合同 (\`Contract\` / \`AGG-01\`)**：包含合同编号、名称、合同类型、相对方引用、合同总金额、状态、履约有效期（\`SignPeriod\`）及风险等级；下辖子实体 \`ContractLineItem\`（标的明细）与 \`PaymentMilestone\`（收付款里程碑）。
- **签约相对方 (\`Counterparty\` / \`AGG-02\`)**：维护统一社会信用代码、企业全称、资信等级（AAA~C）与准入状态。
- **履约结算单 (\`SettlementOrder\` / \`AGG-03\`)**：关联执行中合同，记录每期结算金额与核销状态。

## 3. 关键业务行为与规则 (对应 M2 / M3 / ME / M4)
1. **起草合同 (\`BHV-01\`)**：前置检查相对方状态必须为 \`ACTIVE\`，调用 \`RULE-01\` 校验百万级合同资信门槛，发布 \`EVT-01 (Contract.DraftCreated)\`。
2. **提交合同审批 (\`BHV-02\`)**：调用 \`RULE-02\` 按金额阈值（50万/200万）自动判定风险等级，发布 \`EVT-02 (Contract.SubmittedForApproval)\`。
3. **法务终审与结算联动 (\`BHV-03\` / \`SCN-01\`)**：法务审批放行后发布 \`EVT-03 (Contract.ApprovedAndSigned)\`，触发 \`RULE-03\` 结算总额守恒校验并调用 \`BHV-04\` 自动生成首期结算单。
`,
    updatedAt: '2026-11-10T08:30:00.000Z',
  },
];

export const SEED_PROTOTYPES: PrototypeArtifact[] = [
  {
    id: 'proto-contract-v1',
    projectId: 'proj-contract',
    name: '合同台账、起草与法务会签交互原型 (界面原型.html)',
    version: 'v5.0',
    htmlContent: CONTRACT_PROTOTYPE_HTML,
    extractedScreenCount: 3,
    updatedAt: '2026-11-10T08:45:00.000Z',
  },
];

export const SEED_FOUR_LAYER_ASSETS: FourLayerAsset[] = [
  {
    id: 'asset-ui-spatial-paper',
    layer: 'UI_UE',
    name: 'Spatial-Sync 暖纸与胶片颗粒双模设计规范',
    version: 'v2.4',
    summary:
      '支持亮色暖纸纹理 (#f3f2ee) 与暗色胶片颗粒 (#121211)，采用 Noto Serif SC 标题 + IBM Plex Sans 正文 + IBM Plex Mono 本体编码的高密度专业工作台规范。',
    tags: ['Light/Dark', 'Warm Paper', 'IBM Plex', 'Bilingual i18n'],
    specMarkdown: `# UI/UE 界面设计规范 — Spatial-Sync 双模工作台

## 1. 色彩与表面令牌
- **亮色模式（Warm Paper）**：背景 \`#f3f2ee\`，工作台卡片 \`#fdfdfb\`，主墨色 \`#1a1a18\`，强调色 \`#4c50c4\`。
- **暗色模式（Film Grain）**：背景 \`#121211\`，工作台卡片 \`#181816\`，主墨色 \`#eceae3\`，强调色 \`#9ca4ff\`。

## 2. 排版与组件约束
- 禁止使用浏览器原生阻塞弹窗（\`alert\` / \`confirm\` / \`prompt\`），统一采用非阻塞抽屉或模态框。
- 所有本体模型 ID、规则表达式与 SQL 必须使用 \`IBM Plex Mono\` 等宽字体渲染。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-ui-enterprise-dense',
    layer: 'UI_UE',
    name: '企业级高密度主子表与审批流交互规范',
    version: 'v1.8',
    summary: '针对 ERP / 合同 / 财务单据场景定制的主子表联编、状态徽章与审批时间轴设计规范。',
    tags: ['Master-Detail', 'Approval Flow', 'Enterprise Table'],
    specMarkdown: `# 企业级高密度主子表与审批流交互规范\n\n支持单屏同时展示主单据属性、子实体明细行与底部固定审批操作栏。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-foundation-ts-edge',
    layer: 'TECH_FOUNDATION',
    name: 'TypeScript + Hono + Drizzle + SQLite/D1 轻量全栈技术底座',
    version: 'v5.0',
    summary:
      'Local-first 零外部数据库依赖，本地基于 Node.js 内置 SQLite 高速运行，边缘端无缝部署至 Cloudflare Workers + D1。',
    tags: ['TypeScript', 'Hono', 'Drizzle ORM', 'SQLite / D1', 'React 19'],
    specMarkdown: `# 技术底座说明 — TypeScript + Hono + SQLite/D1

- **前端框架**：Vite + React 19 + TanStack Query + Zustand + Base UI
- **服务端框架**：Hono REST/SSE API + MCP JSON-RPC Server
- **持久化引擎**：本地 \`node:sqlite\` 与 Cloudflare D1 同构 SQLite 方言`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-foundation-spring-cloud',
    layer: 'TECH_FOUNDATION',
    name: 'Spring Boot 3 + MyBatis-Plus + PostgreSQL 企业级底座',
    version: 'v3.2',
    summary: '适用于存量 Java 技术栈团队的标准脚手架底座，内置多租户、RBAC 权限拦截与分布式事务支持。',
    tags: ['Java 21', 'Spring Boot 3', 'PostgreSQL'],
    specMarkdown: `# 技术底座说明 — Spring Boot 3 企业级底座\n\n提供标准 Maven 多模块工程结构与统一异常处理。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-arch-ddd-deep-module',
    layer: 'TECH_ARCH',
    name: 'DDD 11元模型驱动 + Deep Modules 深模块技术架构',
    version: 'v5.0',
    summary:
      '将 M1~MI 11 个业务本体模型确定性映射为领域聚合根、命令/查询应用服务、规则引擎、事件总线与持久化仓储。',
    tags: ['DDD', 'Deep Modules', '11-Model Mapping', 'Zero Drift'],
    specMarkdown: `# 技术架构设计文档 — DDD 11元模型驱动深模块架构

## 1. 四层架构映射契约
1. **领域层 (\`domain/\`)**：严格对应 \`M1\` 聚合根/实体/值对象、\`M3\` 领域规则与 \`ME\` 领域事件。
2. **应用层 (\`application/\`)**：严格对应 \`M2\` 行为命令、\`M4\` 事件场景与 \`M6\` 业务流程编排。
3. **基础设施层 (\`infrastructure/\`)**：严格对应 \`MM\` 对象-数据表映射与 \`M7\` 参考 SQL 查询实现。
4. **接口与表现层 (\`interfaces/\` & \`ui/\`)**：严格对应 \`MI\` 接口契约与 \`MU\` 屏幕控件调用链。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
];

export const SEED_ASSEMBLED_APPS: AssembledApplication[] = [
  {
    id: 'app-contract-clm',
    name: '合同全生命周期管理系统 (CLM v5.0)',
    projectId: 'proj-contract',
    uiUeAssetId: 'asset-ui-spatial-paper',
    techFoundationAssetId: 'asset-foundation-ts-edge',
    techArchAssetId: 'asset-arch-ddd-deep-module',
    status: 'PUBLISHED',
    packageOutputDir: '.onto-cs/packages/app-contract-clm',
    publishedEndpoint: 'http://127.0.0.1:4310/apps/contract-clm',
    publishedVersion: 'v5.0.0',
    agentDevLogs: [
      {
        timestamp: '2026-11-10T09:10:00.000Z',
        phase: 'ONTOLOGY_GATE_CHECK',
        detail: '11 模型一致性门禁通过（0 Error, 0 Warning）',
      },
      {
        timestamp: '2026-11-10T09:11:00.000Z',
        phase: 'PACKAGE_COMPILE',
        detail: '已编译渐进式披露《开发指导书.md》《本体模型业务功能开发指导书.md》及 11 份 YAML 模型元文件',
      },
      {
        timestamp: '2026-11-10T09:12:00.000Z',
        phase: 'APP_PUBLISH',
        detail: '应用已发布至运行态沙箱并同步挂载 MCP 服务与业务技能包',
      },
    ],
    updatedAt: '2026-11-10T09:12:00.000Z',
  },
];

export const SEED_SKILLS: GeneratedSkill[] = [
  {
    id: 'skill-contract-clm',
    projectId: 'proj-contract',
    name: '合同全生命周期业务本体技能 (contract-lifecycle-ontology)',
    slug: 'contract-lifecycle-ontology',
    version: '5.0.0',
    description:
      '提供合同起草、相对方资信准入核验（RULE-01）、风险分级会签（RULE-02）与首期履约结算单联动（SCN-01）的渐进式披露 Agent 技能包。',
    skillMarkdown: `---
name: contract-lifecycle-ontology
description: 合同全生命周期管理系统 (CLM) 业务本体技能包。当需要起草商务合同、核验签约相对方资信等级、执行多级法务风险会签、查询合同台账或触发首期履约结算时调用。
---

# 合同全生命周期业务本体技能 (Contract Lifecycle Ontology Skill)

## 1. 核心领域概念 (M1)
- \`Contract\` (AGG-01): 商务合同聚合根，包含 \`ContractLineItem\` 与 \`PaymentMilestone\`。
- \`Counterparty\` (AGG-02): 签约相对方，含资信等级 \`creditRating\` (\`AAA\`/\`AA\`/\`A\`/\`B\`/\`C\`)。
- \`SettlementOrder\` (AGG-03): 履约结算单。

## 2. 可调用业务行为与规则门禁 (M2 & M3)
- \`draftContract\` (\`BHV-01\`): 起草合同，自动执行 \`RULE-01\`（金额 > 100万要求相对方 AA/AAA 级）。
- \`submitContractApproval\` (\`BHV-02\`): 提交审批，自动执行 \`RULE-02\` 判定风险等级。
- \`approveContract\` (\`BHV-03\`): 法务终审通过，触发 \`EVT-03\` 与 \`SCN-01\` 自动生成首期结算单。
- \`queryContractLedger\` (\`BHV-05\` -> \`QRY-01\`): 分页检索合同台账。
`,
    updatedAt: '2026-11-10T09:05:00.000Z',
  },
];

export const SEED_LEGACY_SYSTEMS: LegacySystemConfig[] = [
  {
    id: 'sys-erp-contract',
    name: '存量 ERP 合同与客商主数据系统',
    code: 'ERP-CLM-LEGACY',
    category: 'ERP / 业财一体',
    baseUrl: 'http://127.0.0.1:4310/api/mock-legacy/erp',
    dbDialect: 'SQLite / PostgreSQL',
    dbConnectionUri: 'sqlite://.onto-cs/onto-cs.db',
    status: 'MCP_ACTIVE',
    linkedProjectId: 'proj-contract',
    description: '存量企业合同与相对方管理系统，已完成本体萃取并封装为标准 MCP Server。',
  },
  {
    id: 'sys-mft-transfer',
    name: '企业跨网大文件安全传输平台 (MFT)',
    code: 'MFT-GATEWAY',
    category: '安全基础设施',
    baseUrl: 'http://127.0.0.1:4310/api/mock-legacy/mft',
    dbDialect: 'MySQL 8.0',
    dbConnectionUri: 'mysql://mft_ro@10.20.1.50:3306/mft_prod',
    status: 'EXTRACTED',
    linkedProjectId: 'proj-mft',
    description: '承载合同定稿 PDF 加密归档与跨安全域文件交换的存量系统。',
  },
];

export const SEED_EXTRACTION_JOBS: ExtractionJob[] = [
  {
    id: 'ext-job-01',
    systemId: 'sys-erp-contract',
    projectId: 'proj-contract',
    title: 'ERP 合同主子表 DDL 与 OpenAPI 接口本体萃取',
    sourceType: 'DDL_AND_OPENAPI',
    sourceSnippet: `CREATE TABLE t_contract (
  id VARCHAR(36) PRIMARY KEY,
  contract_no VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(128) NOT NULL,
  counterparty_id VARCHAR(36) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL
);
-- POST /api/v1/contracts/draft -> BHV-01 draftContract
-- POST /api/v1/contracts/approve -> BHV-03 approveContract`,
    extractedModels: ['M1', 'M2', 'M3', 'ME', 'M7', 'MM', 'MI'],
    confidenceScore: 0.96,
    status: 'COMPLETED',
    summary:
      '成功从 3 张核心物理表与 6 个 REST 接口萃取生成 Contract、Counterparty、SettlementOrder 三个聚合根及完整映射模型 MM/MI。',
    extractedEntitiesCount: 3,
    extractedTablesCount: 3,
    extractedInterfacesCount: 6,
    appliedToProject: true,
    createdAt: '2026-11-10T08:50:00.000Z',
  },
  {
    id: 'ext-job-02',
    systemId: 'sys-mft-transfer',
    projectId: 'proj-mft',
    title: 'MFT 跨网传输任务表与调度接口本体萃取',
    sourceType: 'DDL_AND_OPENAPI',
    sourceSnippet: `CREATE TABLE mft_transfer_task (
  task_no VARCHAR(32) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  file_size_mb DECIMAL(12,2) NOT NULL,
  sha256_digest CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL
);`,
    extractedModels: ['M1', 'M2', 'M3', 'ME', 'M5'],
    confidenceScore: 0.94,
    status: 'COMPLETED',
    summary: '成功从 MFT 存量库表与传输网关接口萃取出 TransferTask 聚合根与 10GB 体积校验规则 RULE-MFT-01。',
    extractedEntitiesCount: 1,
    extractedTablesCount: 1,
    extractedInterfacesCount: 1,
    appliedToProject: true,
    createdAt: '2026-11-10T09:20:00.000Z',
  },
];

export const SEED_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mcp-contract-server',
    projectId: 'proj-contract',
    name: '合同全生命周期业务本体 MCP Server',
    endpoint: '/api/mcp/proj-contract',
    transport: 'HTTP_JSON_RPC',
    status: 'ONLINE',
    toolsCount: 6,
    resourcesCount: 11,
    updatedAt: '2026-11-10T09:15:00.000Z',
  },
  {
    id: 'mcp-mft-server',
    projectId: 'proj-mft',
    name: 'MFT 跨网安全传输本体 MCP Server',
    endpoint: '/api/mcp/proj-mft',
    transport: 'HTTP_JSON_RPC',
    status: 'ONLINE',
    toolsCount: 2,
    resourcesCount: 5,
    updatedAt: '2026-11-10T09:25:00.000Z',
  },
];

export const SEED_CAPABILITY_AGENTS: CapabilityAgent[] = [
  {
    id: 'agent-contract-risk',
    name: '合同风控与履约协同智能体',
    role: '法务风控与跨系统履约数字专家',
    projectId: 'proj-contract',
    mcpIds: ['mcp-contract-server', 'mcp-mft-server'],
    skillIds: ['skill-contract-clm'],
    modelId: 'auto/glm-5.3-flash',
    systemPrompt:
      '你是基于《合同全生命周期管理系统》11元模型驱动的智能体。在执行任何合同起草、审批、MFT跨网归档或结算指令前，必须严格遵循 M3 规则模型（如 RULE-01 百万级合同相对方 AA/AAA 资信要求、RULE-03 结算总额上限守恒）。',
    status: 'ACTIVE',
  },
  {
    id: 'agent-contract-copilot',
    name: '合同合规审查与履约协同智能体',
    role: '法务风控与商务履约数字专家',
    projectId: 'proj-contract',
    mcpIds: ['mcp-contract-server', 'mcp-mft-server'],
    skillIds: ['skill-contract-clm'],
    modelId: 'auto/glm-5.3-flash',
    systemPrompt:
      '你是基于《合同全生命周期管理系统》11元模型驱动的智能体。在执行任何合同起草、审批或结算指令前，必须严格遵循 M3 规则模型（如 RULE-01 百万级合同相对方 AA/AAA 资信要求、RULE-03 结算总额上限守恒）。',
    status: 'ACTIVE',
  },
];

export const SEED_CAPABILITY_CHAT_SESSIONS: CapabilityChatSession[] = [
  {
    id: 'cap-chat-contract-risk-01',
    agentId: 'agent-contract-risk',
    projectId: 'proj-contract',
    title: '华东区半导体逾期合同排查与 M3 资信红线核验',
    messages: [
      {
        id: 'cap-msg-1',
        role: 'user',
        content: '请帮我核查华东区半导体高风险外包合同的履约结算情况，并校验是否触发 RULE-01 与 RULE-03 风控规则。',
        timestamp: '2026-11-10T09:35:00.000Z',
      },
      {
        id: 'cap-msg-2',
        role: 'assistant',
        content:
          '已通过 `mcp-contract-server` 检索合同台账并完成 M3 规则门禁核验：\n1. **华东区半导体逾期外包合同共 3 份**（`CT-2026-0002`、`CT-2026-0003`、`CT-2026-0004`），待核销逾期结算单合计 **¥ 2,886,000**。\n2. 其中 `CT-2026-0003`（¥185万）与 `CT-2026-0004`（¥240万）签约相对方资信等级为 `A` 级，已触发 **`RULE-01` 百万级合同资信准入预警**；全部合同累计结算额均满足 **`RULE-03` 总额守恒约束**。建议通过 `WB-01` 冻结后续批次付款并推送法务催办。',
        timestamp: '2026-11-10T09:35:06.000Z',
        toolInvocations: [
          {
            toolName: 'm2_queryContractLedger',
            arguments: { contractType: 'OUTSOURCING', status: 'EXECUTING' },
            output: '{"matchedContracts":3,"overdueSettlementTotal":2886000,"region":"华东区"}',
          },
        ],
      },
    ],
    updatedAt: '2026-11-10T09:35:06.000Z',
  },
];

export const SEED_CROSS_SYSTEM_FLOWS: CrossSystemFlow[] = [
  {
    id: 'xflow-contract-seal-archive',
    name: '合同终审放行 -> CA电子签章 -> MFT跨网归档 -> ERP首期结算协同流',
    description:
      '打通合同管理系统 (CLM)、CA 电子签章网关、MFT 安全文件传输平台与财务结算模块的跨系统自动化流程协同。',
    involvedSystems: ['存量 ERP 合同与客商主数据系统', '电子签章服务网关', '企业跨网大文件安全传输平台 (MFT)'],
    triggerEvent: 'EVT-03 (Contract.ApprovedAndSigned)',
    steps: [
      {
        stepOrder: 1,
        systemName: '存量 ERP 合同与客商主数据系统',
        mcpToolName: 'm2_approveContract',
        description: '调用 BHV-03 完成法务终审状态流转并校验 RULE-03 结算额度守恒',
        status: 'SUCCESS',
      },
      {
        stepOrder: 2,
        systemName: '电子签章服务网关',
        mcpToolName: 'mi_IF-EXT-ESIGN-03',
        description: '调用外部 CA 电子签章接口固化合同 PDF 数字签名',
        status: 'SUCCESS',
      },
      {
        stepOrder: 3,
        systemName: '企业跨网大文件安全传输平台 (MFT)',
        mcpToolName: 'm2_dispatchSecureTransfer',
        description: '通过 MFT 将已签章合同加密归档至内网档案库',
        status: 'SUCCESS',
      },
      {
        stepOrder: 4,
        systemName: '存量 ERP 合同与客商主数据系统',
        mcpToolName: 'm2_createInitialSettlement',
        description: '触发 BHV-04 自动生成首期履约待核销结算单',
        status: 'SUCCESS',
      },
    ],
    lastRunAt: '2026-11-10T09:30:00.000Z',
    lastRunStatus: 'SUCCESS',
    executionLogs: [
      '[09:30:01] 收到触发事件 EVT-03 (Contract.ApprovedAndSigned) · 合同编号 CT-2026-0001',
      '[09:30:02] Step 1 [ERP-CLM] 调用 m2_approveContract 成功 -> 状态流转为 EXECUTING',
      '[09:30:03] Step 2 [CA-ESIGN] 调用 mi_IF-EXT-ESIGN-03 成功 -> 签章流水号 SEAL-20261110-8891',
      '[09:30:04] Step 3 [MFT-GATEWAY] 调用 m2_dispatchSecureTransfer 成功 -> 传输单号 MFT-2026-0412 (SHA256 校验一致)',
      '[09:30:05] Step 4 [ERP-CLM] 调用 m2_createInitialSettlement 成功 -> 首期结算单 STL-2026-0098 已生成 (¥ 720,000.00)',
    ],
  },
];

export const SEED_KNOWLEDGE_ENTRIES: KnowledgeEntry[] = [
  {
    id: 'know-01',
    title: '企业商务合同风险分级与资信准入管理办法 (2026版)',
    category: 'BUSINESS_POLICY',
    tags: ['法务合规', 'RULE-01', 'RULE-02'],
    content: `# 企业商务合同风险分级与资信准入管理办法

1. **百万级合同资信红线（映射 RULE-01）**：单笔合同总金额超过 ¥1,000,000 时，签约相对方资信评级必须为 \`AAA\` 或 \`AA\`。
2. **三级风险定级标准（映射 RULE-02）**：
   - \`HIGH\`（高风险）：合同金额 ≥ ¥2,000,000 或涉及跨境知识产权授权，必须经法务总监终审。
   - \`MEDIUM\`（中风险）：¥500,000 ≤ 合同金额 < ¥2,000,000，需部门主管与法务专员会签。
   - \`LOW\`（低风险）：合同金额 < ¥500,000 且采用标准合同模板，支持快速通道放行。`,
    linkedProjectId: 'proj-contract',
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'know-02',
    title: '存量业务系统本体萃取（Ontology Extraction）实施指南',
    category: 'EXTRACTION_GUIDE',
    tags: ['本体萃取', '存量系统本体化', 'MCP封装'],
    content: `# 存量业务系统本体萃取实施指南

针对企业既有 ERP、MFT、CRM 等存量系统，无需推倒重写，通过 **数据库表结构 (DDL) + 接口文档 (OpenAPI) + 业务制度文档** 三源融合萃取：
1. 从物理表主外键提炼 \`M1\` 聚合根与 \`MM\` 数据表映射模型；
2. 从服务接口提炼 \`M2\` 行为模型与 \`MI\` 接口模型；
3. 从校验逻辑与制度文档提炼 \`M3\` 规则模型与 \`ME\` 事件模型；
4. 一键发布为标准 **MCP Server** 与 **Skill 技能包**，赋能智能体跨系统协同。`,
    linkedProjectId: 'proj-mft',
    updatedAt: '2026-11-10T08:20:00.000Z',
  },
];

export const SEED_DATABASE_RESOURCES: DatabaseResource[] = [
  {
    id: 'db-clm-dw',
    name: '业财合同与履约分析主数仓 (SQLite / Cloudflare D1)',
    dialect: 'SQLite',
    connectionUri: 'sqlite://.onto-cs/onto-cs.db',
    status: 'ONLINE',
    tables: [
      {
        tableName: '__dict',
        comment: '全域标准数据字典表 (映射 M1 DataDictionary)',
        rowCount: SEED_DICT_ROWS.length,
        columns: [
          { name: 'id', type: 'TEXT', comment: '主键ID' },
          { name: 'dict_id', type: 'TEXT', comment: '字典编号' },
          { name: 'type_code', type: 'TEXT', comment: '字典分类编码' },
          { name: 'item_code', type: 'TEXT', comment: '字典项编码' },
          { name: 'item_label', type: 'TEXT', comment: '字典项中文名称' },
        ],
      },
      {
        tableName: 't_counterparty',
        comment: '签约相对方资信表 (映射 M1 Counterparty)',
        rowCount: SEED_COUNTERPARTY_ROWS.length,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'credit_code', type: 'CHAR(18)', comment: '统一社会信用代码' },
          { name: 'company_name', type: 'VARCHAR(128)', comment: '企业全称' },
          { name: 'industry', type: 'VARCHAR(64)', comment: '所属行业' },
          { name: 'region', type: 'VARCHAR(32)', comment: '所属大区' },
          { name: 'credit_rating', type: 'VARCHAR(8)', comment: '资信等级 AAA~C' },
          { name: 'status', type: 'VARCHAR(16)', comment: '准入状态' },
        ],
      },
      {
        tableName: 't_contract',
        comment: '商务合同主表 (映射 M1 Contract)',
        rowCount: SEED_CONTRACT_ROWS.length,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'contract_no', type: 'VARCHAR(32)', comment: '合同编号' },
          { name: 'title', type: 'VARCHAR(128)', comment: '合同名称' },
          { name: 'contract_type', type: 'VARCHAR(32)', comment: '合同类型' },
          { name: 'counterparty_id', type: 'VARCHAR(36)', comment: '相对方ID' },
          { name: 'region', type: 'VARCHAR(32)', comment: '所属区域' },
          { name: 'industry', type: 'VARCHAR(64)', comment: '行业板块' },
          { name: 'total_amount', type: 'DECIMAL(18,2)', comment: '合同总金额' },
          { name: 'risk_level', type: 'VARCHAR(16)', comment: '风险等级' },
          { name: 'status', type: 'VARCHAR(24)', comment: '履约状态' },
          { name: 'overdue_days', type: 'INTEGER', comment: '逾期天数' },
        ],
      },
      {
        tableName: 't_contract_line_item',
        comment: '合同标的明细子表 (映射 M1 Contract.ContractLineItem)',
        rowCount: SEED_CONTRACT_LINE_ITEM_ROWS.length,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'contract_id', type: 'VARCHAR(36)', comment: '关联合同ID' },
          { name: 'item_name', type: 'VARCHAR(128)', comment: '标的名称' },
          { name: 'quantity', type: 'INTEGER', comment: '数量' },
          { name: 'unit_price', type: 'DECIMAL(18,2)', comment: '含税单价' },
          { name: 'subtotal_amount', type: 'DECIMAL(18,2)', comment: '明细小计金额' },
        ],
      },
      {
        tableName: 't_payment_milestone',
        comment: '合同收付款里程碑表 (映射 M1 Contract.PaymentMilestone)',
        rowCount: SEED_PAYMENT_MILESTONE_ROWS.length,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'contract_id', type: 'VARCHAR(36)', comment: '关联合同ID' },
          { name: 'phase_name', type: 'VARCHAR(64)', comment: '阶段名称' },
          { name: 'planned_amount', type: 'DECIMAL(18,2)', comment: '计划付款金额' },
          { name: 'due_date', type: 'DATE', comment: '计划到期日' },
          { name: 'milestone_status', type: 'VARCHAR(16)', comment: '里程碑状态' },
          { name: 'overdue_days', type: 'INTEGER', comment: '逾期天数' },
        ],
      },
      {
        tableName: 't_settlement_order',
        comment: '合同履约结算事实表 (映射 M1 SettlementOrder)',
        rowCount: SEED_SETTLEMENT_ORDER_ROWS.length,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'settlement_no', type: 'VARCHAR(32)', comment: '结算单号' },
          { name: 'contract_ref', type: 'VARCHAR(36)', comment: '关联合同ID' },
          { name: 'settlement_amount', type: 'DECIMAL(18,2)', comment: '结算金额' },
          { name: 'settlement_status', type: 'VARCHAR(16)', comment: '结算状态' },
          { name: 'overdue_days', type: 'INTEGER', comment: '逾期天数' },
        ],
      },
      {
        tableName: 't_mft_work_order',
        comment: 'MFT 跨网安全归档传输工单表 (映射 MFT TransferTask)',
        rowCount: SEED_MFT_WORK_ORDER_ROWS.length,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'work_order_no', type: 'VARCHAR(32)', comment: '传输工单号' },
          { name: 'contract_ref', type: 'VARCHAR(36)', comment: '关联合同ID' },
          { name: 'file_name', type: 'VARCHAR(255)', comment: '归档文件名称' },
          { name: 'file_size_mb', type: 'DECIMAL(12,2)', comment: '文件大小(MB)' },
          { name: 'status', type: 'VARCHAR(24)', comment: '传输状态' },
        ],
      },
    ],
  },
];

export const SEED_DATA_DOCUMENTS: DataDocument[] = [
  {
    id: 'ddoc-01',
    title: '业财合同主题域数仓分层与指标口径说明书',
    category: 'METRIC_DICT',
    content: `# 业财合同主题域指标口径说明

- **合同履约结算达成率**：\`SUM(已付结算单金额) / SUM(生效合同总金额)\`，正常阈值 ≥ 85%。
- **高风险合同占比**：\`COUNT(risk_level = 'HIGH') / COUNT(全部生效合同)\`，预警阈值 > 15%。
- **大额合同逾期未结算率**：超过里程碑计划付款日 15 天仍处于 \`PENDING\` 状态的结算金额占比。`,
    updatedAt: '2026-11-10T08:40:00.000Z',
  },
];

export const SEED_DATA_MAPPINGS: DataMappingRule[] = [
  {
    id: 'dmap-01',
    ontologyObject: 'Contract',
    ontologyAttribute: 'Contract.totalAmount',
    sourceDatabaseId: 'db-clm-dw',
    sourceTable: 't_contract',
    sourceColumn: 'total_amount',
    transformExpr: 'CAST(total_amount AS DECIMAL(18,2))',
    qualityRule: 'total_amount > 0 AND total_amount IS NOT NULL',
  },
  {
    id: 'dmap-02',
    ontologyObject: 'Counterparty',
    ontologyAttribute: 'Counterparty.creditRating',
    sourceDatabaseId: 'db-clm-dw',
    sourceTable: 't_counterparty',
    sourceColumn: 'credit_rating',
    transformExpr: 'UPPER(TRIM(credit_rating))',
    qualityRule: "credit_rating IN ('AAA', 'AA', 'A', 'B', 'C')",
  },
  {
    id: 'dmap-03',
    ontologyObject: 'SettlementOrder',
    ontologyAttribute: 'SettlementOrder.settlementAmount',
    sourceDatabaseId: 'db-clm-dw',
    sourceTable: 't_settlement_order',
    sourceColumn: 'settlement_amount',
    transformExpr: 'COALESCE(settlement_amount, 0)',
    qualityRule: 'settlement_amount > 0',
  },
];

export const SEED_METRICS: MetricDefinition[] = [
  {
    id: 'MET-01',
    code: 'CONTRACT_SETTLEMENT_RATE',
    name: '合同履约结算达成率',
    category: '履约效率',
    formula: 'SUM(SettlementOrder.settlementAmount) / SUM(Contract.totalAmount)',
    unit: '%',
    currentValue: '88.4%',
    yoYChange: '+4.2%',
    status: 'NORMAL',
    dimensions: ['合同类型 (contractType)', '风险等级 (riskLevel)', '相对方资信 (creditRating)'],
    linkedAggregate: 'Contract',
  },
  {
    id: 'MET-02',
    code: 'HIGH_RISK_OVERDUE_RATIO',
    name: '高风险合同逾期未结算率',
    category: '法务与资金风控',
    formula: "SUM(OverdueSettlement.amount WHERE Contract.riskLevel='HIGH') / SUM(HighRiskContract.totalAmount)",
    unit: '%',
    currentValue: '14.8%',
    yoYChange: '+3.1%',
    status: 'WARNING',
    dimensions: ['相对方资信 (creditRating)', '所属大区 (region)'],
    linkedAggregate: 'SettlementOrder',
  },
  {
    id: 'MET-03',
    code: 'AVG_APPROVAL_CYCLE_HOURS',
    name: '法务风险会签平均周期',
    category: '流程效能',
    formula: 'AVG(approvedAt - submittedAt)',
    unit: '小时',
    currentValue: '16.5h',
    yoYChange: '-28.0%',
    status: 'NORMAL',
    dimensions: ['风险等级 (riskLevel)'],
    linkedAggregate: 'Contract',
  },
];

export const SEED_ANALYTICS_SCENARIOS: AnalyticsScenario[] = [
  {
    id: 'ascn-01',
    name: '大额高风险合同逾期未结算归因与资信动态降级分析场景',
    domain: '合同全生命周期管理系统',
    triggerCondition: 'HIGH_RISK_OVERDUE_RATIO > 12%',
    relatedMetrics: ['MET-01', 'MET-02'],
    causalFactors: [
      '华东区 A 级资信半导体外包服务商在 Q3 集中出现里程碑验收材料缺失（占比 71.5%）',
      '部分技术服务外包合同未绑定自动电子签章回执校验，导致财务核销挂起',
    ],
    recommendedActions: [
      '对连续 2 期逾期超过 15 天的相对方自动触发资信降级预警（AA -> A）',
      '调用回写接口 WB-01 冻结高风险逾期合同的后续批次付款并推送法务催告函',
    ],
    writebackInterfaceId: 'WB-01',
  },
];

export const SEED_ANALYTICS_REPORTS: AnalyticsReport[] = [
  {
    id: 'arpt-2026-q4',
    title: '2026 Q4 企业商务合同履约健康度与风险归因分析报告',
    period: '2026-Q4',
    author: '数据本体推理引擎 (Data Ontology Reasoner)',
    summary:
      '全公司生效合同总额 ¥1,921 万，整体结算达成率良好，但华东区半导体技术外包类高风险合同逾期率偏高，建议通过回写接口收紧 A 级相对方首付款比例。',
    markdownContent: `# 2026 Q4 企业商务合同履约健康度与风险归因分析报告

## 一、核心经营指标概览（智能问数结论）
- **生效合同总金额**：\`¥ 19,210,000.00\`（环比 \`+11.4%\`）
- **合同履约结算达成率 (\`MET-01\`)**：\`88.4%\`（处于健康区间）
- **高风险合同逾期未结算率 (\`MET-02\`)**：\`14.8%\`（触发黄色预警阈值 \`12.0%\`）

## 二、异常波动根因穿透（智能问因结论）
沿着 \`Contract -> Counterparty -> SettlementOrder\` 本体关联路径下钻发现：
1. **区域与行业维度**：\`华东区\` 半导体 \`OUTSOURCING\`（技术服务外包合同）贡献了全部高风险逾期未结算金额（\`¥ 2,886,000\`）；
2. **相对方资信维度**：资信等级为 \`A\` 级的半导体外包供应商在二期里程碑交付物签署环节平均逾期 \`24.7\` 天。

## 三、策略建议与业务回写（智能问策结论）
1. **立即执行**：调用 **\`WB-01 高风险逾期合同催收与结算冻结回写接口\`**，对逾期超 15 天的 3 份华东区高风险合同自动锁定下期付款并发送法务催办通知。
2. **规则优化**：建议将 \`M3\` 中 \`RULE-01\` 的大额合同准入阈值从 \`100万\` 下调至 \`80万\`。`,
    createdAt: '2026-11-10T09:40:00.000Z',
  },
];

export const SEED_REASONING_SESSIONS: ReasoningSession[] = [
  {
    id: 'reas-01',
    question: '为什么本季度高风险合同逾期未结算率上升到了 14.8%？应该采取什么处置策略并回写业务系统？',
    mode: 'ASK_POLICY',
    sqlGenerated:
      "SELECT c.contract_type, cp.credit_rating, COUNT(c.id) AS cnt, SUM(so.settlement_amount) AS overdue_amt FROM t_contract c JOIN t_counterparty cp ON c.counterparty_id = cp.id JOIN t_settlement_order so ON so.contract_ref = c.id WHERE c.risk_level = 'HIGH' AND so.settlement_status = 'PENDING' GROUP BY c.contract_type, cp.credit_rating ORDER BY overdue_amt DESC",
    dataSummary: [
      { label: '高风险逾期总额', value: '¥ 2,886,000', delta: '+3.1%' },
      { label: '华东半导体外包占比', value: '100%', delta: '主因' },
      { label: 'A级资信相对方逾期笔数', value: '3 笔', delta: '超15天' },
    ],
    causalAnalysis: [
      '【对象层 M1 关联穿透】Contract(OUTSOURCING, 华东区半导体) -> Counterparty(creditRating=A) 组合贡献了全部待核销逾期结算单。',
      '【规则层 M3 阈值对照】当前 RULE-01 仅对 >100万合同强制要求 AA/AAA 级资信，导致 80万~100万区间的高风险外包合同流入 A 级供应商。',
    ],
    policyRecommendations: [
      {
        actionTitle: '触发高风险逾期合同付款冻结与法务催办',
        targetObject: 'Contract / SettlementOrder',
        expectedImpact: '预计 7 日内追回逾期结算款 ¥288.6 万，降低逾期率至 6.5% 以下',
        writebackInterfaceId: 'WB-01',
      },
    ],
    answerMarkdown: `### 1. 智能问数 (Data Retrieval)\n检索 \`t_contract\` 与 \`t_settlement_order\` 发现，高风险合同待核销逾期总额为 **¥ 2,886,000**（逾期率 **14.8%**）。\n\n### 2. 智能问因 (Causal Attribution)\n沿本体知识图谱关系链 \`Contract -> Counterparty -> SettlementOrder\` 归因：\n- 逾期金额集中在 **华东区半导体** \`OUTSOURCING\`（技术外包）类型且相对方资信为 \`A\` 级的合同；\n- \`RULE-01\` 资信门槛当前设定在 100 万元，80~100 万区间合同存在风控敞口。\n\n### 3. 智能问策 (Actionable Policy)\n建议立即调用回写接口 **\`WB-01\`** 批量冻结逾期结算单并推送法务催收待办。`,
    createdAt: '2026-11-10T09:42:00.000Z',
  },
];

export const SEED_WRITEBACK_INTERFACES: WritebackInterface[] = [
  {
    id: 'WB-01',
    name: '高风险逾期合同催收与结算冻结回写接口',
    targetSystem: '合同全生命周期管理系统 (CLM)',
    protocol: 'REST_POST',
    endpoint: '/api/mcp/proj-contract',
    boundBehaviorRef: 'BHV-03',
    payloadTemplate: {
      action: 'FREEZE_OVERDUE_SETTLEMENT_AND_NOTIFY_LEGAL',
      riskLevelFilter: 'HIGH',
      overdueDaysThreshold: 15,
      operatorRole: 'ROLE-DEPT-MGR',
    },
    executionCount: 2,
    lastExecutedAt: '2026-11-10T09:45:00.000Z',
    lastExecutionResult: '已成功回写业务系统：锁定 3 笔逾期结算单并向法务主管推送催收任务（状态码 200）',
  },
];

export const SEED_LLM_PROVIDERS: LlmProviderConfig[] = [
  {
    id: 'llm-pi-local',
    name: 'Magpie Local Gateway (Pi · GLM-5.3-Flash)',
    providerType: 'OPENAI_COMPATIBLE',
    baseUrl: 'http://127.0.0.1:3425/v1',
    apiKey: 'magpie',
    defaultModel: 'auto/glm-5.3-flash',
    availableModels: [
      'auto/glm-5.3-flash',
      'zhipu/glm-5.3-flash',
      'workbuddy-ai/glm-5.3-flash',
      'auto/glm-5.2',
    ],
    enabled: true,
    lastTestedStatus: 'OK',
    lastTestedMessage: 'Connected to local Pi gateway (http://127.0.0.1:3425/v1 · auto/glm-5.3-flash)',
  },
];

export const SEED_SYSTEM_SETTINGS: SystemSettingsState = {
  workspaceDir: '.onto-cs',
  defaultLanguage: 'zh-CN',
  defaultTheme: 'system',
  strictValidation: true,
  autoMirrorYaml: true,
  autoSyncPrototypeMu: true,
  mockLlmMode: false,
};

export const SEED_PROJECT_SNAPSHOTS: ProjectSnapshot[] = [
  {
    id: 'snap-contract-baseline',
    projectId: 'proj-contract',
    label: 'v5.0 基准全套 11 元模型快照',
    note: '合同全生命周期管理系统基准快照（0 错误 · 11/11 模型完备）',
    presentModels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'ME', 'MU', 'MM', 'MI'],
    errorCount: 0,
    warningCount: 0,
    suite: CONTRACT_LIFECYCLE_SUITE,
    createdAt: '2026-11-10T09:00:00.000Z',
  },
];

export const SEED_AGENT_SESSIONS: AgentSession[] = [
  {
    id: 'asess-req-01',
    projectId: 'proj-contract',
    agentKind: 'REQUIREMENT',
    targetId: 'req-sess-01',
    title: '商务合同履约与结算规则探索',
    pinned: true,
    status: 'IDLE',
    createdAt: '2026-11-10T09:05:00.000Z',
    updatedAt: '2026-11-10T09:10:00.000Z',
    messages: [
      {
        id: 'amsg-req-1',
        role: 'user',
        content: '我们需要建设一套企业级合同全生命周期管理系统，涵盖相对方准入、大额会签、履约里程碑与结算回款。',
        timestamp: '2026-11-10T09:05:00.000Z',
      },
      {
        id: 'amsg-req-2',
        role: 'assistant',
        thinking: '识别合同全生命周期核心聚合根（Contract, Counterparty, SettlementOrder）与关键准入/里程碑校验规则。',
        thinkingDurationMs: 1240,
        content:
          '已完成首轮领域实体与规则收敛：\n\n1. **M1 领域聚合根**：`Contract`（含 `ContractLineItem`、`PaymentMilestone`）、`Counterparty`、`SettlementOrder`\n2. **M3 刚性业务规则**：大额合同资信准入（`RULE-01`）、里程碑收款比例守恒 100%（`RULE-02`）\n\n您可以继续补充多币种折算、印章用印策略或直接生成 **结构化 SRS 需求规格书**。',
        timestamp: '2026-11-10T09:06:00.000Z',
        artifacts: [
          {
            kind: 'REQUIREMENT_HINTS',
            aggregates: ['Contract', 'Counterparty', 'SettlementOrder'],
            rules: ['RULE-01 大额合同资信准入', 'RULE-02 里程碑收款比例守恒 100%'],
            openQuestions: ['跨境合同汇率锁定基准日采取签约日还是结算日？'],
          },
        ],
      },
    ],
  },
  {
    id: 'asess-copilot-01',
    projectId: 'proj-contract',
    agentKind: 'COPILOT',
    title: '11 元模型本体建模助手主会话',
    pinned: true,
    status: 'IDLE',
    createdAt: '2026-11-10T09:15:00.000Z',
    updatedAt: '2026-11-10T09:15:00.000Z',
    messages: [
      {
        id: 'amsg-cop-1',
        role: 'assistant',
        content:
          '您好！我是 **AI 本体助手 (Ontology Copilot)**。所有工具调用默认自动执行并通过 `ontology-core` 双层一致性校验器守门。您可以直接要求：\n- 为 `Contract` 新增字段或业务不变量\n- 在 `M3` 新增业务规则并关联 `M2` 行为\n- 检查跨模型引用完整性或执行级联重命名',
        timestamp: '2026-11-10T09:15:00.000Z',
      },
    ],
  },
  {
    id: 'asess-cap-01',
    projectId: 'proj-contract',
    agentKind: 'CAPABILITY',
    targetId: 'ag-contract-copilot',
    title: '高风险合同审查与结算巡检对话',
    pinned: true,
    status: 'IDLE',
    createdAt: '2026-11-10T09:30:00.000Z',
    updatedAt: '2026-11-10T09:32:00.000Z',
    messages: [
      {
        id: 'amsg-cap-1',
        role: 'user',
        content: '帮我巡检当前高风险合同台账并核对是否存在逾期未结算风险。',
        timestamp: '2026-11-10T09:30:00.000Z',
      },
      {
        id: 'amsg-cap-2',
        role: 'assistant',
        thinking: '调用 MCP 查询工具检索高风险合同及关联结算单逾期状态。',
        thinkingDurationMs: 960,
        content:
          '已通过 MCP 服务查询合同与结算台账：共命中 **3 份** `HIGH` 风险等级生效合同，其中华东区技术服务外包合同存在超 15 天待核销结算单，建议启动法务催办流程。',
        timestamp: '2026-11-10T09:32:00.000Z',
        toolCalls: [
          {
            id: 'tc-seed-1',
            toolName: 'mcp_query_contracts',
            arguments: { riskLevel: 'HIGH' },
            output: '{"matchedContracts":3,"overdueSettlementAmount":2886000}',
            durationMs: 42,
          },
        ],
      },
    ],
  },
  {
    id: 'asess-reason-01',
    projectId: 'proj-contract',
    agentKind: 'REASONING',
    reasoningMode: 'ASK_POLICY',
    title: 'Q4 高风险合同逾期归因与策略回写',
    pinned: true,
    status: 'IDLE',
    createdAt: '2026-11-10T09:42:00.000Z',
    updatedAt: '2026-11-10T09:42:00.000Z',
    messages: [
      {
        id: 'amsg-reas-1',
        role: 'user',
        content: '为什么本季度高风险合同逾期未结算率上升到了 14.8%？应该采取什么处置策略并回写业务系统？',
        timestamp: '2026-11-10T09:42:00.000Z',
      },
      {
        id: 'amsg-reas-2',
        role: 'assistant',
        thinking: '沿 M1(Contract -> Counterparty -> SettlementOrder) 与 MM 物理表映射执行实库聚合 SQL，并对照 M3 RULE-01 准入阈值定位风控敞口。',
        thinkingDurationMs: 1450,
        content:
          '### 1. 智能问数 (Data Retrieval)\n检索 `t_contract` 与 `t_settlement_order` 发现，高风险合同待核销逾期总额为 **¥ 2,886,000**（逾期率 **14.8%**）。\n\n### 2. 智能问因 (Causal Attribution)\n沿本体知识图谱关系链 `Contract -> Counterparty -> SettlementOrder` 归因：\n- 逾期金额集中在 **华东区半导体** `OUTSOURCING`（技术外包）类型且相对方资信为 `A` 级的合同；\n- `RULE-01` 资信门槛当前设定在 100 万元，80~100 万区间合同存在风控敞口。\n\n### 3. 智能问策 (Actionable Policy)\n建议立即调用回写接口 **`WB-01`** 批量冻结逾期结算单并推送法务催收待办。',
        timestamp: '2026-11-10T09:42:05.000Z',
        artifacts: [
          {
            kind: 'REASONING_POLICY',
            mode: 'ASK_POLICY',
            dataSummary: [
              { label: '高风险逾期总额', value: '¥ 2,886,000', delta: '+3.1%' },
              { label: '华东半导体外包占比', value: '100%', delta: '主因' },
              { label: 'A级资信相对方逾期笔数', value: '3 笔', delta: '超15天' },
            ],
            causalAnalysis: [
              '【对象层 M1 关联穿透】Contract(OUTSOURCING, 华东区半导体) -> Counterparty(creditRating=A) 组合贡献了全部待核销逾期结算单。',
              '【规则层 M3 阈值对照】当前 RULE-01 仅对 >100万合同强制要求 AA/AAA 级资信，导致 80万~100万区间的高风险外包合同流入 A 级供应商。',
            ],
            policyRecommendations: [
              {
                actionTitle: '触发高风险逾期合同付款冻结与法务催办',
                targetObject: 'Contract / SettlementOrder',
                expectedImpact: '预计 7 日内追回逾期结算款 ¥288.6 万，降低逾期率至 6.5% 以下',
                writebackInterfaceId: 'WB-01',
              },
            ],
          },
        ],
      },
    ],
  },
];

