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
  where, updateDoc, arrayUnion, arrayRemove, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);

// ===== STATE =====
let currentUser = null;
let currentUserData = null;
let currentChatUser = null;
let currentChatId = null;
let unsubscribeChat = null;
let unsubscribeUsers = null;
let unsubscribeMyPosts = null;
let unsubscribeFeed = null;
let unsubscribeHomeFeed = null;
let replyTo = null;
let allUsers = [];

// ===== HELPER =====
const $ = (id) => document.getElementById(id);

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function formatSize(bytes) {
  if (!bytes) return '?';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatPrice(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function translateErr(code) {
  const map = {
    'auth/email-already-in-use': 'Email sudah terdaftar, coba login.',
    'auth/invalid-email': 'Format email salah.',
    'auth/weak-password': 'Password terlalu lemah (min 6 karakter).',
    'auth/user-not-found': 'Akun tidak ditemukan, daftar dulu.',
    'auth/wrong-password': 'Password salah.',
    'auth/invalid-credential': 'Email atau password salah.',
    'auth/missing-password': 'Password wajib diisi.',
    'auth/too-many-requests': 'Terlalu banyak percobaan, coba lagi nanti.',
    'auth/network-request-failed': 'Koneksi bermasalah, cek internet.',
    'permission-denied': 'Akses ditolak. Cek Firestore Rules lu!'
  };
  return map[code] || code;
}

function getInitial(nameOrEmail = '') {
  return (nameOrEmail.charAt(0) || '?').toUpperCase();
}

function getAvatarColor(nameOrEmail = '') {
  let hash = 0;
  for (let i = 0; i < nameOrEmail.length; i++) {
    hash = nameOrEmail.charCodeAt(i) + ((hash << 5) - hash);
  }
  return 'av-' + (Math.abs(hash) % 8);
}

function avatarHTML(name, size = '') {
  return `<div class="avatar ${size} ${getAvatarColor(name)}">${escapeHtml(getInitial(name))}</div>`;
}

let toastTimer = null;
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== ROUTING =====
function navigate(page) {
  history.replaceState(null, '', '#' + page);

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.side-link, .bn-link').forEach(l => l.classList.remove('active'));

  const pageEl = $('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  document.querySelectorAll(`.side-link[data-page="${page}"], .bn-link[data-page="${page}"]`)
    .forEach(l => l.classList.add('active'));

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initRoute() {
  const hash = location.hash.replace('#', '') || 'home';
  navigate(hash);
}

document.querySelectorAll('.side-link, .bn-link, [data-page]').forEach(el => {
  el.addEventListener('click', (e) => {
    const page = el.dataset.page;
    if (page) {
      e.preventDefault();
      navigate(page);
    }
  });
});

// ===== AUTH PAGE (Login/Daftar) =====
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.authtab === mode);
  });
  const uEl = $('authUsername');
  if (uEl) uEl.classList.toggle('hidden', mode !== 'register');
  const doBtn = $('doAuth');
  if (doBtn) doBtn.textContent = mode === 'register' ? 'DAFTAR' : 'LOGIN';
}

// Tab click
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => setAuthMode(tab.dataset.authtab));
});

// Switch link
$('switchAuth')?.addEventListener('click', (e) => {
  e.preventDefault();
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});

// Tombol login di topbar → ke halaman auth
$('topAuthBtn')?.addEventListener('click', () => {
  if (currentUser) {
    navigate('profile');
  } else {
    navigate('auth');
    setAuthMode('login');
  }
});

// Tombol login sidebar
$('sideAuthBtn')?.addEventListener('click', () => {
  if (currentUser) {
    if (confirm('Yakin logout?')) signOut(auth);
  } else {
    navigate('auth');
    setAuthMode('login');
  }
});

