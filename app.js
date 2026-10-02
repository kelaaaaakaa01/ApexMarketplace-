import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query,
  orderBy, serverTimestamp, doc, getDoc, setDoc, deleteDoc,
  where, updateDoc, arrayUnion, arrayRemove, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

// ⚠️ GANTI dengan UID admin lu
const ADMIN_UIDS = ['ISI_UID_ADMIN_LU_DISINI'];

// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let currentChatTarget = null;
let unsubscribeChat = null;
let unsubscribeUsers = null;
let unsubscribeMyPosts = null;
let unsubscribeFeed = null;
let unsubscribeHomeFeed = null;
let unsubscribeChatList = null;
let unsubscribeStoryRow = null;
let unsubscribeChannels = null;
let unsubscribeIncomingCall = null;
let unsubscribeMyRating = null;
let replyTo = null;
let allUsers = {};
let allChats = [];
let allChannels = [];
let currentChatFilter = 'all';
let stories = [];
let storyIndex = 0;
let storyTimer = null;
let editAvatarData = null;
let editGroupAvatarData = null;
let unreadCounts = {};
let currentHWID = null;
let isAdminUser = false;
let builderFiles = [];

// Call state
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let callDocUnsub = null;
let isMuted = false;
let isSpeaker = false;
let callStartTime = null;
let callDurationTimer = null;
let pendingCallData = null;
let isInCall = false;

let presenceInterval = null;
let musicPlaying = false;
let musicStarted = false;

const $ = (id) => document.getElementById(id);

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatSize(bytes) {
  if (!bytes) return '?';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1)+' KB';
  return (bytes/1024/1024).toFixed(1)+' MB';
}
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(2) + ' MB';
}
function formatPrice(n) { return 'Rp ' + Number(n||0).toLocaleString('id-ID'); }
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts.seconds * 1000);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'baru';
  if (diff < 3600) return Math.floor(diff/60) + 'm';
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('id-ID', {day:'2-digit',month:'2-digit'});
}
function translateErr(code) {
  const map = {
    'auth/email-already-in-use': 'Email sudah terdaftar.',
    'auth/invalid-email': 'Format email salah.',
    'auth/weak-password': 'Password minimal 6 karakter.',
    'auth/user-not-found': 'Akun tidak ditemukan.',
    'auth/wrong-password': 'Password salah.',
    'auth/invalid-credential': 'Email atau password salah.',
    'auth/too-many-requests': 'Terlalu banyak percobaan.',
    'permission-denied': 'Akses ditolak. Cek Firestore Rules!'
  };
  return map[code] || code;
}
function getInitial(n = '') { return (n.charAt(0) || '?').toUpperCase(); }
function getAvatarColor(n = '') {
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
  return 'av-' + (Math.abs(hash) % 8);
}
function avatarHTML(name, size = '', photoURL = '') {
  const color = getAvatarColor(name);
  if (photoURL) {
    return `<div class="avatar ${size} ${color}" style="overflow:hidden;padding:0"><img src="${photoURL}" style="width:100%;height:100%;object-fit:cover"></div>`;
  }
  return `<div class="avatar ${size} ${color}">${escapeHtml(getInitial(name))}</div>`;
}
function isUserOnline(userData) {
  if (!userData || !userData.lastSeen) return false;
  const lastSeen = userData.lastSeen.seconds ? userData.lastSeen.seconds * 1000 : 0;
  return (Date.now() - lastSeen) < 120000;
}

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ============================================
// ===== HWID =====
// ============================================
async function generateHWID() {
  const components = [
    navigator.userAgent, navigator.language,
    screen.width + 'x' + screen.height, screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 'unknown',
    navigator.platform || 'unknown',
    navigator.deviceMemory || 'unknown'
  ].join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(components);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return 'HWID-' + hashHex.substring(0, 32).toUpperCase();
}

async function checkHWIDBan(hwid) {
  try {
    const snap = await getDoc(doc(db, 'banned', hwid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

function showBannedScreen(banData, hwid) {
  const screen = $('bannedScreen');
  if (!screen) return;
  screen.classList.remove('hidden');

  const hwidEl = $('bannedHwid'); if (hwidEl) hwidEl.textContent = hwid;
  const reasonEl = $('bannedReason'); if (reasonEl) reasonEl.textContent = banData.reason || 'Tidak ada alasan';
  const dateEl = $('bannedDate');
  if (dateEl) dateEl.textContent = banData.bannedAt
    ? new Date(banData.bannedAt.seconds * 1000).toLocaleString('id-ID') : '-';
  const deviceEl = $('bannedDevice');
  if (deviceEl) deviceEl.textContent = banData.deviceInfo ||
    `${navigator.platform || 'Unknown'} • ${navigator.userAgent.substring(0, 80)}`;

  $('copyHwidBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(hwid).then(() => toast('📋 HWID dicopy!', 'success'));
  });

  const waMsg = encodeURIComponent(
    `Halo Developer,\n\nDevice gw kena ban di website.\n\nHWID: ${hwid}\nAlasan: ${banData.reason || '-'}\n\nMohon dibuka aksesnya.`
  );
  const wa1 = $('bannedWa1'); const wa2 = $('bannedWa2');
  if (wa1) wa1.href = `https://wa.me/6283181437266?text=${waMsg}`;
  if (wa2) wa2.href = `https://wa.me/6283185679623?text=${waMsg}`;
}

async function saveHWIDToUser(uid, hwid) {
  try {
    await setDoc(doc(db, 'users', uid), {
      hwid, deviceInfo: `${navigator.platform || 'Unknown'} • ${navigator.userAgent.substring(0, 100)}`,
      lastSeen: serverTimestamp()
    }, { merge: true });
  } catch (e) {}
}

// ============================================
// ===== STATS =====
// ============================================
function subscribeStats() {
  onSnapshot(collection(db, 'users'), (snap) => {
    const el = $('statVisitors'); if (el) el.textContent = snap.size + '+';
  });
  onSnapshot(collection(db, 'posts'), (snap) => {
    const el = $('statPosts'); if (el) el.textContent = snap.size + '+';
  });
  onSnapshot(collection(db, 'ratings'), (snap) => {
    const el = $('statRating'); if (!el) return;
    if (snap.size === 0) { el.textContent = '-'; return; }
    let total = 0;
    snap.forEach(d => total += (d.data().rating || 0));
    el.textContent = (total / snap.size).toFixed(1) + '⭐';
  });
}

// ============================================
// ===== RATING =====
// ============================================
function subscribeMyRating() {
  if (!currentUser) return;
  if (unsubscribeMyRating) unsubscribeMyRating();
  unsubscribeMyRating = onSnapshot(doc(db, 'ratings', currentUser.uid), (snap) => {
    const stars = document.querySelectorAll('.star');
    const rating = snap.exists() ? snap.data().rating : 0;
    stars.forEach(s => {
      const val = parseInt(s.dataset.star);
      s.classList.toggle('active', val <= rating);
    });
    const msg = $('ratingMsg');
    if (msg) msg.textContent = rating > 0 ? `Lu udah kasih ${rating} bintang ⭐` : 'Bantu kita jadi lebih baik!';
  });
}

function bindRatingStars() {
  document.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', async () => {
      if (!currentUser) return toast('Login dulu buat kasih rating!', 'error');
      const rating = parseInt(star.dataset.star);
      try {
        await setDoc(doc(db, 'ratings', currentUser.uid), {
          rating, userId: currentUser.uid,
          userName: currentUser.displayName || 'User',
          updatedAt: serverTimestamp()
        });
        toast(`⭐ Makasih! Lu kasih ${rating} bintang`, 'success');
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
  });
}

// ============================================
// ===== CLOSED ROOMS =====
// ============================================
async function checkRoomClosed(roomId) {
  try {
    const snap = await getDoc(doc(db, 'closedRooms', roomId));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

async function checkCurrentChatClosed() {
  if (!currentChatTarget) return null;
  const prefix = currentChatTarget.type === 'channel' ? 'channel_'
    : currentChatTarget.type === 'group' ? 'group_' : 'dm_';
  const closed = await checkRoomClosed(prefix + currentChatTarget.id);

  const banner = $('fcClosedBanner');
  const input = $('fcChatInput');
  const sendBtn = document.querySelector('#fcChatForm button[type="submit"]');

  if (closed) {
    if (banner) {
      banner.classList.remove('hidden');
      banner.innerHTML = `<b>⛔ ROOM INI DITUTUP</b>Alasan: ${escapeHtml(closed.reason || '-')}`;
    }
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    return closed;
  } else {
    if (banner) banner.classList.add('hidden');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    return null;
  }
}

// ============================================
// ===== NOTIFIKASI =====
// ============================================
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'https://via.placeholder.com/64/FFD93D/000?text=A' }); } catch (e) {}
  }
}
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}
function updateFaviconBadge(count) {
  let link = document.querySelector("link[rel*='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'shortcut icon';
    document.head.appendChild(link);
  }
  if (count > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFD93D'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(count > 9 ? '9+' : count, 32, 48);
    link.href = canvas.toDataURL();
  } else { link.href = 'data:,'; }
}
function updateTotalUnread() {
  const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const chatBadge = $('sidebarChatBadge');
  if (chatBadge) {
    if (total > 0) {
      chatBadge.textContent = total > 99 ? '99+' : total;
      chatBadge.classList.remove('hidden');
    } else { chatBadge.classList.add('hidden'); }
  }
  updateFaviconBadge(total);
}

// ============================================
// ===== PRESENCE =====
// ============================================
async function markOnline() {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), { online: true, lastSeen: serverTimestamp() }, { merge: true });
  } catch (e) {}
}
async function markOffline() {
  if (!currentUser) return;
  try { await updateDoc(doc(db, 'users', currentUser.uid), { online: false, lastSeen: serverTimestamp() }); } catch (e) {}
}
function startPresence() {
  if (!currentUser) return;
  markOnline();
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(markOnline, 30000);
}
function stopPresence() {
  if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; }
  markOffline();
}

// ============================================
// ===== SIDEBAR =====
// ============================================
function openSidebar() {
  $('sidebar')?.classList.add('show');
  const ov = $('overlay');
  if (ov) { ov.classList.remove('hidden'); setTimeout(() => ov.classList.add('show'), 10); }
}
function closeSidebar() {
  $('sidebar')?.classList.remove('show');
  const ov = $('overlay');
  if (ov) { ov.classList.remove('show'); setTimeout(() => ov.classList.add('hidden'), 300); }
}
$('menuBtn')?.addEventListener('click', openSidebar);
$('sidebarClose')?.addEventListener('click', closeSidebar);
$('overlay')?.addEventListener('click', closeSidebar);

