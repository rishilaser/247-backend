const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'zoho-payments.log');

function sanitizeZohoPayload(pl) {
  if (!pl || typeof pl !== 'object') return pl;
  return {
    payment_link_id: pl.payment_link_id,
    reference_id: pl.reference_id,
    status: pl.status,
    payment_status: pl.payment_status,
    payment_link_status: pl.payment_link_status,
    amount: pl.amount,
    amount_paid: pl.amount_paid,
    amount_due: pl.amount_due,
    currency: pl.currency,
    payments: Array.isArray(pl.payments)
      ? pl.payments.map((p) => ({
          payment_id: p.payment_id,
          status: p.status,
          payment_status: p.payment_status,
          amount: p.amount,
          type: p.type,
        }))
      : undefined,
  };
}

/**
 * Log Zoho payment events to console + logs/zoho-payments.log (JSON lines).
 * @param {'sync'|'webhook'|'payment-link-create'|'zoho-api-error'} source
 * @param {'paid'|'pending'|'failed'|'cancelled'|'error'|'ignored'} outcome
 * @param {object} details
 */
function logZohoPaymentEvent(source, outcome, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    source,
    outcome,
    ...details,
  };

  const summary = `[Zoho ${source}] ${outcome} quotation=${details.quotationId || '-'} link=${details.paymentLinkId || '-'} status=${details.zohoStatus || '-'}`;
  console.log(summary);
  if (details.zohoPayload) {
    console.log('[Zoho payload]', JSON.stringify(sanitizeZohoPayload(details.zohoPayload), null, 2));
  }
  if (details.error) {
    console.log('[Zoho error]', details.error);
  }

  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const line = JSON.stringify({
      ...entry,
      zohoPayload: details.zohoPayload ? sanitizeZohoPayload(details.zohoPayload) : undefined,
    });
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch (err) {
    console.error('[Zoho logger] failed to write log file:', err.message);
  }
}

module.exports = {
  logZohoPaymentEvent,
  sanitizeZohoPayload,
  LOG_FILE,
};