// Submit auth
$('doAuth')?.addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const pass = $('authPassword').value;
  const uname = $('authUsername').value.trim() || email.split('@')[0];

  if (!email || !pass) return toast('Email & password wajib diisi!', 'error');
  if (pass.length < 6) return toast('Password minimal 6 karakter!', 'error');

  const btn = $('doAuth');
  btn.disabled = true;
  btn.textContent = 'LOADING...';

  try {
    if (authMode === 'register') {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: uname });
      try {
        await setDoc(doc(db, 'users', cred.user.uid), {
          username: uname, email, createdAt: serverTimestamp()
        });
      } catch (e) { console.warn('setDoc user gagal:', e); }
      toast('✅ Daftar sukses! Selamat datang ' + uname, 'success');
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
      toast('✅ Login berhasil!', 'success');
    }
    $('authEmail').value = '';
    $('authPassword').value = '';
    $('authUsername').value = '';
    navigate('home');
  } catch (e) {
    toast('Gagal: ' + translateErr(e.code), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'register' ? 'DAFTAR' : 'LOGIN';
  }
});

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    const name = user.displayName || user.email;
    $('topAuthBtn').textContent = getInitial(name);
    $('topAuthBtn').className = 'top-avatar ' + getAvatarColor(name);
    $('topAuthBtn').style.cssText = 'width:42px;height:42px;padding:0;border-radius:50%;border:3px solid #1a1a1a;font-family:"Bangers",cursive;font-size:1.2rem;color:white;cursor:pointer;box-shadow:3px 3px 0 #1a1a1a;display:flex;align-items:center;justify-content:center;';

    const sideAv = $('sideAvatar');
    sideAv.textContent = getInitial(name);
    sideAv.className = 'avatar ' + getAvatarColor(name);
    $('sideName').textContent = name;
    $('sideAuthBtn').textContent = 'LOGOUT';

    await loadUserData();
    subscribeUsers();
    subscribeMyPosts();
    updateOnlineStatus();
    renderProfile();
  } else {
    $('topAuthBtn').textContent = 'LOGIN';
    $('topAuthBtn').className = 'btn-login-top';
    $('topAuthBtn').style.cssText = '';

    const sideAv = $('sideAvatar');
    sideAv.textContent = '?';
    sideAv.className = 'avatar';
    $('sideName').textContent = 'Guest';
    $('sideAuthBtn').textContent = 'LOGIN';

    if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
    if (unsubscribeMyPosts) { unsubscribeMyPosts(); unsubscribeMyPosts = null; }
    if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }

    $('profileInfo').innerHTML = '<p>Login dulu untuk lihat profil...</p>';
    $('chatList').innerHTML = '<p style="padding:10px">Login dulu untuk lihat user...</p>';
    $('myPosts').innerHTML = '<p style="padding:20px">Login buat lihat barang lu...</p>';
    $('chatMessages').innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Belum ada chat dipilih</p>';
    $('chatHeader').innerHTML = '<span>Pilih chat dulu...</span>';
  }
});

