# HI-LINE Easy Lab 🏭

Warehouse Operations Platform — Next.js 14 + Supabase + Socket.IO

## Quick Start

### 1. Run Database Schema (ONE-TIME SETUP)

Go to: https://supabase.com/dashboard/project/ksxlfcbzgzcjkxewykhk/sql/new

Copy and paste the contents of `supabase_schema.sql` and click **Run**.

### 2. Start the Development Server

```bash
npm run dev
```

The app will be running at: **http://localhost:3000**

### 3. Login

- **Email:** admin@hilinegift.com  
- **Password:** e&^Mb*s&s32a*#Y@&(

---

## Production Start (Windows)

```bash
npm run build
npm run start:win
```

---

## Features

| Feature | Description |
|---------|-------------|
| 🔐 Auth | Single login, browser fingerprint identity |
| 📦 Pickwave Upload | PDF upload with custom ID, stored in Supabase |
| 🏷️ Labels Processing | OCR + SKU overlay using pdf-lib |
| 🔍 Search | Search by Pickwave ID or Order ID |
| 💬 Real-time Chat | Socket.IO with emoji picker + sounds |
| 📋 Activity Logs | Full audit trail with filters |
| 🌙 Themes | Light / Dark / System toggle |

## Architecture

```
/app               - Next.js App Router pages
/components        - React components
/lib               - Shared utilities (Supabase, OCR, PDF, Socket)
/scripts           - Setup scripts
server.js          - Custom Node.js server with Socket.IO
```

## File Expiry

All uploaded documents expire in **7 days**. Enable pg_cron in Supabase to auto-delete expired records.

---

(C) 2025 HI-LINE GIFT - Developed by Raul J - https://radbert18o7.github.io/portfolio/
