const https = require('https');
const models = [
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it'
];
const prompt = "Reply with {'action': 'WAIT', 'confidence': 50, 'reasoning': 'test'}";

models.forEach(model => {
  const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (process.env.GROQ_API_KEY || ''),
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
