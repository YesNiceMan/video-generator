'use strict';
/* 登录 / 注册 */
const AuthView = {
  render(root) {
    root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-stage">
        <aside class="auth-poster" aria-hidden="true">
          <div class="ap-kicker">VideoForge Studio · Est. 2026</div>
          <h1 class="ap-title">每一帧，
            都值得<br>大银幕</h1>
          <p class="ap-sub">AI 视频创作平台 · 分镜 · 生成 · 审片 · 成片</p>
          <div class="ap-foot">
            体验账号<br>
            管理员 <b>admin@videoforge.cn / admin123</b><br>
            演示用户 <b>demo@videoforge.cn / demo123</b>
          </div>
        </aside>
        <div class="auth-card">
          <div class="auth-logo"><i data-lucide="clapperboard"></i></div>
          <div class="auth-title">视界引擎</div>
          <div class="auth-sub">AI 视频生成与编辑平台</div>
          <div id="authForm"></div>
          <div class="auth-switch" id="authSwitch"></div>
        </div>
      </div>
    </div>`;
    this.mode = 'login';
    this.formEl = root.querySelector('#authForm');
    this.switchEl = root.querySelector('#authSwitch');
    this.renderForm();
  },

  renderForm() {
    const isLogin = this.mode === 'login';
    this.formEl.innerHTML = `
      ${isLogin ? '' : `<div class="field"><label>昵称</label><input class="input" id="afName" placeholder="你的昵称" maxlength="40"></div>`}
      <div class="field"><label>邮箱</label><input class="input" id="afEmail" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>密码</label><input class="input" id="afPass" type="password" placeholder="至少 6 位"></div>
      <button class="btn btn-primary btn-block" id="afSubmit">${iconText('log-in', isLogin ? '登 录' : '注 册')}</button>`;
    this.switchEl.innerHTML = isLogin
      ? `还没有账号？<a href="#" id="afGo">立即注册</a>`
      : `已有账号？<a href="#" id="afGo">去登录</a>`;
    this.formEl.querySelector('#afSubmit').addEventListener('click', () => this.submit());
    this.formEl.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') this.submit(); }));
    this.switchEl.querySelector('#afGo').addEventListener('click', e => { e.preventDefault(); this.mode = isLogin ? 'register' : 'login'; this.renderForm(); });
  },

  async submit() {
    const email = (this.formEl.querySelector('#afEmail') || {}).value || '';
    const pass = (this.formEl.querySelector('#afPass') || {}).value || '';
    const name = (this.formEl.querySelector('#afName') || {}).value || '';
    const btn = this.formEl.querySelector('#afSubmit');
    const label = this.mode === 'login' ? '登 录' : '注 册';
    btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-sm"></span>请稍候…';
    try {
      if (this.mode === 'login') {
        await API.post('/auth/login', { email, password: pass });
      } else {
        await API.post('/auth/register', { email, password: pass, name });
      }
      toast(this.mode === 'login' ? '登录成功，正在进入…' : '注册成功，正在进入…', 'ok');
      /* 确保离开登录/注册页再引导，避免 route 命中 login 分支又渲染回登录页 */
      if (location.hash === '#/login' || location.hash === '#/register') {
        history.replaceState(null, '', location.pathname + location.search);
      }
      await App.boot();
      return;
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
      btn.innerHTML = iconText('log-in', label);
    }
  }
};
