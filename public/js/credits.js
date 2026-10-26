'use strict';
/* 积分中心：余额展示 + 申请积分 + 消耗/发放流水 + 申请记录 */
const CreditCenter = {
  cache: { balance: 0, pricing: { perSecond: 5, overrides: {} } },

  async refresh() {
    try {
      const res = await API.get('/credits');
      this.cache.balance = res.balance;
      this.cache.pricing = res.pricing;
      const chip = document.getElementById('creditChipVal');
      if (chip) chip.textContent = res.balance;
      if (App.user) App.user.credits = res.balance;
      return res;
    } catch (e) { return null; }
  },

  /* 按段时长计算本次任务消耗
     优先级与后端一致：免费模型 0 → 模型专属每秒单价 → 段时长覆盖价 → 全局每秒单价 */
  costFor(durationSec, model) {
    if (model && model.is_free) return 0;
    const dur = Math.max(1, Math.round(Number(durationSec) || 5));
    const modelPerSecond = model ? Number(model.credit_per_second) || 0 : 0;
    if (modelPerSecond > 0) return Math.max(1, Math.ceil(dur * modelPerSecond));
    const p = this.cache.pricing || { perSecond: 5, overrides: {} };
    const key = String(dur);
    if (p.overrides && p.overrides[key] !== undefined) return Math.max(0, Math.round(p.overrides[key]));
    return Math.max(1, Math.ceil(dur * (p.perSecond || 5)));
  },

  open() {
    const body = el('<div></div>');
    const m = openModal({ title: `${icon('coins', 'ico-sm')} 积分中心`, size: 'modal-md', body });
    this.renderBody(body);
  },

  async renderBody(body) {
    const res = await this.refresh();
    if (!res) { body.innerHTML = '<div class="empty"><h3>加载失败</h3></div>'; return; }
    const logs = res.logs || [], requests = res.requests || [];
    body.innerHTML = `
      <div class="cc-hero">
        <div class="cc-balance"><span class="cc-num">${res.balance}</span><span class="cc-unit">积分</span></div>
        <div class="cc-price">
          定价：免费模型 0 分 · 常用段时长 ${Object.entries(res.pricing.overrides || {}).map(([d, v]) => d + 's=' + v).join(' / ')} · 其余 ${res.pricing.perSecond} 分/秒
        </div>
        <button class="btn btn-primary" id="ccApplyBtn">${iconText('hand-coins', '申请积分')}</button>
      </div>
      <div class="tabs cc-tabs" style="margin-bottom:10px">
        <div class="tab active" data-cc-tab="logs">积分流水</div>
        <div class="tab" data-cc-tab="req">我的申请${res.pending ? ` <span class="cc-pending">${res.pending}</span>` : ''}</div>
      </div>
      <div id="ccList"></div>`;
    const list = body.querySelector('#ccList');
    const renderLogs = () => {
      list.innerHTML = logs.length ? logs.map(l => `
        <div class="cc-row">
          <span class="cc-delta ${l.delta >= 0 ? 'plus' : 'minus'}">${l.delta >= 0 ? '+' : ''}${l.delta}</span>
          <span class="cc-reason">${esc(l.reason || '积分变动')}</span>
          <span class="cc-meta">余额 ${l.balance}</span>
          <span class="cc-meta">${fmtAgo(l.created_at)}</span>
        </div>`).join('') : '<div class="empty" style="padding:26px"><h3>暂无流水</h3></div>';
    };
    const renderReqs = () => {
      list.innerHTML = requests.length ? requests.map(rq => `
        <div class="cc-row">
          <span class="cc-delta plus">+${rq.amount}</span>
          <span class="cc-reason">${esc(rq.reason || '未填写用途')}</span>
          <span class="status status-${rq.status === 'approved' ? 'completed' : rq.status === 'rejected' ? 'failed' : 'queued'}">${rq.status === 'approved' ? '已批准' : rq.status === 'rejected' ? '已驳回' : '待审批'}</span>
          <span class="cc-meta">${fmtAgo(rq.created_at)}</span>
        </div>`).join('') : `<div class="empty" style="padding:26px"><h3>还没有申请记录</h3></div>`;
    };
    renderLogs();
    body.querySelectorAll('[data-cc-tab]').forEach(t => t.addEventListener('click', () => {
      body.querySelectorAll('[data-cc-tab]').forEach(x => x.classList.toggle('active', x === t));
      t.dataset.ccTab === 'logs' ? renderLogs() : renderReqs();
    }));
    body.querySelector('#ccApplyBtn').addEventListener('click', async () => {
      const vals = await formModal({
        title: '申请积分',
        fields: [
          { key: 'amount', label: '申请数量', type: 'number', value: 100, hint: '1 ~ 100000,由管理员审批后到账' },
          { key: 'reason', label: '申请用途', type: 'textarea', placeholder: '如： 本月需生成 40 集短视频素材…' }
        ],
        submitText: '提交申请'
      });
      if (vals) {
        try {
          await API.post('/credits/apply', { amount: Number(vals.amount), reason: vals.reason });
          toast('申请已提交，等待管理员审批', 'ok');
          this.renderBody(body);
        } catch (e) { toast(e.message, 'err'); }
      }
    });
  }
};
