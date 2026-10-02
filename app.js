import { firebaseConfig } from './firebase-config.js';
import { getMessaging, getToken, isSupported as isMessagingSupported, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query,
  orderBy, serverTimestamp, doc, getDoc, setDoc, deleteDoc,
  where, updateDoc, arrayUnion, arrayRemove, limit, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

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

// Presence
let presenceInterval = null;

// Music
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
// ===== HWID (DEVICE FINGERPRINT) =====
// ============================================
async function generateHWID() {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
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
  } catch (e) {
    return null;
  }
}

function showBannedScreen(banData, hwid) {
  const screen = $('bannedScreen');
  if (!screen) return;
  screen.classList.remove('hidden');

  const hwidEl = $('bannedHwid');
  if (hwidEl) hwidEl.textContent = hwid;

  const reasonEl = $('bannedReason');
  if (reasonEl) reasonEl.textContent = banData.reason || 'Tidak ada alasan';

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
    `Halo Developer,\n\nDevice gw kena ban di website.\n\nHWID: ${hwid}\nAlasan: ${banData.reason || '-'}\n\nMohon dibuka aksesnya. Terima kasih!`
  );
  const wa1 = $('bannedWa1');
  const wa2 = $('bannedWa2');
  if (wa1) wa1.href = `https://wa.me/6283181437266?text=${waMsg}`;
  if (wa2) wa2.href = `https://wa.me/6283185679623?text=${waMsg}`;
}

async function saveHWIDToUser(uid, hwid) {
  try {
    await setDoc(doc(db, 'users', uid), {
      hwid: hwid,
      deviceInfo: `${navigator.platform || 'Unknown'} • ${navigator.userAgent.substring(0, 100)}`,
      lastSeen: serverTimestamp()
    }, { merge: true });
  } catch (e) {}
}

// ============================================
// ===== STATS (USER, POST, RATING) =====
// ============================================
function subscribeStats() {
  onSnapshot(collection(db, 'users'), (snap) => {
    const el = $('statVisitors');
    if (el) el.textContent = snap.size + '+';
  });

  onSnapshot(collection(db, 'posts'), (snap) => {
    const el = $('statPosts');
    if (el) el.textContent = snap.size + '+';
  });

  onSnapshot(collection(db, 'ratings'), (snap) => {
    const el = $('statRating');
    if (!el) return;
    if (snap.size === 0) { el.textContent = '-'; return; }
    let total = 0;
    snap.forEach(d => total += (d.data().rating || 0));
    el.textContent = (total / snap.size).toFixed(1) + '⭐';
  });
}



// ============================================
// ===== RATING WEBSITE =====
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
    if (msg) {
      msg.textContent = rating > 0
        ? `Lu udah kasih ${rating} bintang ⭐`
        : 'Bantu kita jadi lebih baik!';
    }
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
let notificationRegistration = null;
let messagingInstance = null;
let notificationPermissionRequested = false;

async function initNotificationSystem() {
  if (!('Notification' in window)) return;

  try {
    if ('serviceWorker' in navigator) {
      notificationRegistration = await navigator.serviceWorker.register('/notification-sw.js', { scope: '/' });
    }
  } catch (e) {
    console.warn('Notification service worker:', e);
  }

  // FCM is optional. The local/service-worker notification path still works
  // without a VAPID key, while FCM can be enabled later from Firebase.
  try {
    if (currentUser && await isMessagingSupported()) {
      messagingInstance = getMessaging(app);
      onMessage(messagingInstance, (payload) => {
        const title = payload.notification?.title || payload.data?.title || 'Nova';
        const body = payload.notification?.body || payload.data?.body || '';
        showNotification(title, body);
      });
    }
  } catch (e) {
    console.warn('FCM unavailable:', e);
  }
}

async function requestNotificationPermission(force = false) {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  if (notificationPermissionRequested && !force) return 'default';

  notificationPermissionRequested = true;
  try {
    return await Notification.requestPermission();
  } catch (e) {
    return 'default';
  }
}

