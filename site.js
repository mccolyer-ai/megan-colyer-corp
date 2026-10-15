// Shared header behavior: mobile menu, active link, account-aware "Buyer Login".
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;
  var btn = header.querySelector('.sh-menu');
  if (btn) btn.addEventListener('click', function () {
    var open = header.classList.toggle('menu-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (header.classList.contains('menu-open') && !header.contains(e.target)) header.classList.remove('menu-open');
  });
  var page = document.body.getAttribute('data-page');
  header.querySelectorAll('[data-nav]').forEach(function (a) {
    if (a.getAttribute('data-nav') === page) a.classList.add('active');
  });
  var loggedIn = false;
  try { loggedIn = !!localStorage.getItem('bpToken'); } catch (e) {}
  var acct = header.querySelector('.sh-account[href="/buyer-portal"]');
  if (acct && loggedIn) acct.textContent = 'My Deals';
})();

// Share a property link (works on any page that loads site.js).
window.mcShareDeal = async function (leadId, address, price) {
  var url = window.location.origin + '/?deal=' + encodeURIComponent(leadId || '');
  var title = (address ? String(address).split(',')[0] : 'Off-market deal') + (price ? ' — $' + Number(price).toLocaleString() + ' asking' : '');
  var toast = function (msg) {
    var t = document.getElementById('mcShareToast');
    if (!t) {
      t = document.createElement('div'); t.id = 'mcShareToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#2b2b2b;color:#fff;padding:10px 20px;border-radius:30px;font:13px "PT Serif",serif;z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.opacity = '0'; }, 2200);
  };
  if (navigator.share) {
    try { await navigator.share({ title: title, text: 'Check out this deal: ' + title, url: url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied — ready to share!'); }
  catch (e) { window.prompt('Copy this link to share:', url); }
};

// Showing DAY for a deal's card (never the time). Accepts "Thu 10/15, 11-12:30", "10/15", or a date value; hides it once the day has passed.
window.mcShowingDay = function (raw) {
  if (!raw) return '';
  var s = String(raw).trim(), dt = null, label = '';
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    var d = new Date(s);
    dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    label = days[dt.getUTCDay()] + ' ' + (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate();
  } else {
    var m = s.match(/(\d{1,2})\/(\d{1,2})/), w = s.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i);
    if (m) {
      dt = new Date(Date.UTC(new Date().getFullYear(), +m[1] - 1, +m[2]));
      label = (w ? w[1].charAt(0).toUpperCase() + w[1].slice(1, 3).toLowerCase() + ' ' : '') + m[1] + '/' + m[2];
    } else {
      label = s.replace(/[,;]?\s*\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)\b.*$/i, '').replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b.*$/i, '').trim();
    }
  }
  if (dt) { var t = new Date(); if (dt.getTime() < Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) return ''; }
  return label;
};

/* Open-house banner across the top of a card's main photo */
(function () {
  try {
    var st = document.createElement('style');
    st.textContent = '.mc-show-banner{position:absolute;top:0;left:0;right:0;z-index:5;background:#111;color:#e6c77a;text-align:center;font:700 12px/1 Montserrat,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:9px 8px;border-bottom:2px solid #b89a5e;box-shadow:0 2px 8px rgba(0,0,0,.35);animation:mcBannerGlow 2.4s ease-in-out infinite}' +
      '.mc-show-banner b{color:#fff;font-weight:800}' +
      '@keyframes mcBannerGlow{0%,100%{background:#111}50%{background:#2a2112}}' +
      '.card-photo:has(.mc-show-banner) .photo-badge,.card-photo:has(.mc-show-banner) .exclusive-badge{top:42px !important}';
    document.head.appendChild(st);
  } catch (e) {}
})();
window.mcShowBanner = function (d) {
  try {
    var day = window.mcShowingDay && window.mcShowingDay(d && (d.Showing || d.showing));
    return day ? '<div class="mc-show-banner">🏠 Open house &middot; <b>' + String(day).replace(/[<>&]/g, '') + '</b></div>' : '';
  } catch (e) { return ''; }
};
