// 📁 api/deploy-upload.js
// Upload file project (HTML/CSS/JS) → deploy ke Vercel

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'VERCEL_TOKEN belum di-set di Vercel' });
  }

  try {
    const { name, files } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Nama website wajib diisi' });
    }
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'File wajib diisi' });
    }
    if (files.length > 100) {
      return res.status(400).json({ error: 'Maks 100 file per project' });
    }

    const cleanName = name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    if (!cleanName) {
      return res.status(400).json({ error: 'Nama project gak valid' });
    }

    // Siapin file list
    const vercelFiles = files.map(f => ({
      file: f.file,
      data: f.data,
      encoding: 'base64'
    }));

    // Total size check
    let totalSize = 0;
    for (const f of files) {
      totalSize += (f.data?.length || 0) * 0.75;
    }
    if (totalSize > 50 * 1024 * 1024) {
      return res.status(413).json({ error: 'Total file terlalu besar (maks 50MB)' });
    }

    const totalBytes = Math.round(totalSize);

    // Deploy ke Vercel
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: cleanName,
        target: 'production',
        files: vercelFiles,
        projectSettings: {
          framework: null
        }
      })
    });

    const deployData = await deployRes.json();

    if (!deployRes.ok) {
      console.error('Vercel error:', deployData);
      return res.status(deployRes.status).json({
        error: deployData.error?.message || 'Deploy gagal',
        details: deployData
      });
    }

    const deployUrl = deployData.url ? `https://${deployData.url}` : null;

    return res.status(200).json({
      success: true,
      message: '🚀 Website berhasil di-deploy!',
      deployment: {
        id: deployData.id,
        name: cleanName,
        url: deployUrl,
        inspectorUrl: deployData.inspectorUrl,
        readyState: deployData.readyState,
        fileCount: files.length,
        totalBytes
      }
    });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}