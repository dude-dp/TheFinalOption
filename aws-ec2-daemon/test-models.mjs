import fetch from 'node-fetch';
const models = [
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it'
];
const prompt = "Reply with {'action': 'WAIT', 'confidence': 50, 'reasoning': 'test'}";

for (const model of models) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + (process.env.GROQ_API_KEY || ''),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages: [{role: 'user', content: prompt}] })
  });
  const data = await res.json();
  console.log(model, res.status, JSON.stringify(data));
}
