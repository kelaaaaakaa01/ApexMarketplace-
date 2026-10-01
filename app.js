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
  where, updateDoc, arrayUnion, arrayRemove, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ⚙️ GANTI INI — API key DeepSeek lu
const DEEPSEEK_API_URL = '/api/chat'; // proxy Vercel (bikin file api/chat.js — lihat step bawah)

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

// STATE
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
let replyTo = null;
let allUsers = [];
let allChats = [];
let allChannels = [];
let currentChatFilter = 'all';
let stories = [];
let storyIndex = 0;
let storyTimer = null;
let editAvatarData = null;
let editGroupAvatarData = null;

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

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ROUTING
function navigate(page) {
  history.replaceState(null, '', '#' + page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.side-link, .bn-link').forEach(l => l.classList.remove('active'));
  const pageEl = $('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll(`.side-link[data-page="${page}"], .bn-link[data-page="${page}"]`)
    .forEach(l => l.classList.add('active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'chats') renderChatList();
  if (page === 'channels') renderChannels();
}
function initRoute() {
  const hash = location.hash.replace('#', '') || 'home';
  navigate(hash);
}
document.querySelectorAll('.side-link, .bn-link, [data-page]').forEach(el => {
  el.addEventListener('click', (e) => {
    const page = el.dataset.page;
    if (page) { e.preventDefault(); navigate(page); }
  });
});

// AUTH
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authtab === mode));
  $('authUsername').classList.toggle('hidden', mode !== 'register');
  $('doAuth').textContent = mode === 'register' ? 'DAFTAR' : 'LOGIN';
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

  const btn = $('doAuth'); btn.disabled = true; btn.textContent = 'LOADING...';
  try {
    if (authMode === 'register') {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: uname });
      try {
        await setDoc(doc(db, 'users', cred.user.uid), {
          username: uname, email, photoURL: '', bio: '', createdAt: serverTimestamp()
        });
      } catch (e) {}
      toast('✅ Daftar sukses!', 'success');
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
      toast('✅ Login berhasil!', 'success');
    }
    $('authEmail').value = ''; $('authPassword').value = ''; $('authUsername').value = '';
    navigate('home');
  } catch (e) { toast('Gagal: ' + translateErr(e.code), 'error'); }
  finally { btn.disabled = false; btn.textContent = authMode === 'register' ? 'DAFTAR' : 'LOGIN'; }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    const name = user.displayName || user.email;

    await loadUserData();

    const photoURL = currentUserData?.photoURL || '';

    // Update topbar avatar
    const topBtn = $('topAuthBtn');
    topBtn.className = 'top-avatar';
    topBtn.style.cssText = 'width:42px;height:42px;padding:0;border-radius:50%;border:3px solid #1a1a1a;font-family:"Bangers",cursive;font-size:1.2rem;color:white;cursor:pointer;box-shadow:3px 3px 0 #1a1a1a;display:flex;align-items:center;justify-content:center;overflow:hidden;';
    if (photoURL) {
      topBtn.innerHTML = `<img src="${photoURL}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      topBtn.textContent = getInitial(name);
      topBtn.classList.add(getAvatarColor(name));
    }

    // Update sidebar avatar
    const sideAv = $('sideAvatar');
    sideAv.className = 'avatar';
    if (photoURL) {
      sideAv.innerHTML = `<img src="${photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      sideAv.textContent = getInitial(name);
      sideAv.classList.add(getAvatarColor(name));
    }

    $('sideName').textContent = name;
    $('sideAuthBtn').textContent = 'LOGOUT';

    subscribeUsers();
    // ... (sisanya tetap sama)
    subscribeMyPosts();
    subscribeChatList();
    subscribeStoryRow();
    subscribeChannels();
    updateOnlineStatus();
    renderProfile();
  } else {
    $('topAuthBtn').textContent = 'LOGIN';
    $('topAuthBtn').className = 'btn-login-top';
    $('topAuthBtn').style.cssText = '';
    const sideAv = $('sideAvatar');
    sideAv.textContent = '?'; sideAv.className = 'avatar';
    $('sideName').textContent = 'Guest';
    $('sideAuthBtn').textContent = 'LOGIN';

    [unsubscribeUsers, unsubscribeMyPosts, unsubscribeChat, unsubscribeChatList,
     unsubscribeStoryRow, unsubscribeChannels].forEach(fn => fn && fn());
    allChats = []; allUsers = []; allChannels = [];

    $('profileInfo').innerHTML = '<p>Login dulu...</p>';
    $('waChatList').innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Login dulu...</p>';
    $('myPosts').innerHTML = '<p style="padding:20px">Login buat lihat...</p>';
    $('channelList').innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Login dulu...</p>';
  }
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
async function updateOnlineStatus() {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      lastSeen: serverTimestamp(), online: true
    }, { merge: true });
  } catch (e) {}
}