async function showNotification(title, body, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;

  const payload = {
    body: body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: options.tag || 'nova-notification',
    renotify: true,
    vibrate: options.vibrate || [180, 100, 180],
    data: options.data || {}
  };

  try {
    if (notificationRegistration) {
      await notificationRegistration.showNotification(title, payload);
      return true;
    }
  } catch (e) {
    console.warn('SW notification failed:', e);
  }

  // Fallback for desktop browsers that support the Notification constructor.
  try {
    new Notification(title, payload);
    return true;
  } catch (e) {
    return false;
  }
}

function enableNotificationsFromUserGesture() {
  if (!currentUser) return;
  if (Notification.permission === 'default') requestNotificationPermission(true);
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close().catch(() => {}), 500);
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
    ctx.fillStyle = '#FFD93D';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(count > 9 ? '9+' : count, 32, 48);
    link.href = canvas.toDataURL();
  } else {
    link.href = 'data:,';
  }
}
function updateTotalUnread() {
  const total = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const chatBadge = $('sidebarChatBadge');
  if (chatBadge) {
    if (total > 0) {
      chatBadge.textContent = total > 99 ? '99+' : total;
      chatBadge.classList.remove('hidden');
    } else {
      chatBadge.classList.add('hidden');
    }
  }
  updateFaviconBadge(total);
}

// Ask from a real user interaction so mobile browsers do not silently block it.
document.addEventListener('pointerdown', enableNotificationsFromUserGesture, { passive: true });

// ============================================
// ===== USER PROFILE =====
// ============================================
async function showUserProfile(uid) {
  if (!uid) return;
  const modal = $('userProfileModal');
  const content = $('userProfileContent');
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
    const userDoc = {
      username, bio, email: currentUser.email,
      updatedAt: serverTimestamp()
    };
    if (editAvatarData) {
      if (editAvatarData.length > 800 * 1024) return toast('Foto terlalu besar', 'error');
      userDoc.photoURL = editAvatarData;
    } else {
      userDoc.photoURL = '';
    }

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
// ===== CREATE GROUP =====
// ============================================
$('newGroupBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  const picker = $('memberPicker');
  if (!picker) return;
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
      lastMessage: 'Grup dibuat',
      lastMessageAt: serverTimestamp(),
      unread: {}
    });
    toast('✅ Grup dibuat!', 'success');
    $('groupModal')?.classList.add('hidden');
    $('groupName').value = '';
    openGroup(ref.id, name);
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// ============================================
// ===== EDIT GROUP =====
// ============================================
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

// ============================================
// ===== MEMBERS =====
// ============================================
async function showMembers() {
  if (!currentChatTarget) return;
  const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
  const data = snap.data();
  const members = data.members || [];
  const admins = data.admins || [];
  const isMeAdmin = admins.includes(currentUser.uid);

  const list = $('membersList');
  if (!list) return;
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
      members: [currentUser.uid],
      admins: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: 'Saluran dibuat',
      lastMessageAt: serverTimestamp(),
      unread: {}
    });
    toast('✅ Saluran dibuat!', 'success');
    $('channelModal')?.classList.add('hidden');
    $('channelName').value = '';
    $('channelDesc').value = '';
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
  const list = $('channelList');
  if (!list || !currentUser) return;
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
  const row = $('storyRow');
  if (!row) return;
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
      image: dataUrl, caption,
      createdAt: serverTimestamp()
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
    const pi = $('profileInfo');
    if (!pi) return;

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
// ===== TUTUP WEBSITE GLOBAL =====
// ============================================
async function checkSiteConfig() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'main'));
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'closed') {
      showSiteClosedPopup(data);
    }
  } catch (e) { console.warn('Check site config error:', e); }
}

function subscribeSiteConfig() {
  onSnapshot(doc(db, 'siteConfig', 'main'), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'closed') {
      showSiteClosedPopup(data);
    } else {
      hideSiteClosedPopup();
    }
  });
}

