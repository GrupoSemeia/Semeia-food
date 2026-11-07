// Popula um ambiente de DEMONSTRAÇÃO via API (lojas e produtos de exemplo).
// Uso: BASE=http://localhost:8787 node scripts/seed-demo.mjs
const BASE = process.env.BASE ?? 'http://localhost:8787';
const post = async (path, body, token) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok && r.status !== 409) throw new Error(path + ': ' + JSON.stringify(d)); return d;
};
await post('/api/auth/setup', { name: 'Proprietário Demo', email: 'dono@yracema.demo', password: 'demo123' });
const { token } = await post('/api/auth/login', { email: 'dono@yracema.demo', password: 'demo123' });
const lojas = [['Loja 1', 'Curitiba'], ['Loja 2', 'Curitiba'], ['Loja 3', 'Curitiba'], ['Loja 4', 'Araucária'], ['Loja 5', 'Araucária'], ['Loja 6', 'São José dos Pinhais'], ['Loja 7', 'Fazenda Rio Grande']];
const produtos = [['Pão de hot dog', 'Pães', 'un'], ['Salsicha', 'Salsichas', 'kg'], ['Molho verde', 'Molhos', 'kg'], ['Maionese', 'Molhos', 'kg'], ['Embalagem hot dog', 'Embalagens', 'un'], ['Batata palha', 'Batata', 'kg'], ['Carne moída', 'Carnes', 'kg'], ['Purê de batata', 'Outros', 'kg']];
for (const [name, city] of lojas) await post('/api/stores', { name, city }, token);
for (const [name, category, unit] of produtos) await post('/api/products', { name, category, unit }, token);
console.log('Demo pronto. Login: dono@yracema.demo / demo123 (gerentes: crie em Cadastros > Usuários)');
