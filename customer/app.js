// Was the old Node proxy in front of Apps Script (server/). Now points at
// the NestJS backend's REST endpoints directly (server-nest/).
const CONFIG = { API_URL: 'https://server-production-036d.up.railway.app/' };
let userToken = localStorage.getItem('citrine_token') || null;
let userData = JSON.parse(localStorage.getItem('citrine_user') || 'null');

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  loadBanners();
  setupTrackOrder();
});

// تسجيل الدخول بالرمز المؤقت OTP
function initAuth() {
  const authBtn = document.getElementById('authBtn');
  const modal = document.getElementById('authModalScrim');
  const sendOtpBtn = document.getElementById('sendOtpBtn');
  const verifyOtpBtn = document.getElementById('verifyOtpBtn');

  if (userData) authBtn.textContent = `👤 ${userData.name || 'حسابي'}`;

  authBtn?.addEventListener('click', () => modal.classList.add('open'));

  sendOtpBtn?.addEventListener('click', async () => {
    const identifier = document.getElementById('otpIdentifier').value.trim();
    if (!identifier) return alert('أدخل رقم الهاتف أو البريد الإلكتروني');

    try {
      const res = await fetch(`${CONFIG.API_URL}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json();
      if (data.success) {
        alert('تم إرسال رمز الدخول بنجاح!');
        document.getElementById('step1').hidden = true;
        document.getElementById('step2').hidden = false;
      }
    } catch (e) {
      alert('حدث خطأ أثناء الإرسال');
    }
  });

  verifyOtpBtn?.addEventListener('click', async () => {
    const identifier = document.getElementById('otpIdentifier').value.trim();
    const otp = document.getElementById('otpCode').value.trim();
    const name = document.getElementById('userName').value.trim();

    try {
      const res = await fetch(`${CONFIG.API_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp, name })
      });
      const data = await res.json();
      if (data.success) {
        userToken = data.token;
        userData = data.user;
        localStorage.setItem('citrine_token', userToken);
        localStorage.setItem('citrine_user', JSON.stringify(userData));
        authBtn.textContent = `👤 ${userData.name || 'حسابي'}`;
        modal.classList.remove('open');
        alert('تم تسجيل الدخول بنجاح!');
      }
    } catch (e) {
      alert('رمز التحقق غير صحيح');
    }
  });
}

// تحميل بنرات العروض
async function loadBanners() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/banners`);
    const data = await res.json();
    if (data.banners && data.banners.length > 0) {
      const b = data.banners[0];
      const bannerSlider = document.getElementById('bannerSlider');
      if (bannerSlider) {
        bannerSlider.style.display = 'block';
        document.getElementById('bannerImg').src = b.image_url.startsWith('http') ? b.image_url : `http://localhost:4000${b.image_url}`;
        document.getElementById('bannerTitle').textContent = b.title;
        document.getElementById('bannerSub').textContent = b.subtitle;
      }
    }
  } catch (e) {}
}

// تتبع الطيار المباشر للعميل
function setupTrackOrder() {
  document.getElementById('trackBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('trackOrderId').value.trim();
    if (!id) return;
    try {
      const res = await fetch(`${CONFIG.API_URL}/orders/${id}/tracking`);
      const data = await res.json();
      if (data.success && data.tracking) {
        const t = data.tracking;
        document.getElementById('trackResult').innerHTML = `<p>حالة الطلب: <strong>${t.status}</strong></p>`;
        if (t.current_lat && t.current_lng) {
          document.getElementById('gpsCard').hidden = false;
          document.getElementById('driverInfo').textContent = `الطيار: ${t.driver_name || 'جاري التوصيل'}`;
          document.getElementById('gpsCoords').textContent = `خط العرض: ${t.current_lat.toFixed(4)}, خط الطول: ${t.current_lng.toFixed(4)}`;
        }
      }
    } catch (e) {}
  });
}