/**
 * Kenya statutory payroll calculations (2024/2025 bands — review annually).
 * NSSF Tier I/II, SHIF 2.75%, Housing Levy 1.5%, PAYE progressive bands.
 */

export interface PayrollBreakdown {
  grossPay: number;
  paye: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  totalDeductions: number;
  netPay: number;
}

const NSSF_TIER1_LIMIT = 7000;
const NSSF_TIER2_LIMIT = 36000;
const NSSF_RATE = 0.06;
const SHIF_RATE = 0.0275;
const HOUSING_LEVY_RATE = 0.015;
const PERSONAL_RELIEF = 2400;

function calcPaye(taxableIncome: number): number {
  let tax = 0;
  const bands = [
    { upTo: 24000, rate: 0.1 },
    { upTo: 32333, rate: 0.25 },
    { upTo: 500000, rate: 0.3 },
    { upTo: 800000, rate: 0.325 },
    { upTo: Infinity, rate: 0.35 },
  ];

  let remaining = taxableIncome;
  let prevLimit = 0;

  for (const band of bands) {
    const bandWidth = Math.min(remaining, band.upTo - prevLimit);
    if (bandWidth <= 0) break;
    tax += bandWidth * band.rate;
    remaining -= bandWidth;
    prevLimit = band.upTo;
    if (remaining <= 0) break;
  }

  return Math.max(0, tax - PERSONAL_RELIEF);
}

export function calculateKenyaPayroll(basicSalary: number, allowances = 0): PayrollBreakdown {
  const grossPay = basicSalary + allowances;

  const nssfTier1 = Math.min(grossPay, NSSF_TIER1_LIMIT) * NSSF_RATE;
  const nssfTier2 =
    grossPay > NSSF_TIER1_LIMIT
      ? Math.min(grossPay - NSSF_TIER1_LIMIT, NSSF_TIER2_LIMIT - NSSF_TIER1_LIMIT) * NSSF_RATE
      : 0;
  const nssf = Math.round((nssfTier1 + nssfTier2) * 100) / 100;

  const shif = Math.round(grossPay * SHIF_RATE * 100) / 100;
  const housingLevy = Math.round(grossPay * HOUSING_LEVY_RATE * 100) / 100;

  const taxableIncome = grossPay - nssf;
  const paye = Math.round(calcPaye(taxableIncome) * 100) / 100;

  const totalDeductions = paye + nssf + shif + housingLevy;
  const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

  return { grossPay, paye, nssf, shif, housingLevy, totalDeductions, netPay };
}
