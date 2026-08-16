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

  // ---- Our income ----
  const incomeKept = round2(totalApplied * rate);
  const incomeExpectedTotal = round2(invoiceTotal * rate);
  const incomeRemaining = round2(Math.max(0, incomeExpectedTotal - incomeKept));

  // ---- Supplier reserve (the 96%) ----
  const supplierReserveCollected = round2(totalApplied - incomeKept);

  // ---- Supplier invoices / batches ----
  const supplierInvoicesGross = round2(si.reduce((a, b) => a + (Number(b.actual_total) || 0), 0));
  const prepayCreditApplied = round2(
    si.reduce((a, b) => a + (Number(b.prepay_credit_applied) || 0), 0)
  );
  const proformaAllocated = round2(si.reduce((a, b) => a + (Number(b.proforma_allocated) || 0), 0));
  const deliveredSalesValue = round2(
    si.reduce((a, b) => a + (Number(b.customer_sales_value) || 0), 0)
  );

  // Payments made against commercial invoices (not prepayments).
  const supplierInvoicePaid = round2(
    sp.filter((p) => !p.is_prepayment).reduce((a, p) => a + (Number(p.amount) || 0), 0)
  );
  // Per-invoice open balance: actual_total - prepay credit - invoice payments linked to it.
  const invoicePaidById = {};
  for (const p of sp) {
    if (p.is_prepayment) continue;
    const id = p.invoice_id;
    if (id == null) continue;
    invoicePaidById[id] = round2((invoicePaidById[id] || 0) + (Number(p.amount) || 0));
  }
  let supplierInvoicesOpen = 0;
  const invoiceBalances = si.map((b) => {
    const paid = invoicePaidById[b.id] || 0;
    const open = round2(
      Math.max(0, (Number(b.actual_total) || 0) - (Number(b.prepay_credit_applied) || 0) - paid)
    );
    supplierInvoicesOpen = round2(supplierInvoicesOpen + open);
    return { id: b.id, paid, open };
  });
  const openInvoiceCount = invoiceBalances.filter((b) => b.open > 0.005).length;

  // ---- Supplier prepayment ----
  const supplierPrepaySent = round2(
    sp.filter((p) => p.is_prepayment).reduce((a, p) => a + (Number(p.amount) || 0), 0)
  );
  const supplierPrepayUnused = round2(Math.max(0, supplierPrepaySent - prepayCreditApplied));
  const supplierPrepayOverApplied = round2(Math.max(0, prepayCreditApplied - supplierPrepaySent));
  const supplierPrepayRemaining = round2(Math.max(0, suppPrepayReq - supplierPrepaySent));
  const supplierPrepayAbovePlan = round2(Math.max(0, supplierPrepaySent - suppPrepayReq));

  // ---- Delivery progress ----
  const deliveryPct = invoiceTotal > 0 ? round2((deliveredSalesValue / invoiceTotal) * 100) : 0;
  const deliveryOutstanding = round2(Math.max(0, invoiceTotal - deliveredSalesValue));
  const overDelivery = round2(Math.max(0, deliveredSalesValue - invoiceTotal));

  // ---- Profit reality vs the 4% target ----
  // Actual known supplier cost = documented commercial invoice totals so far.
  const actualSupplierCost = supplierInvoicesGross;
  // What we have actually set aside for the supplier from customer money.
  const reserveAvailableForSupplier = round2(supplierReserveCollected - supplierInvoicePaid);
  // If open supplier obligations exceed the reserve we hold, that gap needs funding.
  const supplierFundingShortfall = round2(
    Math.max(0, supplierInvoicesOpen - Math.max(0, reserveAvailableForSupplier))
  );
  // Company money used = supplier paid beyond the 96% reserve collected.
  const companyMoneyUsed = round2(Math.max(0, supplierInvoicePaid - supplierReserveCollected));
  // Forecast profit if the deal closes at current documented values.
  const forecastProfit = round2(invoiceTotal - actualSupplierCost);
  const targetProfit = incomeExpectedTotal; // the 4% target
  const profitVsTarget = round2(forecastProfit - targetProfit);

  const supplierOverpayment = round2(Math.max(0, supplierInvoicePaid + prepayCreditApplied - supplierInvoicesGross));

  return {
    rate,
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
    // supplier reserve
    supplierReserveCollected,
    reserveAvailableForSupplier,
    // supplier invoices
    supplierInvoicesGross,
    supplierInvoicesOpen,
    openInvoiceCount,
    prepayCreditApplied,
    proformaAllocated,
    supplierInvoicePaid,
    invoiceBalances,
    supplierOverpayment,
    // supplier prepayment
    suppPrepayReq,
    supplierPrepaySent,
    supplierPrepayUnused,
    supplierPrepayOverApplied,
    supplierPrepayRemaining,
    supplierPrepayAbovePlan,
    // delivery
    deliveredSalesValue,
    deliveryPct,
    deliveryOutstanding,
    overDelivery,
    // profit reality
    actualSupplierCost,
    supplierFundingShortfall,
    companyMoneyUsed,
    forecastProfit,
    targetProfit,
    profitVsTarget,
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

  if (c.supplierFundingShortfall > eps)
    return { code: 'resolve_funding', label: 'Resolve a funding difference', priority: 0 };

  if (c.custPrepayReq > eps && c.prepayRemaining > eps)
    return { code: 'customer_prepay', label: 'Record customer prepayment', priority: 1 };

  if (c.customerBalance > eps)
    return { code: 'customer_payment', label: 'Record the next customer payment', priority: 2 };

  if (c.suppPrepayReq > eps && c.supplierPrepayRemaining > eps)
    return { code: 'supplier_prepay', label: 'Send supplier prepayment', priority: 3 };

  if (c.supplierInvoicesOpen > eps)
    return { code: 'pay_supplier', label: 'Pay an open supplier invoice', priority: 4 };

  if (c.deliveryOutstanding > eps)
    return { code: 'add_delivery', label: 'Add the next delivery', priority: 5 };

  return { code: 'complete_deal', label: 'Complete the deal', priority: 6 };
}

module.exports = { round2, parseAmount, splitApplied, computeDeal, nextAction };
