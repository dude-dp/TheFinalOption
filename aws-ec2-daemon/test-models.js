const https = require('https');
const models = [
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free'
];
const prompt = "Reply with {'action': 'WAIT', 'confidence': 50, 'reasoning': 'test'}";

models.forEach(model => {
  const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (process.env.OPENROUTER_API_KEY || ''),
      'Content-Type': 'application/json'
    }
  }, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => console.log(model, res.statusCode, data));
  });
  req.write(JSON.stringify({ model, messages: [{role: 'user', content: prompt}] }));
  req.end();
});