function showSiteClosedPopup(data) {
  // Kalau udah ada popup, skip
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
  if (overlay) {
    overlay.remove();
    document.body.style.overflow = '';
  }
}

// ============================================
// ===== WA POPUP =====
// ============================================
$('waFloatBtn')?.addEventListener('click', () => {
  $('waPopup')?.classList.remove('hidden');
});
$('waPopupClose')?.addEventListener('click', () => {
  $('waPopup')?.classList.add('hidden');
});
$('waPopup')?.addEventListener('click', (e) => {
  if (e.target.id === 'waPopup') $('waPopup')?.classList.add('hidden');
});
document.querySelectorAll('.wa-dev-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setTimeout(() => $('waPopup')?.classList.add('hidden'), 300);
  });
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
    musicPlaying = true;
    musicStarted = true;
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
function toggleMusic() {
  if (musicPlaying) pauseMusic();
  else playMusic();
}
function showMusicPrompt() {
  const p = $('musicPrompt');
  if (p && !musicStarted) p.classList.remove('hidden');
}
function hideMusicPrompt() {
  const p = $('musicPrompt');
  if (p) p.classList.add('hidden');
}

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
// ===== TELEPON (WebRTC) =====
// ============================================
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

function makeCallId(uid1, uid2) {
  return [uid1, uid2].sort().join('_') + '_' + Date.now();
}

function normalizeCandidate(c) {
  if (!c) return null;
  const x = typeof c.toJSON === 'function' ? c.toJSON() : c;
  return {
    candidate: x.candidate,
    sdpMid: x.sdpMid ?? null,
    sdpMLineIndex: x.sdpMLineIndex ?? null,
    usernameFragment: x.usernameFragment ?? null
  };
}

async function addRemoteCandidates(pc, candidates = []) {
  if (!pc || !Array.isArray(candidates)) return;
  for (const c of candidates) {
    if (!c?.candidate) continue;
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
  }
}

function setCallConnectionHandlers() {
  if (!peerConnection) return;
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState;
    const st = $('callStatus');
    if (state === 'connected') {
      if (st) st.textContent = 'Tersambung';
      startCallTimer();
    } else if (state === 'connecting') {
      if (st) st.textContent = 'Menghubungkan...';
    } else if (state === 'disconnected') {
      if (st) st.textContent = 'Koneksi terputus...';
    } else if (state === 'failed') {
      if (st) st.textContent = 'Koneksi gagal';
      toast('Koneksi telepon gagal. Coba lagi.', 'error');
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection?.iceConnectionState === 'failed') {
      peerConnection.restartIce?.();
    }
  };
}

async function startCall() {
  if (!currentUser) return toast('Login dulu!', 'error');
  if (!currentChatTarget || currentChatTarget.type !== 'dm') {
    return toast('Cuma bisa telepon di chat pribadi', 'error');
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    return toast('Browser ini tidak mendukung telepon WebRTC.', 'error');
  }

  const targetUid = currentChatTarget.otherId;
  const targetName = currentChatTarget.name || 'User';
  const callId = makeCallId(currentUser.uid, targetUid);
  const callRef = doc(db, 'calls', callId);
  let callDocReady = false;
  const pendingCallerCandidates = [];

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    setCallConnectionHandlers();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = async (event) => {
      if (event.streams[0]) {
        remoteStream = event.streams[0];
        const audio = $('remoteAudio');
        if (audio) {
          audio.srcObject = remoteStream;
          audio.muted = false;
          try { await audio.play(); } catch (e) {}
        }
      }
    };

    peerConnection.onicecandidate = async (event) => {
      const c = normalizeCandidate(event.candidate);
      if (!c) return;
      if (!callDocReady) {
        pendingCallerCandidates.push(c);
        return;
      }
      try {
        await updateDoc(callRef, { callerCandidates: arrayUnion(c) });
      } catch (e) {}
    };

    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    // Create the signaling document BEFORE flushing ICE candidates.
    await setDoc(callRef, {
      callId,
      caller: currentUser.uid,
      callerName: currentUser.displayName || currentUser.email || 'Anonim',
      receiver: targetUid,
      receiverName: targetName,
      offer: { type: offer.type, sdp: offer.sdp },
      callerCandidates: [],
      receiverCandidates: [],
      status: 'calling',
      createdAt: serverTimestamp()
    });
    callDocReady = true;
    if (pendingCallerCandidates.length) {
      await updateDoc(callRef, { callerCandidates: arrayUnion(...pendingCallerCandidates) });
      pendingCallerCandidates.length = 0;
    }

    currentCallId = callId;
    isInCall = true;
    showCallScreen(targetName, 'Memanggil...');
    listenCallAnswer(callId, 'caller');

    setTimeout(() => {
      if (isInCall && currentCallId === callId && !callStartTime) {
        toast('Tidak diangkat', 'error');
        endCall();
      }
    }, 60000);
  } catch (err) {
    console.error('startCall:', err);
    toast('Gagal telepon: ' + (err?.message || err), 'error');
    try { await updateDoc(callRef, { status: 'ended', endedAt: serverTimestamp() }); } catch (e) {}
    cleanupCall();
  }
}

