import { firebaseConfig } from '../firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, onSnapshot, query, orderBy,
  serverTimestamp, doc, getDoc, setDoc, deleteDoc, where, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ⚠️ GANTI dengan UID admin lu
const ADMIN_UIDS = ['ISI_UID_ADMIN_LU_DISINI'];

let currentAdmin = null;

const $ = (id) => document.getElementById(id);
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('toastAdmin');
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

    // Cek UID admin
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

// ===== SUBSCRIBE STATS =====
let unsubUsers, unsubPosts, unsubBanned, unsubRatings, unsubClosed;
let allUsersData = [], allPostsData = [], allBannedData = [], allClosedData = [];

function subscribeAll() {
  // Users
  if (unsubUsers) unsubUsers();
  unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
    allUsersData = [];
    snap.forEach(d => allUsersData.push({ id: d.id, ...d.data() }));
    $('aTotalUsers').textContent = snap.size;
    renderUsers(allUsersData);
  });

  // Posts
  if (unsubPosts) unsubPosts();
  unsubPosts = onSnapshot(collection(db, 'posts'), (snap) => {
    allPostsData = [];
    snap.forEach(d => allPostsData.push({ id: d.id, ...d.data() }));
    $('aTotalPosts').textContent = snap.size;
    renderPosts(allPostsData);
  });

  // Banned
  if (unsubBanned) unsubBanned();
  unsubBanned = onSnapshot(collection(db, 'banned'), (snap) => {
    allBannedData = [];
    snap.forEach(d => allBannedData.push({ hwid: d.id, ...d.data() }));
    $('aTotalBanned').textContent = snap.size;
    renderBanned(allBannedData);
  });

  // Ratings
  if (unsubRatings) unsubRatings();
  unsubRatings = onSnapshot(collection(db, 'ratings'), (snap) => {
    if (snap.size === 0) { $('aAvgRating').textContent = '-'; return; }
    let total = 0;
    snap.forEach(d => total += (d.data().rating || 0));
    $('aAvgRating').textContent = (total / snap.size).toFixed(1) + '⭐';
  });

  // Closed rooms
  if (unsubClosed) unsubClosed();
  unsubClosed = onSnapshot(collection(db, 'closedRooms'), (snap) => {
    allClosedData = [];
    snap.forEach(d => allClosedData.push({ id: d.id, ...d.data() }));
    renderClosedRooms(allClosedData);
  });
}

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

    await setDoc(doc(collection(db, 'banLog'), hwid + '_' + Date.now()), {
      hwid, reason, username, action: 'ban',
      by: currentAdmin.uid,
      at: serverTimestamp()
    });

    toast('🚫 HWID berhasil di-ban!', 'success');
    $('banHwid').value = '';
    $('banReason').value = '';
    $('banUsername').value = '';
    $('banDeviceInfo').value = '';
  } catch (e) {
    toast('Gagal: ' + e.message, 'error');
  }
});

