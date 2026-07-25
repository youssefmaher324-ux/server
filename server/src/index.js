require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'citrine_secret_key_2025';

// الاتصال بقاعدة البيانات PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/citrine_db',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// إعداد مجلد رفع الصور
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// إعداد Multer لرفع الصور من جهاز الكمبيوتر/الموبايل
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'banner-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // حد أقصى 5 ميجابايت للصورة
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('مسموح بملفات الصور فقط!'), false);
  }
});

// إعداد إرسال الإيميلات
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
});

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*' }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

/* ============================================================================
   1. تسجيل الدخول بالرمز المؤقت (OTP)
   ============================================================================ */
app.post('/api/citrine/auth/request-otp', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ success: false, message: 'رقم الهاتف أو الإيميل مطلوب' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 5 * 60 * 1000);
  const isEmail = identifier.includes('@');
  const field = isEmail ? 'email' : 'phone';

  try {
    await pool.query(
      `INSERT INTO users (${field}, otp_code, otp_expires) VALUES ($1, $2, $3)
       ON CONFLICT (${field}) DO UPDATE SET otp_code = $2, otp_expires = $3`,
      [identifier, otp, expires]
    );

    if (isEmail && process.env.SMTP_USER) {
      await mailer.sendMail({
        from: '"Citrine Juice Co." <no-reply@citrinejuice.com>',
        to: identifier,
        subject: 'رمز الدخول الخاص بك - Citrine Juice Co.',
        html: `<h2>رمز الدخول هو: <strong>${otp}</strong></h2><p>صالح لمدة 5 دقائق</p>`
      });
    }

    console.log(`[OTP LOGIN CODE] ${identifier} -> ${otp}`);
    res.json({ success: true, message: 'تم إرسال رمز التحقق بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
});

app.post('/api/citrine/auth/verify-otp', async (req, res) => {
  const { identifier, otp, name } = req.body;
  const isEmail = identifier.includes('@');
  const field = isEmail ? 'email' : 'phone';

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE ${field} = $1 AND otp_code = $2 AND otp_expires > NOW()`,
      [identifier, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'رمز التحقق غير صحيح أو انتهت صلاحيته' });
    }

    const user = result.rows[0];
    if (name) {
      await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, user.id]);
    }

    const token = jwt.sign({ id: user.id, identifier, name: name || user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, name: name || user.name, identifier } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل التحقق' });
  }
});

/* ============================================================================
   2. رفع صور العروض والإعلانات مباشرة من الجهاز
   ============================================================================ */
app.post('/api/citrine/banners/upload', upload.single('bannerImage'), async (req, res) => {
  try {
    const { title, subtitle } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: 'الصورة مطلوبة' });

    const imageUrl = `/uploads/${req.file.filename}`;
    const result = await pool.query(
      'INSERT INTO banners (title, subtitle, image_url) VALUES ($1, $2, $3) RETURNING *',
      [title, subtitle, imageUrl]
    );
    res.json({ success: true, banner: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل رفع الصورة' });
  }
});

app.get('/api/citrine/banners', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM banners WHERE active = true ORDER BY created_at DESC');
    res.json({ success: true, banners: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, banners: [] });
  }
});

/* ============================================================================
   3. تتبع موقع الطيار المباشر بالـ GPS
   ============================================================================ */
app.post('/api/citrine/driver/location', async (req, res) => {
  const { driverId, lat, lng } = req.body;
  try {
    await pool.query(
      'UPDATE drivers SET current_lat = $1, current_lng = $2, last_location_update = NOW() WHERE id = $3',
      [lat, lng, driverId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/citrine/orders/:id/tracking', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.status, d.name as driver_name, d.phone as driver_phone, d.current_lat, d.current_lng
       FROM orders o LEFT JOIN drivers d ON o.driver_id = d.id WHERE o.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    res.json({ success: true, tracking: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* المنتجات والطلبات */
app.get('/api/citrine/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY name ASC');
    res.json({ success: true, products: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, products: [] });
  }
});

app.listen(PORT, () => console.log(`🚀 الخادم يعمل بنجاح على البورت ${PORT}`));