// ============================================
// ===== ROUTING =====
// ============================================
function navigate(page) {
  history.replaceState(null, '', '#' + page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.side-link').forEach(l => l.classList.remove('active'));
  const pageEl = $('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll(`.side-link[data-page="${page}"]`).forEach(l => l.classList.add('active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeSidebar();
  if (page === 'chats') renderChatList();
  if (page === 'channels') renderChannels();
}
function initRoute() {
  const hash = location.hash.replace('#', '') || 'home';
  navigate(hash);
}
document.querySelectorAll('.side-link, [data-page]').forEach(el => {
  el.addEventListener('click', (e) => {
    const page = el.dataset.page;
    if (page) { e.preventDefault(); navigate(page); }
  });
});

// ============================================
// ===== AUTH =====
// ============================================
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authtab === mode));
  $('authUsername')?.classList.toggle('hidden', mode !== 'register');
  const btn = $('doAuth');
  if (btn) btn.textContent = mode === 'register' ? 'DAFTAR' : 'LOGIN';
}
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => setAuthMode(tab.dataset.authtab));
});
$('switchAuth')?.addEventListener('click', (e) => {
  e.preventDefault();
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});
$('topAuthBtn')?.addEventListener('click', () => {
  if (currentUser) navigate('profile');
  else { navigate('auth'); setAuthMode('login'); }
});
$('sideAuthBtn')?.addEventListener('click', () => {
  if (currentUser) { if (confirm('Logout?')) signOut(auth); }
  else { navigate('auth'); setAuthMode('login'); }
});