// POST JUALAN
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
  unsubscribeFeed = onSnapshot(q, (snap) => {
    const list = $('feedList'); list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<p style="padding:20px">Belum ada postingan.</p>'; return; }
    snap.forEach(d => {
      const p = d.data();
      const card = document.createElement('div');
      card.className = 'post-card';
      card.innerHTML = postCardHTML(p, d.id);
      list.appendChild(card);
    });
    bindPostActions(list);
  }, (err) => {
    $('feedList').innerHTML = `<p style="padding:20px;color:red">Error: ${translateErr(err.code)}</p>`;
  });
}
function subscribeHomeFeed() {
  if (unsubscribeHomeFeed) unsubscribeHomeFeed();
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(6));
  unsubscribeHomeFeed = onSnapshot(q, (snap) => {
    const list = $('homeFeed'); list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<p style="padding:20px">Belum ada barang.</p>'; return; }
    snap.forEach(d => {
      const p = d.data();
      const card = document.createElement('div');
      card.className = 'post-card';
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
    const list = $('myPosts'); list.innerHTML = '';
    if (snap.empty) { list.innerHTML = '<p style="padding:20px">Belum jualan apa-apa.</p>'; return; }
    snap.forEach(d => {
      const p = d.data();
      const card = document.createElement('div');
      card.className = 'post-card';
      card.innerHTML = postCardHTML(p, d.id);
      list.appendChild(card);
    });
    bindPostActions(list);
  });
}

function subscribeUsers() {
  if (unsubscribeUsers) unsubscribeUsers();
  unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
    allUsers = [];
    snap.forEach(u => {
      if (u.id === currentUser.uid) return;
      allUsers.push({ uid: u.id, ...u.data() });
    });
    if (currentChatFilter === 'users') renderChatList();
  });
}

// ===== CHAT LIST =====
function subscribeChatList() {
  if (unsubscribeChatList) unsubscribeChatList();
  if (!currentUser) return;

  unsubscribeChatList = onSnapshot(collection(db, 'chats'), (snap) => {
    const chats = [];
    snap.forEach(d => {
      const c = d.data();
      if (!c.members || !c.members.includes(currentUser.uid)) return;
      if (c.type === 'channel') {
        allChannels.push({ id: d.id, ...c });
        return;
      }
      chats.push({
        id: d.id, type: c.type || 'dm', name: c.name || 'Chat',
        members: c.members, admins: c.admins || [],
        photoURL: c.photoURL || '', desc: c.desc || '',
        lastMsg: c.lastMessage || '',
        lastMsgAt: c.lastMessageAt,
        lastSender: c.lastSender || ''
      });
    });
    chats.sort((a, b) => (b.lastMsgAt?.seconds || 0) - (a.lastMsgAt?.seconds || 0));
    allChats = chats;
    renderChatList();
  });
}

