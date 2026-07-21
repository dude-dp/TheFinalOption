import fetch from 'node-fetch';
const models = [
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free'
];
const prompt = "Reply with {'action': 'WAIT', 'confidence': 50, 'reasoning': 'test'}";

for (const model of models) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (process.env.OPENROUTER_API_KEY || ''),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages: [{role: 'user', content: prompt}] })
  });
  const data = await res.json();
  console.log(model, res.status, JSON.stringify(data));
}
