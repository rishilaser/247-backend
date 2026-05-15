const axios = require('axios');
const crypto = require('crypto');

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

/** Zoho GET/POST responses nest the link under `payment_links` (see Zoho Payments API docs). */
function extractZohoPaymentLinkPayload(zohoRespData) {
  const data = zohoRespData || {};
  let pl =
    data.payment_links ||
    data.payment_link ||
    data.paymentlink ||
    data.data?.payment_links ||
    data.data?.payment_link ||
    data;
  if (pl && typeof pl === 'object' && pl.payment_links && typeof pl.payment_links === 'object') {
    pl = pl.payment_links;
  }
  return pl;
}

function isZohoPaid(paymentLinkPayload) {
  const pl = paymentLinkPayload || {};

  const candidateStatuses = [
    pl.status,
    pl.payment_status,
    pl.payment_link_status,
    pl.link_status,
    pl.last_payment_status,
    pl.last_payment?.status,
    pl.data?.status,
    pl.data?.payment_status,
  ]
    .map(normalizeStatus)
    .filter(Boolean);

  const paidStatuses = new Set(['paid', 'success', 'succeeded', 'completed']);
  if (candidateStatuses.some((s) => paidStatuses.has(s))) {
    return { paid: true, statuses: candidateStatuses };
  }

  const paymentAttempts = Array.isArray(pl.payments) ? pl.payments : [];
  if (
    paymentAttempts.some(
      (p) =>
        paidStatuses.has(normalizeStatus(p?.status)) ||
        paidStatuses.has(normalizeStatus(p?.payment_status))
    )
  ) {
    return { paid: true, statuses: candidateStatuses };
  }

  const amount = Number(pl.amount ?? NaN);
  const amountPaid = Number(pl.amount_paid ?? NaN);
  if (Number.isFinite(amount) && Number.isFinite(amountPaid) && amount > 0 && amountPaid >= amount) {
    return { paid: true, statuses: candidateStatuses };
  }

  const amountDue = Number(pl.amount_due ?? pl.balance_due ?? NaN);
  if (Number.isFinite(amountDue) && Number.isFinite(amountPaid) && amountDue <= 0 && amountPaid > 0) {
    return { paid: true, statuses: candidateStatuses };
  }

  return { paid: false, statuses: candidateStatuses };
}

function isZohoFailedOrCancelled(paymentLinkPayload) {
  const pl = paymentLinkPayload || {};
  const candidateStatuses = [
    pl.status,
    pl.payment_status,
    pl.payment_link_status,
    pl.link_status,
    pl.last_payment_status,
    pl.last_payment?.status,
    pl.data?.status,
    pl.data?.payment_status,
  ]
    .map(normalizeStatus)
    .filter(Boolean);

  const failedStatuses = new Set([
    'failed',
    'failure',
    'cancelled',
    'canceled',
    'expired',
    'declined',
    'aborted',
  ]);

  if (candidateStatuses.some((s) => failedStatuses.has(s))) {
    return { failed: true, statuses: candidateStatuses };
  }

  const paymentAttempts = Array.isArray(pl.payments) ? pl.payments : [];
  if (
    paymentAttempts.some(
      (p) =>
        failedStatuses.has(normalizeStatus(p?.status)) ||
        failedStatuses.has(normalizeStatus(p?.payment_status))
    )
  ) {
    return { failed: true, statuses: candidateStatuses };
  }

  return { failed: false, statuses: candidateStatuses };
}

function getZohoAccountsTokenUrl() {
  return (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in/oauth/v2/token').trim();
}

async function refreshZohoAccessToken() {
  const refreshToken = process.env.ZOHO_PAYMENTS_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_PAYMENTS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_PAYMENTS_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return null;

  try {
    const tokenResp = await axios.post(
      getZohoAccountsTokenUrl(),
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      }
    );

    if (tokenResp.data?.error) {
      console.error('Zoho token refresh error:', tokenResp.data.error, tokenResp.data.error_description);
      return null;
    }

    const accessToken = tokenResp.data?.access_token;
    if (!accessToken) return null;
    process.env.ZOHO_PAYMENTS_ACCESS_TOKEN = accessToken;
    return accessToken;
  } catch (e) {
    console.error('Zoho token refresh failed:', e?.response?.data || e?.message);
    return null;
  }
}

async function getZohoAccessToken() {
  if (process.env.ZOHO_PAYMENTS_REFRESH_TOKEN) {
    const refreshed = await refreshZohoAccessToken();
    if (refreshed) return refreshed;
  }
  return process.env.ZOHO_PAYMENTS_ACCESS_TOKEN || null;
}

