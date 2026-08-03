const CONFIG = {
  API_URL: 'https://server-production-f5ce.up.railway.app/api',
};

let TOKEN = localStorage.getItem('monastery_admin_token') || null;
let USER = JSON.parse(localStorage.getItem('monastery_admin_user') || 'null');

document.addEventListener('DOMContentLoaded', () => {
  if (TOKEN && USER) showDashboard();
  initLogin();
  initNav();
  initRooms();
  initNews();
  initBookings();
  initUsers();
});

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  if (!isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${CONFIG.API_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
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

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Login / session
// ---------------------------------------------------------------------------
function initLogin() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      TOKEN = data.accessToken;
      USER = data.user;
      localStorage.setItem('monastery_admin_token', TOKEN);
      localStorage.setItem('monastery_admin_user', JSON.stringify(USER));
      await api('/rooms'); // super_admin/booking_manager-only — confirms this account has a staff role
      showDashboard();
    } catch (err) {
      document.getElementById('loginHint').textContent = err.message;
      TOKEN = null;
      localStorage.removeItem('monastery_admin_token');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    TOKEN = null;
    USER = null;
    localStorage.removeItem('monastery_admin_token');
    localStorage.removeItem('monastery_admin_user');
    document.getElementById('dashboard').hidden = true;
    document.getElementById('loginScreen').hidden = false;
  });
}

function showDashboard() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('dashboard').hidden = false;
  loadStats();
  loadRooms();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function initNav() {
  document.querySelectorAll('.navBtn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
      document.getElementById(`view-${btn.dataset.view}`).hidden = false;
      if (btn.dataset.view === 'stats') loadStats();
      if (btn.dataset.view === 'rooms') loadRooms();
      if (btn.dataset.view === 'news') loadNewsAdmin();
      if (btn.dataset.view === 'bookings') loadAdminBookings();
      if (btn.dataset.view === 'users') loadUsers();
    });
  });
}

// ---------------------------------------------------------------------------
// Stats (simple counts derived from bookings + rooms lists — no dedicated
// stats endpoint was added, so this stays a lightweight client-side rollup)
// ---------------------------------------------------------------------------
async function loadStats() {
  const grid = document.getElementById('statsGrid');
  grid.innerHTML = '<p>جارِ التحميل...</p>';
  try {
    const [rooms, bookings] = await Promise.all([api('/rooms'), api('/bookings')]);
    const totalBeds = rooms.reduce((s, r) => s + r.capacity, 0);
    const byStatus = {};
    bookings.forEach((b) => { byStatus[b.status] = (byStatus[b.status] || 0) + 1; });
    grid.innerHTML = `
      <div class="statCard"><span class="statNum">${rooms.length}</span><span>غرفة</span></div>
      <div class="statCard"><span class="statNum">${totalBeds}</span><span>سرير</span></div>
      <div class="statCard"><span class="statNum">${byStatus.pending || 0}</span><span>طلبات قيد المراجعة</span></div>
      <div class="statCard"><span class="statNum">${byStatus.approved || 0}</span><span>حجوزات مقبولة</span></div>
      <div class="statCard"><span class="statNum">${byStatus.checked_in || 0}</span><span>ضيوف حاليون</span></div>
      <div class="statCard"><span class="statNum">${byStatus.completed || 0}</span><span>إقامات مكتملة</span></div>
    `;
  } catch (err) {
    grid.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
function initRooms() {
  document.getElementById('roomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const body = {
      number: fd.get('number'),
      capacity: Number(fd.get('capacity')),
      type: fd.get('type') || undefined,
      notes: fd.get('notes') || undefined,
    };
    try {
      if (id) {
        await api(`/rooms/${id}`, { method: 'PATCH', body });
        toast('تم تحديث الغرفة');
      } else {
        await api('/rooms', { method: 'POST', body });
        toast('تمت إضافة الغرفة');
      }
      resetRoomForm();
      loadRooms();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('roomFormCancel').addEventListener('click', resetRoomForm);
}

function resetRoomForm() {
  const form = document.getElementById('roomForm');
  form.reset();
  form.elements.id.value = '';
  document.getElementById('roomFormCancel').hidden = true;
}

async function loadRooms() {
  const tbody = document.getElementById('roomsTableBody');
  try {
    const rooms = await api('/rooms');
    tbody.innerHTML = rooms.map((r) => `
      <tr>
        <td>${escapeHtml(r.number)}</td>
        <td>${r.capacity}</td>
        <td>${escapeHtml(r.type || '-')}</td>
        <td>${r.isActive ? 'نشطة' : 'موقوفة'}</td>
        <td>
          <button data-edit="${r.id}">تعديل</button>
          <button data-toggle="${r.id}" data-active="${r.isActive}">${r.isActive ? 'إيقاف' : 'تفعيل'}</button>
          <button data-delete="${r.id}">حذف</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
      const room = rooms.find((r) => r.id === btn.dataset.edit);
      const form = document.getElementById('roomForm');
      form.elements.id.value = room.id;
      form.elements.number.value = room.number;
      form.elements.capacity.value = room.capacity;
      form.elements.type.value = room.type || '';
      form.elements.notes.value = room.notes || '';
      document.getElementById('roomFormCancel').hidden = false;
    }));
    tbody.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/rooms/${btn.dataset.toggle}`, { method: 'PATCH', body: { isActive: btn.dataset.active !== 'true' } });
        loadRooms();
      } catch (err) { toast(err.message, true); }
    }));
    tbody.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('حذف هذه الغرفة نهائياً؟')) return;
      try {
        await api(`/rooms/${btn.dataset.delete}`, { method: 'DELETE' });
        loadRooms();
      } catch (err) { toast(err.message, true); }
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="error">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------
const NEWS_CATEGORY_LABELS = {
  news: 'خبر', mass_schedule: 'مواعيد قداسات', conference: 'مؤتمر', meeting: 'اجتماع', event: 'مناسبة',
};

