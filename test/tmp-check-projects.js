
(async () => {
  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const d = await (await fetch('http://localhost:3088/api/projects/p-3c7b68936ffd2ffd', { headers: { cookie } })).json();
  console.log('keys:', Object.keys(d));
  console.log(JSON.stringify(d).slice(0, 800));
})().catch(e => console.error('ERR', e.message));