$('doAuth')?.addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const pass = $('authPassword').value;
  const uname = $('authUsername').value.trim() || email.split('@')[0];
  if (!email || !pass) return toast('Email & password wajib!', 'error');
  if (pass.length < 6) return toast('Password min 6 karakter!', 'error');

  const btn = $('doAuth');
  btn.disabled = true; btn.textContent = 'LOADING...';

  try {
    if (authMode === 'register') {
      const hwid = currentHWID || await generateHWID();
      currentHWID = hwid;
      const banData = await checkHWIDBan(hwid);
      if (banData) {
        btn.disabled = false; btn.textContent = 'DAFTAR';
        showBannedScreen(banData, hwid);
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: uname });
      try {
        await setDoc(doc(db, 'users', cred.user.uid), {
          username: uname, email, photoURL: '', bio: '',
          online: true, lastSeen: serverTimestamp(), createdAt: serverTimestamp()
        });
        await saveHWIDToUser(cred.user.uid, hwid);
      } catch (e) {}
      toast('✅ Daftar sukses!', 'success');
    } else {
      const hwid = currentHWID || await generateHWID();
      currentHWID = hwid;
      const banData = await checkHWIDBan(hwid);
      if (banData) {
        btn.disabled = false; btn.textContent = 'LOGIN';
        showBannedScreen(banData, hwid);
        return;
      }
      await signInWithEmailAndPassword(auth, email, pass);
      toast('✅ Login berhasil!', 'success');
    }
    $('authEmail').value = ''; $('authPassword').value = ''; $('authUsername').value = '';
    navigate('home');
  } catch (e) {
    toast('Gagal: ' + translateErr(e.code), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'register' ? 'DAFTAR' : 'LOGIN';
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    if (currentHWID) saveHWIDToUser(user.uid, currentHWID);
    const name = user.displayName || user.email;
    await loadUserData();
    const photoURL = currentUserData?.photoURL || '';

    const topBtn = $('topAuthBtn');
    if (topBtn) {
      topBtn.className = 'top-avatar';
      if (photoURL) topBtn.innerHTML = `<img src="${photoURL}">`;
      else { topBtn.textContent = getInitial(name); topBtn.classList.add(getAvatarColor(name)); }
    }
    const sideAv = $('sideAvatar');
    if (sideAv) {
      sideAv.className = 'avatar';
      if (photoURL) sideAv.innerHTML = `<img src="${photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      else { sideAv.textContent = getInitial(name); sideAv.classList.add(getAvatarColor(name)); }
    }
    const sideName = $('sideName'); if (sideName) sideName.textContent = name;
    const sideAuthBtn = $('sideAuthBtn'); if (sideAuthBtn) sideAuthBtn.textContent = 'LOGOUT';

    // Cek admin
    isAdminUser = ADMIN_UIDS.includes(user.uid);
    const builderMenu = document.getElementById('builderMenu');
    if (builderMenu) {
      if (isAdminUser) builderMenu.classList.remove('hidden');
      else builderMenu.classList.add('hidden');
    }

    requestNotificationPermission();
    startPresence();
    subscribeUsers();
    subscribeMyPosts();
    subscribeChatList();
    subscribeStoryRow();
    subscribeChannels();
    subscribeMyRating();
    listenIncomingCalls();
    listenGlobalNotifications();
    renderProfile();
  } else {
    const topBtn = $('topAuthBtn');
    if (topBtn) {
      topBtn.textContent = 'LOGIN';
      topBtn.className = 'btn-login-top';
      topBtn.style.cssText = '';
    }
    const sideAv = $('sideAvatar');
    if (sideAv) { sideAv.textContent = '?'; sideAv.className = 'avatar'; }
    const sideName = $('sideName'); if (sideName) sideName.textContent = 'Guest';
    const sideAuthBtn = $('sideAuthBtn'); if (sideAuthBtn) sideAuthBtn.textContent = 'LOGIN';

    isAdminUser = false;
    const builderMenu = document.getElementById('builderMenu');
    if (builderMenu) builderMenu.classList.add('hidden');

    stopPresence();
    [unsubscribeUsers, unsubscribeMyPosts, unsubscribeChat, unsubscribeChatList,
     unsubscribeStoryRow, unsubscribeChannels, unsubscribeIncomingCall,
     unsubscribeMyRating].forEach(fn => fn && fn());
    allChats = []; allUsers = {}; allChannels = []; unreadCounts = {};

    const pi = $('profileInfo'); if (pi) pi.innerHTML = '<p>Login dulu...</p>';
    const wcl = $('waChatList'); if (wcl) wcl.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Login dulu...</p>';
    const mp = $('myPosts'); if (mp) mp.innerHTML = '<p style="padding:20px">Login buat lihat...</p>';
    const cl = $('channelList'); if (cl) cl.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Login dulu...</p>';
    updateTotalUnread();
  }
});

window.addEventListener('beforeunload', () => stopPresence());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) markOnline();
});

async function loadUserData() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    currentUserData = snap.exists() ? snap.data() : {
      username: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email, photoURL: '', bio: ''
    };
  } catch (e) {
    currentUserData = { username: currentUser.displayName || currentUser.email.split('@')[0] };
  }
}

// ============================================
// ===== POST JUALAN =====
// ============================================
$('postForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { toast('Login dulu!', 'error'); navigate('auth'); return; }
  const title = $('postTitle').value.trim();
  const desc = $('postDesc').value.trim();
  const price = Number($('postPrice').value);
  const image = $('postImage').value.trim() || 'https://via.placeholder.com/300x180/FFD93D/000?text=No+Image';
  if (!title || !desc || isNaN(price)) return toast('Isi semua field!', 'error');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'POSTING...';
  try {
    await addDoc(collection(db, 'posts'), {
      title, desc, price, image,
      sellerId: currentUser.uid,
      sellerName: currentUser.displayName || currentUserData?.username || 'Anonim',
      sellerEmail: currentUser.email || '',
      likes: [], createdAt: serverTimestamp()
    });
    e.target.reset();
    toast('✅ Postingan berhasil!', 'success');
    navigate('feed');
  } catch (err) { toast('Error: ' + translateErr(err.code || err.message), 'error'); }
  finally { btn.disabled = false; btn.textContent = '🚀 POSTING!'; }
});

function postCardHTML(p, id) {
  const isMine = currentUser && p.sellerId === currentUser.uid;
  const liked = currentUser && Array.isArray(p.likes) && p.likes.includes(currentUser.uid);
  const sellerName = p.sellerName || 'Anonim';
  return `
    <button class="like-btn ${liked ? 'liked' : ''}" data-like="${id}">${liked ? '❤️' : '🤍'}</button>
    <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" onerror="this.src='https://via.placeholder.com/300x180'">
    <h3>${escapeHtml(p.title)}</h3>
    <p>${escapeHtml(p.desc)}</p>
    <span class="price">${formatPrice(p.price)}</span>
    <div class="seller">${avatarHTML(sellerName, 'small')}<span>${escapeHtml(sellerName)}</span></div>
    <div class="actions">
      ${isMine
        ? `<button class="btn-pop" data-delete="${id}">🗑️ HAPUS</button>`
        : `<button class="btn-pop" data-chat-user="${p.sellerId}" data-chat-name="${escapeHtml(sellerName)}">💬 CHAT</button>`}
    </div>
  `;
}
function bindPostActions(container) {
  container.querySelectorAll('[data-chat-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser) { navigate('auth'); return; }
      const uid = btn.dataset.chatUser;
      const name = btn.dataset.chatName;
      if (uid === currentUser.uid) return toast('Ini barang lu sendiri 😅', 'error');
      openDM(uid, name);
    });
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus?')) return;
      try { await deleteDoc(doc(db, 'posts', btn.dataset.delete)); toast('🗑️ Dihapus', 'success'); }
      catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
  });
  container.querySelectorAll('[data-like]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentUser) { navigate('auth'); return; }
      const liked = btn.classList.contains('liked');
      try {
        await updateDoc(doc(db, 'posts', btn.dataset.like), {
          likes: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
        });
      } catch (e) {}
    });
  });
}

function subscribeFeed() {
  if (unsubscribeFeed) unsubscribeFeed();
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
  unsubscribeFeed = onSnapshot(q, async (snap) => {
    const list = $('feedList'); if (!list) return;
    list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<p style="padding:20px">Belum ada postingan.</p>'; return; }
    for (const d of snap.docs) {
      const p = d.data();
      const closed = await checkRoomClosed('post_' + d.id);
      const card = document.createElement('div');
      card.className = 'post-card' + (closed ? ' closed' : '');
      card.dataset.postId = d.id;
      card.dataset.sellerId = p.sellerId;
      card.dataset.sellerName = p.sellerName || 'Anonim';
      card.innerHTML = postCardHTML(p, d.id);
      if (closed) {
        const stamp = document.createElement('div');
        stamp.className = 'closed-stamp';
        stamp.textContent = '⛔ DITUTUP';
        card.appendChild(stamp);
      }
      list.appendChild(card);
    }
    bindPostActions(list);
  });
}
function subscribeHomeFeed() {
  if (unsubscribeHomeFeed) unsubscribeHomeFeed();
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(6));
  unsubscribeHomeFeed = onSnapshot(q, (snap) => {
    const list = $('homeFeed'); if (!list) return;
    list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<p style="padding:20px">Belum ada barang.</p>'; return; }
    snap.forEach(d => {
      const p = d.data();
      const card = document.createElement('div');
      card.className = 'post-card';
      card.dataset.sellerId = p.sellerId;
      card.dataset.sellerName = p.sellerName || 'Anonim';
      card.innerHTML = postCardHTML(p, d.id);
      list.appendChild(card);
    });
    bindPostActions(list);
  });
}
function subscribeMyPosts() {
  if (unsubscribeMyPosts) unsubscribeMyPosts();
  if (!currentUser) return;
  const q = query(collection(db, 'posts'), where('sellerId', '==', currentUser.uid), orderBy('createdAt', 'desc'));
  unsubscribeMyPosts = onSnapshot(q, (snap) => {
    const list = $('myPosts'); if (!list) return;
    list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<p style="padding:20px">Belum jualan apa-apa.</p>'; return; }
    snap.forEach(d => {
      const p = d.data();
      const card = document.createElement('div');
      card.className = 'post-card';
      card.dataset.sellerId = p.sellerId;
      card.dataset.sellerName = p.sellerName || 'Anonim';
      card.innerHTML = postCardHTML(p, d.id);
      list.appendChild(card);
    });
    bindPostActions(list);
  });
}

// ============================================
// ===== USERS =====
// ============================================
function subscribeUsers() {
  if (unsubscribeUsers) unsubscribeUsers();
  unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
    allUsers = {};
    snap.forEach(u => { allUsers[u.id] = { uid: u.id, ...u.data() }; });
    renderChatList();
  });
}

// ============================================
// ===== CHAT LIST =====
// ============================================
function subscribeChatList() {
  if (unsubscribeChatList) unsubscribeChatList();
  if (!currentUser) return;
  unsubscribeChatList = onSnapshot(collection(db, 'chats'), (snap) => {
    const chats = [];
    snap.forEach(d => {
      const c = d.data();
      if (!c.members || !c.members.includes(currentUser.uid)) return;
      if (c.type === 'channel') return;
      chats.push({
        id: d.id, type: c.type || 'dm', name: c.name || 'Chat',
        members: c.members, admins: c.admins || [],
        photoURL: c.photoURL || '', desc: c.desc || '',
        lastMsg: c.lastMessage || '', lastMsgAt: c.lastMessageAt,
        lastSender: c.lastSender || '', unread: c.unread?.[currentUser.uid] || 0
      });
    });
    chats.sort((a, b) => (b.lastMsgAt?.seconds || 0) - (a.lastMsgAt?.seconds || 0));
    allChats = chats;
    renderChatList();
    unreadCounts = {};
    chats.forEach(c => { if (c.unread > 0) unreadCounts[c.id] = c.unread; });
    updateTotalUnread();
  });
}

function renderChatList() {
  const list = $('waChatList');
  if (!list || !currentUser) return;

  let filtered = allChats;
  if (currentChatFilter === 'dm') filtered = allChats.filter(c => c.type === 'dm');
  else if (currentChatFilter === 'group') filtered = allChats.filter(c => c.type === 'group');
  else if (currentChatFilter === 'users') {
    const userList = Object.values(allUsers).filter(u => u.uid !== currentUser.uid);
    if (userList.length === 0) {
      list.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada user lain</p>';
      return;
    }
    list.innerHTML = '';
    userList.forEach(u => {
      const name = u.username || u.email || 'User';
      const isOnline = isUserOnline(u);
      const el = document.createElement('div');
      el.className = 'wa-chat-item';
      el.innerHTML = `
        <div style="position:relative">${avatarHTML(name, '', u.photoURL)}${isOnline ? '<div class="online-dot"></div>' : ''}</div>
        <div class="wa-chat-info">
          <div class="wa-chat-name">${escapeHtml(name)}</div>
          <div class="wa-chat-preview">${isOnline ? '🟢 Online' : '⚫ Offline'}</div>
        </div>
      `;
      el.addEventListener('click', () => openDM(u.uid, name));
      list.appendChild(el);
    });
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada chat.</p>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(c => {
    const isGroup = c.type === 'group';
    let displayName = c.name;
    let avatar = '';
    if (isGroup) {
      const memberCount = c.members?.length || 0;
      avatar = `<div class="wa-chat-avatar group">${c.photoURL ? `<img src="${c.photoURL}">` : '👥'}</div>`;
      displayName = `${escapeHtml(c.name)} <span class="member-count">(${memberCount})</span>`;
    } else {
      const other = c.members.find(m => m !== currentUser.uid);
      const u = allUsers[other];
      const name = u?.username || u?.email || c.name || 'User';
      const isOnline = isUserOnline(u);
      avatar = `<div style="position:relative">${avatarHTML(name, '', u?.photoURL)}${isOnline ? '<div class="online-dot"></div>' : ''}</div>`;
      displayName = escapeHtml(name);
    }
    let checkIcon = '';
    if (!isGroup && c.lastSender === currentUser.uid && c.lastMsg) {
      checkIcon = `<span class="check sent" style="margin-right:4px">✓✓</span>`;
    }
    const el = document.createElement('div');
    el.className = 'wa-chat-item';
    el.innerHTML = `
      ${avatar}
      <div class="wa-chat-info">
        <div class="wa-chat-name">${isGroup ? '👥 ' : ''}${displayName}</div>
        <div class="wa-chat-preview">${checkIcon}${escapeHtml(c.lastMsg || 'Belum ada pesan')}</div>
      </div>
      <div class="wa-chat-meta">
        <div class="wa-chat-time">${c.lastMsgAt ? formatTime(c.lastMsgAt) : ''}</div>
        ${c.unread > 0 ? `<div class="wa-badge">${c.unread > 99 ? '99+' : c.unread}</div>` : ''}
      </div>
    `;
    el.addEventListener('click', () => {
      if (isGroup) openGroup(c.id, c.name);
      else {
        const other = c.members.find(m => m !== currentUser.uid);
        const u = allUsers[other];
        const name = u?.username || u?.email || 'User';
        openDM(other, name);
      }
    });
    list.appendChild(el);
  });
}

document.querySelectorAll('.chat-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentChatFilter = tab.dataset.chattab;
    renderChatList();
  });
});

async function markChatRead(chatId) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(db, 'chats', chatId), { [`unread.${currentUser.uid}`]: 0 });
    unreadCounts[chatId] = 0;
    updateTotalUnread();
  } catch (e) {}
}

// ============================================
// ===== OPEN CHAT =====
// ============================================
async function openDM(otherId, otherName) {
  if (!currentUser) { navigate('auth'); return; }
  if (otherId === currentUser.uid) return;

  const chatId = [currentUser.uid, otherId].sort().join('_');
  const ref = doc(db, 'chats', chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: 'dm', members: [currentUser.uid, otherId],
      createdAt: serverTimestamp(), lastMessage: '',
      lastMessageAt: serverTimestamp(), unread: {}
    });
  }
  currentChatTarget = { type: 'dm', id: chatId, otherId, name: otherName };
  markChatRead(chatId);
  showFullChat(otherName, '', false);
  loadMessagesFor(chatId);
}

async function openGroup(groupId, name) {
  const snap = await getDoc(doc(db, 'chats', groupId));
  const data = snap.exists() ? snap.data() : {};
  currentChatTarget = { type: 'group', id: groupId, name, data };
  const members = data.members?.length || 0;
  const isAdmin = data.admins?.includes(currentUser.uid);
  showFullChat(name, `👥 ${members} anggota ${isAdmin ? '• Admin' : ''}`, true);
  markChatRead(groupId);
  loadMessagesFor(groupId);
  checkCurrentChatClosed();
}

async function openChannel(channelId, name) {
  const snap = await getDoc(doc(db, 'chats', channelId));
  const data = snap.exists() ? snap.data() : {};
  currentChatTarget = { type: 'channel', id: channelId, name, data };
  const members = data.members?.length || 0;
  const isAdmin = data.admins?.includes(currentUser.uid);
  showFullChat(name, `📻 ${members} pengikut ${isAdmin ? '• Admin' : ''}`, true);
  markChatRead(channelId);
  loadMessagesFor(channelId);
  checkCurrentChatClosed();
}

function showFullChat(name, status, isGroupOrChannel) {
  $('fullChat')?.classList.remove('hidden');
  const n = $('fcName'); if (n) n.textContent = name;
  const s = $('fcStatus'); if (s) s.textContent = status;
  const aw = $('fcAvatarWrap');
  if (aw) {
    aw.innerHTML = isGroupOrChannel
      ? `<div class="wa-chat-avatar group" style="width:40px;height:40px;font-size:1.2rem">👥</div>`
      : avatarHTML(name, 'small');
  }
  if (aw) aw.onclick = null;
  const info = $('fcName')?.parentElement;
  if (info) info.onclick = null;
  if (currentChatTarget?.type === 'dm') {
    const other = allUsers[currentChatTarget.otherId];
    const isOnline = isUserOnline(other);
    if (s) s.textContent = isOnline ? '🟢 Online' : '⚫ Offline';
    if (aw) aw.onclick = () => showUserProfile(currentChatTarget.otherId);
    if (info) info.onclick = () => showUserProfile(currentChatTarget.otherId);
  }
  const callBtn = $('fcCallBtn');
  if (callBtn) callBtn.style.display = (currentChatTarget?.type === 'dm') ? '' : 'none';
}

function closeFullChat() {
  $('fullChat')?.classList.add('hidden');
  $('fcMenuDropdown')?.classList.add('hidden');
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  currentChatTarget = null;
}
$('fcBack')?.addEventListener('click', closeFullChat);

$('fcMenu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = $('fcMenuDropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
  const isGroup = currentChatTarget?.type === 'group';
  const isChannel = currentChatTarget?.type === 'channel';
  const isAdmin = currentChatTarget?.data?.admins?.includes(currentUser.uid);
  dd.querySelectorAll('.group-only').forEach(el => el.style.display = isGroup ? '' : 'none');
  dd.querySelectorAll('.channel-only').forEach(el => el.style.display = isChannel ? '' : 'none');
  dd.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
  const cl = $('menuCopyLink');
  if (cl) cl.style.display = (isGroup && isAdmin) ? '' : 'none';
});

document.addEventListener('click', (e) => {
  if (!$('fcMenuDropdown')?.contains(e.target) && e.target.id !== 'fcMenu') {
    $('fcMenuDropdown')?.classList.add('hidden');
  }
});

$('menuViewProfile')?.addEventListener('click', () => {
  $('fcMenuDropdown')?.classList.add('hidden');
  if (currentChatTarget?.type === 'dm') showUserProfile(currentChatTarget.otherId);
});
$('menuViewMembers')?.addEventListener('click', () => {
  $('fcMenuDropdown')?.classList.add('hidden');
  showMembers();
});
$('menuEditGroup')?.addEventListener('click', () => {
  $('fcMenuDropdown')?.classList.add('hidden');
  showEditGroup();
});
$('menuCopyLink')?.addEventListener('click', () => {
  $('fcMenuDropdown')?.classList.add('hidden');
  if (!currentChatTarget) return;
  const link = `${location.origin}${location.pathname}#group=${currentChatTarget.id}`;
  navigator.clipboard.writeText(link).then(() => toast('🔗 Link dicopy!', 'success'));
});
$('menuCopyLinkChannel')?.addEventListener('click', () => {
  $('fcMenuDropdown')?.classList.add('hidden');
  if (!currentChatTarget) return;
  const link = `${location.origin}${location.pathname}#channel=${currentChatTarget.id}`;
  navigator.clipboard.writeText(link).then(() => toast('🔗 Link dicopy!', 'success'));
});
$('menuLeave')?.addEventListener('click', async () => {
  $('fcMenuDropdown')?.classList.add('hidden');
  if (!currentChatTarget) return;
  if (!confirm('Yakin keluar?')) return;
  try {
    await updateDoc(doc(db, 'chats', currentChatTarget.id), { members: arrayRemove(currentUser.uid) });
    toast('🚪 Keluar', 'success');
    closeFullChat();
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// ============================================
// ===== LOAD MESSAGES =====
// ============================================
function loadMessagesFor(chatId) {
  if (unsubscribeChat) unsubscribeChat();
  const msgsEl = $('fcMessages');
  if (!msgsEl) return;
  msgsEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Memuat...</p>';

  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(200));
  unsubscribeChat = onSnapshot(q, (snap) => {
    msgsEl.innerHTML = '';
    if (snap.empty) {
      msgsEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Belum ada pesan.</p>';
      return;
    }
    snap.forEach(d => msgsEl.appendChild(buildMessage(d.data(), d.id)));
    msgsEl.scrollTop = msgsEl.scrollHeight;
    markChatRead(chatId);
    const batch = writeBatch(db);
    snap.forEach(d => {
      const m = d.data();
      if (m.senderId !== currentUser.uid && !m.readBy?.[currentUser.uid]) {
        batch.update(d.ref, { [`readBy.${currentUser.uid}`]: true });
      }
    });
    batch.commit().catch(() => {});
  }, (err) => {
    msgsEl.innerHTML = `<p style="text-align:center;color:red;padding:20px">${translateErr(err.code)}</p>`;
  });
}

function buildMessage(m, msgId) {
  const div = document.createElement('div');
  const isMe = m.senderId === currentUser.uid;
  div.className = 'msg ' + (isMe ? 'me' : 'other');
  const time = m.createdAt
    ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'})
    : '';
  let senderLabel = '';
  if (!isMe && (currentChatTarget?.type === 'group' || currentChatTarget?.type === 'channel')) {
    senderLabel = `<div style="font-size:0.7rem;opacity:0.8;margin-bottom:3px"><b>${escapeHtml(m.senderName||'User')}</b></div>`;
  }
  let replyHTML = '';
  if (m.replyTo) {
    replyHTML = `<div class="reply-quote"><b>${escapeHtml(m.replyTo.name||'User')}</b><div>${escapeHtml((m.replyTo.text||'').substring(0,60))}</div></div>`;
  }
  let content = '';
  if (m.type === 'image') {
    content = `<img src="${m.url}" alt="gambar">`;
    setTimeout(() => {
      const img = div.querySelector('img');
      if (img) img.addEventListener('click', () => window.openImage(m.url));
    }, 0);
    if (m.text) content = `<p>${escapeHtml(m.text)}</p>` + content;
  } else if (m.type === 'voice') {
    content = `<div>🎤 VN (${m.duration||0}s)</div><audio controls preload="metadata" src="${m.url}"></audio>`;
  } else if (m.type === 'file') {
    content = `<a href="${m.url}" target="_blank" download="${escapeHtml(m.fileName)}" class="file-link">📎 ${escapeHtml(m.fileName)} <span style="opacity:0.7">(${formatSize(m.size)})</span></a>`;
  } else {
    content = `<span>${escapeHtml(m.text||'')}</span>`;
  }
  let checkHTML = '';
  if (isMe && currentChatTarget?.type === 'dm') {
    const otherId = currentChatTarget.otherId;
    const otherUser = allUsers[otherId];
    const isOtherOnline = isUserOnline(otherUser);
    const isRead = m.readBy && m.readBy[otherId];
    if (isRead) checkHTML = `<span class="check read">✓✓</span>`;
    else if (isOtherOnline) checkHTML = `<span class="check delivered">✓✓</span>`;
    else checkHTML = `<span class="check sent">✓</span>`;
  }
  div.innerHTML = senderLabel + replyHTML + content + `<span class="time">${time}${checkHTML}</span>`;
  div.addEventListener('dblclick', () => setReply(m, msgId));
  return div;
}

function setReply(m, msgId) {
  replyTo = {
    msgId,
    name: m.senderId === currentUser.uid ? 'Lu' : (m.senderName || currentChatTarget?.name || 'User'),
    text: m.text || (m.type === 'image' ? '[Gambar]' : m.type === 'voice' ? '[VN]' : '[File]')
  };
  $('fcReplyBar')?.classList.remove('hidden');
  const n = $('fcReplyName'); if (n) n.textContent = '↩ ' + replyTo.name;
  const t = $('fcReplyText'); if (t) t.textContent = replyTo.text;
  $('fcChatInput')?.focus();
}
function clearReply() {
  replyTo = null;
  $('fcReplyBar')?.classList.add('hidden');
}
$('fcReplyClose')?.addEventListener('click', clearReply);

// ============================================
// ===== SEND TEXT =====
// ============================================
$('fcChatForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatTarget) return toast('Buka chat dulu!', 'error');
  const closedInfo = await checkCurrentChatClosed();
  if (closedInfo) return toast(`⛔ Room ditutup: ${closedInfo.reason}`, 'error');
  if (currentChatTarget.type === 'channel') {
    const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
    const data = snap.data();
    if (!data.admins?.includes(currentUser.uid)) return toast('❌ Cuma admin yang bisa posting di saluran!', 'error');
  }
  const input = $('fcChatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await addDoc(collection(db, 'chats', currentChatTarget.id, 'messages'), {
      type: 'text', text, replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      readBy: {}, createdAt: serverTimestamp()
    });
    await updateChatAfterSend(currentChatTarget.id, text.substring(0, 50));
    clearReply();
  } catch (err) {
    toast('Gagal: ' + err.message, 'error');
    input.value = text;
  }
});

