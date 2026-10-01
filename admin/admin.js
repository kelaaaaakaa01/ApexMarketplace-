import { firebaseConfig } from '../firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, onSnapshot, serverTimestamp,
  doc, getDoc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ⚠️ GANTI dengan UID admin lu
const ADMIN_UIDS = ['BM2nil1Qw6W1D9RlbZCMydh4qK53'];

let currentAdmin = null;

const $ = (id) => document.getElementById(id);
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('toastAdmin');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast-admin show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== LOGIN =====
$('adminLoginBtn')?.addEventListener('click', async () => {
  const email = $('adminEmail').value.trim();
  const pass = $('adminPassword').value;
  if (!email || !pass) return toast('Isi email & password!', 'error');

  $('loginMsg').textContent = 'Loading...';
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);

    if (!ADMIN_UIDS.includes(cred.user.uid)) {
      $('loginMsg').textContent = '❌ Lu bukan admin!';
      await signOut(auth);
      return;
    }

    $('loginMsg').textContent = '✅ Login sukses!';
  } catch (e) {
    $('loginMsg').textContent = '❌ ' + e.message;
  }
});

$('logoutBtn')?.addEventListener('click', async () => {
  if (confirm('Logout?')) await signOut(auth);
});

// ===== AUTH STATE =====
onAuthStateChanged(auth, (user) => {
  currentAdmin = user;
  if (user && ADMIN_UIDS.includes(user.uid)) {
    $('loginScreen').classList.add('hidden');
    $('adminPanel').classList.remove('hidden');
    $('adminName').textContent = user.displayName || user.email;
    subscribeAll();
  } else {
    $('loginScreen').classList.remove('hidden');
    $('adminPanel').classList.add('hidden');
  }
});

// ===== TABS =====
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ===== SUBSCRIBE SEMUA DATA =====
let unsubUsers, unsubPosts, unsubBanned, unsubRatings, unsubSite;
let allUsersData = [], allBannedData = [];

function subscribeAll() {
  // Users
  if (unsubUsers) unsubUsers();
  unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
    allUsersData = [];
    snap.forEach(d => allUsersData.push({ id: d.id, ...d.data() }));
    const totalEl = $('aTotalUsers');
    if (totalEl) totalEl.textContent = snap.size;
    renderUsers(allUsersData);
  }, (err) => {
    console.error('Users error:', err);
  });

  // Posts
  if (unsubPosts) unsubPosts();
  unsubPosts = onSnapshot(collection(db, 'posts'), (snap) => {
    const el = $('aTotalPosts');
    if (el) el.textContent = snap.size;
  });

  // Banned
  if (unsubBanned) unsubBanned();
  unsubBanned = onSnapshot(collection(db, 'banned'), (snap) => {
    allBannedData = [];
    snap.forEach(d => allBannedData.push({ hwid: d.id, ...d.data() }));
    const el = $('aTotalBanned');
    if (el) el.textContent = snap.size;
    renderBanned(allBannedData);
    renderUsers(allUsersData);
  });

  // Ratings
  if (unsubRatings) unsubRatings();
  unsubRatings = onSnapshot(collection(db, 'ratings'), (snap) => {
    const el = $('aAvgRating');
    if (!el) return;
    if (snap.size === 0) { el.textContent = '-'; return; }
    let total = 0;
    snap.forEach(d => total += (d.data().rating || 0));
    el.textContent = (total / snap.size).toFixed(1) + '⭐';
  });

  // Site Config (Tutup Website)
  if (unsubSite) unsubSite();
  unsubSite = onSnapshot(doc(db, 'siteConfig', 'main'), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    const statusEl = $('siteStatus');
    const titleEl = $('siteTitle');
    const msgEl = $('siteMessage');
    const waEl = $('siteWa');

    if (statusEl) statusEl.value = d.status || 'open';
    if (titleEl) titleEl.value = d.title || '';
    if (msgEl) msgEl.value = d.message || '';
    if (waEl) waEl.value = d.wa || '';
    updatePreview();
  }, (err) => {
    console.error('Site config error:', err);
  });
}

