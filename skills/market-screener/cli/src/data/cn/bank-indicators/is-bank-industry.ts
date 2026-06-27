export function isCnBankIndustry(industryProxy: string | undefined): boolean {
  if (!industryProxy) return false;
  return industryProxy.includes("银行");
}