function renderChatList() {
  const list = $('waChatList');
  if (!list) return;

  let filtered = allChats;
  if (currentChatFilter === 'dm') filtered = allChats.filter(c => c.type === 'dm');
  else if (currentChatFilter === 'group') filtered = allChats.filter(c => c.type === 'group');
  else if (currentChatFilter === 'users') {
    // Tampilkan semua user + tombol chat
    if (allUsers.length === 0) {
      list.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada user lain</p>';
      return;
    }
    list.innerHTML = '';
    allUsers.forEach(u => {
      const name = u.username || u.email || 'User';
      const isOnline = u.online && u.lastSeen && (Date.now() - u.lastSeen.seconds * 1000) < 120000;
      const el = document.createElement('div');
      el.className = 'wa-chat-item';
      el.innerHTML = `
        ${avatarHTML(name, '', u.photoURL)}
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
      displayName = `${c.name} <span class="member-count">(${memberCount} anggota)</span>`;
    } else {
      const other = c.members.find(m => m !== currentUser.uid);
      const u = allUsers.find(u => u.uid === other);
      const name = u?.username || u?.email || c.name || 'User';
      avatar = avatarHTML(name, '', u?.photoURL);
      displayName = escapeHtml(name);
    }

    const el = document.createElement('div');
    el.className = 'wa-chat-item';
    el.innerHTML = `
      ${avatar}
      <div class="wa-chat-info">
        <div class="wa-chat-name">${isGroup ? '👥 ' : ''}${displayName}</div>
        <div class="wa-chat-preview">${escapeHtml(c.lastMsg || 'Belum ada pesan')}</div>
      </div>
      <div class="wa-chat-meta">
        <div class="wa-chat-time">${c.lastMsgAt ? formatTime(c.lastMsgAt) : ''}</div>
      </div>
    `;
    el.addEventListener('click', () => {
      if (isGroup) openGroup(c.id, c.name);
      else {
        const other = c.members.find(m => m !== currentUser.uid);
        const u = allUsers.find(u => u.uid === other);
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

// OPEN DM
async function openDM(otherId, otherName) {
  if (!currentUser) { navigate('auth'); return; }
  if (otherId === currentUser.uid) return;

  const chatId = [currentUser.uid, otherId].sort().join('_');

  // Buat chat doc kalau belum ada
  const ref = doc(db, 'chats', chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: 'dm',
      members: [currentUser.uid, otherId],
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageAt: serverTimestamp()
    });
  }

  currentChatTarget = { type: 'dm', id: chatId, otherId, name: otherName };
  showFullChat(otherName, 'Klik untuk lihat profil', false);
  loadMessagesFor(chatId);
}

// OPEN GROUP
async function openGroup(groupId, name) {
  const snap = await getDoc(doc(db, 'chats', groupId));
  const data = snap.exists() ? snap.data() : {};
  currentChatTarget = { type: 'group', id: groupId, name, data };
  const members = data.members?.length || 0;
  showFullChat(name, `👥 ${members} anggota`, true);
  loadMessagesFor(groupId);
}

// OPEN CHANNEL
async function openChannel(channelId, name) {
  const snap = await getDoc(doc(db, 'chats', channelId));
  const data = snap.exists() ? snap.data() : {};
  currentChatTarget = { type: 'channel', id: channelId, name, data };
  const members = data.members?.length || 0;
  const isAdmin = data.admins?.includes(currentUser.uid);
  showFullChat(name, `📻 ${members} pengikut ${isAdmin ? '• Admin' : ''}`, true);
  loadMessagesFor(channelId);
}

// SHOW FULL CHAT
function showFullChat(name, status, isGroupOrChannel) {
  $('fullChat').classList.remove('hidden');
  $('fcName').textContent = name;
  $('fcStatus').textContent = status;
  $('fcAvatarWrap').innerHTML = isGroupOrChannel
    ? `<div class="wa-chat-avatar group" style="width:40px;height:40px;font-size:1.2rem">👥</div>`
    : avatarHTML(name, 'small');

  $('fcAvatarWrap').onclick = null;
  $('fcName').parentElement.onclick = null;

  if (currentChatTarget.type === 'dm') {
    $('fcAvatarWrap').onclick = () => showUserProfile(currentChatTarget.otherId);
    $('fcName').parentElement.onclick = () => showUserProfile(currentChatTarget.otherId);
  }
}

function closeFullChat() {
  $('fullChat').classList.add('hidden');
  $('fcMenuDropdown').classList.add('hidden');
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  currentChatTarget = null;
}
$('fcBack')?.addEventListener('click', closeFullChat);

// MENU
$('fcMenu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = $('fcMenuDropdown');
  dd.classList.toggle('hidden');

  // Filter tombol sesuai tipe chat
  const isGroup = currentChatTarget?.type === 'group';
  const isChannel = currentChatTarget?.type === 'channel';
  const isDM = currentChatTarget?.type === 'dm';
  const isAdmin = currentChatTarget?.data?.admins?.includes(currentUser.uid);

  dd.querySelectorAll('.group-only').forEach(el => el.style.display = isGroup ? '' : 'none');
  dd.querySelectorAll('.channel-only').forEach(el => el.style.display = isChannel ? '' : 'none');
  dd.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
  // menuCopyLink cuma buat grup & admin
  $('menuCopyLink').style.display = (isGroup && isAdmin) ? '' : 'none';
});

document.addEventListener('click', (e) => {
  if (!$('fcMenuDropdown')?.contains(e.target) && e.target.id !== 'fcMenu') {
    $('fcMenuDropdown')?.classList.add('hidden');
  }
});

$('menuViewProfile')?.addEventListener('click', () => {
  $('fcMenuDropdown').classList.add('hidden');
  if (currentChatTarget.type === 'dm') showUserProfile(currentChatTarget.otherId);
});

$('menuViewMembers')?.addEventListener('click', () => {
  $('fcMenuDropdown').classList.add('hidden');
  showMembers();
});

$('menuEditGroup')?.addEventListener('click', () => {
  $('fcMenuDropdown').classList.add('hidden');
  showEditGroup();
});

$('menuCopyLink')?.addEventListener('click', () => {
  $('fcMenuDropdown').classList.add('hidden');
  const link = `${location.origin}${location.pathname}#group=${currentChatTarget.id}`;
  navigator.clipboard.writeText(link).then(() => toast('🔗 Link dicopy!', 'success'));
});

$('menuCopyLinkChannel')?.addEventListener('click', () => {
  $('fcMenuDropdown').classList.add('hidden');
  const link = `${location.origin}${location.pathname}#channel=${currentChatTarget.id}`;
  navigator.clipboard.writeText(link).then(() => toast('🔗 Link dicopy!', 'success'));
});

$('menuLeave')?.addEventListener('click', async () => {
  $('fcMenuDropdown').classList.add('hidden');
  if (!confirm('Yakin keluar?')) return;
  try {
    await updateDoc(doc(db, 'chats', currentChatTarget.id), {
      members: arrayRemove(currentUser.uid)
    });
    toast('🚪 Keluar', 'success');
    closeFullChat();
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// LOAD MESSAGES
function loadMessagesFor(chatId) {
  if (unsubscribeChat) unsubscribeChat();
  const msgsEl = $('fcMessages');
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

  div.innerHTML = senderLabel + replyHTML + content + `<span class="time">${time}</span>`;
  div.addEventListener('dblclick', () => setReply(m, msgId));
  return div;
}

function setReply(m, msgId) {
  replyTo = {
    msgId,
    name: m.senderId === currentUser.uid ? 'Lu' : (m.senderName || currentChatTarget?.name || 'User'),
    text: m.text || (m.type === 'image' ? '[Gambar]' : m.type === 'voice' ? '[VN]' : '[File]')
  };
  $('fcReplyBar').classList.remove('hidden');
  $('fcReplyName').textContent = '↩ ' + replyTo.name;
  $('fcReplyText').textContent = replyTo.text;
  $('fcChatInput').focus();
}
function clearReply() {
  replyTo = null;
  $('fcReplyBar').classList.add('hidden');
}
$('fcReplyClose')?.addEventListener('click', clearReply);

// SEND TEXT
$('fcChatForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatTarget) return toast('Buka chat dulu!', 'error');

  // Kalau channel & bukan admin, gak boleh kirim
  if (currentChatTarget.type === 'channel') {
    const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
    const data = snap.data();
    if (!data.admins?.includes(currentUser.uid)) {
      return toast('❌ Cuma admin yang bisa posting di saluran!', 'error');
    }
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
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'chats', currentChatTarget.id), {
      lastMessage: text.substring(0, 50),
      lastMessageAt: serverTimestamp(),
      lastSender: currentUser.uid,
      type: currentChatTarget.type
    }, { merge: true });
    clearReply();
  } catch (err) {
    toast('Gagal: ' + err.message, 'error');
    input.value = text;
  }
});

// ===== MEDIA HELPERS =====
window.openImage = (url) => {
  const modal = document.createElement('div');
  modal.id = 'imgPreviewModal';
  modal.innerHTML = `<img src="${url}">`;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
};

function showUploadBar(show, pct = 0, label = 'Processing...') {
  const bar = $('fcUploadBar');
  if (!bar) return;
  const fill = $('fcUploadFill');
  const text = $('fcUploadText');
  if (show) {
    bar.classList.remove('hidden');
    fill.style.width = pct + '%';
    text.textContent = `${label} ${Math.round(pct)}%`;
  } else {
    bar.classList.add('hidden');
    fill.style.width = '0%';
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

// SEND IMAGE
$('fcImgBtn')?.addEventListener('click', () => $('fcImgInput').click());
$('fcImgInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentChatTarget) return;
  if (file.size > 10*1024*1024) return toast('Maks 10 MB!', 'error');

  try {
    showUploadBar(true, 30, 'Compress...');
    const dataUrl = await compressImage(file, 800, 0.7);
    if (dataUrl.length > 900*1024) return toast('Gambar terlalu besar', 'error');

    await addDoc(collection(db, 'chats', currentChatTarget.id, 'messages'), {
      type: 'image', url: dataUrl, text: '', replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'chats', currentChatTarget.id), {
      lastMessage: '📷 Foto',
      lastMessageAt: serverTimestamp(),
      lastSender: currentUser.uid,
      type: currentChatTarget.type
    }, { merge: true });
    clearReply();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
  finally { setTimeout(() => showUploadBar(false), 500); }
});

// SEND FILE
$('fcFileBtn')?.addEventListener('click', () => $('fcFileInput').click());
$('fcFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentChatTarget) return;
  if (file.size > 700*1024) return toast('Maks 700 KB', 'error');

  try {
    showUploadBar(true, 50, 'Encode...');
    const dataUrl = await fileToBase64(file);
    await addDoc(collection(db, 'chats', currentChatTarget.id, 'messages'), {
      type: 'file', url: dataUrl, fileName: file.name, size: file.size, mime: file.type, replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, 'chats', currentChatTarget.id), {
      lastMessage: '📎 ' + file.name.substring(0, 30),
      lastMessageAt: serverTimestamp(),
      lastSender: currentUser.uid,
      type: currentChatTarget.type
    }, { merge: true });
    clearReply();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
  finally { setTimeout(() => showUploadBar(false), 500); }
});

// VOICE NOTE
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
      $('fcRecordingBar').classList.add('hidden');
      $('fcVnBtn').classList.remove('recording');
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
          createdAt: serverTimestamp()
        });
        await setDoc(doc(db, 'chats', currentChatTarget.id), {
          lastMessage: '🎤 VN',
          lastMessageAt: serverTimestamp(),
          lastSender: currentUser.uid,
          type: currentChatTarget.type
        }, { merge: true });
        clearReply();
      } catch (err) { toast('Gagal: ' + err.message, 'error'); }
      finally { setTimeout(() => showUploadBar(false), 500); }
    });

    mediaRecorder.start();
    recStartTime = Date.now();
    $('fcRecordingBar').classList.remove('hidden');
    $('fcVnBtn').classList.add('recording');
    $('fcRecTime').textContent = '0:00';
    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStartTime)/1000);
      $('fcRecTime').textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      if (s >= MAX_VN_SECONDS && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 200);
  } catch (err) { toast('Mic error: ' + err.message, 'error'); }
});
$('fcStopRec')?.addEventListener('click', () => { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); });
$('fcCancelRec')?.addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') { cancelled = true; audioChunks = []; mediaRecorder.stop(); }
});

