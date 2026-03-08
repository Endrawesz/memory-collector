const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  uploadLimit: parseInt(process.env.UPLOAD_LIMIT || '25'),
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '200'),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  dataFile: path.join(__dirname, 'data.json'),
};

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadData() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
  } catch (e) { console.error('Error loading data:', e); }
  return { tokens: [], uploads: [] };
}

function saveData(data) {
  try { fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Error saving data:', e); }
}

let db = loadData();

function getDriveClient() {
  if (!CONFIG.googleClientId || !CONFIG.googleClientSecret || !CONFIG.googleRefreshToken) return null;
  const oauth2Client = new google.auth.OAuth2(
    CONFIG.googleClientId, CONFIG.googleClientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: CONFIG.googleRefreshToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function uploadToDrive(filePath, fileName, mimeType, uploaderName, folderId) {
  const drive = getDriveClient();
  if (!drive) { console.log('Drive not configured'); return null; }

  if (!fs.existsSync(filePath)) throw new Error('File not found at: ' + filePath);

  console.log(`Uploading to Drive: ${fileName} from ${filePath} (${fs.statSync(filePath).size} bytes)`);

  let uploadFolderId = folderId;

  if (uploaderName && uploadFolderId) {
    try {
      const folderSearch = await drive.files.list({
        q: `name='${uploaderName}' and mimeType='application/vnd.google-apps.folder' and '${uploadFolderId}' in parents and trashed=false`,
        fields: 'files(id)'
      });
      if (folderSearch.data.files.length > 0) {
        uploadFolderId = folderSearch.data.files[0].id;
      } else {
        const folderRes = await drive.files.create({
          requestBody: { name: uploaderName, mimeType: 'application/vnd.google-apps.folder', parents: [uploadFolderId] },
          fields: 'id'
        });
        uploadFolderId = folderRes.data.id;
      }
    } catch (e) { console.error('Folder error:', e.message); }
  }

  const uploadRes = await drive.files.create({
    requestBody: { name: fileName, parents: uploadFolderId ? [uploadFolderId] : undefined },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id, webViewLink'
  });

  console.log('Drive upload success:', uploadRes.data.id);
  return { fileId: uploadRes.data.id, webViewLink: uploadRes.data.webViewLink };
}

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-admin-password'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
      // Derive extension from mimetype directly — more reliable than original filename
      let ext = '.jpg';
      if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/gif') ext = '.gif';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else if (file.mimetype === 'image/heic') ext = '.heic';
      else if (file.mimetype === 'video/mp4') ext = '.mp4';
      else if (file.mimetype === 'video/quicktime') ext = '.mov';
      else if (file.mimetype === 'video/webm') ext = '.webm';
      else if (file.mimetype.startsWith('video/')) ext = '.mp4';
      else if (file.mimetype.startsWith('image/')) ext = '.jpg';
      cb(null, crypto.randomBytes(8).toString('hex') + ext);
    }
});

const upload = multer({
  storage,
  limits: { fileSize: CONFIG.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only images and videos allowed'));
  }
});

function adminAuth(req, res, next) {
  if (req.headers['x-admin-password'] !== CONFIG.adminPassword) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/validate', (req, res) => {
  const tokenData = db.tokens.find(t => t.token === req.query.token);
  if (!tokenData) return res.status(404).json({ valid: false, error: 'Token not found' });
  if (tokenData.revoked) return res.json({ valid: false, error: 'Token revoked' });
  res.json({ valid: true, uploadedCount: tokenData.uploadCount || 0, savedName: tokenData.uploaderName || null, uploadLimit: CONFIG.uploadLimit });
});

