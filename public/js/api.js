'use strict';
/* API 请求封装 */
const API = {
  base: '/api',
  async request(method, url, body, isForm) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined && body !== null) {
      if (isForm) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    let res;
    try { res = await fetch(this.base + url, opts); }
    catch (e) { throw new Error('网络连接失败,请检查服务是否运行'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) {
      const msg = (data && data.error) || ('请求失败(' + res.status + ')');
      if (res.status === 401) {
        location.hash = '#/login';
      }
      throw new Error(msg);
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body || {}); },
  patch(url, body) { return this.request('PATCH', url, body || {}); },
  del(url) { return this.request('DELETE', url); },
  upload(url, formData) { return this.request('POST', url, formData, true); }
};

/* 上传文件辅助:把文件 POST 到指定接口 */
async function uploadFile(url, file, extra) {
  const fd = new FormData();
  fd.append('file', file);
  if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return API.upload(url, fd);
}