// ===== USER PROFILE MODAL =====
async function showUserProfile(uid) {
  if (!uid) return;
  const modal = $('userProfileModal');
  const content = $('userProfileContent');
  content.innerHTML = 'Loading...';
  modal.classList.remove('hidden');

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.exists() ? snap.data() : {};
    const name = data.username || data.email || 'User';
    const isOnline = data.online && data.lastSeen && (Date.now() - data.lastSeen.seconds * 1000) < 120000;

    content.innerHTML = `
      ${avatarHTML(name, 'big', data.photoURL)}
      <h3 style="font-family:'Bangers';font-size:1.6rem;margin:10px 0">${escapeHtml(name)}</h3>
      ${data.bio ? `<p style="font-style:italic;font-size:0.9rem;padding:0 10px;margin-bottom:10px">"${escapeHtml(data.bio)}"</p>` : ''}
      <p style="font-size:0.85rem">📧 ${escapeHtml(data.email||'-')}</p>
      <p style="font-size:0.85rem">${isOnline ? '🟢 Online' : '⚫ Offline'}</p>
      <p style="font-size:0.75rem;opacity:0.6;margin-top:10px">🆔 ${escapeHtml(uid)}</p>
    `;
  } catch (e) {
    content.innerHTML = '<p>Gagal load profil</p>';
  }
}
$('closeUserProfile')?.addEventListener('click', () => $('userProfileModal').classList.add('hidden'));