function listenCallAnswer(callId, role) {
  if (callDocUnsub) callDocUnsub();
  callDocUnsub = onSnapshot(doc(db, 'calls', callId), async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.status === 'ended' || data.status === 'declined') {
      if (role === 'caller') toast(data.status === 'declined' ? 'Panggilan ditolak' : 'Panggilan berakhir', 'error');
      cleanupCall();
      return;
    }

    if (!peerConnection) return;

    if (role === 'caller' && data.status === 'accepted' && data.answer && !peerConnection.currentRemoteDescription) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        await addRemoteCandidates(peerConnection, data.receiverCandidates || []);
        const st = $('callStatus'); if (st) st.textContent = 'Menghubungkan...';
      } catch (err) {
        console.error('setRemoteDescription caller:', err);
      }
    }

    // Receiver must also consume caller ICE candidates after accepting.
    if (role === 'receiver' && data.callerCandidates) {
      const seen = peerConnection.__seenCallerCandidates || new Set();
      peerConnection.__seenCallerCandidates = seen;
      for (const c of data.callerCandidates) {
        const key = `${c.candidate}|${c.sdpMid}|${c.sdpMLineIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
      }
    }

    if (role === 'caller' && data.receiverCandidates) {
      const seen = peerConnection.__seenReceiverCandidates || new Set();
      peerConnection.__seenReceiverCandidates = seen;
      for (const c of data.receiverCandidates) {
        const key = `${c.candidate}|${c.sdpMid}|${c.sdpMLineIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {}
      }
    }
  }, (err) => {
    console.error('call listener:', err);
    toast('Sinyal telepon gagal: ' + err.message, 'error');
  });
}

async function acceptCall() {
  if (!pendingCallData || !currentUser || !currentCallId) return;
  const callId = currentCallId;
  const callRef = doc(db, 'calls', callId);
  let callDocReady = false;
  const pendingReceiverCandidates = [];

  try {
    $('incomingCallModal')?.classList.add('hidden');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser tidak mendukung mikrofon.');

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    peerConnection = new RTCPeerConnection(ICE_SERVERS);
    setCallConnectionHandlers();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = async (event) => {
      if (event.streams[0]) {
        remoteStream = event.streams[0];
        const audio = $('remoteAudio');
        if (audio) {
          audio.srcObject = remoteStream;
          audio.muted = false;
          try { await audio.play(); } catch (e) {}
        }
      }
    };

    peerConnection.onicecandidate = async (event) => {
      const c = normalizeCandidate(event.candidate);
      if (!c) return;
      if (!callDocReady) {
        pendingReceiverCandidates.push(c);
        return;
      }
      try { await updateDoc(callRef, { receiverCandidates: arrayUnion(c) }); } catch (e) {}
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingCallData.offer));
    await addRemoteCandidates(peerConnection, pendingCallData.callerCandidates || []);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await updateDoc(callRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'accepted',
      acceptedAt: serverTimestamp()
    });
    callDocReady = true;
    if (pendingReceiverCandidates.length) {
      await updateDoc(callRef, { receiverCandidates: arrayUnion(...pendingReceiverCandidates) });
      pendingReceiverCandidates.length = 0;
    }

    isInCall = true;
    showCallScreen(pendingCallData.callerName || 'User', 'Menghubungkan...');
    listenCallAnswer(callId, 'receiver');
  } catch (err) {
    console.error('acceptCall:', err);
    toast('Gagal terima: ' + (err?.message || err), 'error');
    try { await updateDoc(callRef, { status: 'ended', endedAt: serverTimestamp() }); } catch (e) {}
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
  const callId = currentCallId;
  if (callId) {
    try {
      await updateDoc(doc(db, 'calls', callId), {
        status: 'ended', endedAt: serverTimestamp()
      });
    } catch (e) {}
  }
  cleanupCall();
}