// ===== RENDER USERS =====
function renderUsers(list) {
  const el = $('usersList');
  if (!el) return;

  const search = ($('userSearch')?.value || '').toLowerCase().trim();
  const filtered = search
    ? list.filter(u =>
        (u.username || '').toLowerCase().includes(search) ||
        (u.email || '').toLowerCase().includes(search) ||
        (u.hwid || '').toLowerCase().includes(search))
    : list;

  if (filtered.length === 0) {
    el.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">User gak ditemukan</p>';
    return;
  }

  el.innerHTML = '';
  filtered.forEach(u => {
    const div = document.createElement('div');
    div.className = 'list-item';
    const isBanned = allBannedData.some(b => b.hwid === u.hwid);
    div.innerHTML = `
      <div class="list-item-info">
        <b>${escapeHtml(u.username || 'Anonim')} ${isBanned ? '🚫' : ''}</b>
        <small>📧 ${escapeHtml(u.email || '-')}</small>
        ${u.hwid
          ? `<div style="margin-top:6px"><span class="hwid-code">${escapeHtml(u.hwid)}</span></div>`
          : '<small style="color:#FF4757;margin-top:4px">⚠️ HWID gak ke-detect (user lama, minta login ulang)</small>'}
        ${u.deviceInfo ? `<small style="margin-top:4px">📱 ${escapeHtml(u.deviceInfo)}</small>` : ''}
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${u.hwid ? `
          <button class="btn-mini" data-copy="${escapeHtml(u.hwid)}">📋 COPY</button>
          ${isBanned
            ? `<button class="btn-mini success" data-unban-user="${escapeHtml(u.hwid)}">✅ UNBAN</button>`
            : `<button class="btn-mini danger" data-ban-user="${escapeHtml(u.hwid)}" data-username="${escapeHtml(u.username || '')}">🚫 BAN DEVICE</button>`}
        ` : ''}
      </div>
    `;

    div.querySelector('[data-copy]')?.addEventListener('click', (e) => {
      const hwid = e.currentTarget.dataset.copy;
      navigator.clipboard.writeText(hwid);
      toast('📋 HWID dicopy!', 'success');
    });

    div.querySelector('[data-ban-user]')?.addEventListener('click', (e) => {
      const hwid = e.currentTarget.dataset.banUser;
      const username = e.currentTarget.dataset.username;
      $('banHwid').value = hwid;
      $('banUsername').value = username;
      document.querySelector('.admin-tab[data-tab="ban"]')?.click();
      toast('Isi alasan ban dulu ya', 'success');
    });

    div.querySelector('[data-unban-user]')?.addEventListener('click', async (e) => {
      const hwid = e.currentTarget.dataset.unbanUser;
      if (!confirm('Unban device ini?')) return;
      try {
        await deleteDoc(doc(db, 'banned', hwid));
        toast('✅ Unban sukses!', 'success');
      } catch (err) { toast('Gagal: ' + err.message, 'error'); }
    });

    el.appendChild(div);
  });
}

$('userSearch')?.addEventListener('input', () => renderUsers(allUsersData));