function getZohoSigningKey() {
  return (
    process.env.ZOHO_PAYMENTS_SIGNING_KEY ||
    process.env.ZOHO_WEBHOOK_SIGNING_KEY ||
    ''
  ).trim();
}

/** Return URL params after payment link checkout (no READ API scope required). */
function buildReturnUrlSignatureString(zohoReturn) {
  const r = zohoReturn || {};
  const ref = r.payment_link_reference != null ? String(r.payment_link_reference) : '';
  return [
    String(r.payment_link_id || ''),
    String(r.payment_id || ''),
    String(r.amount ?? ''),
    String(r.status || ''),
    ref,
  ].join('.');
}

function verifyZohoReturnUrlSignature(zohoReturn) {
  const signingKey = getZohoSigningKey();
  const signature = String(zohoReturn?.signature || '').trim();
  if (!signingKey) {
    return { ok: false, reason: 'signing_key_missing' };
  }
  if (!signature) {
    return { ok: false, reason: 'signature_missing' };
  }
  const payload = buildReturnUrlSignatureString(zohoReturn);
  const computed = crypto.createHmac('sha256', signingKey).update(payload).digest('hex');
  const matches =
    signature === computed ||
    signature.toLowerCase() === computed.toLowerCase();
  return { ok: matches, reason: matches ? 'valid' : 'signature_mismatch' };
}

function isZohoReturnPaidStatus(status) {
  const s = normalizeStatus(status);
  return ['paid', 'success', 'succeeded', 'completed'].includes(s);
}

function isZohoReturnFailedStatus(status) {
  const s = normalizeStatus(status);
  return ['failed', 'failure', 'cancelled', 'canceled', 'expired', 'declined', 'aborted'].includes(s);
}

async function fetchZohoPaymentLink(paymentLinkId, accessToken) {
  const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
  const zohoBase = (process.env.ZOHO_PAYMENTS_API_BASE || 'https://payments.zoho.in')
    .trim()
    .replace(/\/+$/, '');
  const url = `${zohoBase}/api/v1/paymentlinks/${encodeURIComponent(paymentLinkId)}?account_id=${encodeURIComponent(accountId)}`;

  async function get(token) {
    return axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      timeout: 30000,
    });
  }

  try {
    return await get(accessToken);
  } catch (e) {
    if (e?.response?.status === 401) {
      const newToken = await refreshZohoAccessToken();
      if (newToken) return await get(newToken);
    }
    throw e;
  }
}

/** Probe CREATE vs READ scopes (for admin diagnostics). */
async function testZohoPaymentsAuth() {
  const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
  const token = await getZohoAccessToken();
  if (!token || !accountId) {
    return { ok: false, message: 'Missing token or ZOHO_PAYMENTS_ACCOUNT_ID' };
  }
  const zohoBase = (process.env.ZOHO_PAYMENTS_API_BASE || 'https://payments.zoho.in')
    .trim()
    .replace(/\/+$/, '');
  const headers = { Authorization: `Zoho-oauthtoken ${token}` };
  let createOk = false;
  let readOk = false;
  let readError = null;
  try {
    await axios.post(
      `${zohoBase}/api/v1/paymentlinks?account_id=${encodeURIComponent(accountId)}`,
      {
        amount: 1,
        currency: 'INR',
        description: 'Auth scope probe',
        reference_id: `probe_${Date.now()}`,
      },
      { headers: { ...headers, 'content-type': 'application/json' }, timeout: 30000 }
    );
    createOk = true;
  } catch (e) {
    return {
      ok: false,
      createOk: false,
      readOk: false,
      message: e?.response?.data?.message || 'CREATE scope check failed',
    };
  }
  try {
    await axios.get(`${zohoBase}/api/v1/paymentlinks?account_id=${encodeURIComponent(accountId)}`, {
      headers,
      timeout: 30000,
    });
    readOk = true;
  } catch (e) {
    readError = e?.response?.data?.message || e?.message;
  }
  return {
    ok: createOk && readOk,
    createOk,
    readOk,
    readError,
    accountId,
    hint: !readOk
      ? 'Token can CREATE links but cannot READ them. Regenerate OAuth with ZohoPay.payments.READ scope.'
      : 'OAuth scopes look correct.',
  };
}

module.exports = {
  normalizeStatus,
  extractZohoPaymentLinkPayload,
  isZohoPaid,
  isZohoFailedOrCancelled,
  refreshZohoAccessToken,
  getZohoAccessToken,
  fetchZohoPaymentLink,
  verifyZohoReturnUrlSignature,
  isZohoReturnPaidStatus,
  isZohoReturnFailedStatus,
  testZohoPaymentsAuth,
};