// ===== RENDER BANNED LIST =====
function renderBanned(list) {
  const el = $('bannedList');
  if (!el) return;

  const search = ($('unbanSearch')?.value || '').toLowerCase().trim();
  const filtered = search
    ? list.filter(b =>
        b.hwid?.toLowerCase().includes(search) ||
        b.username?.toLowerCase().includes(search))
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
    div.querySelector('[data-unban]').addEventListener('click', async () => {
      if (!confirm('Unban HWID ini?')) return;
      try {
        await deleteDoc(doc(db, 'banned', b.hwid));
        await setDoc(doc(collection(db, 'banLog'), b.hwid + '_' + Date.now()), {
          hwid: b.hwid, action: 'unban',
          by: currentAdmin.uid,
          at: serverTimestamp()
        });
        toast('✅ HWID berhasil di-unban!', 'success');
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
    el.appendChild(div);
  });
}

$('unbanSearch')?.addEventListener('input', () => renderBanned(allBannedData));

// ===== CLOSE ROOM =====
$('doCloseBtn')?.addEventListener('click', async () => {
  const type = $('closeType').value;
  const roomId = $('closeRoomId').value.trim();
  const reason = $('closeReason').value.trim();

  if (!roomId) return toast('Room ID wajib!', 'error');
  if (!reason) return toast('Alasan wajib!', 'error');

  const fullId = type + '_' + roomId.replace(/^(gb|group|channel|post|dm)_/, '');

  try {
    await setDoc(doc(db, 'closedRooms', fullId), {
      type, roomId: fullId, reason,
      closedAt: serverTimestamp(),
      closedBy: currentAdmin.uid,
      closedByName: currentAdmin.displayName || currentAdmin.email
    });
    toast('🔒 Room berhasil ditutup!', 'success');
    $('closeRoomId').value = '';
    $('closeReason').value = '';
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

function renderClosedRooms(list) {
  const el = $('closedRoomsList');
  if (!el) return;

  if (list.length === 0) {
    el.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada room yang ditutup</p>';
    return;
  }

  el.innerHTML = '';
  list.forEach(r => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div class="list-item-info">
        <b>${escapeHtml(r.roomId)}</b>
        <small>📝 ${escapeHtml(r.reason)}</small>
        <small>📅 ${r.closedAt ? new Date(r.closedAt.seconds*1000).toLocaleString('id-ID') : '-'}</small>
      </div>
      <button class="btn-mini success" data-open="${escapeHtml(r.roomId)}">🔓 BUKA</button>
    `;
    div.querySelector('[data-open]').addEventListener('click', async () => {
      if (!confirm('Buka room ini?')) return;
      try {
        await deleteDoc(doc(db, 'closedRooms', r.roomId));
        toast('🔓 Room dibuka!', 'success');
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
    el.appendChild(div);
  });
}

// ===== USERS LIST =====
function renderUsers(list) {
  const el = $('usersList');
  if (!el) return;

  const search = ($('userSearch')?.value || '').toLowerCase().trim();
  const filtered = search
    ? list.filter(u =>
        u.username?.toLowerCase().includes(search) ||
        u.email?.toLowerCase().includes(search) ||
        u.hwid?.toLowerCase().includes(search))
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
        ${u.hwid ? `<div style="margin-top:6px"><span class="hwid-code">${escapeHtml(u.hwid)}</span></div>` : ''}
      </div>
      ${u.hwid ? `
        ${isBanned
          ? `<button class="btn-mini success" data-unban-user="${escapeHtml(u.hwid)}">✅ UNBAN</button>`
          : `<button class="btn-mini danger" data-ban-user="${escapeHtml(u.hwid)}" data-username="${escapeHtml(u.username || '')}">🚫 BAN DEVICE</button>`}
      ` : ''}
    `;

    div.querySelector('[data-ban-user]')?.addEventListener('click', () => {
      $('banHwid').value = div.querySelector('[data-ban-user]').dataset.banUser;
      $('banUsername').value = div.querySelector('[data-ban-user]').dataset.username;
      document.querySelector('.admin-tab[data-tab="ban"]')?.click();
      toast('Isi alasan ban dulu ya', 'success');
    });

    div.querySelector('[data-unban-user]')?.addEventListener('click', async () => {
      const hwid = div.querySelector('[data-unban-user]').dataset.unbanUser;
      if (!confirm('Unban device ini?')) return;
      try {
        await deleteDoc(doc(db, 'banned', hwid));
        toast('✅ Unban sukses!', 'success');
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });

    el.appendChild(div);
  });
}

$('userSearch')?.addEventListener('input', () => renderUsers(allUsersData));

// ===== POSTS LIST =====
function renderPosts(list) {
  const el = $('postsList');
  if (!el) return;

  const search = ($('postSearch')?.value || '').toLowerCase().trim();
  const filtered = search
    ? list.filter(p =>
        p.title?.toLowerCase().includes(search) ||
        p.sellerName?.toLowerCase().includes(search))
    : list;

  if (filtered.length === 0) {
    el.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Post gak ditemukan</p>';
    return;
  }

  el.innerHTML = '';
  filtered.forEach(p => {
    const div = document.createElement('div');
    div.className = 'list-item';
    const isClosed = allClosedData.some(c => c.roomId === 'post_' + p.id);
    div.innerHTML = `
      <div class="list-item-info">
        <b>${escapeHtml(p.title)} ${isClosed ? '🔒' : ''}</b>
        <small>👤 ${escapeHtml(p.sellerName || '-')}</small>
        <small>💰 Rp ${Number(p.price || 0).toLocaleString('id-ID')}</small>
      </div>
      ${isClosed
        ? `<button class="btn-mini success" data-open-post="${p.id}">🔓 BUKA</button>`
        : `<button class="btn-mini danger" data-close-post="${p.id}">🔒 TUTUP</button>`}
    `;
    div.querySelector('[data-close-post]')?.addEventListener('click', async () => {
      const reason = prompt('Alasan tutup post:');
      if (!reason) return;
      try {
        await setDoc(doc(db, 'closedRooms', 'post_' + p.id), {
          type: 'post', roomId: 'post_' + p.id, reason,
          closedAt: serverTimestamp(),
          closedBy: currentAdmin.uid
        });
        toast('🔒 Post ditutup!', 'success');
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
    div.querySelector('[data-open-post]')?.addEventListener('click', async () => {
      try {
        await deleteDoc(doc(db, 'closedRooms', 'post_' + p.id));
        toast('🔓 Post dibuka!', 'success');
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
    el.appendChild(div);
  });
}

$('postSearch')?.addEventListener('input', () => renderPosts(allPostsData));