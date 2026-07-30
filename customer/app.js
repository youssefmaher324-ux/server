// Was the old Node proxy in front of Apps Script (server/). Now points at
// the NestJS backend's REST endpoints directly (server-nest/).
const CONFIG = { API_URL: 'https://server-production-036d.up.railway.app/api' };
let userToken = localStorage.getItem('citrine_token') || null;
let userData = JSON.parse(localStorage.getItem('citrine_user') || 'null');

let PRODUCTS = [];
let CATEGORIES = [];
let CART = JSON.parse(localStorage.getItem('citrine_cart') || '{}'); // { productId: qty }
let currentCategoryFilter = 'all';
let currentSearch = '';
let currentProductId = null;
let lastOrder = null;
let cancelTimerInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNav();
  initSearch();
  initCart();
  initCheckout();
  loadBanners();
  loadShopData();
  setupTrackOrder();
});

// ---------------------------------------------------------------------------
// تسجيل الدخول بالرمز المؤقت OTP
// ---------------------------------------------------------------------------
function initAuth() {
  const authBtn = document.getElementById('authBtn');
  const modal = document.getElementById('authModalScrim');
  const closeBtn = document.getElementById('authModalClose');
  const sendOtpBtn = document.getElementById('sendOtpBtn');
  const verifyOtpBtn = document.getElementById('verifyOtpBtn');

  if (userData) authBtn.textContent = `👤 ${userData.name || 'حسابي'}`;

  const closeModal = () => modal.classList.remove('open');
  authBtn?.addEventListener('click', () => modal.classList.add('open'));
  closeBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  sendOtpBtn?.addEventListener('click', async () => {
    const identifier = document.getElementById('otpIdentifier').value.trim();
    if (!identifier) return alert('أدخل بريدك الإلكتروني');

    sendOtpBtn.disabled = true;
    sendOtpBtn.textContent = 'جاري الإرسال…';
    try {
      const res = await fetch(`${CONFIG.API_URL}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'تعذر إرسال الكود');
      toast('تم إرسال رمز الدخول إلى بريدك الإلكتروني.');
      document.getElementById('step1').hidden = true;
      document.getElementById('step2').hidden = false;
    } catch (e) {
      alert(e.message || 'حدث خطأ أثناء الإرسال');
    } finally {
      sendOtpBtn.disabled = false;
      sendOtpBtn.textContent = 'Send Code ↦';
    }
  });

  verifyOtpBtn?.addEventListener('click', async () => {
    const identifier = document.getElementById('otpIdentifier').value.trim();
    const otp = document.getElementById('otpCode').value.trim();
    const name = document.getElementById('userName').value.trim();

    verifyOtpBtn.disabled = true;
    verifyOtpBtn.textContent = 'جاري التحقق…';
    try {
      const res = await fetch(`${CONFIG.API_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, code: otp, name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'رمز التحقق غير صحيح');

      userToken = data.accessToken;
      userData = data.user;
      localStorage.setItem('citrine_token', userToken);
      localStorage.setItem('citrine_user', JSON.stringify(userData));
      authBtn.textContent = `👤 ${userData.name || 'حسابي'}`;
      closeModal();
      document.getElementById('step1').hidden = false;
      document.getElementById('step2').hidden = true;
      toast('تم تسجيل الدخول بنجاح!');
    } catch (e) {
      alert(e.message || 'رمز التحقق غير صحيح');
    } finally {
      verifyOtpBtn.disabled = false;
      verifyOtpBtn.textContent = 'Verify & Sign In ↦';
    }
  });
}

// ---------------------------------------------------------------------------
// تحميل بنرات العروض
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// تتبع الطيار المباشر للعميل
// ---------------------------------------------------------------------------
function setupTrackOrder() {
  document.getElementById('trackBtn')?.addEventListener('click', () => trackOrder(document.getElementById('trackOrderId').value.trim()));
}

async function trackOrder(id) {
  if (!id) return;
  try {
    const res = await fetch(`${CONFIG.API_URL}/orders/${id}/tracking`);
    const data = await res.json();
    if (data.success && data.tracking) {
      const t = data.tracking;
      document.getElementById('trackResult').innerHTML = `<p>حالة الطلب: <strong>${esc(t.status)}</strong></p>`;
      if (t.current_lat && t.current_lng) {
        document.getElementById('gpsCard').hidden = false;
        document.getElementById('driverInfo').textContent = `الطيار: ${t.driver_name || 'جاري التوصيل'}`;
        document.getElementById('gpsCoords').textContent = `خط العرض: ${t.current_lat.toFixed(4)}, خط الطول: ${t.current_lng.toFixed(4)}`;
      }
    } else {
      document.getElementById('trackResult').innerHTML = `<p>لم يتم العثور على الطلب.</p>`;
    }
  } catch (e) {
    document.getElementById('trackResult').innerHTML = `<p>حدث خطأ أثناء البحث عن الطلب.</p>`;
  }
}

// ---------------------------------------------------------------------------
// NAV — switches between .view sections (this used to not exist at all,
// which is why every link on the page — Shop, Track Order, product cards —
// did nothing)
// ---------------------------------------------------------------------------
function initNav() {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-nav]');
    if (!trigger) return;
    e.preventDefault();
    showView(trigger.dataset.nav);
  });
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.main-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  closeCart();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// LOAD PRODUCTS + CATEGORIES
// ---------------------------------------------------------------------------
async function loadShopData() {
  try {
    const [productsRes, categoriesRes] = await Promise.all([
      fetch(`${CONFIG.API_URL}/products?pageSize=100`),
      fetch(`${CONFIG.API_URL}/categories`)
    ]);
    const productsData = await productsRes.json();
    CATEGORIES = await categoriesRes.json();

    PRODUCTS = (productsData.items || []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: Number(p.price),
      image: p.imageUrl || '',
      available: p.available,
      categoryId: p.categoryId,
      categoryName: p.category?.name || 'Uncategorized'
    }));

    renderCategoryRail();
    renderFilterChips();
    renderHomeGrid();
    renderShopGrid();
    renderCart();
  } catch (e) {
    console.error('Failed to load shop data', e);
  }
}