async function updateChatAfterSend(chatId, lastMsg) {
  const chatRef = doc(db, 'chats', chatId);
  const chatSnap = await getDoc(chatRef);
  const chatData = chatSnap.data() || {};
  const members = chatData.members || [];
  const unreadUpdate = {};
  members.forEach(uid => {
    if (uid !== currentUser.uid) {
      unreadUpdate[`unread.${uid}`] = (chatData.unread?.[uid] || 0) + 1;
    }
  });
  await updateDoc(chatRef, {
    lastMessage: lastMsg,
    lastMessageAt: serverTimestamp(),
    lastSender: currentUser.uid,
    type: currentChatTarget.type,
    ...unreadUpdate
  });
}

// ============================================
// ===== MEDIA HELPERS =====
// ============================================
window.openImage = (url) => {
  const modal = document.createElement('div');
  modal.id = 'imgPreviewModal';
  modal.innerHTML = `<img src="${url}">`;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
};

function showUploadBar(show, pct = 0, label = 'Processing...') {
  const bar = $('fcUploadBar'); if (!bar) return;
  const fill = $('fcUploadFill'); const text = $('fcUploadText');
  if (show) {
    bar.classList.remove('hidden');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = `${label} ${Math.round(pct)}%`;
  } else {
    bar.classList.add('hidden');
    if (fill) fill.style.width = '0%';
  }
}

function compressImage(file, maxSize = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxSize) { height = (height/width)*maxSize; width = maxSize; }
        else if (height > maxSize) { width = (width/height)*maxSize; height = maxSize; }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Gambar tidak valid'));
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Send Image
$('fcImgBtn')?.addEventListener('click', () => $('fcImgInput').click());
$('fcImgInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !currentChatTarget) return;
  if (file.size > 10*1024*1024) return toast('Maks 10 MB!', 'error');
  const closedInfo = await checkCurrentChatClosed();
  if (closedInfo) return toast('⛔ Room ditutup', 'error');
  try {
    showUploadBar(true, 30, 'Compress...');
    const dataUrl = await compressImage(file, 800, 0.7);
    if (dataUrl.length > 900*1024) return toast('Gambar terlalu besar', 'error');
    await addDoc(collection(db, 'chats', currentChatTarget.id, 'messages'), {
      type: 'image', url: dataUrl, text: '', replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      readBy: {}, createdAt: serverTimestamp()
    });
    await updateChatAfterSend(currentChatTarget.id, '📷 Foto');
    clearReply();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
  finally { setTimeout(() => showUploadBar(false), 500); }
});

// Send File
$('fcFileBtn')?.addEventListener('click', () => $('fcFileInput').click());
$('fcFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !currentChatTarget) return;
  if (file.size > 700*1024) return toast('Maks 700 KB', 'error');
  const closedInfo = await checkCurrentChatClosed();
  if (closedInfo) return toast('⛔ Room ditutup', 'error');
  try {
    showUploadBar(true, 50, 'Encode...');
    const dataUrl = await fileToBase64(file);
    await addDoc(collection(db, 'chats', currentChatTarget.id, 'messages'), {
      type: 'file', url: dataUrl, fileName: file.name, size: file.size, mime: file.type, replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      readBy: {}, createdAt: serverTimestamp()
    });
    await updateChatAfterSend(currentChatTarget.id, '📎 ' + file.name.substring(0, 30));
    clearReply();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
  finally { setTimeout(() => showUploadBar(false), 500); }
});

// Voice Note
let mediaRecorder = null;
let audioChunks = [];
let recStartTime = 0;
let recTimer = null;
let recStream = null;
let cancelled = false;
const MAX_VN_SECONDS = 60;

