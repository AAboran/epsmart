'use strict';

/**
 * finance.js
 * Pure functions. No database, no I/O. This is the single source of truth for
 * every money figure the application shows. Keeping it isolated means the math
 * can be reasoned about and tested without spinning up the server.
 *
 * Convention: all stored amounts are plain JS numbers in the deal currency.
 * Rounding to cents happens only at calculation boundaries via round2().
 */

function round2(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse international amount formats into a plain number.
 * Handles: 11000 | 11,000 | 11,000.50 | 11.000,50 | 11 000,50 | 1 234 567,89
 * Strategy:
 *   - strip currency symbols, spaces (incl. non-breaking / thin spaces)
 *   - if both "." and "," present, the LAST one is the decimal separator
 *   - if only one separator present, use a digits-after heuristic
 * Returns { value:Number, ok:Boolean }.
 */
function parseAmount(raw) {
  if (typeof raw === 'number') return { value: round2(raw), ok: Number.isFinite(raw) };
  if (raw === null || raw === undefined) return { value: 0, ok: false };

  let s = String(raw).trim();
  if (s === '') return { value: 0, ok: false };

  // Remove currency symbols and any spacing characters used as grouping.
  s = s.replace(/[€$£₽\s\u00A0\u202F\u2009]/g, '');
  // Keep only digits, separators and a leading sign.
  const sign = s.startsWith('-') ? -1 : 1;
  s = s.replace(/[^0-9.,]/g, '');
  if (s === '') return { value: 0, ok: false };

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized;

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator.
    if (lastComma > lastDot) {
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    const decimals = parts[parts.length - 1].length;
    if (parts.length > 2 || decimals === 3) {
      // 1,234,567 or 11,000 -> comma is a thousands separator
      normalized = s.replace(/,/g, '');
    } else {
      // 11,5 or 11,50 -> comma is the decimal separator
      normalized = s.replace(',', '.');
    }
  } else if (lastDot !== -1) {
    const parts = s.split('.');
    const decimals = parts[parts.length - 1].length;
    if (parts.length > 2 || decimals === 3) {
      // 1.234.567 or 11.000 (European grouping) -> dot is thousands
      normalized = s.replace(/\./g, '');
    } else {
      normalized = s; // 11.5 or 11.50 -> already a decimal point
    }
  } else {
    normalized = s;
  }

  const value = parseFloat(normalized);
  if (!Number.isFinite(value)) return { value: 0, ok: false };
  return { value: round2(sign * value), ok: true };
}

/** Split an applied customer amount into our income and the supplier reserve. */
function splitApplied(applied, rate) {
  const kept = round2(applied * rate);
  const reserved = round2(applied - kept); // reserved is the remainder, avoids rounding drift
  return { kept, reserved };
}

/**
 * Compute everything about one deal from its posted entries.
 * Inputs are already filtered to status === 'posted' (void/pending excluded) by
 * the caller, EXCEPT we also accept raw arrays and filter defensively here.
 *
 * deal: { invoice_total, proforma_total, customer_prepay_required,
 *         supplier_prepay_required, commission_rate }
 * customerPayments: [{ amount_applied, amount_received, is_prepayment, status }]
 * supplierInvoices: [{ proforma_allocated, actual_total, prepay_credit_applied,
 *                      customer_sales_value, status }]
 * supplierPayments: [{ amount, is_prepayment, invoice_id, status }]
 */
function computeDeal(deal, customerPayments, supplierInvoices, supplierPayments) {
  const rate = Number(deal.commission_rate) || 0.04;
  const invoiceTotal = round2(Number(deal.invoice_total) || 0);
  const proformaTotal = round2(Number(deal.proforma_total) || 0);
  const custPrepayReq = round2(Number(deal.customer_prepay_required) || 0);
  const suppPrepayReq = round2(Number(deal.supplier_prepay_required) || 0);

  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const cp = posted(customerPayments);
  const si = posted(supplierInvoices);
  const sp = posted(supplierPayments);

  // ---- Customer side ----
  const totalReceived = round2(cp.reduce((a, p) => a + (Number(p.amount_received) || 0), 0));
  const totalApplied = round2(cp.reduce((a, p) => a + (Number(p.amount_applied) || 0), 0));
  const customerOverpayment = round2(Math.max(0, totalReceived - invoiceTotal));
  const customerBalance = round2(Math.max(0, invoiceTotal - totalApplied));

  const prepayReceived = round2(
    cp.filter((p) => p.is_prepayment).reduce((a, p) => a + (Number(p.amount_applied) || 0), 0)
  );
  const prepayRemaining = round2(Math.max(0, custPrepayReq - prepayReceived));
  const prepayAbovePlan = round2(Math.max(0, prepayReceived - custPrepayReq));

  // ---- Our income = the markup we add (client invoice - supplier proforma) ----
  // Realized proportionally as the client pays. This reconciles exactly: once the
  // client has fully paid and the supplier is fully paid, cash held == our income.
  const dealMargin = round2(Math.max(0, invoiceTotal - proformaTotal));
  const keptRatio = invoiceTotal > 0 ? dealMargin / invoiceTotal : 0;
  const incomeExpectedTotal = dealMargin;
  const incomeKept = round2(totalApplied * keptRatio);
  const incomeRemaining = round2(Math.max(0, incomeExpectedTotal - incomeKept));
  const marginPct = proformaTotal > 0 ? round2((dealMargin / proformaTotal) * 100) : 0;

  // ---- Supplier reserve (the 96% of what the client has paid) ----
  const supplierReserveCollected = round2(totalApplied - incomeKept);

  // =====================================================================
  // PAYMENT LAYER (money to the supplier) — independent of deliveries.
  // What we owe the supplier is the agreed proforma total; what we've paid is
  // simply the sum of every payment we've sent them. Deliveries never change
  // this.
  // =====================================================================
  const supplierOwed = proformaTotal;
  const totalPaidToSupplier = round2(sp.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const supplierOpenToPay = round2(Math.max(0, supplierOwed - totalPaidToSupplier));
  const supplierOverpaid = round2(Math.max(0, totalPaidToSupplier - supplierOwed));

  // =====================================================================
  // DELIVERY LAYER (goods received, by batch) — purely informational.
  // We measure delivered value against the order value (customer invoice).
  // =====================================================================
  const deliveredValue = round2(si.reduce((a, b) => a + (Number(b.customer_sales_value) || 0), 0));
  const deliveryCount = si.length;
  const deliveryTarget = invoiceTotal;
  const deliveryPct = deliveryTarget > 0 ? round2((deliveredValue / deliveryTarget) * 100) : 0;
  const deliveryOutstanding = round2(Math.max(0, deliveryTarget - deliveredValue));
  const overDelivery = round2(Math.max(0, deliveredValue - deliveryTarget));

  // ---- Our position: cash in hand vs. our income ----
  const heldInHouse = round2(totalReceived - totalPaidToSupplier);
  const supplierShareHeld = round2(heldInHouse - incomeKept); // supplier money still with us
  const companyMoneyFronted = round2(Math.max(0, -supplierShareHeld));

  // ---- Profit vs the 4% target ----
  const forecastProfit = round2(invoiceTotal - supplierOwed); // the built-in margin
  const targetProfit = incomeExpectedTotal;
  const profitVsTarget = round2(forecastProfit - targetProfit);

  return {
    rate: keptRatio,           // the effective "our share" ratio applied to each receipt
    commissionRate: rate,      // the nominal rate stored on the deal (for reference)
    marginPct,
    dealMargin,
    invoiceTotal,
    proformaTotal,
    // customer
    totalReceived,
    totalApplied,
    customerBalance,
    customerOverpayment,
    custPrepayReq,
    prepayReceived,
    prepayRemaining,
    prepayAbovePlan,
    // income
    incomeKept,
    incomeExpectedTotal,
    incomeRemaining,
    supplierReserveCollected,
    // PAYMENT LAYER (supplier)
    supplierOwed,
    totalPaidToSupplier,
    supplierOpenToPay,
    supplierOverpaid,
    // DELIVERY LAYER
    deliveredValue,
    deliveryCount,
    deliveryTarget,
    deliveryPct,
    deliveryOutstanding,
    overDelivery,
    // position + profit
    heldInHouse,
    supplierShareHeld,
    companyMoneyFronted,
    forecastProfit,
    targetProfit,
    profitVsTarget,

    // ---- backward-compatible aliases (old field names still used by UI) ----
    supplierInvoicesGross: supplierOwed,
    supplierInvoicesOpen: supplierOpenToPay,
    supplierInvoicePaid: totalPaidToSupplier,
    supplierPrepaySent: 0,
    prepayCreditApplied: 0,
    proformaAllocated: 0,
    invoiceBalances: [],
    openInvoiceCount: 0,
    supplierOverpayment: supplierOverpaid,
    reserveAvailableForSupplier: round2(supplierReserveCollected - totalPaidToSupplier),
    supplierFundingShortfall: companyMoneyFronted,
    companyMoneyUsed: companyMoneyFronted,
    actualSupplierCost: supplierOwed,
    deliveredSalesValue: deliveredValue,
    suppPrepayReq: 0,
    supplierPrepayUnused: 0,
    supplierPrepayOverApplied: 0,
    supplierPrepayRemaining: 0,
    supplierPrepayAbovePlan: 0,
  };
}

/**
 * Decide the single most useful "next action" for a deal, given its computed
 * figures. Returns { code, label, priority } where lower priority sorts first.
 */
function nextAction(deal, c) {
  const eps = 0.005;
  if (deal.status === 'archived') return { code: 'archived', label: 'Archived', priority: 90 };
  if (deal.status === 'completed') return { code: 'complete', label: 'Completed', priority: 95 };

  if (c.companyMoneyFronted > eps)
    return { code: 'resolve_funding', label: 'You have paid the supplier ahead — check the balance', priority: 0 };

  if (c.customerBalance > eps)
    return { code: 'customer_payment', label: 'Record the next client payment', priority: 2 };

  if (c.supplierOpenToPay > eps)
    return { code: 'pay_supplier', label: 'Pay the supplier', priority: 4 };

  if (c.deliveryOutstanding > eps)
    return { code: 'add_delivery', label: 'Awaiting remaining deliveries', priority: 5 };

  return { code: 'complete_deal', label: 'Complete the deal', priority: 6 };
}

module.exports = { round2, parseAmount, splitApplied, computeDeal, nextAction };