// ---------------------------------------------------------------------------
// CATEGORY RAIL (home page)
// ---------------------------------------------------------------------------
function renderCategoryRail() {
  const rail = document.getElementById('categoryRail');
  if (!rail) return;
  if (!CATEGORIES.length) { rail.innerHTML = ''; return; }

  rail.innerHTML = CATEGORIES.map((c) => {
    const count = PRODUCTS.filter((p) => p.categoryId === c.id && p.available).length;
    return `
      <button class="category-card" data-category="${esc(c.id)}">
        <span class="emoji">🍊</span>
        <span class="cat-name">${esc(c.name)}</span>
        <span class="cat-count">${count} items</span>
      </button>`;
  }).join('');

  rail.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentCategoryFilter = btn.dataset.category;
      renderFilterChips();
      renderShopGrid();
      showView('shop');
    });
  });
}

// ---------------------------------------------------------------------------
// SHOP FILTER CHIPS
// ---------------------------------------------------------------------------
function renderFilterChips() {
  const row = document.getElementById('filterRow');
  if (!row) return;
  const chips = [{ id: 'all', name: 'All' }, ...CATEGORIES];
  row.innerHTML = chips.map((c) => `
    <button class="chip ${currentCategoryFilter === c.id ? 'active' : ''}" data-filter="${esc(c.id)}">${esc(c.name)}</button>
  `).join('');
  row.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentCategoryFilter = btn.dataset.filter;
      renderFilterChips();
      renderShopGrid();
    });
  });
}

// ---------------------------------------------------------------------------
// PRODUCT GRIDS
// ---------------------------------------------------------------------------
function renderHomeGrid() {
  const grid = document.getElementById('homeProductGrid');
  if (!grid) return;
  const list = PRODUCTS.filter((p) => p.available).slice(0, 8);
  grid.innerHTML = list.map((p) => productCardHtml(p)).join('') || '<p class="empty-state">No products yet — check back soon.</p>';
  wireProductCards(grid);
}

function renderShopGrid() {
  const grid = document.getElementById('shopProductGrid');
  const emptyState = document.getElementById('shopEmptyState');
  if (!grid) return;

  let list = PRODUCTS.filter((p) => p.available);
  if (currentCategoryFilter !== 'all') list = list.filter((p) => p.categoryId === currentCategoryFilter);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }

  grid.innerHTML = list.map((p) => productCardHtml(p)).join('');
  if (emptyState) emptyState.hidden = list.length > 0;
  wireProductCards(grid);
}

