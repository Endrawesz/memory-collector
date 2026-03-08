# 📸 Memory Collector — Complete Setup Guide

A photo & video collection website where guests get unique QR codes to upload memories directly to your Google Drive.

---

## 🗺️ Overview

| Part | What it does | Where it runs |
|------|-------------|---------------|
| **Upload page** (`public/index.html`) | What guests see when they scan the QR | GitHub Pages (free) |
| **Admin panel** (`admin/index.html`) | You use this to create QR codes | GitHub Pages (free) |
| **Backend** (`api/server.js`) | Validates tokens, handles uploads, talks to Google Drive | Railway.app (free tier) |

---

## 💰 What does it cost?

| Service | Cost |
|---------|------|
| GitHub (host website + admin) | **FREE** |
| Railway.app (run backend) | **FREE** up to $5 usage/mo, ~500 hours |
| Google Drive | **FREE** 15GB, then $3/mo for 100GB |
| Custom domain (optional) | ~$12/year if you want yourevent.com |
| **Total for most events** | **$0** |

---

## 📋 STEP-BY-STEP SETUP

---

### STEP 1 — Set up Google Drive

1. Go to **[drive.google.com](https://drive.google.com)**
2. Create a new folder (e.g., "Wedding Photos 2024")
3. Copy the folder ID from the URL:
   - URL looks like: `https://drive.google.com/drive/folders/`**`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs`**
   - The bold part is your **Folder ID** — save this

---

### STEP 2 — Get Google Drive API credentials

This allows the backend to upload files to your Drive automatically.

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Click **"New Project"** → name it "Memory Collector" → Create
3. In the search bar, search **"Google Drive API"** → Enable it
4. Go to **APIs & Services → Credentials**
5. Click **"+ Create Credentials" → "OAuth 2.0 Client IDs"**
6. Application type: **Web application**
7. Name: Memory Collector
8. Under **"Authorized redirect URIs"**, add:
   `https://developers.google.com/oauthplayground`
9. Click **Create** — copy your **Client ID** and **Client Secret**

**Now get the Refresh Token:**

10. Go to **[developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)**
11. Click the ⚙️ gear icon (top right) → check **"Use your own OAuth credentials"**
12. Enter your Client ID and Client Secret → Close
13. In the left panel, find **"Drive API v3"** → select `https://www.googleapis.com/auth/drive`
14. Click **"Authorize APIs"** → sign in with your Google account
15. Click **"Exchange authorization code for tokens"**
16. Copy the **Refresh token** — save this

You now have:
- ✅ Client ID
- ✅ Client Secret  
- ✅ Refresh Token
- ✅ Folder ID

---

### STEP 3 — Deploy the Backend to Railway

1. Go to **[railway.app](https://railway.app)** → Sign up with GitHub (free)
2. Click **"New Project" → "Deploy from GitHub repo"**
   - First, push your code to GitHub (see Step 4)
   - OR: Click **"Empty Service"** and use Railway's built-in file editor
3. Once your service is created, click on it → **"Variables"** tab
4. Add these environment variables one by one:

```
ADMIN_PASSWORD        = (choose a strong password, e.g. WeddingAdmin2024!)
GOOGLE_CLIENT_ID      = (from Step 2)
GOOGLE_CLIENT_SECRET  = (from Step 2)
GOOGLE_REFRESH_TOKEN  = (from Step 2)
GOOGLE_DRIVE_FOLDER_ID = (from Step 1)
UPLOAD_LIMIT          = 25
MAX_VIDEO_SECONDS     = 30
MAX_FILE_SIZE_MB      = 200
```

5. Under **"Settings"** → note your Railway URL:
   `https://your-project-name.railway.app`
   → Save this as your **Backend URL**

---

### STEP 4 — Deploy the Frontend to GitHub Pages

1. Create a free account at **[github.com](https://github.com)**
2. Click **"+"** → **"New repository"**
   - Name: `memory-collector` (or any name)
   - Set to **Public**
   - Click Create
3. Upload the files:
   - Click **"uploading an existing file"**
   - Drag in the `public/` folder contents AND `admin/` folder
   - Your repo should have:
     ```
     index.html          (the upload page)
     admin/index.html    (the admin panel)
     ```
4. Go to **Settings → Pages**
   - Source: **"Deploy from a branch"**
   - Branch: **main**, folder: **/ (root)**
   - Click Save
5. After ~2 minutes, your site is live at:
   `https://yourusername.github.io/memory-collector`
   → Save this as your **Frontend URL**

> **Important:** Edit `index.html` before uploading — find this line:
> ```js
> backendUrl: window.BACKEND_URL || 'https://your-backend.railway.app',
> ```
> Replace `https://your-backend.railway.app` with your actual Railway URL.

---

### STEP 5 — Configure the Admin Panel

1. Open your admin panel at:
   `https://yourusername.github.io/memory-collector/admin/`
2. Log in with the `ADMIN_PASSWORD` you set in Railway
3. Go to **Configuration** tab:
   - **Backend URL**: `https://your-project.railway.app`
   - **Frontend URL**: `https://yourusername.github.io/memory-collector`
   - **Event Name**: "Our Wedding Day" (or whatever you like)
   - **Upload Limit**: 25
4. Click **Save Configuration**

---

### STEP 6 — Create QR Codes for Guests

1. In the Admin Panel → **"QR Tokens"** tab
2. Click **"+ Create QR Token"**
3. Add a label (optional): "Table 5", "Uncle John", etc.
4. A QR code is generated instantly
5. Click **"Download QR"** to save it as PNG
6. Print it or send it to the guest

**Repeat for each person or group you want to give access to.**

---

### STEP 7 — Print & Distribute QR Codes

**For a wedding/party:**
- Print them on table cards: "Scan to share your photos! 📸"
- Put one per table, or one per family
- You can also text the link directly to people

**For a smaller event:**
- Send the URL via WhatsApp: `https://yourusername.github.io/memory-collector/index.html?token=XXXX`

---

## 📱 Guest Experience

When a guest scans the QR code:
1. They enter their name (stored with all their uploads)
2. They can take photos or videos directly, or upload from their camera roll
3. Photos: any amount up to their limit (25 by default)
4. Videos: up to 30 seconds each
5. All files go directly into YOUR Google Drive, in a subfolder named after them

---

## 🗂️ How Files Are Organized in Google Drive

```
📁 Your Event Folder (the one you created)
  📁 Sarah Johnson
     📷 Sarah_Johnson_2024-06-15_1.jpg
     🎬 Sarah_Johnson_2024-06-15_2.mp4
  📁 Mike & Emma
     📷 Mike___Emma_2024-06-15_1.jpg
     📷 Mike___Emma_2024-06-15_2.jpg
  📁 Table 5
     📷 Table_5_2024-06-15_1.jpg
```

---

## ⚙️ Customization

### Change event name
Edit `index.html`, find:
```js
eventName: window.EVENT_NAME || 'Memory Collection'
```
Change `Memory Collection` to your event name.

### Change upload limit
In Railway environment variables, change `UPLOAD_LIMIT=25`

### Change colors/style
Edit the CSS variables at the top of `index.html`:
```css
:root {
  --gold: #c9a96e;   /* Change to any color */
  --cream: #faf7f2;  /* Background color */
}
```

---

## 🔧 Troubleshooting

**"Invalid Access Link" on the upload page**
→ Check that the backend URL in `index.html` is correct
→ Check that your Railway service is running (visit the health endpoint: `https://your-app.railway.app/health`)

**Files aren't appearing in Google Drive**
→ Double-check all 4 Google credentials in Railway variables
→ Make sure the Drive folder ID is correct
→ Visit `https://your-app.railway.app/health` — it should show `"driveConfigured": true`

**QR code shows blank**
→ Make sure the Frontend URL in the admin config doesn't have a trailing slash

**"Upload limit reached" too quickly**
→ In Railway variables, increase `UPLOAD_LIMIT`

---

## 🔐 Security Notes

- Each QR code token is a random 32-character hex string (practically impossible to guess)
- Admin panel is password protected
- Tokens can be revoked at any time from the admin panel
- Files are validated for type (images/videos only)

---

## 📞 Quick Reference

| What | Where |
|------|-------|
| Upload page | `https://yourusername.github.io/memory-collector/` |
| Admin panel | `https://yourusername.github.io/memory-collector/admin/` |
| Backend health | `https://your-app.railway.app/health` |
| Your Google Drive | `https://drive.google.com` |