function cleanupCall() {
  if (peerConnection) { try { peerConnection.close(); } catch (e) {} peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteStream = null;
  if (callDocUnsub) { callDocUnsub(); callDocUnsub = null; }
  if (callDurationTimer) { clearInterval(callDurationTimer); callDurationTimer = null; }
  currentCallId = null;
  pendingCallData = null;
  isInCall = false;
  isMuted = false;
  isSpeaker = false;
  callStartTime = null;
  $('callScreen')?.classList.add('hidden');
  $('incomingCallModal')?.classList.add('hidden');
  const audio = $('remoteAudio');
  if (audio) {
    audio.pause?.();
    audio.srcObject = null;
  }
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

  // Avoid the composite-index requirement from the previous
  // receiver+status+orderBy query. Filter the status client-side.
  const q = query(
    collection(db, 'calls'),
    where('receiver', '==', currentUser.uid)
  );

  unsubscribeIncomingCall = onSnapshot(q, (snap) => {
    if (isInCall) return;

    let newest = null;
    snap.forEach(d => {
      const data = d.data();
      if (data.status !== 'calling' || !data.offer) return;
      if (data.createdAt?.seconds && (Date.now() - data.createdAt.seconds * 1000) > 60000) return;
      if (!newest || (data.createdAt?.seconds || 0) > (newest.data.createdAt?.seconds || 0)) {
        newest = { id: d.id, data };
      }
    });

    if (!newest) return;
    currentCallId = newest.id;
    pendingCallData = newest.data;
    const av = $('incomingAvatar'); if (av) av.textContent = getInitial(newest.data.callerName);
    const n = $('incomingName'); if (n) n.textContent = newest.data.callerName || 'User';
    $('incomingCallModal')?.classList.remove('hidden');
    playBeep();
    if (navigator.vibrate) navigator.vibrate([250, 150, 250, 150, 400]);
    showNotification('Panggilan masuk', `${newest.data.callerName || 'User'} sedang menelepon`, {
      tag: `incoming-call-${newest.id}`,
      data: { type: 'call', callId: newest.id }
    });
  }, (err) => {
    console.error('incoming call listener:', err);
    toast('Listener telepon gagal: ' + err.message, 'error');
  });
}

$('fcCallBtn')?.addEventListener('click', () => {
  if (!currentChatTarget || currentChatTarget.type !== 'dm') {
    return toast('Cuma bisa telepon di chat pribadi', 'error');
  }
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
  const audio = $('remoteAudio');
  if (audio && 'setSinkId' in audio) {
    // Mobile browsers generally route media to the active audio output.
    // Keep the state/UI without forcing an invalid sink id.
    audio.setSinkId('').catch(() => {});
  }
  $('speakerBtn')?.classList.toggle('active', isSpeaker);
  const s = $('speakerBtn'); if (s) s.textContent = isSpeaker ? '🔊' : '🔉';
});

// ============================================
// ===== DEPLOY HTML TO VERCEL =====
// ============================================
function setDeployProgress(show, title = '', detail = '') {
  const box = $('deployProgress');
  if (!box) return;
  box.classList.toggle('hidden', !show);
  if (title) $('deployProgressTitle').textContent = title;
  if (detail) $('deployProgressText').textContent = detail;
}

function showDeployResult(ok, title, message, url = '') {
  const box = $('deployResult');
  if (!box) return;
  box.className = 'deploy-result' + (ok ? '' : ' error');
  box.classList.remove('hidden');

  if (ok && url) {
    const safeUrl = String(url).replace(/"/g, '&quot;');
    box.innerHTML = `
      <h4>Deployment berhasil</h4>
      <p>${escapeHtml(message || 'Website sudah dipublish ke Vercel.')}</p>
      <a class="deploy-url" href="${safeUrl}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(url)}
      </a>
    `;
  } else {
    box.innerHTML = `
      <h4>Deployment gagal</h4>
      <p>${escapeHtml(message || 'Terjadi kesalahan saat deploy.')}</p>
    `;
  }
}

function sanitizeDeployName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

$('deployClearBtn')?.addEventListener('click', () => {
  $('deployProjectName').value = '';
  $('deployHtml').value = '';
  $('deployCss').value = '';
  $('deployJs').value = '';
  $('deployResult')?.classList.add('hidden');
  setDeployProgress(false);
});

$('deployBtn')?.addEventListener('click', async () => {
  if (!currentUser) {
    toast('Login dulu untuk deploy!', 'error');
    navigate('auth');
    return;
  }

  const projectName = sanitizeDeployName($('deployProjectName')?.value);
  const html = $('deployHtml')?.value || '';
  const css = $('deployCss')?.value || '';
  const jsCode = $('deployJs')?.value || '';

  if (!projectName) return toast('Nama project wajib diisi!', 'error');
  if (!html.trim()) return toast('Kode index.html masih kosong!', 'error');
  if (html.length > 2 * 1024 * 1024) return toast('index.html maksimal 2 MB.', 'error');
  if (css.length > 2 * 1024 * 1024) return toast('style.css maksimal 2 MB.', 'error');
  if (jsCode.length > 2 * 1024 * 1024) return toast('script.js maksimal 2 MB.', 'error');

  const btn = $('deployBtn');
  btn.disabled = true;
  $('deployResult')?.classList.add('hidden');
  setDeployProgress(true, 'Menyiapkan deployment...', 'Mengirim file ke server deployment.');

  try {
    const idToken = await currentUser.getIdToken();
    const files = [
      { file: 'index.html', data: html }
    ];
    if (css.trim()) files.push({ file: 'style.css', data: css });
    if (jsCode.trim()) files.push({ file: 'script.js', data: jsCode });

    setDeployProgress(true, 'Menghubungkan ke Vercel...', 'Memproses file website.');

    const response = await fetch('/api/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        name: projectName,
        files
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || result.error || `HTTP ${response.status}`);
    }

    const liveUrl = result.url
      ? (result.url.startsWith('http') ? result.url : `https://${result.url}`)
      : '';

    setDeployProgress(false);
    showDeployResult(
      true,
      'Deployment berhasil',
      `Project "${projectName}" berhasil dikirim ke Vercel.`,
      liveUrl
    );
    toast('Website berhasil di-deploy!', 'success');
  } catch (err) {
    console.error('Deploy error:', err);
    setDeployProgress(false);
    showDeployResult(false, 'Deployment gagal', err.message || 'Unknown error');
    toast('Deploy gagal!', 'error');
  } finally {
    btn.disabled = false;
  }
});

// ============================================
// ===== INIT =====
// ============================================
window.addEventListener('DOMContentLoaded', async () => {
  currentHWID = await generateHWID();
  console.log('HWID Device:', currentHWID);

  // Cek HWID ban
  const banData = await checkHWIDBan(currentHWID);
  if (banData) {
    showBannedScreen(banData, currentHWID);
    return;
  }

  // Cek site closed
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