$('fcVnBtn')?.addEventListener('click', async () => {
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatTarget) return toast('Buka chat dulu!', 'error');
  if (mediaRecorder?.state === 'recording') return;
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
      else mimeType = '';
    }
    mediaRecorder = mimeType
      ? new MediaRecorder(recStream, { mimeType, audioBitsPerSecond: 32000 })
      : new MediaRecorder(recStream, { audioBitsPerSecond: 32000 });
    audioChunks = []; cancelled = false;
    mediaRecorder.addEventListener('dataavailable', ev => { if (ev.data.size > 0) audioChunks.push(ev.data); });
    mediaRecorder.addEventListener('stop', async () => {
      recStream?.getTracks().forEach(t => t.stop());
      clearInterval(recTimer);
      $('fcRecordingBar')?.classList.add('hidden');
      $('fcVnBtn')?.classList.remove('recording');
      if (cancelled || audioChunks.length === 0) return;
      const duration = Math.max(1, Math.round((Date.now() - recStartTime)/1000));
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (blob.size > 700*1024) return toast('VN terlalu besar', 'error');
      try {
        showUploadBar(true, 50, 'Encode VN...');
        const dataUrl = await fileToBase64(blob);
        await addDoc(collection(db, 'chats', currentChatTarget.id, 'messages'), {
          type: 'voice', url: dataUrl, duration, replyTo,
          senderId: currentUser.uid,
          senderName: currentUser.displayName || 'Anonim',
          readBy: {}, createdAt: serverTimestamp()
        });
        await updateChatAfterSend(currentChatTarget.id, '🎤 VN');
        clearReply();
      } catch (err) { toast('Gagal: ' + err.message, 'error'); }
      finally { setTimeout(() => showUploadBar(false), 500); }
    });
    mediaRecorder.start();
    recStartTime = Date.now();
    $('fcRecordingBar')?.classList.remove('hidden');
    $('fcVnBtn')?.classList.add('recording');
    const t = $('fcRecTime'); if (t) t.textContent = '0:00';
    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStartTime)/1000);
      const rt = $('fcRecTime'); if (rt) rt.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      if (s >= MAX_VN_SECONDS && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 200);
  } catch (err) { toast('Mic error: ' + err.message, 'error'); }
});
$('fcStopRec')?.addEventListener('click', () => { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); });
$('fcCancelRec')?.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') { cancelled = true; audioChunks = []; mediaRecorder.stop(); }
});

// ============================================
// ===== NOTIFIKASI GLOBAL =====
// ============================================
function listenGlobalNotifications() {
  if (!currentUser) return;
  if (window._notifUnsub) window._notifUnsub();
  const q = query(collection(db, 'chats'));
  window._notifUnsub = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      const c = change.doc.data();
      if (!c.members?.includes(currentUser.uid)) return;
      if (change.type !== 'modified') return;
      const chatId = change.doc.id;
      if (currentChatTarget?.id === chatId) return;
      const unread = c.unread?.[currentUser.uid] || 0;
      if (unread > 0) { unreadCounts[chatId] = unread; updateTotalUnread(); }
      if (c.lastSender && c.lastSender !== currentUser.uid && c.lastMessageAt) {
        const diff = (Date.now() - c.lastMessageAt.seconds * 1000) / 1000;
        if (diff < 5) {
          playBeep();
          let displayName = c.name || 'Chat';
          if (c.type !== 'group') {
            const other = c.members.find(m => m !== currentUser.uid);
            const u = allUsers[other];
            displayName = u?.username || u?.email || 'User';
          }
          showNotification('💬 ' + displayName, c.lastMessage || 'Pesan baru');
        }
      }
    });
  });
}

// ============================================
// ===== USER PROFILE =====
// ============================================
async function showUserProfile(uid) {
  if (!uid) return;
  const modal = $('userProfileModal'); const content = $('userProfileContent');
  if (!modal || !content) return;
  content.innerHTML = 'Loading...';
  modal.classList.remove('hidden');
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};
    const name = data.username || data.email || 'User';
    const isOnline = isUserOnline(data);
    content.innerHTML = `
      ${avatarHTML(name, 'big', data.photoURL)}
      <h3 style="font-family:'Bangers';font-size:1.6rem;margin:10px 0">${escapeHtml(name)}</h3>
      ${data.bio ? `<p style="font-style:italic;font-size:0.9rem;padding:0 10px;margin-bottom:10px">"${escapeHtml(data.bio)}"</p>` : ''}
      <p style="font-size:0.85rem">📧 ${escapeHtml(data.email||'-')}</p>
      <p style="font-size:0.85rem">${isOnline ? '🟢 Online' : '⚫ Offline'}</p>
    `;
  } catch (e) { content.innerHTML = '<p>Gagal load profil</p>'; }
}
$('closeUserProfile')?.addEventListener('click', () => $('userProfileModal')?.classList.add('hidden'));

// ============================================
// ===== EDIT PROFIL =====
// ============================================
function showEditProfile() {
  if (!currentUser) return;
  const name = currentUser.displayName || currentUserData?.username || 'Anonim';
  const eu = $('editUsername'); if (eu) eu.value = name;
  const eb = $('editBio'); if (eb) eb.value = currentUserData?.bio || '';
  editAvatarData = currentUserData?.photoURL || null;
  const preview = $('editAvatarPreview');
  if (preview) {
    preview.className = 'avatar big';
    preview.style.cssText = 'margin:0 auto 10px;overflow:hidden;';
    if (editAvatarData) preview.innerHTML = `<img src="${editAvatarData}" style="width:100%;height:100%;object-fit:cover">`;
    else { preview.textContent = getInitial(name); preview.classList.add(getAvatarColor(name)); }
  }
  $('editProfileModal')?.classList.remove('hidden');
}
$('closeEditProfile')?.addEventListener('click', () => $('editProfileModal')?.classList.add('hidden'));
$('pickAvatarBtn')?.addEventListener('click', () => $('editAvatarInput').click());
$('editAvatarInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3*1024*1024) return toast('Maks 3 MB', 'error');
  const dataUrl = await compressImage(file, 400, 0.7);
  editAvatarData = dataUrl;
  const preview = $('editAvatarPreview');
  if (preview) preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
});

$('saveProfileBtn')?.addEventListener('click', async () => {
  const username = $('editUsername').value.trim();
  const bio = $('editBio').value.trim();
  if (!username) return toast('Username wajib!', 'error');
  try {
    await updateProfile(currentUser, { displayName: username });
    const userDoc = { username, bio, email: currentUser.email, updatedAt: serverTimestamp() };
    if (editAvatarData) {
      if (editAvatarData.length > 800 * 1024) return toast('Foto terlalu besar', 'error');
      userDoc.photoURL = editAvatarData;
    } else userDoc.photoURL = '';
    await setDoc(doc(db, 'users', currentUser.uid), userDoc, { merge: true });
    await loadUserData();
    toast('✅ Profil disimpan!', 'success');
    $('editProfileModal')?.classList.add('hidden');
    renderProfile();
    const sideAv = $('sideAvatar');
    if (sideAv) {
      if (editAvatarData) sideAv.innerHTML = `<img src="${editAvatarData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      else { sideAv.textContent = getInitial(username); sideAv.className = 'avatar ' + getAvatarColor(username); }
    }
    const sn = $('sideName'); if (sn) sn.textContent = username;
    const topBtn = $('topAuthBtn');
    if (topBtn) {
      if (editAvatarData) topBtn.innerHTML = `<img src="${editAvatarData}">`;
      else topBtn.textContent = getInitial(username);
    }
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// ============================================
// ===== GROUP =====
// ============================================
$('newGroupBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  const picker = $('memberPicker'); if (!picker) return;
  picker.innerHTML = '';
  const userList = Object.values(allUsers).filter(u => u.uid !== currentUser.uid);
  if (userList.length === 0) {
    picker.innerHTML = '<p style="padding:10px;text-align:center">Belum ada user lain</p>';
  } else {
    userList.forEach(u => {
      const name = u.username || u.email;
      const el = document.createElement('label');
      el.className = 'member-item';
      el.innerHTML = `${avatarHTML(name, 'small', u.photoURL)}<span>${escapeHtml(name)}</span><input type="checkbox" value="${u.uid}">`;
      el.querySelector('input').addEventListener('change', (ev) => el.classList.toggle('selected', ev.target.checked));
      picker.appendChild(el);
    });
  }
  $('groupModal')?.classList.remove('hidden');
});
$('closeGroupModal')?.addEventListener('click', () => $('groupModal')?.classList.add('hidden'));

$('createGroupBtn')?.addEventListener('click', async () => {
  const name = $('groupName').value.trim();
  if (!name) return toast('Nama grup wajib!', 'error');
  const selected = Array.from(document.querySelectorAll('#memberPicker input:checked')).map(i => i.value);
  if (selected.length === 0) return toast('Pilih minimal 1 member!', 'error');
  const members = [currentUser.uid, ...selected];
  try {
    const ref = await addDoc(collection(db, 'chats'), {
      type: 'group', name, photoURL: '', desc: '',
      members, admins: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: 'Grup dibuat', lastMessageAt: serverTimestamp(), unread: {}
    });
    toast('✅ Grup dibuat!', 'success');
    $('groupModal')?.classList.add('hidden');
    $('groupName').value = '';
    openGroup(ref.id, name);
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

async function showEditGroup() {
  if (currentChatTarget?.type !== 'group') return;
  const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
  const data = snap.data();
  const egn = $('editGroupName'); if (egn) egn.value = data.name || '';
  const egd = $('editGroupDesc'); if (egd) egd.value = data.desc || '';
  editGroupAvatarData = data.photoURL || null;
  const preview = $('editGroupAvatar');
  if (preview) {
    preview.className = 'avatar big';
    preview.style.cssText = 'margin:0 auto 10px;overflow:hidden;';
    if (editGroupAvatarData) preview.innerHTML = `<img src="${editGroupAvatarData}" style="width:100%;height:100%;object-fit:cover">`;
    else preview.textContent = '👥';
  }
  $('editGroupModal')?.classList.remove('hidden');
}
$('closeEditGroup')?.addEventListener('click', () => $('editGroupModal')?.classList.add('hidden'));
$('pickGroupAvatarBtn')?.addEventListener('click', () => $('editGroupAvatarInput').click());
$('editGroupAvatarInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3*1024*1024) return toast('Maks 3 MB', 'error');
  const dataUrl = await compressImage(file, 400, 0.7);
  editGroupAvatarData = dataUrl;
  const preview = $('editGroupAvatar');
  if (preview) preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
});

$('saveGroupBtn')?.addEventListener('click', async () => {
  const name = $('editGroupName').value.trim();
  const desc = $('editGroupDesc').value.trim();
  if (!name) return toast('Nama grup wajib!', 'error');
  try {
    await setDoc(doc(db, 'chats', currentChatTarget.id), { name, desc, photoURL: editGroupAvatarData || '' }, { merge: true });
    toast('✅ Grup disimpan!', 'success');
    $('editGroupModal')?.classList.add('hidden');
    const n = $('fcName'); if (n) n.textContent = name;
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

async function showMembers() {
  if (!currentChatTarget) return;
  const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
  const data = snap.data();
  const members = data.members || [];
  const admins = data.admins || [];
  const isMeAdmin = admins.includes(currentUser.uid);
  const list = $('membersList'); if (!list) return;
  list.innerHTML = '';
  members.forEach(uid => {
    const u = allUsers[uid];
    const name = u?.username || u?.email || (uid === currentUser.uid ? 'Lu' : 'User');
    const isAdmin = admins.includes(uid);
    const photoURL = u?.photoURL || '';
    const isOnline = isUserOnline(u);
    const row = document.createElement('div');
    row.className = 'member-row';
    row.innerHTML = `
      <div style="position:relative">${avatarHTML(name, 'small', photoURL)}${isOnline ? '<div class="online-dot"></div>' : ''}</div>
      <div class="member-row-info">
        <div>${escapeHtml(name)} ${uid === currentUser.uid ? '(Lu)' : ''}</div>
        <small class="role-badge ${isAdmin ? 'admin' : 'member'}">${isAdmin ? '👑 Admin' : 'Member'}</small>
      </div>
      ${isMeAdmin ? `<div class="member-row-actions">
        ${isAdmin
          ? `<button class="mini-btn danger" data-demote="${uid}">⬇️ Demote</button>`
          : `<button class="mini-btn" data-promote="${uid}">👑 Admin</button>`}
      </div>` : ''}
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-promote]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Jadikan admin?')) return;
      try {
        await updateDoc(doc(db, 'chats', currentChatTarget.id), { admins: arrayUnion(btn.dataset.promote) });
        toast('👑 Jadi admin!', 'success');
        showMembers();
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
  });
  list.querySelectorAll('[data-demote]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.demote;
      if (uid === currentUser.uid) return toast('Gak bisa demote diri sendiri', 'error');
      if (!confirm('Turunin jadi member?')) return;
      try {
        await updateDoc(doc(db, 'chats', currentChatTarget.id), { admins: arrayRemove(uid) });
        toast('⬇️ Jadi member', 'success');
        showMembers();
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
  });
  $('membersModal')?.classList.remove('hidden');
}
$('closeMembers')?.addEventListener('click', () => $('membersModal')?.classList.add('hidden'));

// ============================================
// ===== CHANNELS =====
// ============================================
$('newChannelBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  $('channelModal')?.classList.remove('hidden');
});
$('closeChannelModal')?.addEventListener('click', () => $('channelModal')?.classList.add('hidden'));

