// app.js - static JS for the KomiBot dashboard
(function () {
  const API_ENDPOINT = '/api/members';

  const membersBody = document.getElementById('membersBody');
  const countMembers = document.getElementById('countMembers');
  const totalWarns = document.getElementById('totalWarns');
  const totalMutes = document.getElementById('totalMutes');
  const totalTickets = document.getElementById('totalTickets');
  const lastUpdate = document.getElementById('lastUpdate');
  const refreshBtn = document.getElementById('refreshBtn');
  const intervalSelect = document.getElementById('interval');
  const searchInput = document.getElementById('search');
  const themeBtn = document.getElementById('themeBtn');

  let intervalId = null;
  let membersCache = [];

  function setTheme(isDark) {
    document.body.classList.toggle('dark', isDark);
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    localStorage.setItem('komi_theme', isDark ? 'dark' : 'light');
  }

  themeBtn.addEventListener('click', () => {
    setTheme(!document.body.classList.contains('dark'));
  });

  // initialize theme
  setTheme(localStorage.getItem('komi_theme') === 'dark');

  async function fetchMembers() {
    try {
      const res = await fetch(API_ENDPOINT, {cache: "no-store"});
      if (!res.ok) {
        const txt = await res.text();
        console.error('[SITE] Erro ao buscar membros:', res.status, txt);
        membersBody.innerHTML = '<tr><td colspan="7" class="muted">Erro ao carregar membros (ver console)</td></tr>';
        return;
      }
      const data = await res.json();
      membersCache = Array.isArray(data) ? data : [];
      renderMembers();
      updateStats();
      lastUpdate.textContent = new Date().toLocaleString();
    } catch (err) {
      console.error('[SITE] Falha na requisição:', err.message);
      membersBody.innerHTML = '<tr><td colspan="7" class="muted">Falha na requisição (ver console)</td></tr>';
    }
  }

  function updateStats() {
    countMembers.textContent = membersCache.length;
    totalWarns.textContent = membersCache.reduce((s,m)=>s+(m.total_warns||0),0);
    totalMutes.textContent = membersCache.reduce((s,m)=>s+(m.total_mutes||0),0);
    totalTickets.textContent = membersCache.reduce((s,m)=>s+(m.tickets||0),0);
  }

  function renderMembers() {
    const q = (searchInput.value || '').toLowerCase().trim();
    const rows = membersCache
      .filter(m => {
        if (!q) return true;
        return (m.user_tag||'').toLowerCase().includes(q) || (m.user_id||'').includes(q);
      })
      .map(m => {
        return `<tr>
          <td><span class="avatar" title="${escapeHtml(m.user_tag||'')}"></span></td>
          <td>${escapeHtml(m.user_tag||'')}</td>
          <td class="muted small">${escapeHtml(m.user_id||'')}</td>
          <td>${m.total_warns||0}</td>
          <td>${m.total_mutes||0}</td>
          <td>${m.total_bans||0}</td>
          <td>${m.tickets||0}</td>
        </tr>`;
      });

    if (rows.length === 0) {
      membersBody.innerHTML = '<tr><td colspan="7" class="muted">Nenhum membro encontrado.</td></tr>';
    } else {
      membersBody.innerHTML = rows.join('');
    }
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  refreshBtn.addEventListener('click', fetchMembers);
  searchInput.addEventListener('input', () => renderMembers());

  intervalSelect.addEventListener('change', () => {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    const v = parseInt(intervalSelect.value, 10);
    if (v > 0) intervalId = setInterval(fetchMembers, v);
  });

  // restore interval
  (function initInterval() {
    const v = parseInt(intervalSelect.value, 10);
    if (v > 0) intervalId = setInterval(fetchMembers, v);
  })();

  // initial load
  fetchMembers();

  // expose for debug
  window.__komi = { fetchMembers, membersCache };
})();
