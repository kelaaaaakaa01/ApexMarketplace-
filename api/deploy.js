// 📁 api/deploy.js
// Deploy Vercel via API Token

// ⚠️ GANTI dengan nama project Vercel lu
const VERCEL_PROJECT_NAME = 'apexmarketplace';

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
    // 1. Cari project by name
    const projectRes = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_NAME}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const projectData = await projectRes.json();

    if (!projectRes.ok) {
      return res.status(projectRes.status).json({
        error: projectData.error?.message || 'Project gak ditemukan'
      });
    }

    const projectId = projectData.id;

    // 2. Ambil deployment terakhir
    const listRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    const lastDeploy = listData.deployments?.[0];

    if (!lastDeploy) {
      return res.status(404).json({ error: 'Belum ada deployment' });
    }

    // 3. Redeploy
    const deployRes = await fetch(
      `https://api.vercel.com/v13/deployments?forceNew=1`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: lastDeploy.name,
          project: projectId,
          target: 'production',
          gitSource: lastDeploy.gitSource || null,
          deploymentId: lastDeploy.uid
        })
      }
    );
    const deployData = await deployRes.json();

    if (!deployRes.ok) {
      return res.status(deployRes.status).json({
        error: deployData.error?.message || 'Deploy gagal'
      });
    }

    return res.status(200).json({
      success: true,
      deployment: {
        id: deployData.id,
        url: deployData.url,
        readyState: deployData.readyState
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
