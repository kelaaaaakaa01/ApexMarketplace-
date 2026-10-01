import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query,
  orderBy, serverTimestamp, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ===== INIT =====
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let currentChatUser = null;
let unsubscribeChat = null;
let unsubscribeUsers = null;

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
    'auth/network-request-failed': 'Koneksi bermasalah, cek internet.'
  };
  return map[code] || code;
}

// ===== TAB NAVIGATION =====
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  });
});

// ===== LOGIN MODAL =====
const loginModal = $('loginModal');
$('loginBtn').addEventListener('click', () => loginModal.classList.remove('hidden'));
$('closeModal').addEventListener('click', () => loginModal.classList.add('hidden'));

// REGISTER
$('doRegister').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const pass = $('password').value;
  const uname = $('username').value.trim() || email.split('@')[0];

  if (!email || !pass) return alert('Email & password wajib diisi!');
  if (pass.length < 6) return alert('Password minimal 6 karakter!');

  $('doRegister').disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: uname });
    await setDoc(doc(db, 'users', cred.user.uid), {
      username: uname,
      email: email,
      createdAt: serverTimestamp()
    });
    alert('✅ Daftar sukses! Selamat datang ' + uname);
    loginModal.classList.add('hidden');
    $('email').value = '';
    $('password').value = '';
    $('username').value = '';
  } catch (e) {
    alert('Gagal daftar: ' + translateErr(e.code));
  } finally {
    $('doRegister').disabled = false;
  }
});

// LOGIN
$('doLogin').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const pass = $('password').value;

  if (!email || !pass) return alert('Email & password wajib diisi!');

  $('doLogin').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    alert('✅ Login berhasil!');
    loginModal.classList.add('hidden');
    $('email').value = '';
    $('password').value = '';
    $('username').value = '';
  } catch (e) {
    alert('Gagal login: ' + translateErr(e.code));
  } finally {
    $('doLogin').disabled = false;
  }
});

// LOGOUT
$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('Yakin mau logout?')) return;
  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
  currentChatUser = null;
  await signOut(auth);
});

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const nameEl = $('userName');

  if (user) {
    nameEl.textContent = user.displayName || user.email;
    $('loginBtn').classList.add('hidden');
    $('logoutBtn').classList.remove('hidden');

    // Pastikan user doc ada
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        username: user.displayName || user.email.split('@')[0],
        email: user.email,
        createdAt: serverTimestamp()
      });
    }

    renderProfile();
    subscribeUsers();
  } else {
    nameEl.textContent = 'Guest';
    $('loginBtn').classList.remove('hidden');
    $('logoutBtn').classList.add('hidden');
    $('profileInfo').innerHTML = '<p>Login dulu untuk lihat profil...</p>';
    $('chatList').innerHTML = '<p style="padding:10px">Login dulu untuk lihat user...</p>';
    $('chatMessages').innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Belum ada chat dipilih</p>';
    $('chatHeader').textContent = 'Pilih chat dulu...';
    if (unsubscribeUsers) { unsubscribeUsers(); unsubscribeUsers = null; }
  }
});

// ===== POST JUALAN =====
$('postForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return alert('Login dulu bos!');

  const title = $('postTitle').value.trim();
  const desc = $('postDesc').value.trim();
  const price = Number($('postPrice').value);
  const image = $('postImage').value.trim() ||
    'https://via.placeholder.com/300x180/FFD93D/000?text=No+Image';

  if (!title || !desc || isNaN(price)) return alert('Isi semua field dengan benar!');

  try {
    await addDoc(collection(db, 'posts'), {
      title, desc, price, image,
      sellerId: currentUser.uid,
      sellerName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
    e.target.reset();
    alert('✅ Postingan berhasil!');
    document.querySelector('[data-tab="feed"]').click();
  } catch (err) {
    alert('Error: ' + err.message);
  }
});

// ===== FEED REALTIME =====
const feedQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
onSnapshot(feedQuery, (snap) => {
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
    card.innerHTML = `
      <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" onerror="this.src='https://via.placeholder.com/300x180'">
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(p.desc)}</p>
      <span class="price">Rp ${Number(p.price || 0).toLocaleString('id-ID')}</span>
      <p style="font-size:0.85rem;margin-top:8px"><b>👤 ${escapeHtml(p.sellerName)}</b></p>
      <div class="actions">
        <button class="btn-pop chatBtn">💬 CHAT</button>
      </div>
    `;
    card.querySelector('.chatBtn').addEventListener('click', () => {
      if (!currentUser) return alert('Login dulu!');
      if (p.sellerId === currentUser.uid) return alert('Ini barang lu sendiri 😅');
      startChat(p.sellerId, p.sellerName);
    });
    list.appendChild(card);
  });
});