// ===== EDIT PROFIL SENDIRI =====
function showEditProfile() {
  if (!currentUser) return;
  const name = currentUser.displayName || currentUserData?.username || 'Anonim';
  $('editUsername').value = name;
  $('editBio').value = currentUserData?.bio || '';
  editAvatarData = currentUserData?.photoURL || null;

  const preview = $('editAvatarPreview');
  preview.className = 'avatar big';
  preview.style.cssText = 'margin:0 auto 10px;overflow:hidden;';
  if (editAvatarData) {
    preview.innerHTML = `<img src="${editAvatarData}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    preview.textContent = getInitial(name);
    preview.classList.add(getAvatarColor(name));
  }
  $('editProfileModal').classList.remove('hidden');
}
$('closeEditProfile')?.addEventListener('click', () => $('editProfileModal').classList.add('hidden'));
$('pickAvatarBtn')?.addEventListener('click', () => $('editAvatarInput').click());
$('editAvatarInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3*1024*1024) return toast('Maks 3 MB', 'error');
  const dataUrl = await compressImage(file, 400, 0.7);
  editAvatarData = dataUrl;
  const preview = $('editAvatarPreview');
  preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
});

$('saveProfileBtn')?.addEventListener('click', async () => {
  const username = $('editUsername').value.trim();
  const bio = $('editBio').value.trim();
  if (!username) return toast('Username wajib!', 'error');

  try {
    // ⚠️ JANGAN kirim photoURL ke updateProfile (limit 2048 char)
    // Cukup update displayName doang
    await updateProfile(currentUser, { displayName: username });

    // Simpan foto + bio di Firestore (limit 1 MB, lebih gede)
    const userDoc = {
      username,
      bio,
      email: currentUser.email,
      updatedAt: serverTimestamp()
    };

    // Cuma tambah photoURL kalau ada, dan cek panjangnya
    if (editAvatarData) {
      if (editAvatarData.length > 800 * 1024) {
        return toast('Foto terlalu besar (>800KB). Coba foto lain.', 'error');
      }
      userDoc.photoURL = editAvatarData;
    } else {
      userDoc.photoURL = ''; // Reset foto
    }

    await setDoc(doc(db, 'users', currentUser.uid), userDoc, { merge: true });
    await loadUserData();

    toast('✅ Profil disimpan!', 'success');
    $('editProfileModal').classList.add('hidden');

    // Update UI
    renderProfile();

    const sideAv = $('sideAvatar');
    if (editAvatarData) {
      sideAv.innerHTML = `<img src="${editAvatarData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      sideAv.textContent = getInitial(username);
      sideAv.className = 'avatar ' + getAvatarColor(username);
    }
    $('sideName').textContent = username;

    // Update topbar avatar juga
    const topBtn = $('topAuthBtn');
    if (editAvatarData) {
      topBtn.innerHTML = `<img src="${editAvatarData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      topBtn.textContent = getInitial(username);
    }
  } catch (e) {
    console.error('Save profile error:', e);
    toast('Gagal: ' + e.message, 'error');
  }
});

// ===== CREATE GROUP =====
$('newGroupBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  const picker = $('memberPicker');
  picker.innerHTML = '';
  if (allUsers.length === 0) {
    picker.innerHTML = '<p style="padding:10px;text-align:center">Belum ada user lain</p>';
  } else {
    allUsers.forEach(u => {
      const name = u.username || u.email;
      const el = document.createElement('label');
      el.className = 'member-item';
      el.innerHTML = `
        ${avatarHTML(name, 'small', u.photoURL)}
        <span>${escapeHtml(name)}</span>
        <input type="checkbox" value="${u.uid}">
      `;
      el.querySelector('input').addEventListener('change', (ev) => {
        el.classList.toggle('selected', ev.target.checked);
      });
      picker.appendChild(el);
    });
  }
  $('groupModal').classList.remove('hidden');
});
$('closeGroupModal')?.addEventListener('click', () => $('groupModal').classList.add('hidden'));

$('createGroupBtn')?.addEventListener('click', async () => {
  const name = $('groupName').value.trim();
  if (!name) return toast('Nama grup wajib!', 'error');
  const selected = Array.from(document.querySelectorAll('#memberPicker input:checked')).map(i => i.value);
  if (selected.length === 0) return toast('Pilih minimal 1 member!', 'error');

  const members = [currentUser.uid, ...selected];
  try {
    const ref = await addDoc(collection(db, 'chats'), {
      type: 'group',
      name,
      photoURL: '',
      desc: '',
      members,
      admins: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: 'Grup dibuat',
      lastMessageAt: serverTimestamp()
    });
    toast('✅ Grup dibuat!', 'success');
    $('groupModal').classList.add('hidden');
    $('groupName').value = '';
    openGroup(ref.id, name);
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// ===== EDIT GROUP =====
async function showEditGroup() {
  if (currentChatTarget?.type !== 'group') return;
  const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
  const data = snap.data();
  $('editGroupName').value = data.name || '';
  $('editGroupDesc').value = data.desc || '';
  editGroupAvatarData = data.photoURL || null;

  const preview = $('editGroupAvatar');
  if (editGroupAvatarData) {
    preview.innerHTML = `<img src="${editGroupAvatarData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    preview.textContent = '👥';
    preview.className = 'avatar big';
  }
  $('editGroupModal').classList.remove('hidden');
}
$('closeEditGroup')?.addEventListener('click', () => $('editGroupModal').classList.add('hidden'));
$('pickGroupAvatarBtn')?.addEventListener('click', () => $('editGroupAvatarInput').click());
$('editGroupAvatarInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3*1024*1024) return toast('Maks 3 MB', 'error');
  const dataUrl = await compressImage(file, 400, 0.7);
  editGroupAvatarData = dataUrl;
  const preview = $('editGroupAvatar');
  preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
});

