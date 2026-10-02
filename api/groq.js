/**
 * APEX AI -> Groq proxy.
 * Required Vercel Environment Variable:
 *   GROQ_API_KEY = your Groq API key
 * Optional:
 *   GROQ_MODEL = llama-3.3-70b-versatile
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed', message: 'Gunakan POST.' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'missing_groq_key',
      message: 'GROQ_API_KEY belum diset di Vercel Environment Variables.'
    });
  }

  const body = req.body || {};
  const message = String(body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'empty_message', message: 'Pesan kosong.' });
  if (message.length > 8000) return res.status(400).json({ error: 'message_too_long', message: 'Pesan maksimal 8000 karakter.' });

  const history = Array.isArray(body.history) ? body.history.slice(-12).filter(x =>
    x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string'
  ) : [];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah APEX AI, asisten chat yang ramah, singkat, dan membantu. Jawab dalam bahasa yang digunakan pengguna.'
          },
          ...history,
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 1200
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'groq_error',
        message: data?.error?.message || 'Groq gagal memproses permintaan.'
      });
    }

    const reply = data?.choices?.[0]?.message?.content || '';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e.message || 'Gagal menghubungi Groq.' });
  }
};