// ===== CHAT — DAFTAR USER =====
function subscribeUsers() {
  if (unsubscribeUsers) unsubscribeUsers();

  unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
    const listEl = $('chatList');
    listEl.innerHTML = '';
    let found = false;

    snap.forEach(u => {
      if (u.id === currentUser.uid) return;
      found = true;
      const data = u.data();
      const name = data.username || data.email || 'User';
      const el = document.createElement('div');
      el.className = 'chat-user';
      el.textContent = '👤 ' + name;
      el.dataset.uid = u.id;
      if (currentChatUser && currentChatUser.uid === u.id) el.classList.add('active');
      el.addEventListener('click', () => startChat(u.id, name));
      listEl.appendChild(el);
    });

    if (!found) {
      listEl.innerHTML = '<p style="padding:10px">Belum ada user lain...</p>';
    }
  });
}

// ===== CHAT ID (SORTED) =====
function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

// ===== START CHAT =====
function startChat(otherId, otherName) {
  if (!currentUser) return alert('Login dulu!');
  if (otherId === currentUser.uid) return;

  currentChatUser = { uid: otherId, name: otherName };

  // UI aktif
  document.querySelectorAll('.chat-user').forEach(el => {
    el.classList.toggle('active', el.dataset.uid === otherId);
  });

  $('chatHeader').textContent = '💬 ' + otherName;

  const chatId = getChatId(currentUser.uid, otherId);
  $('chatForm').dataset.chatId = chatId;

  const msgsEl = $('chatMessages');
  msgsEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Memuat chat...</p>';

  if (unsubscribeChat) unsubscribeChat();

  const q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('createdAt', 'asc')
  );

  unsubscribeChat = onSnapshot(q, (snap) => {
    msgsEl.innerHTML = '';

    if (snap.empty) {
      msgsEl.innerHTML = '<p style="text-align:center;opacity:0.6;padding:20px">Belum ada pesan. Mulai chat!</p>';
      return;
    }

    snap.forEach(d => {
      msgsEl.appendChild(buildMessage(d.data()));
    });

    msgsEl.scrollTop = msgsEl.scrollHeight;
  }, (err) => {
    console.error(err);
    msgsEl.innerHTML = '<p style="text-align:center;color:red;padding:20px">Gagal load chat: ' + err.message + '</p>';
  });
}

// ===== BUILD MESSAGE =====
function buildMessage(m) {
  const div = document.createElement('div');
  const isMe = m.senderId === currentUser.uid;
  div.className = 'msg ' + (isMe ? 'me' : 'other');

  const time = m.createdAt
    ? new Date(m.createdAt.seconds * 1000).toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit'
      })
    : '';

  let content = '';

  if (m.type === 'image') {
    content = `<img src="${escapeHtml(m.url)}" alt="gambar"
      onclick="window.openImage('${escapeHtml(m.url)}')"
      onerror="this.alt='Gagal load gambar'">`;
    if (m.text) content = `<p>${escapeHtml(m.text)}</p>` + content;
  } else if (m.type === 'voice') {
    content = `
      <div>🎤 Voice Note (${m.duration || 0}s)</div>
      <audio controls preload="metadata" src="${escapeHtml(m.url)}"></audio>
    `;
  } else if (m.type === 'file') {
    content = `
      <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" download="${escapeHtml(m.fileName)}" class="file-link">
        📎 ${escapeHtml(m.fileName)} <span style="opacity:0.7">(${formatSize(m.size)})</span>
      </a>
    `;
  } else {
    content = `<span>${escapeHtml(m.text || '')}</span>`;
  }

  div.innerHTML = content + `<span class="time">${time}</span>`;
  return div;
}

// ===== KIRIM PESAN TEKS =====
$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return alert('Login dulu!');
  if (!currentChatUser) return alert('Pilih chat dulu!');

  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;

  const chatId = e.target.dataset.chatId;
  input.value = '';

  try {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      type: 'text',
      text,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
  } catch (err) {
    alert('Gagal kirim: ' + err.message);
    input.value = text;
  }
});

// ===== IMAGE PREVIEW GLOBAL =====
window.openImage = (url) => {
  const modal = document.createElement('div');
  modal.id = 'imgPreviewModal';
  modal.innerHTML = `<img src="${url}">`;
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
};

