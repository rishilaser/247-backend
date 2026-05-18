const path = require('path');
const cloudinary = require('../config/cloudinary');

/** Names that look like Cloudinary auto public_ids (e.g. inquiries_1700000000_123456789) */
function looksLikeCloudinaryPublicId(name) {
  if (!name || typeof name !== 'string') return false;
  const base = path.basename(name, path.extname(name));
  return /^inquiries_\d{8,}_\d{6,}$/i.test(base);
}

function basenameOnly(name) {
  if (!name || typeof name !== 'string') return '';
  return path.basename(String(name).replace(/\\/g, '/'));
}

/**
 * Pick the best display/download name from inquiry file metadata.
 */
function resolveInquiryFileName(file) {
  const fromOriginal = basenameOnly(file?.originalName);
  const fromFileName = basenameOnly(file?.fileName);

  if (fromOriginal && !looksLikeCloudinaryPublicId(fromOriginal)) {
    return fromOriginal;
  }
  if (fromFileName && !looksLikeCloudinaryPublicId(fromFileName)) {
    return fromFileName;
  }
  return fromOriginal || fromFileName || 'file';
}

/**
 * Resolve filename; if stored name is a public_id, fetch original from Cloudinary.
 */
async function resolveInquiryFileNameWithCloudinary(file) {
  let name = resolveInquiryFileName(file);

  if (!file?.cloudinaryPublicId || !looksLikeCloudinaryPublicId(name)) {
    return name;
  }

  try {
    const resource = await cloudinary.api.resource(file.cloudinaryPublicId, {
      resource_type: 'raw',
    });

    const contextName =
      resource?.context?.custom?.original_filename ||
      resource?.context?.original_filename;
    const base = resource?.original_filename || contextName;

    if (base) {
      const ext =
        path.extname(name) ||
        (resource.format && !String(base).includes('.') ? `.${resource.format}` : '');
      name = basenameOnly(String(base).includes('.') ? base : `${base}${ext}`);
    }
  } catch (err) {
    console.warn(
      `Could not resolve Cloudinary original filename for ${file.cloudinaryPublicId}:`,
      err.message
    );
  }

  return name;
}

/**
 * Ensure unique ZIP entry names without archiver adding _1, _2 suffixes.
 */
function uniquifyZipEntryNames(entries) {
  const used = new Map();

  return entries.map((entry) => {
    let name = entry.downloadName || 'file';
    if (!used.has(name)) {
      used.set(name, 1);
      return { ...entry, downloadName: name };
    }

    const ext = path.extname(name);
    const stem = path.basename(name, ext) || 'file';
    let index = used.get(name);
    let candidate;

    do {
      index += 1;
      candidate = `${stem} (${index})${ext}`;
    } while (used.has(candidate));

    used.set(name, index);
    used.set(candidate, 1);
    return { ...entry, downloadName: candidate };
  });
}

/**
 * Build stored originalName from Cloudinary upload result.
 */
function buildStoredOriginalName(uploadResult, multerOriginalName) {
  const multerName = basenameOnly(multerOriginalName);
  const ext =
    path.extname(multerName) ||
    (uploadResult?.format ? `.${uploadResult.format}` : '');

  const fromCloudinary = uploadResult?.original_filename;
  if (fromCloudinary) {
    const base = String(fromCloudinary);
    return basenameOnly(base.includes('.') ? base : `${base}${ext}`);
  }

  return multerName;
}

module.exports = {
  looksLikeCloudinaryPublicId,
  resolveInquiryFileName,
  resolveInquiryFileNameWithCloudinary,
  uniquifyZipEntryNames,
  buildStoredOriginalName,
};