$('saveGroupBtn')?.addEventListener('click', async () => {
  const name = $('editGroupName').value.trim();
  const desc = $('editGroupDesc').value.trim();
  if (!name) return toast('Nama grup wajib!', 'error');

  try {
    await setDoc(doc(db, 'chats', currentChatTarget.id), {
      name, desc,
      photoURL: editGroupAvatarData || ''
    }, { merge: true });
    toast('✅ Grup disimpan!', 'success');
    $('editGroupModal').classList.add('hidden');
    $('fcName').textContent = name;
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// ===== MEMBERS LIST =====
async function showMembers() {
  if (!currentChatTarget) return;
  const snap = await getDoc(doc(db, 'chats', currentChatTarget.id));
  const data = snap.data();
  const members = data.members || [];
  const admins = data.admins || [];
  const isMeAdmin = admins.includes(currentUser.uid);

  const list = $('membersList');
  list.innerHTML = '';

  members.forEach(uid => {
    const u = allUsers.find(x => x.uid === uid);
    const name = u?.username || u?.email || (uid === currentUser.uid ? 'Lu' : 'User');
    const isAdmin = admins.includes(uid);
    const photoURL = u?.photoURL || '';

    const row = document.createElement('div');
    row.className = 'member-row';
    row.innerHTML = `
      ${avatarHTML(name, 'small', photoURL)}
      <div class="member-row-info">
        <div>${escapeHtml(name)} ${uid === currentUser.uid ? '(Lu)' : ''}</div>
        <small class="role-badge ${isAdmin ? 'admin' : 'member'}">${isAdmin ? '👑 Admin' : 'Member'}</small>
      </div>
      ${isMeAdmin ? `
        <div class="member-row-actions">
          ${isAdmin
            ? `<button class="mini-btn danger" data-demote="${uid}">⬇️ Demote</button>`
            : `<button class="mini-btn" data-promote="${uid}">👑 Admin</button>`}
        </div>
      ` : ''}
    `;
    list.appendChild(row);
  });

  // Bind actions
  list.querySelectorAll('[data-promote]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.promote;
      if (!confirm('Jadikan admin?')) return;
      try {
        await updateDoc(doc(db, 'chats', currentChatTarget.id), {
          admins: arrayUnion(uid)
        });
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
        await updateDoc(doc(db, 'chats', currentChatTarget.id), {
          admins: arrayRemove(uid)
        });
        toast('⬇️ Jadi member', 'success');
        showMembers();
      } catch (e) { toast('Gagal: ' + e.message, 'error'); }
    });
  });

  $('membersModal').classList.remove('hidden');
}
$('closeMembers')?.addEventListener('click', () => $('membersModal').classList.add('hidden'));