function initNews() {
  document.getElementById('newsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const body = {
      title: fd.get('title'),
      body: fd.get('body') || undefined,
      category: fd.get('category'),
      isPinned: fd.get('isPinned') === 'on',
    };
    try {
      if (id) {
        await api(`/news/${id}`, { method: 'PATCH', body });
        toast('تم تحديث الخبر');
      } else {
        await api('/news', { method: 'POST', body });
        toast('تمت إضافة الخبر');
      }
      resetNewsForm();
      loadNewsAdmin();
    } catch (err) {
      toast(err.message, true);
    }
  });
  document.getElementById('newsFormCancel').addEventListener('click', resetNewsForm);
}

function resetNewsForm() {
  const form = document.getElementById('newsForm');
  form.reset();
  form.elements.id.value = '';
  document.getElementById('newsFormCancel').hidden = true;
}

async function loadNewsAdmin() {
  const container = document.getElementById('newsAdminList');
  try {
    const posts = await api('/news/admin');
    if (!posts.length) { container.innerHTML = '<p>لا توجد أخبار بعد.</p>'; return; }
    container.innerHTML = posts.map((p) => `
      <article class="newsCard ${p.isHidden ? 'hidden-post' : ''}">
        <span class="badge">${NEWS_CATEGORY_LABELS[p.category] || p.category}</span>
        ${p.isPinned ? '<span class="pin">📌</span>' : ''}
        <h3>${escapeHtml(p.title)}</h3>
        ${p.body ? `<p>${escapeHtml(p.body)}</p>` : ''}
        <div class="newsImages">${(p.media || []).filter((m) => m.type === 'image').map((m) => `<img src="${m.url}" alt="" />`).join('')}</div>
        <div class="newsFiles">${(p.media || []).filter((m) => m.type === 'file').map((m) => `<a href="${m.url}" target="_blank">📎 ${escapeHtml(m.fileName || 'ملف')}</a>`).join('')}</div>
        <div class="uploadRow">
          <label class="uploadBtn">إضافة صورة <input type="file" accept="image/*" data-upload-image="${p.id}" hidden /></label>
          <label class="uploadBtn">إضافة ملف <input type="file" data-upload-file="${p.id}" hidden /></label>
        </div>
        <div class="cardActions">
          <button data-edit-news="${p.id}">تعديل</button>
          <button data-hide-news="${p.id}" data-hidden="${p.isHidden}">${p.isHidden ? 'إظهار' : 'إخفاء'}</button>
          <button data-pin-news="${p.id}" data-pinned="${p.isPinned}">${p.isPinned ? 'إلغاء التثبيت' : 'تثبيت'}</button>
          <button data-delete-news="${p.id}">حذف</button>
        </div>
      </article>`).join('');

    container.querySelectorAll('[data-edit-news]').forEach((btn) => btn.addEventListener('click', () => {
      const post = posts.find((p) => p.id === btn.dataset.editNews);
      const form = document.getElementById('newsForm');
      form.elements.id.value = post.id;
      form.elements.title.value = post.title;
      form.elements.body.value = post.body || '';
      form.elements.category.value = post.category;
      form.elements.isPinned.checked = post.isPinned;
      document.getElementById('newsFormCancel').hidden = false;
    }));
    container.querySelectorAll('[data-hide-news]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/news/${btn.dataset.hideNews}`, { method: 'PATCH', body: { isHidden: btn.dataset.hidden !== 'true' } });
        loadNewsAdmin();
      } catch (err) { toast(err.message, true); }
    }));
    container.querySelectorAll('[data-pin-news]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/news/${btn.dataset.pinNews}`, { method: 'PATCH', body: { isPinned: btn.dataset.pinned !== 'true' } });
        loadNewsAdmin();
      } catch (err) { toast(err.message, true); }
    }));
    container.querySelectorAll('[data-delete-news]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('حذف هذا الخبر نهائياً؟')) return;
      try {
        await api(`/news/${btn.dataset.deleteNews}`, { method: 'DELETE' });
        loadNewsAdmin();
      } catch (err) { toast(err.message, true); }
    }));
    container.querySelectorAll('[data-upload-image]').forEach((input) => input.addEventListener('change', () => uploadNewsMedia(input.dataset.uploadImage, input.files[0], 'image')));
    container.querySelectorAll('[data-upload-file]').forEach((input) => input.addEventListener('change', () => uploadNewsMedia(input.dataset.uploadFile, input.files[0], 'file')));
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

