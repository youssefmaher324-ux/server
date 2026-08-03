const CONFIG = {
  API_URL: 'https://server-production-f5ce.up.railway.app/api',
};

let TOKEN = localStorage.getItem('monastery_token') || null;
let USER = JSON.parse(localStorage.getItem('monastery_user') || 'null');
let pendingVerifyEmail = null; // email waiting on OTP after registration

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initAuthTabs();
  initAuthForms();
  refreshAuthUI();
  loadNews();
  initBookingTabs();
  initBookingForms();
});

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${CONFIG.API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    const err = new Error(Array.isArray(message) ? message.join(', ') : message);
    err.details = data;
    throw err;
  }
  return data;
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 5000);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function initNav() {
  document.querySelectorAll('.navBtn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function showView(view) {
  document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
  document.getElementById(`view-${view}`).hidden = false;
  if (view === 'bookings') loadMyBookings();
  if (view === 'account') refreshAuthUI();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function setSession(token, user) {
  TOKEN = token;
  USER = user;
  localStorage.setItem('monastery_token', token);
  localStorage.setItem('monastery_user', JSON.stringify(user));
  refreshAuthUI();
}

function clearSession() {
  TOKEN = null;
  USER = null;
  localStorage.removeItem('monastery_token');
  localStorage.removeItem('monastery_user');
  refreshAuthUI();
}

function refreshAuthUI() {
  const authBtn = document.getElementById('authBtn');
  const loggedOut = document.getElementById('accLoggedOut');
  const loggedIn = document.getElementById('accLoggedIn');
  if (USER && TOKEN) {
    authBtn.textContent = `👤 ${USER.name || 'حسابي'}`;
    loggedOut.hidden = true;
    loggedIn.hidden = false;
    document.getElementById('profileInfo').textContent = `${USER.name || ''} — ${USER.email || ''}`;
  } else {
    authBtn.textContent = 'دخول / حسابي';
    loggedOut.hidden = false;
    loggedIn.hidden = true;
  }
}

function initAuthTabs() {
  document.querySelectorAll('[data-authtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-authtab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ['login', 'register', 'forgot'].forEach((name) => {
        document.getElementById(`${name}Form`).hidden = name !== btn.dataset.authtab;
      });
      document.getElementById('verifyEmailForm').hidden = true;
      document.getElementById('resetForm').hidden = true;
    });
  });
}