// ===== UPLOAD HELPER =====
function uploadFile(file, chatId, onProgress) {
  return new Promise((resolve, reject) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `chats/${chatId}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);

    task.on('state_changed',
      snap => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        onProgress?.(pct);
      },
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) { reject(err); }
      }
    );
  });
}

function showUploadBar(show, pct = 0) {
  const bar = $('uploadBar');
  const fill = $('uploadFill');
  const text = $('uploadText');
  if (show) {
    bar.classList.remove('hidden');
    fill.style.width = pct + '%';
    text.textContent = `Uploading... ${Math.round(pct)}%`;
  } else {
    bar.classList.add('hidden');
    fill.style.width = '0%';
  }
}

// ===== KIRIM GAMBAR =====
$('imgBtn').addEventListener('click', () => $('imgInput').click());

$('imgInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!currentChatUser) return alert('Pilih chat dulu!');
  if (file.size > 5 * 1024 * 1024) return alert('Maks 5 MB!');

  const chatId = $('chatForm').dataset.chatId;
  try {
    showUploadBar(true, 0);
    const url = await uploadFile(file, chatId, p => showUploadBar(true, p));
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      type: 'image',
      url,
      text: '',
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
  } catch (err) {
    alert('Gagal upload: ' + err.message);
  } finally {
    showUploadBar(false);
  }
});

// ===== KIRIM FILE =====
$('fileBtn').addEventListener('click', () => $('fileInput').click());

$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!currentChatUser) return alert('Pilih chat dulu!');
  if (file.size > 10 * 1024 * 1024) return alert('Maks 10 MB!');

  const chatId = $('chatForm').dataset.chatId;
  try {
    showUploadBar(true, 0);
    const url = await uploadFile(file, chatId, p => showUploadBar(true, p));
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      type: 'file',
      url,
      fileName: file.name,
      size: file.size,
      mime: file.type,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Anonim',
      createdAt: serverTimestamp()
    });
  } catch (err) {
    alert('Gagal upload: ' + err.message);
  } finally {
    showUploadBar(false);
  }
});

// ===== VOICE NOTE =====
let mediaRecorder = null;
let audioChunks = [];
let recStartTime = 0;
let recTimer = null;
let recStream = null;
let cancelled = false;

$('vnBtn').addEventListener('click', async () => {
  if (!currentUser) return alert('Login dulu!');
  if (!currentChatUser) return alert('Pilih chat dulu!');
  if (mediaRecorder && mediaRecorder.state === 'recording') return;

  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Pilih mime yang didukung
    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
      else mimeType = '';
    }

    mediaRecorder = mimeType
      ? new MediaRecorder(recStream, { mimeType })
      : new MediaRecorder(recStream);

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
      const ext = (mediaRecorder.mimeType || '').includes('mp4') ? 'm4a'
                : (mediaRecorder.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `vn_${Date.now()}.${ext}`, { type: blob.type });

      const chatId = $('chatForm').dataset.chatId;
      try {
        showUploadBar(true, 0);
        const url = await uploadFile(file, chatId, p => showUploadBar(true, p));
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          type: 'voice',
          url,
          duration,
          senderId: currentUser.uid,
          senderName: currentUser.displayName || 'Anonim',
          createdAt: serverTimestamp()
        });
      } catch (err) {
        alert('Gagal kirim VN: ' + err.message);
      } finally {
        showUploadBar(false);
      }
    });

    mediaRecorder.start();
    recStartTime = Date.now();
    $('recordingBar').classList.remove('hidden');
    $('vnBtn').classList.add('recording');
    $('recTime').textContent = '0:00';

    recTimer = setInterval(() => {
      const s = Math.round((Date.now() - recStartTime) / 1000);
      $('recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 200);

  } catch (err) {
    alert('Gak bisa akses mic: ' + err.message);
  }
});

$('stopRec').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
});

$('cancelRec').addEventListener('click', () => {
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
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    const data = snap.data() || {};
    $('profileInfo').innerHTML = `
      <h3 style="font-family:'Bangers';font-size:2rem">👤 ${escapeHtml(currentUser.displayName || 'Anonim')}</h3>
      <p><b>📧 Email:</b> ${escapeHtml(currentUser.email)}</p>
      <p><b>🆔 UID:</b> ${escapeHtml(currentUser.uid)}</p>
      <p><b>📅 Joined:</b> ${data.createdAt
        ? new Date(data.createdAt.seconds * 1000).toLocaleDateString('id-ID')
        : '-'}</p>
    `;
  } catch (err) {
    console.error(err);
  }
}