$('createChannelBtn')?.addEventListener('click', async () => {
  const name = $('channelName').value.trim();
  const desc = $('channelDesc').value.trim();
  if (!name) return toast('Nama saluran wajib!', 'error');
  try {
    const ref = await addDoc(collection(db, 'chats'), {
      type: 'channel', name, desc,
      members: [currentUser.uid], admins: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: 'Saluran dibuat', lastMessageAt: serverTimestamp(), unread: {}
    });
    toast('✅ Saluran dibuat!', 'success');
    $('channelModal')?.classList.add('hidden');
    $('channelName').value = ''; $('channelDesc').value = '';
    const link = `${location.origin}${location.pathname}#channel=${ref.id}`;
    navigator.clipboard.writeText(link).then(() => toast('🔗 Link saluran dicopy!', 'success'));
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

function subscribeChannels() {
  if (unsubscribeChannels) unsubscribeChannels();
  if (!currentUser) return;
  unsubscribeChannels = onSnapshot(collection(db, 'chats'), (snap) => {
    allChannels = [];
    snap.forEach(d => {
      const c = d.data();
      if (c.type !== 'channel') return;
      allChannels.push({ id: d.id, ...c });
    });
    renderChannels();
  });
}

function renderChannels() {
  const list = $('channelList'); if (!list || !currentUser) return;
  const mine = allChannels.filter(c => c.members?.includes(currentUser.uid));
  if (mine.length === 0) {
    list.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada saluran.</p>';
    return;
  }
  list.innerHTML = '';
  mine.forEach(c => {
    const isAdmin = c.admins?.includes(currentUser.uid);
    const el = document.createElement('div');
    el.className = 'channel-item';
    el.innerHTML = `
      <div class="channel-icon">📻</div>
      <div class="wa-chat-info">
        <div class="wa-chat-name">${escapeHtml(c.name)} ${isAdmin ? '<span class="role-badge admin">👑</span>' : ''}</div>
        <div class="wa-chat-preview">${escapeHtml(c.desc || c.lastMessage || '-')} • ${c.members?.length || 0} pengikut</div>
      </div>
    `;
    el.addEventListener('click', () => openChannel(c.id, c.name));
    list.appendChild(el);
  });
}

$('joinChannelBtn')?.addEventListener('click', async () => {
  let input = $('joinChannelId').value.trim();
  if (!input) return toast('Paste link / ID!', 'error');
  const match = input.match(/[#=]([a-zA-Z0-9_-]+)$/);
  if (match) input = match[1];
  try {
    const ref = doc(db, 'chats', input);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().type !== 'channel') return toast('Saluran gak ditemukan!', 'error');
    const members = snap.data().members || [];
    if (members.includes(currentUser.uid)) return toast('Udah gabung!', 'error');
    await updateDoc(ref, { members: arrayUnion(currentUser.uid) });
    toast('✅ Berhasil gabung!', 'success');
    $('joinChannelId').value = '';
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

async function joinGroupViaLink(groupId) {
  if (!currentUser) { navigate('auth'); return; }
  try {
    const ref = doc(db, 'chats', groupId);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().type !== 'group') return toast('Grup tidak ditemukan', 'error');
    const members = snap.data().members || [];
    if (members.includes(currentUser.uid)) { openGroup(groupId, snap.data().name); return; }
    if (confirm(`Gabung ke grup "${snap.data().name}"?`)) {
      await updateDoc(ref, { members: arrayUnion(currentUser.uid) });
      toast('✅ Gabung grup!', 'success');
      openGroup(groupId, snap.data().name);
    }
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
}

// ============================================
// ===== STORY =====
// ============================================
function subscribeStoryRow() {
  if (unsubscribeStoryRow) unsubscribeStoryRow();
  if (!currentUser) return;
  const q = query(collection(db, 'stories'), orderBy('createdAt', 'desc'), limit(50));
  unsubscribeStoryRow = onSnapshot(q, (snap) => {
    const now = Date.now();
    stories = [];
    snap.forEach(d => {
      const s = d.data();
      if (!s.createdAt) return;
      if ((now - s.createdAt.seconds * 1000) > 24 * 60 * 60 * 1000) return;
      stories.push({ id: d.id, ...s });
    });
    renderStoryRow();
  });
}

function renderStoryRow() {
  const row = $('storyRow'); if (!row) return;
  const byUser = {};
  stories.forEach(s => { if (!byUser[s.userId]) byUser[s.userId] = []; byUser[s.userId].push(s); });
  const addBtn = row.querySelector('.story-add');
  row.innerHTML = '';
  if (addBtn) row.appendChild(addBtn);
  Object.entries(byUser).forEach(([uid, items]) => {
    const name = items[0].userName || 'User';
    const el = document.createElement('div');
    el.className = 'story-item';
    el.innerHTML = `<div class="story-ring"><img src="${items[0].image}" onerror="this.style.display='none'"></div><span>${escapeHtml(name.substring(0, 10))}</span>`;
    el.addEventListener('click', () => openStoryViewer(items));
    row.appendChild(el);
  });
}

$('addStoryBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  $('storyModal')?.classList.remove('hidden');
});
$('closeStoryModal')?.addEventListener('click', () => {
  $('storyModal')?.classList.add('hidden');
  const sp = $('storyPreview'); if (sp) sp.innerHTML = '';
  const si = $('storyInput'); if (si) { si.value = ''; si.dataset.dataUrl = ''; }
  const sc = $('storyCaption'); if (sc) sc.value = '';
});
$('pickStoryImg')?.addEventListener('click', () => $('storyInput').click());
$('storyInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5*1024*1024) return toast('Maks 5 MB', 'error');
  const dataUrl = await compressImage(file, 600, 0.7);
  const sp = $('storyPreview');
  if (sp) sp.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:200px;border:3px solid #1a1a1a;border-radius:10px">`;
  e.target.dataset.dataUrl = dataUrl;
});

$('postStoryBtn')?.addEventListener('click', async () => {
  const dataUrl = $('storyInput')?.dataset.dataUrl;
  if (!dataUrl) return toast('Pilih gambar dulu!', 'error');
  const caption = $('storyCaption').value.trim();
  try {
    await addDoc(collection(db, 'stories'), {
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Anonim',
      image: dataUrl, caption, createdAt: serverTimestamp()
    });
    toast('✅ Story diposting!', 'success');
    $('storyModal')?.classList.add('hidden');
    const sp = $('storyPreview'); if (sp) sp.innerHTML = '';
    const si = $('storyInput'); if (si) { si.value = ''; si.dataset.dataUrl = ''; }
    const sc = $('storyCaption'); if (sc) sc.value = '';
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

function openStoryViewer(items) {
  storyIndex = 0;
  $('storyViewer')?.classList.remove('hidden');
  function showStoryItem() {
    clearTimeout(storyTimer);
    const s = items[storyIndex];
    const n = $('svName'); if (n) n.textContent = s.userName || 'User';
    const t = $('svTime'); if (t) t.textContent = s.createdAt ? formatTime(s.createdAt) : '';
    const av = $('svAvatar');
    if (av) { av.textContent = getInitial(s.userName); av.className = 'avatar small ' + getAvatarColor(s.userName); }
    const img = $('svImg'); if (img) img.src = s.image;
    const cap = $('svCaption'); if (cap) cap.textContent = s.caption || '';
    storyTimer = setTimeout(next, 5000);
  }
  function next() {
    storyIndex++;
    if (storyIndex >= items.length) close();
    else showStoryItem();
  }
  function prev() {
    storyIndex--;
    if (storyIndex < 0) storyIndex = 0;
    showStoryItem();
  }
  function close() {
    $('storyViewer')?.classList.add('hidden');
    clearTimeout(storyTimer);
    const nx = $('svNext'); if (nx) nx.onclick = null;
    const pv = $('svPrev'); if (pv) pv.onclick = null;
    const cl = $('svClose'); if (cl) cl.onclick = null;
  }
  const nx = $('svNext'); if (nx) nx.onclick = next;
  const pv = $('svPrev'); if (pv) pv.onclick = prev;
  const cl = $('svClose'); if (cl) cl.onclick = close;
  showStoryItem();
}

// ============================================
// ===== PROFILE =====
// ============================================
async function renderProfile() {
  if (!currentUser) return;
  try {
    await loadUserData();
    const name = currentUser.displayName || currentUserData?.username || 'Anonim';
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userSnap.data() || {};
    const pi = $('profileInfo'); if (!pi) return;
    pi.innerHTML = `
      ${avatarHTML(name, 'big', userData.photoURL)}
      <h3>${escapeHtml(name)}</h3>
      ${userData.bio ? `<p style="font-style:italic">"${escapeHtml(userData.bio)}"</p>` : ''}
      <p>📧 ${escapeHtml(currentUser.email)}</p>
      <div class="profile-stats">
        <div class="stat"><b>${allChats.length}</b><span>Chat</span></div>
        <div class="stat"><b>${stories.length}</b><span>Story</span></div>
        <div class="stat"><b>⭐</b><span>Baru</span></div>
      </div>
      <p style="font-size:0.85rem">📅 Joined: ${userData.createdAt
        ? new Date(userData.createdAt.seconds * 1000).toLocaleDateString('id-ID') : '-'}</p>
      <button class="btn-pop" id="editProfileBtn" style="margin-top:15px;width:100%">⚙️ EDIT PROFIL</button>
      <button class="btn-pop btn-cancel" id="logoutBtn" style="margin-top:10px;width:100%">🚪 LOGOUT</button>
    `;
    $('editProfileBtn')?.addEventListener('click', showEditProfile);
    $('logoutBtn')?.addEventListener('click', async () => {
      if (confirm('Logout?')) { stopPresence(); await signOut(auth); toast('👋 Logout', 'success'); navigate('home'); }
    });
  } catch (err) { console.error(err); }
}

// ============================================
// ===== SEARCH =====
// ============================================
$('searchToggle')?.addEventListener('click', () => {
  $('searchBar')?.classList.toggle('hidden');
  if (!$('searchBar')?.classList.contains('hidden')) $('searchInput')?.focus();
});
$('searchClose')?.addEventListener('click', () => {
  $('searchBar')?.classList.add('hidden');
  const s = $('searchInput'); if (s) s.value = '';
});
$('searchInput')?.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.post-card').forEach(c => {
    c.style.display = (!term || c.textContent.toLowerCase().includes(term)) ? '' : 'none';
  });
});

// ============================================
// ===== TUTUP WEBSITE =====
// ============================================
async function checkSiteConfig() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'main'));
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'closed') showSiteClosedPopup(data);
  } catch (e) { console.warn('Check site config error:', e); }
}