app.post('/api/save-name', (req, res) => {
  const { token, name } = req.body;
  const tokenData = db.tokens.find(t => t.token === token);
  if (!tokenData) return res.status(404).json({ error: 'Token not found' });
  tokenData.uploaderName = name;
  saveData(db);
  res.json({ ok: true });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  let localPath = null;
  try {
    const { token, name } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file received' });
    if (!token) return res.status(400).json({ error: 'No token' });

    localPath = path.join(UPLOADS_DIR, file.filename);
    console.log(`File saved: ${localPath} exists=${fs.existsSync(localPath)}`);

    const tokenData = db.tokens.find(t => t.token === token);
    if (!tokenData) return res.status(404).json({ error: 'Invalid token' });
    if (tokenData.revoked) return res.status(403).json({ error: 'Token revoked' });
    if ((tokenData.uploadCount || 0) >= CONFIG.uploadLimit) return res.status(429).json({ error: 'Upload limit reached' });

    if (name) tokenData.uploaderName = name;

    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video') ? '.mp4' : '.jpg');
    const safeName = (name || tokenData.uploaderName || 'unknown').replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '_') || 'unknown';
    const newFileName = `${safeName}_${new Date().toISOString().slice(0,10)}_${(tokenData.uploadCount||0)+1}${ext}`;

    let driveResult = null;
    try {
      driveResult = await uploadToDrive(localPath, newFileName, file.mimetype, name || tokenData.uploaderName, CONFIG.googleDriveFolderId);
    } catch (driveErr) {
      console.error('Drive upload failed:', driveErr.message);
    }

    db.uploads.push({
      id: crypto.randomUUID(), token,
      uploaderName: name || tokenData.uploaderName,
      fileName: newFileName, originalName: file.originalname,
      mimeType: file.mimetype, size: file.size,
      driveFileId: driveResult?.fileId || null,
      driveUrl: driveResult?.webViewLink || null,
      uploadedAt: new Date().toISOString()
    });

    tokenData.uploadCount = (tokenData.uploadCount || 0) + 1;
    tokenData.lastUpload = new Date().toISOString();
    saveData(db);

    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    res.json({ ok: true, fileName: newFileName, driveUrl: driveResult?.webViewLink || null, driveSuccess: !!driveResult });

  } catch (err) {
    console.error('Upload error:', err);
    if (localPath && fs.existsSync(localPath)) try { fs.unlinkSync(localPath); } catch(e){}
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.get('/api/admin/tokens', adminAuth, (req, res) => {
  const uploads = db.uploads || [];
  res.json({
    tokens: db.tokens, totalTokens: db.tokens.length,
    totalUploads: uploads.length,
    uniqueNames: new Set(uploads.map(u => u.uploaderName).filter(Boolean)).size,
    totalBytes: uploads.reduce((s, u) => s + (u.size||0), 0)
  });
});

app.get('/api/admin/uploads', adminAuth, (req, res) => {
  res.json({ uploads: (db.uploads||[]).sort((a,b) => new Date(b.uploadedAt)-new Date(a.uploadedAt)) });
});

app.post('/api/admin/create-token', adminAuth, (req, res) => {
  const newToken = {
    token: crypto.randomBytes(16).toString('hex'),
    label: req.body.label || null, uploaderName: null,
    uploadCount: 0, uploadLimit: req.body.uploadLimit || CONFIG.uploadLimit,
    revoked: false, createdAt: new Date().toISOString()
  };
  db.tokens.push(newToken);
  saveData(db);
  console.log('Token created:', newToken.token);
  res.json({ ok: true, token: newToken.token });
});

app.post('/api/admin/revoke-token', adminAuth, (req, res) => {
  const tokenData = db.tokens.find(t => t.token === req.body.token);
  if (!tokenData) return res.status(404).json({ error: 'Token not found' });
  tokenData.revoked = true;
  saveData(db);
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok', version: '1.0.0',
    tokens: db.tokens.length, uploads: db.uploads.length,
    uploadsDir: UPLOADS_DIR, uploadsDirExists: fs.existsSync(UPLOADS_DIR),
    driveConfigured: !!(CONFIG.googleClientId && CONFIG.googleRefreshToken && CONFIG.googleDriveFolderId)
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Memory Collector on port ${PORT}`);
  console.log(`📁 Uploads: ${UPLOADS_DIR}`);
  console.log(`☁️  Drive: ${CONFIG.googleDriveFolderId ? '✅' : '❌ Not configured'}\n`);
});

module.exports = app;
