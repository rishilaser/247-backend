/**
 * RFC 5987 attachment header — avoids broken names like ".zip_" on Windows browsers.
 */
function buildAttachmentContentDisposition(filename) {
  const safe = String(filename || 'download').trim() || 'download';
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

module.exports = {
  buildAttachmentContentDisposition,
};