// ===== BAN =====
$('doBanBtn')?.addEventListener('click', async () => {
  const hwid = $('banHwid').value.trim();
  const reason = $('banReason').value.trim();
  const username = $('banUsername').value.trim();
  const deviceInfo = $('banDeviceInfo').value.trim();

  if (!hwid) return toast('HWID wajib diisi!', 'error');
  if (!reason) return toast('Alasan wajib diisi!', 'error');

  try {
    await setDoc(doc(db, 'banned', hwid), {
      hwid, reason, username, deviceInfo,
      bannedAt: serverTimestamp(),
      bannedBy: currentAdmin.uid,
      bannedByName: currentAdmin.displayName || currentAdmin.email
    });

    try {
      await setDoc(doc(collection(db, 'banLog'), hwid + '_' + Date.now()), {
        hwid, reason, username, action: 'ban',
        by: currentAdmin.uid,
        at: serverTimestamp()
      });
    } catch (e) {}

    toast('🚫 HWID berhasil di-ban!', 'success');
    $('banHwid').value = '';
    $('banReason').value = '';
    $('banUsername').value = '';
    $('banDeviceInfo').value = '';
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
});

// ===== RENDER BANNED =====
function renderBanned(list) {
  const el = $('bannedList');
  if (!el) return;

  const search = ($('unbanSearch')?.value || '').toLowerCase().trim();
  const filtered = search
    ? list.filter(b =>
        (b.hwid || '').toLowerCase().includes(search) ||
        (b.username || '').toLowerCase().includes(search))
    : list;

  if (filtered.length === 0) {
    el.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada HWID yang di-ban</p>';
    return;
  }

  el.innerHTML = '';
  filtered.forEach(b => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div class="list-item-info">
        <b>${escapeHtml(b.username || 'Unknown User')}</b>
        <small>${escapeHtml(b.reason || '-')}</small>
        <div style="margin-top:6px">
          <span class="hwid-code">${escapeHtml(b.hwid)}</span>
        </div>
        <small style="margin-top:4px">📅 ${b.bannedAt ? new Date(b.bannedAt.seconds*1000).toLocaleString('id-ID') : '-'}</small>
      </div>
      <button class="btn-mini success" data-unban="${escapeHtml(b.hwid)}">✅ UNBAN</button>
    `;
    div.querySelector('[data-unban]')?.addEventListener('click', async (e) => {
      const hwid = e.currentTarget.dataset.unban;
      if (!confirm('Unban HWID ini?')) return;
      try {
        await deleteDoc(doc(db, 'banned', hwid));
        try {
          await setDoc(doc(collection(db, 'banLog'), hwid + '_' + Date.now()), {
            hwid, action: 'unban',
            by: currentAdmin.uid,
            at: serverTimestamp()
          });
        } catch (e) {}
        toast('✅ HWID berhasil di-unban!', 'success');
      } catch (err) { toast('Gagal: ' + err.message, 'error'); }
    });
    el.appendChild(div);
  });
}

$('unbanSearch')?.addEventListener('input', () => renderBanned(allBannedData));

// ===== SITE CONFIG (TUTUP WEBSITE) =====
function updatePreview() {
  const titleEl = $('siteTitle');
  const msgEl = $('siteMessage');
  const previewTitle = $('previewTitle');
  const previewMsg = $('previewMsg');

  if (previewTitle) previewTitle.textContent = titleEl?.value || '⚠️ MAINTENANCE';
  if (previewMsg) previewMsg.textContent = msgEl?.value || 'Website lagi maintenance...';
}

$('siteTitle')?.addEventListener('input', updatePreview);
$('siteMessage')?.addEventListener('input', updatePreview);

$('saveSiteBtn')?.addEventListener('click', async () => {
  const status = $('siteStatus').value;
  const title = $('siteTitle').value.trim();
  const message = $('siteMessage').value.trim();
  const wa = $('siteWa').value.trim();

  if (status === 'closed' && !message) {
    return toast('Isi pesan dulu kalau mau tutup web!', 'error');
  }

  try {
    await setDoc(doc(db, 'siteConfig', 'main'), {
      status,
      title: title || '⚠️ WEBSITE DITUTUP',
      message: message || 'Website lagi maintenance, balik lagi nanti ya!',
      wa: wa || '',
      updatedAt: serverTimestamp(),
      updatedBy: currentAdmin.uid
    }, { merge: true });

    if (status === 'closed') {
      toast('🔒 Website DITUTUP! Semua user bakal liat popup.', 'success');
    } else {
      toast('✅ Website DIBUKA kembali!', 'success');
    }
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
});