async function uploadNewsMedia(newsId, file, kind) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    await api(`/news/${newsId}/media/${kind}`, { method: 'POST', body: fd, isForm: true });
    toast('تم رفع الملف');
    loadNewsAdmin();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Bookings overview
// ---------------------------------------------------------------------------
const BOOKING_STATUS_LABELS = {
  pending: 'قيد المراجعة', approved: 'مقبول', rejected: 'مرفوض',
  checked_in: 'تم تسجيل الوصول', completed: 'مكتمل', cancelled: 'ملغى',
};
const BOOKING_TYPE_LABELS = { individual: 'حجز فرد', full_room: 'غرفة كاملة', retreat: 'خلوة جماعية' };

function initBookings() {
  document.getElementById('bookingStatusFilter').addEventListener('change', loadAdminBookings);
}

async function loadAdminBookings() {
  const container = document.getElementById('adminBookingsList');
  const status = document.getElementById('bookingStatusFilter').value;
  try {
    const bookings = await api(`/bookings${status ? `?status=${status}` : ''}`);
    if (!bookings.length) { container.innerHTML = '<p>لا توجد حجوزات.</p>'; return; }
    container.innerHTML = bookings.map((b) => `
      <article class="bookingCard status-${b.status}">
        <div class="bookingCardHead">
          <strong>${BOOKING_TYPE_LABELS[b.type] || b.type}</strong>
          <span class="badge">${BOOKING_STATUS_LABELS[b.status] || b.status}</span>
        </div>
        <p>${escapeHtml(b.user?.name || b.contactName || '')} — ${escapeHtml(b.phone)}</p>
        ${b.code ? `<p>رقم الحجز: <strong>${b.code}</strong></p>` : ''}
        <p>${new Date(b.arrivalDate).toLocaleDateString('ar-EG')} → ${new Date(b.departureDate).toLocaleDateString('ar-EG')}</p>
      </article>`).join('');
  } catch (err) {
    container.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function initUsers() {
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/users', {
        method: 'POST',
        body: { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone') || undefined, password: fd.get('password'), roleName: fd.get('roleName') },
      });
      toast('تم إنشاء الحساب');
      e.target.reset();
      loadUsers();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  try {
    const { items } = await api('/users');
    tbody.innerHTML = items.map((u) => `
      <tr>
        <td>${escapeHtml(u.name || '-')}</td>
        <td>${escapeHtml(u.email || '-')}</td>
        <td>${escapeHtml(u.role?.name || '-')}</td>
        <td>${u.isEmailVerified ? '✅' : '❌'}</td>
        <td>${u.isActive ? '✅' : '❌'}</td>
        <td>${u.isActive ? `<button data-deactivate="${u.id}">إيقاف الحساب</button>` : '-'}</td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-deactivate]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('إيقاف هذا الحساب؟')) return;
      try {
        await api(`/users/${btn.dataset.deactivate}`, { method: 'DELETE' });
        loadUsers();
      } catch (err) { toast(err.message, true); }
    }));
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="error">${escapeHtml(err.message)}</td></tr>`;
  }
}
