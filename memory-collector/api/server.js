const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================
// CONFIGURATION
// ============================
const CONFIG = {
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  uploadLimit: parseInt(process.env.UPLOAD_LIMIT || '25'),
  maxVideoSeconds: parseInt(process.env.MAX_VIDEO_SECONDS || '30'),
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '100'),
  
  // Google Drive settings
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID, // ID of folder to upload to
  
  // Data file path
  dataFile: process.env.DATA_FILE || './data.json',
};

// ============================
// DATA STORE (JSON file-based)
// ============================
function loadData() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
  return { tokens: [], uploads: [] };
}

function saveData(data) {
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2));
}

let db = loadData();

// ============================
// GOOGLE DRIVE
// ============================
function getDriveClient() {
  if (!CONFIG.googleClientId || !CONFIG.googleClientSecret || !CONFIG.googleRefreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    CONFIG.googleClientId,
    CONFIG.googleClientSecret,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({
    refresh_token: CONFIG.googleRefreshToken
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function uploadToDrive(filePath, fileName, mimeType, uploaderName, folderId) {
  const drive = getDriveClient();

  if (!drive) {
    console.log('Google Drive not configured — file saved locally only');
    return null;
  }

  try {
    // Create subfolder for uploader if needed
    let uploadFolderId = folderId || CONFIG.googleDriveFolderId;

    if (uploaderName && uploadFolderId) {
      // Check if subfolder exists
      const folderSearch = await drive.files.list({
        q: `name='${uploaderName}' and mimeType='application/vnd.google-apps.folder' and '${uploadFolderId}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });

      if (folderSearch.data.files.length > 0) {
        uploadFolderId = folderSearch.data.files[0].id;
      } else {
        // Create uploader subfolder
        const folderRes = await drive.files.create({
          requestBody: {
            name: uploaderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [uploadFolderId]
          },
          fields: 'id'
        });
        uploadFolderId = folderRes.data.id;
      }
    }

    // Upload file
    const fileMetadata = {
      name: fileName,
      parents: uploadFolderId ? [uploadFolderId] : undefined
    };

    const media = {
      mimeType: mimeType,
      body: fs.createReadStream(filePath)
    };

    const uploadRes = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink'
    });

    return {
      fileId: uploadRes.data.id,
      webViewLink: uploadRes.data.webViewLink,
      webContentLink: uploadRes.data.webContentLink
    };

  } catch (err) {
    console.error('Drive upload error:', err.message);
    return null;
  }
}

// ============================
// MIDDLEWARE
// ============================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-password']
}));

app.use(express.json());
app.use(express.static('public'));

// Multer upload config
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: CONFIG.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
                     'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg'];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Admin auth middleware
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (pw !== CONFIG.adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ============================
// PUBLIC API ROUTES
// ============================

// Validate token
app.get('/api/validate', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false, error: 'No token' });

  const tokenData = db.tokens.find(t => t.token === token);
  if (!tokenData) return res.status(404).json({ valid: false, error: 'Token not found' });
  if (tokenData.revoked) return res.json({ valid: false, error: 'Token revoked' });

  res.json({
    valid: true,
    uploadedCount: tokenData.uploadCount || 0,
    savedName: tokenData.uploaderName || null,
    uploadLimit: CONFIG.uploadLimit
  });
});

// Save uploader name
app.post('/api/save-name', (req, res) => {
  const { token, name } = req.body;
  if (!token || !name) return res.status(400).json({ error: 'Missing token or name' });

  const tokenData = db.tokens.find(t => t.token === token);
  if (!tokenData) return res.status(404).json({ error: 'Token not found' });

  tokenData.uploaderName = name;
  saveData(db);
  res.json({ ok: true });
});

// Upload file
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { token, name } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file' });
    if (!token) return res.status(400).json({ error: 'No token' });

    // Validate token
    const tokenData = db.tokens.find(t => t.token === token);
    if (!tokenData) return res.status(404).json({ error: 'Invalid token' });
    if (tokenData.revoked) return res.status(403).json({ error: 'Token revoked' });
    if ((tokenData.uploadCount || 0) >= CONFIG.uploadLimit) {
      return res.status(429).json({ error: 'Upload limit reached' });
    }

    // Update uploader name
    if (name) tokenData.uploaderName = name;

    // Generate nice filename
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video') ? '.mp4' : '.jpg');
    const safeName = (name || 'unknown').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_');
    const timestamp = new Date().toISOString().slice(0, 10);
    const counter = (tokenData.uploadCount || 0) + 1;
    const newFileName = `${safeName}_${timestamp}_${counter}${ext}`;
    const localPath = path.join('uploads', file.filename);

    // Upload to Google Drive
    let driveResult = null;
    try {
      driveResult = await uploadToDrive(localPath, newFileName, file.mimetype, name, CONFIG.googleDriveFolderId);
    } catch (driveErr) {
      console.error('Drive upload failed:', driveErr.message);
    }

    // Save upload record
    const uploadRecord = {
      id: crypto.randomUUID(),
      token,
      uploaderName: name || tokenData.uploaderName,
      fileName: newFileName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      localPath: localPath,
      driveFileId: driveResult?.fileId || null,
      driveUrl: driveResult?.webViewLink || null,
      uploadedAt: new Date().toISOString()
    };

    db.uploads.push(uploadRecord);
    tokenData.uploadCount = (tokenData.uploadCount || 0) + 1;
    tokenData.lastUpload = new Date().toISOString();
    saveData(db);

    // Clean up local file after drive upload
    if (driveResult && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }

    res.json({
      ok: true,
      fileName: newFileName,
      driveUrl: driveResult?.webViewLink || null,
      uploadCount: tokenData.uploadCount
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ============================
// ADMIN API ROUTES
// ============================

// Get all tokens
app.get('/api/admin/tokens', adminAuth, (req, res) => {
  const uploads = db.uploads || [];
  const uniqueNames = new Set(uploads.map(u => u.uploaderName).filter(Boolean));
  const totalBytes = uploads.reduce((sum, u) => sum + (u.size || 0), 0);

  res.json({
    tokens: db.tokens,
    totalTokens: db.tokens.length,
    totalUploads: uploads.length,
    uniqueNames: uniqueNames.size,
    totalBytes
  });
});

// Get all uploads
app.get('/api/admin/uploads', adminAuth, (req, res) => {
  res.json({
    uploads: (db.uploads || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
  });
});

// Create token
app.post('/api/admin/create-token', adminAuth, (req, res) => {
  const { label, uploadLimit } = req.body;

  const newToken = {
    token: crypto.randomBytes(16).toString('hex'),
    label: label || null,
    uploaderName: null,
    uploadCount: 0,
    uploadLimit: uploadLimit || CONFIG.uploadLimit,
    revoked: false,
    createdAt: new Date().toISOString()
  };

  db.tokens.push(newToken);
  saveData(db);

  res.json({ ok: true, token: newToken.token });
});

// Revoke token
app.post('/api/admin/revoke-token', adminAuth, (req, res) => {
  const { token } = req.body;
  const tokenData = db.tokens.find(t => t.token === token);
  if (!tokenData) return res.status(404).json({ error: 'Token not found' });
  tokenData.revoked = true;
  saveData(db);
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    tokens: db.tokens.length,
    uploads: db.uploads.length,
    driveConfigured: !!(CONFIG.googleClientId && CONFIG.googleRefreshToken)
  });
});

// ============================
// START SERVER
// ============================
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.listen(PORT, () => {
  console.log(`\n🚀 Memory Collector Backend running on port ${PORT}`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`📁 Google Drive: ${CONFIG.googleDriveFolderId ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 Admin password: ${CONFIG.adminPassword}`);
  console.log('');
});

module.exports = app;