function subscribeSiteConfig() {
  onSnapshot(doc(db, 'siteConfig', 'main'), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'closed') showSiteClosedPopup(data);
    else hideSiteClosedPopup();
  });
}

function showSiteClosedPopup(data) {
  if ($('siteClosedOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'siteClosedOverlay';
  overlay.className = 'site-closed-overlay';
  const waLink = data.wa
    ? `<a href="https://wa.me/${data.wa.replace(/\D/g,'')}?text=${encodeURIComponent('Halo admin, saya mau tanya soal website: ' + (data.title || ''))}" target="_blank" class="site-closed-wa">💬 CHAT ADMIN</a>`
    : '';
  overlay.innerHTML = `
    <div class="site-closed-box">
      <div class="site-closed-icon">🚫</div>
      <h1 class="site-closed-title">${escapeHtml(data.title || '⚠️ WEBSITE DITUTUP')}</h1>
      <p class="site-closed-msg">${escapeHtml(data.message || 'Website lagi maintenance, balik lagi nanti ya!')}</p>
      ${waLink}
      <p class="site-closed-footer">— APEX ft RIXX MARKET —</p>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function hideSiteClosedPopup() {
  const overlay = $('siteClosedOverlay');
  if (overlay) { overlay.remove(); document.body.style.overflow = ''; }
}

// ============================================
// ===== WA POPUP =====
// ============================================
$('waFloatBtn')?.addEventListener('click', () => $('waPopup')?.classList.remove('hidden'));
$('waPopupClose')?.addEventListener('click', () => $('waPopup')?.classList.add('hidden'));
$('waPopup')?.addEventListener('click', (e) => {
  if (e.target.id === 'waPopup') $('waPopup')?.classList.add('hidden');
});
document.querySelectorAll('.wa-dev-btn').forEach(btn => {
  btn.addEventListener('click', () => setTimeout(() => $('waPopup')?.classList.add('hidden'), 300));
});

// ============================================
// ===== MUSIC =====
// ============================================
const bgMusic = $('bgMusic');
const musicToggle = $('musicToggle');
if (bgMusic) bgMusic.volume = 0.5;
const savedMusicState = localStorage.getItem('apex_music_on');
const shouldPlayMusic = savedMusicState === null ? true : savedMusicState === 'true';

function updateMusicUI() {
  if (!musicToggle) return;
  if (musicPlaying) {
    musicToggle.textContent = '🔊';
    musicToggle.classList.add('playing');
    musicToggle.title = 'Music ON';
  } else {
    musicToggle.textContent = '🔇';
    musicToggle.classList.remove('playing');
    musicToggle.title = 'Music OFF';
  }
}
async function playMusic() {
  if (!bgMusic) return;
  try {
    await bgMusic.play();
    musicPlaying = true; musicStarted = true;
    localStorage.setItem('apex_music_on', 'true');
    updateMusicUI();
    hideMusicPrompt();
  } catch (err) {
    musicPlaying = false;
    updateMusicUI();
    if (shouldPlayMusic) showMusicPrompt();
  }
}
function pauseMusic() {
  if (!bgMusic) return;
  bgMusic.pause();
  musicPlaying = false;
  localStorage.setItem('apex_music_on', 'false');
  updateMusicUI();
}
function toggleMusic() { if (musicPlaying) pauseMusic(); else playMusic(); }
function showMusicPrompt() { const p = $('musicPrompt'); if (p && !musicStarted) p.classList.remove('hidden'); }
function hideMusicPrompt() { const p = $('musicPrompt'); if (p) p.classList.add('hidden'); }

musicToggle?.addEventListener('click', toggleMusic);
$('musicPromptYes')?.addEventListener('click', () => playMusic());
$('musicPromptNo')?.addEventListener('click', () => {
  hideMusicPrompt();
  localStorage.setItem('apex_music_on', 'false');
});
function tryAutoStartMusic() {
  if (musicStarted) return;
  if (!shouldPlayMusic) return;
  playMusic();
}
['click', 'touchstart', 'keydown'].forEach(evt => {
  document.addEventListener(evt, tryAutoStartMusic, { once: true, passive: true });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shouldPlayMusic && !musicPlaying && musicStarted) {
    bgMusic?.play().then(() => { musicPlaying = true; updateMusicUI(); }).catch(() => {});
  }
});

// ============================================
// ===== TELEPON =====
// ============================================
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function makeCallId(uid1, uid2) {
  return [uid1, uid2].sort().join('_') + '_' + Date.now();
}

async function startCall() {
  if (!currentUser) return toast('Login dulu!', 'error');
  if (!currentChatTarget || currentChatTarget.type !== 'dm') return toast('Cuma bisa telepon di chat pribadi', 'error');
  const targetUid = currentChatTarget.otherId;
  const targetName = currentChatTarget.name;
  const callId = makeCallId(currentUser.uid, targetUid);
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (event) => {
      if (event.streams[0]) {
        remoteStream = event.streams[0];
        const audio = $('remoteAudio'); if (audio) audio.srcObject = remoteStream;
      }
    };
    const callerCandidates = [];
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        callerCandidates.push(event.candidate.toJSON());
        updateDoc(doc(db, 'calls', callId), {
          callerCandidates: callerCandidates.map(c => ({
            candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex
          }))
        }).catch(() => {});
      }
    };
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await setDoc(doc(db, 'calls', callId), {
      callId, caller: currentUser.uid,
      callerName: currentUser.displayName || 'Anonim',
      receiver: targetUid, receiverName: targetName,
      offer: { type: offer.type, sdp: offer.sdp },
      status: 'calling', createdAt: serverTimestamp()
    });
    currentCallId = callId;
    isInCall = true;
    showCallScreen(targetName, 'Memanggil...');
    listenCallAnswer(callId, 'caller');
    setTimeout(() => {
      if (isInCall && !callStartTime) { toast('❌ Gak diangkat', 'error'); endCall(); }
    }, 60000);
  } catch (err) {
    toast('Gagal telepon: ' + err.message, 'error');
    cleanupCall();
  }
}

function listenCallAnswer(callId, role) {
  if (callDocUnsub) callDocUnsub();
  callDocUnsub = onSnapshot(doc(db, 'calls', callId), async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'ended' || data.status === 'declined') {
      if (role === 'caller') toast(data.status === 'declined' ? '❌ Ditolak' : '📞 Berakhir', 'error');
      cleanupCall();
      return;
    }
    if (role === 'caller' && data.status === 'accepted' && data.answer && !callStartTime) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        const st = $('callStatus'); if (st) st.textContent = 'Tersambung';
        startCallTimer();
        if (data.receiverCandidates) {
          for (const c of data.receiverCandidates) {
            if (c) try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
          }
        }
      } catch (err) {}
    }
  });
}

async function acceptCall() {
  if (!pendingCallData || !currentUser) return;
  try {
    $('incomingCallModal')?.classList.add('hidden');
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (event) => {
      if (event.streams[0]) {
        remoteStream = event.streams[0];
        const audio = $('remoteAudio'); if (audio) audio.srcObject = remoteStream;
      }
    };
    const receiverCandidates = [];
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        receiverCandidates.push(event.candidate.toJSON());
        updateDoc(doc(db, 'calls', currentCallId), {
          receiverCandidates: receiverCandidates.map(c => ({
            candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex
          }))
        }).catch(() => {});
      }
    };
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingCallData.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await updateDoc(doc(db, 'calls', currentCallId), {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'accepted', acceptedAt: serverTimestamp()
    });
    isInCall = true;
    showCallScreen(pendingCallData.callerName, 'Tersambung');
    startCallTimer();
    listenCallAnswer(currentCallId, 'receiver');
  } catch (err) {
    toast('Gagal terima: ' + err.message, 'error');
    cleanupCall();
  }
}

async function declineCall() {
  if (!currentCallId) return;
  try { await updateDoc(doc(db, 'calls', currentCallId), { status: 'declined' }); } catch (e) {}
  $('incomingCallModal')?.classList.add('hidden');
  cleanupCall();
}

async function endCall() {
  if (currentCallId) {
    try { await updateDoc(doc(db, 'calls', currentCallId), { status: 'ended', endedAt: serverTimestamp() }); } catch (e) {}
  }
  cleanupCall();
}

function cleanupCall() {
  if (peerConnection) { try { peerConnection.close(); } catch (e) {} peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteStream = null;
  if (callDocUnsub) { callDocUnsub(); callDocUnsub = null; }
  if (callDurationTimer) { clearInterval(callDurationTimer); callDurationTimer = null; }
  currentCallId = null; pendingCallData = null; isInCall = false;
  isMuted = false; isSpeaker = false; callStartTime = null;
  $('callScreen')?.classList.add('hidden');
  $('incomingCallModal')?.classList.add('hidden');
  const audio = $('remoteAudio'); if (audio) audio.srcObject = null;
}

function startCallTimer() {
  if (callStartTime) return;
  callStartTime = Date.now();
  if (callDurationTimer) clearInterval(callDurationTimer);
  callDurationTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const cd = $('callDuration');
    if (cd) cd.textContent = `${m}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

function showCallScreen(name, status) {
  $('callScreen')?.classList.remove('hidden');
  const n = $('callName'); if (n) n.textContent = name;
  const s = $('callStatus'); if (s) s.textContent = status;
  const d = $('callDuration'); if (d) d.textContent = '';
  const av = $('callAvatar'); if (av) av.textContent = getInitial(name);
}

function listenIncomingCalls() {
  if (!currentUser) return;
  if (unsubscribeIncomingCall) unsubscribeIncomingCall();
  const q = query(
    collection(db, 'calls'),
    where('receiver', '==', currentUser.uid),
    where('status', '==', 'calling'),
    orderBy('createdAt', 'desc'),
    limit(1)
  );
  unsubscribeIncomingCall = onSnapshot(q, (snap) => {
    if (snap.empty || isInCall) return;
    snap.forEach(d => {
      const data = d.data();
      if (!data.offer) return;
      if (data.createdAt && (Date.now() - data.createdAt.seconds * 1000) > 60000) return;
      currentCallId = d.id;
      pendingCallData = data;
      const av = $('incomingAvatar'); if (av) av.textContent = getInitial(data.callerName);
      const n = $('incomingName'); if (n) n.textContent = data.callerName;
      $('incomingCallModal')?.classList.remove('hidden');
    });
  });
}

$('fcCallBtn')?.addEventListener('click', () => {
  if (!currentChatTarget || currentChatTarget.type !== 'dm') return toast('Cuma bisa telepon di chat pribadi', 'error');
  if (isInCall) return toast('Masih ada panggilan aktif', 'error');
  startCall();
});
$('acceptCallBtn')?.addEventListener('click', acceptCall);
$('declineCallBtn')?.addEventListener('click', declineCall);
$('endCallBtn')?.addEventListener('click', endCall);
$('muteBtn')?.addEventListener('click', () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  $('muteBtn')?.classList.toggle('active', isMuted);
  const m = $('muteBtn'); if (m) m.textContent = isMuted ? '🔇' : '🎤';
});
$('speakerBtn')?.addEventListener('click', () => {
  isSpeaker = !isSpeaker;
  $('speakerBtn')?.classList.toggle('active', isSpeaker);
  const s = $('speakerBtn'); if (s) s.textContent = isSpeaker ? '🔊' : '🔉';
});

// ============================================
// ===== WEB BUILDER =====
// ============================================
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    html: '📄', htm: '📄', css: '🎨', js: '⚡', json: '📋',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', ico: '🖼️',
    zip: '📦', txt: '📝', md: '📝'
  };
  return icons[ext] || '📎';
}

