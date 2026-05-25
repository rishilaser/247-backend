/** Customer-facing APIs must not expose draft quotations until admin sends them. */

function isQuotationVisibleToCustomer(status) {
  const s = String(status || '').trim().toLowerCase();
  return Boolean(s) && s !== 'draft';
}

function sanitizeQuotationForCustomer(quotation, isAdmin) {
  if (!quotation || isAdmin) return quotation;
  const status = typeof quotation === 'object' ? quotation.status : null;
  return isQuotationVisibleToCustomer(status) ? quotation : null;
}

function sanitizeInquiryForCustomer(inquiry, isAdmin) {
  if (!inquiry || isAdmin) return inquiry;
  const q = inquiry.quotation;
  if (!q || typeof q !== 'object') return inquiry;
  if (isQuotationVisibleToCustomer(q.status)) return inquiry;
  return { ...inquiry, quotation: null };
}

function filterQuotationMapForCustomer(quotationMap, isAdmin) {
  if (!quotationMap || isAdmin) return quotationMap || {};
  const filtered = {};
  Object.entries(quotationMap).forEach(([id, q]) => {
    if (q && isQuotationVisibleToCustomer(q.status)) {
      filtered[id] = q;
    }
  });
  return filtered;
}

module.exports = {
  isQuotationVisibleToCustomer,
  sanitizeQuotationForCustomer,
  sanitizeInquiryForCustomer,
  filterQuotationMapForCustomer,
};
