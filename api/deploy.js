/**
 * Vercel deployment endpoint.
 *
 * Required Vercel Environment Variable:
 *   VERCEL_API_KEY = your Vercel token
 *
 * The browser never receives the Vercel token.
 * The client sends the Firebase ID token so this endpoint can require login.
 *
 * Optional:
 *   VERCEL_TEAM_ID = team_xxx
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 3;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function sanitizeName(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

/*
 * Verifies a Firebase ID token through Google's Identity Toolkit REST API.
 * This avoids putting a Firebase Admin service-account key in this project.
 */
async function verifyFirebaseToken(idToken) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error('FIREBASE_WEB_API_KEY belum diset di Vercel.');
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.users && data.users[0] ? data.users[0] : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'method_not_allowed', message: 'Gunakan POST.' });
  }

  const vercelKey = process.env.VERCEL_API_KEY;
  if (!vercelKey) {
    return json(res, 500, {
      error: 'missing_vercel_key',
      message: 'VERCEL_API_KEY belum diset di Vercel Environment Variables.'
    });
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!idToken) {
    return json(res, 401, {
      error: 'login_required',
      message: 'Login Firebase diperlukan sebelum deploy.'
    });
  }

  try {
    const firebaseUser = await verifyFirebaseToken(idToken);
    if (!firebaseUser) {
      return json(res, 401, {
        error: 'invalid_firebase_token',
        message: 'Sesi login Firebase tidak valid atau sudah kedaluwarsa.'
      });
    }

    const body = req.body || {};
    const name = sanitizeName(body.name);
    const files = Array.isArray(body.files) ? body.files : [];

    if (!name) {
      return json(res, 400, {
        error: 'invalid_name',
        message: 'Nama project tidak valid.'
      });
    }

    if (files.length < 1 || files.length > MAX_FILES) {
      return json(res, 400, {
        error: 'invalid_files',
        message: 'Deployment harus berisi 1 sampai 3 file.'
      });
    }

    const allowed = new Set(['index.html', 'style.css', 'script.js']);
    const seen = new Set();
    let totalBytes = 0;

    const vercelFiles = [];

    for (const item of files) {
      const file = String(item?.file || '');
      const content = String(item?.data || '');

      if (!allowed.has(file) || seen.has(file)) {
        return json(res, 400, {
          error: 'invalid_file',
          message: `File tidak diizinkan: ${file}`
        });
      }

      if (!content) {
        return json(res, 400, {
          error: 'empty_file',
          message: `${file} kosong.`
        });
      }

      const size = byteLength(content);
      if (size > MAX_FILE_BYTES) {
        return json(res, 400, {
          error: 'file_too_large',
          message: `${file} maksimal 2 MB.`
        });
      }

      totalBytes += size;
      seen.add(file);
      vercelFiles.push({ file, data: content });
    }

    if (!seen.has('index.html')) {
      return json(res, 400, {
        error: 'missing_index',
        message: 'index.html wajib ada.'
      });
    }

    if (totalBytes > 5 * 1024 * 1024) {
      return json(res, 400, {
        error: 'payload_too_large',
        message: 'Total file deployment maksimal 5 MB.'
      });
    }

    const teamId = process.env.VERCEL_TEAM_ID;
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';

    const vercelResponse = await fetch(`https://api.vercel.com/v13/deployments${query}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        files: vercelFiles,
        target: 'production'
      })
    });

    const result = await vercelResponse.json().catch(() => ({}));

    if (!vercelResponse.ok) {
      const message =
        result?.error?.message ||
        result?.message ||
        'Vercel menolak deployment.';
      return json(res, vercelResponse.status, {
        error: 'vercel_error',
        message
      });
    }

    const url = result.url
      ? (result.url.startsWith('http') ? result.url : `https://${result.url}`)
      : '';

    return json(res, 200, {
      ok: true,
      url,
      deploymentId: result.id || result.uid || null,
      projectId: result.projectId || null,
      owner: firebaseUser.localId || null
    });
  } catch (error) {
    console.error('deploy error:', error);
    return json(res, 500, {
      error: 'server_error',
      message: error.message || 'Terjadi kesalahan server.'
    });
  }
};
