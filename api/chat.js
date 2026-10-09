// api/chat.js — Vercel Serverless Function
// Proxies requests to the Anthropic API, keeping the API key server-side.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers — tighten origin in production if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY environment variable is not set.' });
  }

  try {
    const body = req.body;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Build the request to Anthropic
    const anthropicPayload = {
      model:      body.model      || 'claude-sonnet-4-20250514',
      max_tokens: body.max_tokens || 1000,
      messages:   body.messages,
    };

    // Optional fields
    if (body.system)      anthropicPayload.system      = body.system;
    if (body.temperature) anthropicPayload.temperature = body.temperature;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-beta':       'pdfs-2024-09-25', // enables PDF document blocks
      },
      body: JSON.stringify(anthropicPayload),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicRes.status).json({
        error: data.error?.message || 'Anthropic API error',
        details: data,
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