// ===== LOAD USER =====
async function loadUserData() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    currentUserData = snap.exists() ? snap.data() : {
      username: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email
    };
  } catch (e) {
    currentUserData = {
      username: currentUser.displayName || currentUser.email.split('@')[0],
      email: currentUser.email
    };
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

// ===== POST =====
$('postForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { toast('Login dulu bos!', 'error'); navigate('auth'); return; }

  const title = $('postTitle').value.trim();
  const desc = $('postDesc').value.trim();
  const price = Number($('postPrice').value);
  const image = $('postImage').value.trim() ||
    'https://via.placeholder.com/300x180/FFD93D/000?text=No+Image';

  if (!title || !desc || isNaN(price)) return toast('Isi semua field!', 'error');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'POSTING...';

  try {
    await addDoc(collection(db, 'posts'), {
      title, desc, price, image,
      sellerId: currentUser.uid,
      sellerName: currentUser.displayName || currentUserData?.username || 'Anonim',
      sellerEmail: currentUser.email,
      likes: [],
      createdAt: serverTimestamp()
    });
    e.target.reset();
    toast('✅ Postingan berhasil!', 'success');
    navigate('feed');
  } catch (err) {
    toast('Error: ' + translateErr(err.code || err.message), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 POSTING!';
  }
});

// ===== POST CARD =====
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
        : `<button class="btn-pop" data-chat="${id}">💬 CHAT</button>`}
    </div>
  `;
}

function bindPostActions(container) {
  container.querySelectorAll('[data-chat]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser) { navigate('auth'); return; }
      const card = btn.closest('.post-card');
      const sellerId = card.dataset.sellerId;
      const sellerName = card.dataset.sellerName;
      if (sellerId === currentUser.uid) return toast('Ini barang lu sendiri 😅', 'error');
      startChat(sellerId, sellerName);
    });
  });

  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus postingan ini?')) return;
      try {
        await deleteDoc(doc(db, 'posts', btn.dataset.delete));
        toast('🗑️ Postingan dihapus', 'success');
      } catch (e) { toast('Gagal hapus: ' + e.message, 'error'); }
    });
  });

  container.querySelectorAll('[data-like]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentUser) { navigate('auth'); return; }
      const postId = btn.dataset.like;
      const liked = btn.classList.contains('liked');
      try {
        await updateDoc(doc(db, 'posts', postId), {
          likes: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
        });
      } catch (e) { toast('Gagal like: ' + e.message, 'error'); }
    });
  });
}

// ===== SUBSCRIPTIONS =====
function subscribeFeed() {
  if (unsubscribeFeed) unsubscribeFeed();
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
  unsubscribeFeed = onSnapshot(q, (snap) => {
    const list = $('feedList');
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<p style="padding:20px">Belum ada postingan. Jadi yang pertama!</p>';
      return;
    }
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
  }, (err) => {
    $('feedList').innerHTML = `<p style="padding:20px;color:red">Error: ${translateErr(err.code)}</p>`;
  });
}

function subscribeHomeFeed() {
  if (unsubscribeHomeFeed) unsubscribeHomeFeed();
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(6));
  unsubscribeHomeFeed = onSnapshot(q, (snap) => {
    const list = $('homeFeed');
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<p style="padding:20px">Belum ada barang. Yuk mulai jualan!</p>';
      return;
    }
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

  const q = query(
    collection(db, 'posts'),
    where('sellerId', '==', currentUser.uid),
    orderBy('createdAt', 'desc')
  );

  unsubscribeMyPosts = onSnapshot(q, (snap) => {
    const list = $('myPosts');
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<p style="padding:20px">Lu belum jualan apa-apa. Yuk posting!</p>';
      return;
    }
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

function subscribeUsers() {
  if (unsubscribeUsers) unsubscribeUsers();

  unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
    allUsers = [];
    const listEl = $('chatList');
    listEl.innerHTML = '';

    snap.forEach(u => {
      if (u.id === currentUser.uid) return;
      const data = u.data();
      allUsers.push({ uid: u.id, ...data });

      const name = data.username || data.email || 'User';
      const isOnline = data.online && data.lastSeen &&
        (Date.now() - data.lastSeen.seconds * 1000) < 120000;

      const el = document.createElement('div');
      el.className = 'chat-user';
      el.dataset.uid = u.id;
      if (currentChatUser && currentChatUser.uid === u.id) el.classList.add('active');
      el.innerHTML = `
        ${avatarHTML(name, 'small')}
        <div class="u-name">${escapeHtml(name)}</div>
        ${isOnline ? '<div class="online-dot"></div>' : ''}
      `;
      el.addEventListener('click', () => startChat(u.id, name));
      listEl.appendChild(el);
    });

    if (allUsers.length === 0) {
      listEl.innerHTML = '<p style="padding:10px">Belum ada user lain...</p>';
    }
  }, (err) => {
    $('chatList').innerHTML = `<p style="padding:10px;color:red">${translateErr(err.code)}</p>`;
  });
}

// ===== CHAT =====
function getChatId(a, b) { return [a, b].sort().join('_'); }

function startChat(otherId, otherName) {
  if (!currentUser) { navigate('auth'); return; }
  if (otherId === currentUser.uid) return;

  currentChatUser = { uid: otherId, name: otherName };
  currentChatId = getChatId(currentUser.uid, otherId);

  navigate('dm');

  const otherUser = allUsers.find(u => u.uid === otherId);
  const isOnline = otherUser?.online && otherUser?.lastSeen &&
    (Date.now() - otherUser.lastSeen.seconds * 1000) < 120000;

  $('chatHeader').innerHTML = `
    ${avatarHTML(otherName, 'small')}
    <div>
      <div style="font-size:1rem">${escapeHtml(otherName)}</div>
      <div style="font-size:0.7rem;opacity:0.9">${isOnline ? '🟢 Online' : '⚫ Offline'}</div>
    </div>
  `;

  document.querySelectorAll('.chat-user').forEach(el => {
    el.classList.toggle('active', el.dataset.uid === otherId);
  });

  clearReply();
  loadMessages();
}

function loadMessages() {
  if (unsubscribeChat) unsubscribeChat();
  const msgsEl = $('chatMessages');
  msgsEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Memuat chat...</p>';

  const q = query(
    collection(db, 'chats', currentChatId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200)
  );

  unsubscribeChat = onSnapshot(q, (snap) => {
    msgsEl.innerHTML = '';
    if (snap.empty) {
      msgsEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Belum ada pesan. Mulai chat!</p>';
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
    ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : '';

  let replyHTML = '';
  if (m.replyTo) {
    replyHTML = `<div class="reply-quote"><b>${escapeHtml(m.replyTo.name || 'User')}</b><div>${escapeHtml((m.replyTo.text || '').substring(0, 60))}</div></div>`;
  }

  let content = '';
  if (m.type === 'image') {
    content = `<img src="${m.url}" alt="gambar" onerror="this.alt='Gagal load'">`;
    setTimeout(() => {
      const img = div.querySelector('img');
      if (img) img.addEventListener('click', () => window.openImage(m.url));
    }, 0);
    if (m.text) content = `<p>${escapeHtml(m.text)}</p>` + content;
  } else if (m.type === 'voice') {
    content = `<div>🎤 Voice Note (${m.duration || 0}s)</div><audio controls preload="metadata" src="${m.url}"></audio>`;
  } else if (m.type === 'file') {
    content = `<a href="${m.url}" target="_blank" rel="noopener" download="${escapeHtml(m.fileName)}" class="file-link">📎 ${escapeHtml(m.fileName)} <span style="opacity:0.7">(${formatSize(m.size)})</span></a>`;
  } else {
    content = `<span>${escapeHtml(m.text || '')}</span>`;
  }

  div.innerHTML = replyHTML + content + `<span class="time">${time}</span>`;
  div.addEventListener('dblclick', () => setReply(m, msgId));
  return div;
}

function setReply(m, msgId) {
  replyTo = {
    msgId,
    name: m.senderId === currentUser.uid ? 'Lu' : (currentChatUser?.name || 'User'),
    text: m.text || (m.type === 'image' ? '[Gambar]' : m.type === 'voice' ? '[VN]' : '[File]')
  };
  $('replyBar').classList.remove('hidden');
  $('replyName').textContent = '↩ ' + replyTo.name;
  $('replyText').textContent = replyTo.text;
  $('chatInput').focus();
}

function clearReply() {
  replyTo = null;
  $('replyBar').classList.add('hidden');
}

$('replyClose')?.addEventListener('click', clearReply);

// ===== SEND TEXT =====
$('chatForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatUser) return toast('Pilih chat dulu!', 'error');

  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  try {
    await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
      type: 'text', text, replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
    clearReply();
  } catch (err) {
    toast('Gagal kirim: ' + err.message, 'error');
    input.value = text;
  }
});

// ===== IMAGE PREVIEW =====
window.openImage = (url) => {
  const modal = document.createElement('div');
  modal.id = 'imgPreviewModal';
  modal.innerHTML = `<img src="${url}">`;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
};

// ===== UPLOAD BAR =====
function showUploadBar(show, pct = 0, label = 'Processing...') {
  const bar = $('uploadBar');
  if (!bar) return;
  const fill = $('uploadFill');
  const text = $('uploadText');
  if (show) {
    bar.classList.remove('hidden');
    fill.style.width = pct + '%';
    text.textContent = `${label} ${Math.round(pct)}%`;
  } else {
    bar.classList.add('hidden');
    fill.style.width = '0%';
  }
}

// ===== MEDIA HELPERS =====
function compressImage(file, maxSize = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxSize) { height = (height / width) * maxSize; width = maxSize; }
        else if (height > maxSize) { width = (width / height) * maxSize; height = maxSize; }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
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

function audioBlobToBase64(blob) { return fileToBase64(blob); }

// ===== SEND IMAGE =====
$('imgBtn')?.addEventListener('click', () => $('imgInput').click());

$('imgInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatUser) return toast('Pilih chat dulu!', 'error');
  if (!file.type.startsWith('image/')) return toast('Harus gambar!', 'error');
  if (file.size > 10 * 1024 * 1024) return toast('Maks 10 MB!', 'error');

  try {
    showUploadBar(true, 30, 'Compress...');
    const dataUrl = await compressImage(file, 800, 0.7);
    showUploadBar(true, 70, 'Menyimpan...');

    if (dataUrl.length > 900 * 1024) return toast('Gambar terlalu besar. Coba lain.', 'error');

    await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
      type: 'image', url: dataUrl, text: '', replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
    clearReply();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
  finally { setTimeout(() => showUploadBar(false), 500); }
});

// ===== SEND FILE =====
$('fileBtn')?.addEventListener('click', () => $('fileInput').click());

$('fileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatUser) return toast('Pilih chat dulu!', 'error');
  if (file.size > 700 * 1024) return toast('Maks 700 KB (tanpa storage)', 'error');

  try {
    showUploadBar(true, 50, 'Encode...');
    const dataUrl = await fileToBase64(file);
    showUploadBar(true, 90, 'Menyimpan...');

    await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
      type: 'file', url: dataUrl, fileName: file.name, size: file.size, mime: file.type, replyTo,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
    clearReply();
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
  finally { setTimeout(() => showUploadBar(false), 500); }
});

// ===== VOICE NOTE =====
let mediaRecorder = null;
let audioChunks = [];
let recStartTime = 0;
let recTimer = null;
let recStream = null;
let cancelled = false;
const MAX_VN_SECONDS = 60;

$('vnBtn')?.addEventListener('click', async () => {
  if (!currentUser) { navigate('auth'); return; }
  if (!currentChatUser) return toast('Pilih chat dulu!', 'error');
  if (mediaRecorder && mediaRecorder.state === 'recording') return;

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

    audioChunks = [];
    cancelled = false;

    mediaRecorder.addEventListener('dataavailable', ev => {
      if (ev.data.size > 0) audioChunks.push(ev.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
      recStream?.getTracks().forEach(t => t.stop());
      clearInterval(recTimer);
      $('recordingBar').classList.add('hidden');
      $('vnBtn').classList.remove('recording');

      if (cancelled || audioChunks.length === 0) return;

      const duration = Math.max(1, Math.round((Date.now() - recStartTime) / 1000));
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

      if (blob.size > 700 * 1024) return toast('VN terlalu besar, coba lebih pendek', 'error');

      try {
        showUploadBar(true, 50, 'Encode VN...');
        const dataUrl = await audioBlobToBase64(blob);
        showUploadBar(true, 90, 'Menyimpan...');

        await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
          type: 'voice', url: dataUrl, duration, replyTo,
          senderId: currentUser.uid,
          senderName: currentUser.displayName || 'Anonim',
          createdAt: serverTimestamp()
        });
        clearReply();
      } catch (err) { toast('Gagal kirim VN: ' + err.message, 'error'); }
      finally { setTimeout(() => showUploadBar(false), 500); }
    });

    mediaRecorder.start();
    recStartTime = Date.now();
    $('recordingBar').classList.remove('hidden');
    $('vnBtn').classList.add('recording');
    $('recTime').textContent = '0:00';

    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStartTime) / 1000);
      $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= MAX_VN_SECONDS && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 200);

  } catch (err) { toast('Gak bisa akses mic: ' + err.message, 'error'); }
});

$('stopRec')?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
});

$('cancelRec')?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    cancelled = true;
    audioChunks = [];
    mediaRecorder.stop();
  }
});

// ===== PROFILE =====
async function renderProfile() {
  if (!currentUser) return;
  try {
    await loadUserData();
    const name = currentUser.displayName || currentUserData?.username || 'Anonim';
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userSnap.data() || {};

    $('profileInfo').innerHTML = `
      ${avatarHTML(name, 'big')}
      <h3>${escapeHtml(name)}</h3>
      <p>📧 ${escapeHtml(currentUser.email)}</p>
      <p style="font-size:0.75rem;opacity:0.7">🆔 ${escapeHtml(currentUser.uid)}</p>
      <div class="profile-stats">
        <div class="stat"><b>${userData.totalPosts || 0}</b><span>Jualan</span></div>
        <div class="stat"><b>${userData.totalChats || 0}</b><span>Chat</span></div>
        <div class="stat"><b>⭐</b><span>Baru</span></div>
      </div>
      <p style="font-size:0.85rem">📅 Joined: ${userData.createdAt
        ? new Date(userData.createdAt.seconds * 1000).toLocaleDateString('id-ID')
        : '-'}</p>
      <button class="btn-pop btn-cancel" id="logoutBtn" style="margin-top:20px;width:100%">🚪 LOGOUT</button>
    `;

    $('logoutBtn')?.addEventListener('click', async () => {
      if (confirm('Yakin logout?')) {
        await signOut(auth);
        toast('👋 Logout sukses', 'success');
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
  if (!term) return;
  document.querySelectorAll('.post-card').forEach(c => {
    c.style.display = c.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
});

// ===== INIT =====
window.addEventListener('DOMContentLoaded', () => {
  initRoute();
  subscribeFeed();
  subscribeHomeFeed();
  window.addEventListener('hashchange', initRoute);
});

setInterval(() => { if (currentUser) updateOnlineStatus(); }, 60000);

window.addEventListener('beforeunload', () => {
  if (currentUser) {
    updateDoc(doc(db, 'users', currentUser.uid), { online: false }).catch(() => {});
  }
});