function initAuthForms() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/auth/login', { method: 'POST', auth: false, body: { email: fd.get('email'), password: fd.get('password') } });
      setSession(data.accessToken, data.user);
      toast('تم تسجيل الدخول بنجاح');
      showView('news');
    } catch (err) {
      if (/verify your email/i.test(err.message)) {
        document.getElementById('loginHint').textContent = 'يجب تفعيل البريد الإلكتروني أولاً.';
        pendingVerifyEmail = fd.get('email');
        showVerifyEmailForm(fd.get('email'));
      } else {
        toast(err.message, true);
      }
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/auth/register', {
        method: 'POST',
        auth: false,
        body: { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone') || undefined, password: fd.get('password') },
      });
      toast('تم إنشاء الحساب. تحقق من بريدك الإلكتروني لإدخال رمز التفعيل.');
      showVerifyEmailForm(fd.get('email'));
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('verifyEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/auth/verify-email', { method: 'POST', auth: false, body: { email: fd.get('email'), code: fd.get('code') } });
      toast('تم تفعيل الحساب بنجاح. يمكنك تسجيل الدخول الآن.');
      document.getElementById('verifyEmailForm').hidden = true;
      document.querySelector('[data-authtab="login"]').click();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('resendOtpBtn').addEventListener('click', async () => {
    const email = document.querySelector('#verifyEmailForm [name="email"]').value || pendingVerifyEmail;
    if (!email) return toast('أدخل البريد الإلكتروني أولاً', true);
    try {
      await api('/auth/resend-verification', { method: 'POST', auth: false, body: { email } });
      toast('تم إرسال رمز جديد إلى بريدك الإلكتروني.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email: fd.get('email') } });
      toast('إذا كان البريد مسجلاً، تم إرسال رمز إعادة التعيين.');
      document.getElementById('forgotForm').hidden = true;
      document.getElementById('resetForm').hidden = false;
      document.querySelector('#resetForm [name="email"]').value = fd.get('email');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        auth: false,
        body: { email: fd.get('email'), code: fd.get('code'), newPassword: fd.get('newPassword') },
      });
      toast('تم تغيير كلمة المرور بنجاح. سجّل الدخول الآن.');
      document.getElementById('resetForm').hidden = true;
      document.querySelector('[data-authtab="login"]').click();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearSession();
    toast('تم تسجيل الخروج');
    showView('news');
  });

  document.getElementById('changePasswordRequestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/auth/change-password/request', { method: 'POST' });
      toast('تم إرسال رمز التأكيد إلى بريدك الإلكتروني.');
      document.getElementById('changePasswordConfirmForm').hidden = false;
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('changePasswordConfirmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('newPassword') !== fd.get('confirmPassword')) {
      return toast('كلمتا المرور غير متطابقتين', true);
    }
    try {
      await api('/auth/change-password/confirm', {
        method: 'POST',
        body: { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword'), code: fd.get('code') },
      });
      toast('تم تغيير كلمة المرور بنجاح. الرجاء تسجيل الدخول مجدداً.');
      clearSession();
      showView('news');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function showVerifyEmailForm(email) {
  document.querySelectorAll('#accLoggedOut form').forEach((f) => (f.hidden = true));
  const form = document.getElementById('verifyEmailForm');
  form.hidden = false;
  document.querySelector('#verifyEmailForm [name="email"]').value = email || '';
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------
async function loadNews() {
  const container = document.getElementById('newsList');
  try {
    const posts = await api('/news', { auth: false });
    if (!posts.length) {
      container.innerHTML = '<p>لا توجد أخبار حالياً.</p>';
      return;
    }
    container.innerHTML = posts.map(newsCardHtml).join('');
  } catch (err) {
    container.innerHTML = `<p class="error">تعذر تحميل الأخبار: ${escapeHtml(err.message)}</p>`;
  }
}

const NEWS_CATEGORY_LABELS = {
  news: 'خبر',
  mass_schedule: 'مواعيد قداسات',
  conference: 'مؤتمر',
  meeting: 'اجتماع',
  event: 'مناسبة',
};

function newsCardHtml(post) {
  const images = (post.media || []).filter((m) => m.type === 'image');
  const files = (post.media || []).filter((m) => m.type === 'file');
  return `
    <article class="newsCard ${post.isPinned ? 'pinned' : ''}">
      ${post.isPinned ? '<span class="pin">📌 مثبّت</span>' : ''}
      <span class="badge">${NEWS_CATEGORY_LABELS[post.category] || post.category}</span>
      <h3>${escapeHtml(post.title)}</h3>
      ${post.body ? `<p>${escapeHtml(post.body)}</p>` : ''}
      ${images.length ? `<div class="newsImages">${images.map((i) => `<img src="${i.url}" alt="" loading="lazy" />`).join('')}</div>` : ''}
      ${files.length ? `<div class="newsFiles">${files.map((f) => `<a href="${f.url}" target="_blank" rel="noopener">📎 ${escapeHtml(f.fileName || 'ملف')}</a>`).join('')}</div>` : ''}
    </article>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Booking creation
// ---------------------------------------------------------------------------
function initBookingTabs() {
  document.querySelectorAll('#view-book [data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-book [data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ['individual', 'full_room', 'retreat'].forEach((t) => {
        document.getElementById(`form-${t}`).hidden = t !== btn.dataset.tab;
      });
      document.getElementById('bookingResult').hidden = true;
    });
  });
}

function initBookingForms() {
  document.getElementById('form-individual').addEventListener('submit', (e) => submitBooking(e, '/bookings/individual'));
  document.getElementById('form-full_room').addEventListener('submit', (e) => submitBooking(e, '/bookings/full-room'));
  document.getElementById('form-retreat').addEventListener('submit', (e) => submitBooking(e, '/bookings/retreat'));
}

async function submitBooking(e, path) {
  e.preventDefault();
  if (!TOKEN) {
    toast('الرجاء تسجيل الدخول أولاً لإتمام الحجز', true);
    showView('account');
    return;
  }
  const fd = new FormData(e.target);
  const body = {};
  fd.forEach((value, key) => {
    if (value === '') return;
    body[key] = ['familySize', 'groupSize'].includes(key) ? Number(value) : value;
  });
  if (body.arrivalDate) body.arrivalDate = new Date(body.arrivalDate).toISOString();
  if (body.departureDate) body.departureDate = new Date(body.departureDate).toISOString();

  const resultBox = document.getElementById('bookingResult');
  try {
    const booking = await api(path, { method: 'POST', body });
    resultBox.hidden = false;
    resultBox.className = 'resultBox success';
    let extra = '';
    if (booking.bedsRemainingInRoom !== undefined) {
      extra = booking.bedsRemainingInRoom <= 1 ? '<p>⚠️ تبقّى سرير واحد فقط في هذه الغرفة.</p>' : '';
    }
    resultBox.innerHTML = `<p>✅ تم استلام طلب الحجز وهو الآن قيد المراجعة.</p>${extra}`;
    e.target.reset();
  } catch (err) {
    resultBox.hidden = false;
    resultBox.className = 'resultBox error';
    let html = `<p>❌ ${escapeHtml(err.message)}</p>`;
    const suggestion = err.details && err.details.suggestion;
    if (suggestion) {
      const arr = new Date(suggestion.arrivalDate).toLocaleDateString('ar-EG');
      const dep = new Date(suggestion.departureDate).toLocaleDateString('ar-EG');
      html += `<p>أقرب موعد متاح: من ${arr} إلى ${dep}</p>`;
    }
    resultBox.innerHTML = html;
  }
}

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------
const BOOKING_STATUS_LABELS = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  checked_in: 'تم تسجيل الوصول',
  completed: 'مكتمل',
  cancelled: 'ملغى',
};
const BOOKING_TYPE_LABELS = { individual: 'حجز فرد', full_room: 'غرفة كاملة', retreat: 'خلوة جماعية' };

async function loadMyBookings() {
  const container = document.getElementById('myBookingsList');
  if (!TOKEN) {
    container.innerHTML = '<p>سجّل الدخول لعرض حجوزاتك.</p>';
    return;
  }
  try {
    const bookings = await api('/users/me/bookings');
    if (!bookings.length) {
      container.innerHTML = '<p>لا توجد حجوزات بعد.</p>';
      return;
    }
    container.innerHTML = bookings.map(bookingCardHtml).join('');
    container.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', () => cancelBooking(btn.dataset.cancel));
    });
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function bookingCardHtml(b) {
  const rooms = (b.bookingRooms || []).map((br) => `غرفة ${br.room?.number} (${br.bedsAllocated} سرير)`).join('، ');
  const arrival = new Date(b.arrivalDate).toLocaleDateString('ar-EG');
  const departure = new Date(b.departureDate).toLocaleDateString('ar-EG');
  const nightsLeft = Math.max(0, Math.ceil((new Date(b.departureDate) - Date.now()) / 86400000));
  return `
    <article class="bookingCard status-${b.status}">
      <div class="bookingCardHead">
        <strong>${BOOKING_TYPE_LABELS[b.type] || b.type}</strong>
        <span class="badge">${BOOKING_STATUS_LABELS[b.status] || b.status}</span>
      </div>
      ${b.code ? `<p>رقم الحجز: <strong>${b.code}</strong></p>` : ''}
      <p>من ${arrival} إلى ${departure}${b.status === 'checked_in' ? ` — الأيام المتبقية: ${nightsLeft}` : ''}</p>
      ${rooms ? `<p>${rooms}</p>` : ''}
      ${b.qrCodeUrl ? `<img class="qr" src="${b.qrCodeUrl}" alt="QR Code" />` : ''}
      ${['pending', 'approved'].includes(b.status) ? `<button data-cancel="${b.id}">إلغاء الحجز</button>` : ''}
    </article>`;
}

async function cancelBooking(id) {
  if (!confirm('هل تريد إلغاء هذا الحجز؟')) return;
  try {
    await api(`/bookings/${id}/cancel`, { method: 'POST' });
    toast('تم إلغاء الحجز');
    loadMyBookings();
  } catch (err) {
    toast(err.message, true);
  }
}