// ===== CHANNELS =====
$('newChannelBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  $('channelModal').classList.remove('hidden');
});
$('closeChannelModal')?.addEventListener('click', () => $('channelModal').classList.add('hidden'));

$('createChannelBtn')?.addEventListener('click', async () => {
  const name = $('channelName').value.trim();
  const desc = $('channelDesc').value.trim();
  if (!name) return toast('Nama saluran wajib!', 'error');

  try {
    const ref = await addDoc(collection(db, 'chats'), {
      type: 'channel',
      name, desc,
      members: [currentUser.uid],
      admins: [currentUser.uid],
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: 'Saluran dibuat',
      lastMessageAt: serverTimestamp()
    });
    toast('✅ Saluran dibuat!', 'success');
    $('channelModal').classList.add('hidden');
    $('channelName').value = '';
    $('channelDesc').value = '';

    // Auto copy link
    const link = `${location.origin}${location.pathname}#channel=${ref.id}`;
    navigator.clipboard.writeText(link).then(() => {
      toast('🔗 Link saluran udah dicopy! Share ke orang', 'success');
    });
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
  if (!list) return;

  const mine = allChannels.filter(c => c.members?.includes(currentUser.uid));
  if (mine.length === 0) {
    list.innerHTML = '<p style="padding:20px;text-align:center;opacity:0.6">Belum ada saluran. Bikin dulu atau gabung pakai link!</p>';
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

// JOIN CHANNEL (via ID / link)
$('joinChannelBtn')?.addEventListener('click', async () => {
  let input = $('joinChannelId').value.trim();
  if (!input) return toast('Paste link / ID!', 'error');

  // Extract ID dari link
  const match = input.match(/[#=]([a-zA-Z0-9_-]+)$/);
  if (match) input = match[1];

  try {
    const ref = doc(db, 'chats', input);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().type !== 'channel') {
      return toast('Saluran gak ditemukan!', 'error');
    }
    const members = snap.data().members || [];
    if (members.includes(currentUser.uid)) return toast('Udah gabung!', 'error');

    await updateDoc(ref, { members: arrayUnion(currentUser.uid) });
    toast('✅ Berhasil gabung!', 'success');
    $('joinChannelId').value = '';
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

// JOIN GROUP via link
async function joinGroupViaLink(groupId) {
  if (!currentUser) { navigate('auth'); return; }
  try {
    const ref = doc(db, 'chats', groupId);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().type !== 'group') {
      return toast('Grup tidak ditemukan', 'error');
    }
    const members = snap.data().members || [];
    if (members.includes(currentUser.uid)) {
      openGroup(groupId, snap.data().name);
      return;
    }
    if (confirm(`Gabung ke grup "${snap.data().name}"?`)) {
      await updateDoc(ref, { members: arrayUnion(currentUser.uid) });
      toast('✅ Gabung grup!', 'success');
      openGroup(groupId, snap.data().name);
    }
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
}

// ===== STORY =====
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
  stories.forEach(s => {
    if (!byUser[s.userId]) byUser[s.userId] = [];
    byUser[s.userId].push(s);
  });

  const addBtn = row.querySelector('.story-add');
  row.innerHTML = '';
  row.appendChild(addBtn);

  Object.entries(byUser).forEach(([uid, items]) => {
    const name = items[0].userName || 'User';
    const el = document.createElement('div');
    el.className = 'story-item';
    el.innerHTML = `
      <div class="story-ring">
        <img src="${items[0].image}" alt="" onerror="this.style.display='none'">
      </div>
      <span>${escapeHtml(name.substring(0, 10))}</span>
    `;
    el.addEventListener('click', () => openStoryViewer(items));
    row.appendChild(el);
  });
}

$('addStoryBtn')?.addEventListener('click', () => {
  if (!currentUser) { navigate('auth'); return; }
  $('storyModal').classList.remove('hidden');
});
$('closeStoryModal')?.addEventListener('click', () => {
  $('storyModal').classList.add('hidden');
  $('storyPreview').innerHTML = '';
  $('storyInput').value = '';
  $('storyInput').dataset.dataUrl = '';
  $('storyCaption').value = '';
});
$('pickStoryImg')?.addEventListener('click', () => $('storyInput').click());
$('storyInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5*1024*1024) return toast('Maks 5 MB', 'error');
  const dataUrl = await compressImage(file, 600, 0.7);
  $('storyPreview').innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:200px;border:3px solid #1a1a1a;border-radius:10px">`;
  $('storyInput').dataset.dataUrl = dataUrl;
});

$('postStoryBtn')?.addEventListener('click', async () => {
  const dataUrl = $('storyInput').dataset.dataUrl;
  if (!dataUrl) return toast('Pilih gambar dulu!', 'error');
  const caption = $('storyCaption').value.trim();

  try {
    await addDoc(collection(db, 'stories'), {
      userId: currentUser.uid,
      userName: currentUser.displayName || 'Anonim',
      image: dataUrl,
      caption,
      createdAt: serverTimestamp()
    });
    toast('✅ Story diposting!', 'success');
    $('storyModal').classList.add('hidden');
    $('storyPreview').innerHTML = '';
    $('storyInput').value = '';
    $('storyInput').dataset.dataUrl = '';
    $('storyCaption').value = '';
  } catch (e) { toast('Gagal: ' + e.message, 'error'); }
});

function openStoryViewer(items) {
  storyIndex = 0;
  $('storyViewer').classList.remove('hidden');

  function showStoryItem() {
    clearTimeout(storyTimer);
    const s = items[storyIndex];
    $('svName').textContent = s.userName || 'User';
    $('svTime').textContent = s.createdAt ? formatTime(s.createdAt) : '';
    $('svAvatar').textContent = getInitial(s.userName);
    $('svAvatar').className = 'avatar small ' + getAvatarColor(s.userName);
    $('svImg').src = s.image;
    $('svCaption').textContent = s.caption || '';
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
    $('storyViewer').classList.add('hidden');
    clearTimeout(storyTimer);
    $('svNext').onclick = null;
    $('svPrev').onclick = null;
    $('svClose').onclick = null;
  }
  $('svNext').onclick = next;
  $('svPrev').onclick = prev;
  $('svClose').onclick = close;
  showStoryItem();
}

// ===== PROFILE =====
async function renderProfile() {
  if (!currentUser) return;
  try {
    await loadUserData();
    const name = currentUser.displayName || currentUserData?.username || 'Anonim';
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userSnap.data() || {};

    const photoURL = userData.photoURL || '';

    $('profileInfo').innerHTML = `
      ${avatarHTML(name, 'big', photoURL)}
      <h3>${escapeHtml(name)}</h3>
      ${userData.bio ? `<p style="font-style:italic">"${escapeHtml(userData.bio)}"</p>` : ''}
      <p>📧 ${escapeHtml(currentUser.email)}</p>
      <p style="font-size:0.75rem;opacity:0.7">🆔 ${escapeHtml(currentUser.uid)}</p>
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
      if (confirm('Logout?')) {
        await signOut(auth);
        toast('👋 Logout', 'success');
        navigate('home');
      }
    });
  } catch (err) { console.error(err); }
}

// ===== SEARCH =====
$('searchToggle')?.addEventListener('click', () => {
  $('searchBar').classList.toggle('hidden');
  if (!$('searchBar').classList.contains('hidden')) $('searchInput').focus();
});
$('searchClose')?.addEventListener('click', () => {
  $('searchBar').classList.add('hidden');
  $('searchInput').value = '';
});
$('searchInput')?.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.post-card').forEach(c => {
    c.style.display = (!term || c.textContent.toLowerCase().includes(term)) ? '' : 'none';
  });
});

// ===== APEX AI (DeepSeek) =====
$('aiForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('aiInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await askAI(text);
});

document.querySelectorAll('.ai-suggest').forEach(btn => {
  btn.addEventListener('click', () => {
    $('aiInput').value = btn.textContent;
    $('aiForm').dispatchEvent(new Event('submit'));
  });
});

import { firebaseConfig, GROQ_API_KEY } from './firebase-config.js';

async function askAI(question) {
  const msgs = $('aiMessages');
  msgs.innerHTML += `<div class="ai-msg ai-user">${escapeHtml(question)}</div>`;
  msgs.innerHTML += `<div class="ai-msg ai-bot ai-typing" id="aiTyping">Apex AI mikir...</div>`;
  msgs.scrollTop = msgs.scrollHeight;

  const systemPrompt = `Kamu adalah "Apex AI"...`; // (sama kayak sebelumnya)

  try {
    // LANGSUNG ke Groq (gak lewat proxy)
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`  // ← key keliatan di browser
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error('API error ' + res.status + ': ' + errText);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || 'Maaf, gw gak bisa jawab sekarang.';
    $('aiTyping')?.remove();
    msgs.innerHTML += `<div class="ai-msg ai-bot">${escapeHtml(reply).replace(/\n/g, '<br>')}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } catch (err) {
    $('aiTyping')?.remove();
    msgs.innerHTML += `<div class="ai-msg ai-bot" style="background:#ffcccc">⚠️ Error: ${escapeHtml(err.message)}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
  initRoute();
  subscribeFeed();
  subscribeHomeFeed();

  // Handle join via link (hash = #group=xxx / #channel=xxx)
  const hash = location.hash;
  if (hash.startsWith('#group=')) {
    const gid = hash.replace('#group=', '');
    setTimeout(() => joinGroupViaLink(gid), 1500);
  } else if (hash.startsWith('#channel=')) {
    const cid = hash.replace('#channel=', '');
    setTimeout(async () => {
      if (!currentUser) { navigate('auth'); return; }
      $('joinChannelId').value = cid;
      navigate('channels');
    }, 1500);
  }
});

setInterval(() => { if (currentUser) updateOnlineStatus(); }, 60000);
window.addEventListener('beforeunload', () => {
  if (currentUser) updateDoc(doc(db, 'users', currentUser.uid), { online: false }).catch(() => {});
});