function renderFileList() {
  const list = document.getElementById('fileList');
  if (!list) return;
  list.innerHTML = '';
  if (builderFiles.length === 0) return;

  builderFiles.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `
      <div class="file-item-icon">${getFileIcon(f.file)}</div>
      <div class="file-item-name">${escapeHtml(f.file)}</div>
      <div class="file-item-size">${formatBytes(f.size)}</div>
      <button class="file-item-remove" data-remove="${i}">✕</button>
    `;
    el.querySelector('[data-remove]').addEventListener('click', () => {
      builderFiles.splice(i, 1);
      renderFileList();
    });
    list.appendChild(el);
  });
}

async function handleFilesPicked(files) {
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      toast(`⚠️ ${file.name} > 10 MB, di-skip`, 'error');
      continue;
    }
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    builderFiles.push({ file: file.name, data: base64, size: file.size });
  }
  renderFileList();
}

async function handleZipPicked(file) {
  if (typeof JSZip === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => handleZipPicked(file);
    document.head.appendChild(script);
    return;
  }

  try {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const entries = Object.entries(contents.files);

    for (const [path, entry] of entries) {
      if (entry.dir) continue;
      if (path.startsWith('__MACOSX/') || path.startsWith('.')) continue;

      const blob = await entry.async('blob');
      if (blob.size > 10 * 1024 * 1024) continue;

      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      let cleanPath = path;
      const parts = path.split('/');
      if (parts.length > 1 && !parts[0].includes('.')) {
        const allSameRoot = entries.every(([p]) => p.startsWith(parts[0] + '/') || p === parts[0] + '/');
        if (allSameRoot) cleanPath = parts.slice(1).join('/');
      }
      if (!cleanPath) continue;

      builderFiles.push({ file: cleanPath, data: base64, size: blob.size });
    }

    toast(`✅ ${builderFiles.length} file di-extract dari ZIP`, 'success');
    renderFileList();
  } catch (e) {
    toast('❌ Gagal extract ZIP: ' + e.message, 'error');
  }
}

document.getElementById('pickFilesBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('builderFileInput')?.click();
});
document.getElementById('pickZipBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('builderZipInput')?.click();
});
document.getElementById('uploadArea')?.addEventListener('click', () => {
  document.getElementById('builderFileInput')?.click();
});

document.getElementById('builderFileInput')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;
  await handleFilesPicked(files);
  e.target.value = '';
});

document.getElementById('builderZipInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await handleZipPicked(file);
  e.target.value = '';
});

const uploadArea = document.getElementById('uploadArea');
uploadArea?.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea?.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea?.addEventListener('drop', async (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files);
  for (const f of files) {
    if (f.name.endsWith('.zip')) await handleZipPicked(f);
    else await handleFilesPicked([f]);
  }
});

document.getElementById('builderDeployBtn')?.addEventListener('click', async () => {
  if (!isAdminUser) return toast('Cuma admin yang bisa deploy!', 'error');

  const name = document.getElementById('builderName').value.trim();
  const resultEl = document.getElementById('builderResult');
  const btn = document.getElementById('builderDeployBtn');

  if (!name) return toast('Isi nama website dulu!', 'error');
  if (builderFiles.length === 0) return toast('Upload minimal 1 file!', 'error');

  const hasIndex = builderFiles.some(f => f.file === 'index.html' || f.file === 'index.htm');
  if (!hasIndex) {
    if (!confirm('⚠️ Gak ada index.html. Website mungkin gak muncul otomatis. Lanjut?')) return;
  }

  if (!confirm(`🚀 Deploy "${name}" dengan ${builderFiles.length} file ke Vercel?`)) return;

  btn.disabled = true;
  btn.textContent = '⏳ DEPLOYING...';

  resultEl.innerHTML = `
    <div style="background:#FFF9C4;border:3px solid #1a1a1a;border-radius:10px;padding:15px;color:#1a1a1a;text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">⏳</div>
      <b>Uploading ${builderFiles.length} file ke Vercel...</b>
      <p style="font-size:0.85rem;margin-top:5px">Bisa makan 30 detik - 2 menit.</p>
    </div>
  `;

  try {
    const res = await fetch('/api/deploy-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, files: builderFiles })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deploy gagal');

    const dep = data.deployment || {};

    resultEl.innerHTML = `
      <div style="background:#D1FAE5;border:3px solid #1a1a1a;border-radius:10px;padding:20px;color:#1a1a1a;text-align:center">
        <div style="font-size:3.5rem;margin-bottom:8px">🎉</div>
        <b style="font-size:1.3rem;display:block;margin-bottom:15px">WEBSITE BERHASIL DI-DEPLOY!</b>

        <div style="background:white;border:2px solid #1a1a1a;border-radius:8px;padding:12px;text-align:left;margin-bottom:12px">
          <div style="font-size:0.75rem;font-weight:700;opacity:0.6;margin-bottom:5px">🔗 LINK WEBSITE:</div>
          <a href="${dep.url}" target="_blank" style="color:#3B82F6;font-weight:700;font-size:0.9rem;word-break:break-all;text-decoration:underline">
            ${dep.url}
          </a>
        </div>

        <button class="btn-pop" id="copyLinkBtn" style="margin-bottom:12px">📋 COPY LINK</button>

        <div style="font-size:0.85rem;text-align:left;padding:10px;background:white;border-radius:8px">
          <b>📊 Info:</b><br>
          • Nama: <code>${dep.name}</code><br>
          • File: ${dep.fileCount} file<br>
          • Size: ${formatBytes(dep.totalBytes || 0)}<br>
          • Status: <span style="color:#3B82F6;font-weight:700">${dep.readyState}</span>
        </div>

        <p style="font-size:0.8rem;margin-top:12px;padding:10px;background:#FFF9C4;border-radius:8px;border:2px dashed #1a1a1a">
          💡 Website live dalam 1-2 menit. Klik link buat cek!
        </p>
      </div>
    `;

    document.getElementById('copyLinkBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(dep.url);
      toast('📋 Link dicopy!', 'success');
    });

    toast('🎉 Website berhasil di-deploy!', 'success');
  } catch (e) {
    resultEl.innerHTML = `
      <div style="background:#FEE2E2;border:3px solid #1a1a1a;border-radius:10px;padding:18px;color:#1a1a1a;text-align:center">
        <div style="font-size:3rem;margin-bottom:8px">❌</div>
        <b style="font-size:1.1rem;display:block;margin-bottom:8px">DEPLOY GAGAL</b>
        <p style="font-size:0.9rem;margin-bottom:10px">${e.message}</p>
        <div style="background:#FFF9C4;border:2px dashed #1a1a1a;border-radius:8px;padding:10px;text-align:left;font-size:0.8rem">
          <b>💡 Cek:</b><br>
          1. Env var <code>VERCEL_TOKEN</code> udah di-set?<br>
          2. Udah Redeploy setelah set env?<br>
          3. Nama website gak boleh ada spasi/simbol aneh<br>
          4. Ada <code>index.html</code> di root file?
        </div>
      </div>
    `;
    toast('❌ Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 DEPLOY KE VERCEL';
  }
});

// ============================================
// ===== INIT =====
// ============================================
window.addEventListener('DOMContentLoaded', async () => {
  currentHWID = await generateHWID();
  console.log('HWID Device:', currentHWID);

  const banData = await checkHWIDBan(currentHWID);
  if (banData) { showBannedScreen(banData, currentHWID); return; }

  await checkSiteConfig();

  initRoute();
  subscribeFeed();
  subscribeHomeFeed();
  subscribeStats();
  bindRatingStars();
  updateMusicUI();
  subscribeSiteConfig();

  if (shouldPlayMusic) setTimeout(() => playMusic(), 500);

  const hash = location.hash;
  if (hash.startsWith('#group=')) {
    const gid = hash.replace('#group=', '');
    setTimeout(() => joinGroupViaLink(gid), 1500);
  } else if (hash.startsWith('#channel=')) {
    const cid = hash.replace('#channel=', '');
    setTimeout(async () => {
      if (!currentUser) { navigate('auth'); return; }
      const jci = $('joinChannelId'); if (jci) jci.value = cid;
      navigate('channels');
    }, 1500);
  }
});

window.addEventListener('beforeunload', () => {
  localStorage.setItem('apex_music_on', musicPlaying ? 'true' : 'false');
});