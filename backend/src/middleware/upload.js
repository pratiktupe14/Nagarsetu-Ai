const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const UPLOADS_DIR = isServerless ? path.join('/tmp', 'uploads') : path.join(__dirname, '../../uploads');

// Ensure isolated uploads directory exists safely without crashing serverless runtimes
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (dirErr) {
  console.warn('[UPLOADS DIR INIT NOTE] Could not create uploads directory:', dirErr.message);
}

// Allowed MIME types and extension mapping
const ALLOWED_MIME_EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif'
};

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10) || (parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 10) * 1024 * 1024;

// Magic byte signature patterns for safe image formats
const MAGIC_BYTES = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png:  [0x89, 0x50, 0x4E, 0x47],
  gif:  [0x47, 0x49, 0x46, 0x38],
  webp: [0x52, 0x49, 0x46, 0x46] // RIFF header
};

/**
 * Validates file buffer against known image magic byte signatures.
 * @param {Buffer} buffer 
 * @returns {boolean}
 */
function isValidImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return false;

  const isJpeg = MAGIC_BYTES.jpeg.every((byte, i) => buffer[i] === byte);
  const isPng  = MAGIC_BYTES.png.every((byte, i) => buffer[i] === byte);
  const isGif  = MAGIC_BYTES.gif.every((byte, i) => buffer[i] === byte);
  const isWebp = MAGIC_BYTES.webp.every((byte, i) => buffer[i] === byte) && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  const isAvif = buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis', 'mif1'].includes(buffer.slice(8, 12).toString('ascii'));

  return isJpeg || isPng || isGif || isWebp || isAvif;
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file) {
    return cb(new Error('No file provided'), false);
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimetype = (file.mimetype || '').toLowerCase();

  if (!ALLOWED_MIME_EXT_MAP[mimetype] && !ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('Only valid image files (.jpg, .jpeg, .png, .webp, .gif, .avif) are allowed!'), false);
  }

  cb(null, true);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

/**
 * Binary Header (Magic Bytes) Verification Middleware
 */
function validateUploadedImageMagicBytes(req, res, next) {
  if (!req.file || !req.file.buffer) {
    return next();
  }

  if (!isValidImageMagicBytes(req.file.buffer)) {
    return res.status(400).json({
      error: 'Security Error: File content magic bytes do not match a valid image format. Upload rejected.'
    });
  }

  next();
}

const { uploadBufferToSupabase } = require('../config/supabaseStorage');

/**
 * Middleware wrapper that performs Magic Byte verification & uploads directly to Supabase Storage (issues bucket)
 */
function uploadSingleImage(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, async (err) => {
      if (err) {
        return next(err);
      }

      if (req.file && req.file.buffer) {
        if (!isValidImageMagicBytes(req.file.buffer)) {
          return res.status(400).json({
            error: 'Security Error: File content magic bytes do not match a valid image format. Upload rejected.'
          });
        }

        const safeExt = ALLOWED_MIME_EXT_MAP[req.file.mimetype] || path.extname(req.file.originalname || '') || '.jpg';
        const randomFilename = `${crypto.randomUUID()}${safeExt}`;

        try {
          // Attempt upload to Supabase Storage ('issues' bucket)
          const result = await uploadBufferToSupabase(
            req.file.buffer,
            randomFilename,
            req.file.mimetype || 'image/jpeg',
            'issues'
          );

          req.file.filename = randomFilename;
          req.file.publicUrl = result.publicUrl;
          req.file.supabaseUrl = result.publicUrl;
          req.file.path = result.publicUrl;
        } catch (supabaseErr) {
          console.warn('[UPLOAD WARN] Supabase upload failed:', supabaseErr.message);

          req.file.filename = randomFilename;
          req.file.publicUrl = `/uploads/${randomFilename}`;
          req.file.supabaseUrl = `/uploads/${randomFilename}`;

          // Local filesystem fallback (gracefully catch read-only filesystem on Vercel serverless)
          try {
            const diskPath = path.join(UPLOADS_DIR, randomFilename);
            fs.writeFileSync(diskPath, req.file.buffer);
            req.file.path = diskPath;
          } catch (writeErr) {
            console.warn('[UPLOAD WARN] Serverless read-only filesystem (in-memory buffer preserved for AI analysis):', writeErr.message);
          }
        }
      }

      next();
    });
  };
}

module.exports = {
  upload,
  multerUpload: upload,
  uploadSingleImage,
  validateUploadedImageMagicBytes,
  isValidImageMagicBytes
};