function productCardHtml(p) {
  return `
    <div class="product-card" data-product="${esc(p.id)}">
      <div class="product-thumb">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" />` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:2.4rem;">🧃</div>`}
        <span class="stamp-badge">FRESH</span>
      </div>
      <div class="product-body">
        <span class="product-cat">${esc(p.categoryName)}</span>
        <h3 class="product-name">${esc(p.name)}</h3>
        <p class="product-desc">${esc(p.description)}</p>
        <div class="product-footer">
          <span class="product-price">EGP ${p.price.toFixed(2)}</span>
          <button class="add-btn" data-add="${esc(p.id)}" title="Add to cart">+</button>
        </div>
      </div>
    </div>`;
}

function wireProductCards(container) {
  container.querySelectorAll('[data-product]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return; // let the add button handle its own click
      openProductDetail(card.dataset.product);
    });
  });
  container.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(btn.dataset.add, 1);
      toast('Added to your crate.');
    });
  });
}

// ---------------------------------------------------------------------------
// PRODUCT DETAIL VIEW
// ---------------------------------------------------------------------------
function openProductDetail(id) {
  const p = PRODUCTS.find((pr) => pr.id === id);
  if (!p) return;
  currentProductId = id;

  const detail = document.getElementById('productDetail');
  detail.innerHTML = `
    ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" />` : `<div style="display:flex;align-items:center;justify-content:center;aspect-ratio:1;background:var(--line);border-radius:20px;font-size:4rem;">🧃</div>`}
    <div>
      <span class="pd-cat">${esc(p.categoryName)}</span>
      <h1 class="pd-name">${esc(p.name)}</h1>
      <p class="pd-desc">${esc(p.description)}</p>
      <div class="pd-price">EGP ${p.price.toFixed(2)}</div>
      <div class="qty-row">
        <button id="pdQtyMinus">−</button>
        <span id="pdQty">1</span>
        <button id="pdQtyPlus">+</button>
      </div>
      <button class="btn btn-primary btn-block" id="pdAddToCart">Add to Crate ↦</button>
    </div>`;

  let qty = 1;
  document.getElementById('pdQtyMinus').addEventListener('click', () => { qty = Math.max(1, qty - 1); document.getElementById('pdQty').textContent = qty; });
  document.getElementById('pdQtyPlus').addEventListener('click', () => { qty += 1; document.getElementById('pdQty').textContent = qty; });
  document.getElementById('pdAddToCart').addEventListener('click', () => { addToCart(id, qty); toast('Added to your crate.'); openCart(); });

  showView('product');
}

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------
function initSearch() {
  const bar = document.getElementById('searchBar');
  const input = document.getElementById('searchInput');

  document.getElementById('searchToggle')?.addEventListener('click', () => {
    bar.classList.add('open');
    input.focus();
  });
  document.getElementById('searchClose')?.addEventListener('click', () => bar.classList.remove('open'));

  input?.addEventListener('input', () => {
    currentSearch = input.value.trim();
    showView('shop');
    renderShopGrid();
  });
}

// ---------------------------------------------------------------------------
// CART
// ---------------------------------------------------------------------------
function saveCart() {
  localStorage.setItem('citrine_cart', JSON.stringify(CART));
}

function addToCart(productId, qty) {
  CART[productId] = (CART[productId] || 0) + qty;
  saveCart();
  renderCart();
}

function setCartQty(productId, qty) {
  if (qty <= 0) { delete CART[productId]; }
  else { CART[productId] = qty; }
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  delete CART[productId];
  saveCart();
  renderCart();
}

function cartLines() {
  return Object.entries(CART)
    .map(([productId, qty]) => ({ product: PRODUCTS.find((p) => p.id === productId), qty }))
    .filter((line) => line.product);
}

function cartTotal() {
  return cartLines().reduce((sum, line) => sum + line.product.price * line.qty, 0);
}

function initCart() {
  document.getElementById('cartToggle')?.addEventListener('click', openCart);
  document.getElementById('cartClose')?.addEventListener('click', closeCart);
  document.getElementById('scrim')?.addEventListener('click', closeCart);
  document.getElementById('checkoutBtn')?.addEventListener('click', () => {
    closeCart();
    prefillCheckout();
    showView('checkout');
  });
}

function openCart() {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('scrim').classList.add('open');
}

function closeCart() {
  document.getElementById('cartDrawer')?.classList.remove('open');
  document.getElementById('scrim')?.classList.remove('open');
}

function renderCart() {
  const lines = cartLines();
  const itemsEl = document.getElementById('cartItems');
  const countEl = document.getElementById('cartCount');
  const totalEl = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('checkoutBtn');
  if (!itemsEl) return;

  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
  countEl.textContent = totalQty;
  totalEl.textContent = `EGP ${cartTotal().toFixed(2)}`;
  if (checkoutBtn) checkoutBtn.disabled = lines.length === 0;

  itemsEl.innerHTML = lines.length ? lines.map((line) => `
    <div class="cart-item" data-line="${esc(line.product.id)}">
      ${line.product.image ? `<img src="${esc(line.product.image)}" alt="${esc(line.product.name)}" />` : `<div style="width:56px;height:56px;border-radius:10px;background:var(--line);display:flex;align-items:center;justify-content:center;">🧃</div>`}
      <div class="cart-item-info">
        <div class="name">${esc(line.product.name)}</div>
        <div class="price">EGP ${line.product.price.toFixed(2)}</div>
        <button class="cart-item-remove" data-remove="${esc(line.product.id)}">Remove</button>
      </div>
      <div class="cart-item-qty">
        <button data-qty-minus="${esc(line.product.id)}">−</button>
        <span>${line.qty}</span>
        <button data-qty-plus="${esc(line.product.id)}">+</button>
      </div>
    </div>`).join('') : '<p class="empty-state">Your crate is empty.</p>';

  itemsEl.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeFromCart(b.dataset.remove)));
  itemsEl.querySelectorAll('[data-qty-minus]').forEach((b) => b.addEventListener('click', () => setCartQty(b.dataset.qtyMinus, (CART[b.dataset.qtyMinus] || 1) - 1)));
  itemsEl.querySelectorAll('[data-qty-plus]').forEach((b) => b.addEventListener('click', () => setCartQty(b.dataset.qtyPlus, (CART[b.dataset.qtyPlus] || 0) + 1)));

  renderCheckoutSummary();
}

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------
function prefillCheckout() {
  if (userData) {
    document.getElementById('custName').value = userData.name || '';
    document.getElementById('custPhone').value = userData.phone || '';
  }
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const itemsEl = document.getElementById('checkoutItems');
  const totalEl = document.getElementById('checkoutTotal');
  if (!itemsEl) return;
  const lines = cartLines();
  itemsEl.innerHTML = lines.map((line) => `
    <div class="cart-total-row"><span>${esc(line.product.name)} × ${line.qty}</span><span>EGP ${(line.product.price * line.qty).toFixed(2)}</span></div>
  `).join('');
  totalEl.textContent = `EGP ${cartTotal().toFixed(2)}`;
}

function initCheckout() {
  const termsCheck = document.getElementById('termsCheck');
  const placeOrderBtn = document.getElementById('placeOrderBtn');
  termsCheck?.addEventListener('change', () => { placeOrderBtn.disabled = !termsCheck.checked; });

  document.getElementById('checkoutForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = cartLines();
    if (!lines.length) return;

    const payload = {
      customerName: document.getElementById('custName').value.trim(),
      customerPhone: document.getElementById('custPhone').value.trim(),
      notes: document.getElementById('custNotes').value.trim() || undefined,
      items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty }))
    };

    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = 'Placing order…';
    try {
      const res = await fetch(`${CONFIG.API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not place the order.');

      lastOrder = data;
      CART = {};
      saveCart();
      renderCart();
      showOrderSuccess(data);
    } catch (err) {
      alert(err.message);
    } finally {
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = 'Place Order ↦';
      termsCheck.checked = false;
    }
  });

  document.getElementById('cancelOrderBtn')?.addEventListener('click', async () => {
    if (!lastOrder) return;
    if (!confirm('Cancel this order?')) return;
    try {
      const res = await fetch(`${CONFIG.API_URL}/orders/${lastOrder.id}/cancel`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not cancel the order.');
      clearInterval(cancelTimerInterval);
      document.getElementById('cancelBox').hidden = true;
      document.getElementById('cancelExpired').hidden = false;
      document.getElementById('cancelExpired').textContent = 'This order has been cancelled.';
      toast('Order cancelled.');
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('trackThisOrderBtn')?.addEventListener('click', () => {
    if (!lastOrder) return;
    document.getElementById('trackOrderId').value = lastOrder.id;
    showView('track');
    trackOrder(lastOrder.id);
  });
}

function showOrderSuccess(order) {
  document.getElementById('successOrderId').textContent = order.id;
  document.getElementById('successCode').textContent = order.verificationCode;
  document.getElementById('cancelBox').hidden = false;
  document.getElementById('cancelExpired').hidden = true;

  const deadline = order.cancellationDeadline ? new Date(order.cancellationDeadline).getTime() : Date.now() + 5 * 60 * 1000;
  clearInterval(cancelTimerInterval);
  const tick = () => {
    const remaining = Math.max(0, deadline - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    document.getElementById('cancelTimer').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    if (remaining <= 0) {
      clearInterval(cancelTimerInterval);
      document.getElementById('cancelBox').hidden = true;
      document.getElementById('cancelExpired').hidden = false;
    }
  };
  tick();
  cancelTimerInterval = setInterval(tick, 1000);

  showView('success');
}

// ---------------------------------------------------------------------------
// UTIL
// ---------------------------------------------------------------------------
function esc(str) { return String(str ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}
