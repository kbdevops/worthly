// Worthly — Single Page Application Logic

// Global Chart instances
let networthTimelineChart = null;
let allocationChart = null;
let performanceChart = null;
let allocationCountryChart = null;
let monthlyChangeChart = null;

// Global state cache
let rawTransactions = [];
let rawBreakdown = null;

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  // Set current date in header
  updateHeaderDate();

  // Set default form date to today
  document.getElementById('f-date').valueAsDate = new Date();

  // Restore last active tab, default to dashboard
  const savedTab = localStorage.getItem('activeTab') || 'dashboard';
  switchTab(savedTab);

  // Fetch initial data
  refreshAllData();

  // Run background sync
  setTimeout(() => {
    syncData(false); // Silent sync (respects cooldown, doesn't annoy user unless they force it)
  }, 1000);
});

function updateHeaderDate() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const today = new Date();
  document.getElementById('header-date').textContent = today.toLocaleDateString('en-US', options);
}

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const hamburger = document.getElementById('hamburger-btn');
  const isOpen = sidebar.classList.toggle('open');
  overlay.classList.toggle('active', isOpen);
  hamburger.classList.toggle('active', isOpen);
}

// Tab switcher
function switchTab(tabId) {
  document.querySelectorAll('.tab-section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(`section-${tabId}`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`nav-${tabId}`).classList.add('active');

  const headingEl = document.getElementById('page-main-heading');
  if (tabId === 'dashboard') headingEl.textContent = 'Portfolio Overview';
  else if (tabId === 'holdings') headingEl.textContent = 'Assets';
  else if (tabId === 'transactions') {
    headingEl.textContent = 'Transaction Ledger';
    fetchTransactions();
  } else if (tabId === 'sync') {
    headingEl.textContent = 'Data Sync & Cache';
    fetchSyncStatus();
  } else if (tabId === 'tax') {
    headingEl.textContent = 'Capital Gains Tax';
    onCgtFYChange();
  }

  // Close mobile sidebar after navigation (only if open)
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar.classList.contains('open')) {
    toggleSidebar();
  }

  // Persist active tab so refresh stays on same page
  localStorage.setItem('activeTab', tabId);
}

// Refresh all dashboard metrics & tables
async function refreshAllData() {
  await Promise.all([
    fetchDashboardStats(),
    fetchNetworthTimeline(),
    fetchHoldings(),
    fetchMonthlyChange(),
    fetchAllocationCountry()
  ]);
  // Refresh ledger if already loaded
  if (rawTransactions.length > 0) {
    renderLedgerTable(rawTransactions);
  }
}

// Fetch aggregate stats for dashboard cards (uses /api/breakdown + /api/stats)
async function fetchDashboardStats() {
  try {
    const [bRes, sRes] = await Promise.all([
      fetch('/api/breakdown'),
      fetch('/api/stats')
    ]);
    const b = await bRes.json();
    const stats = await sRes.json();
    rawBreakdown = b;
    const total = b.total;

    // Total Net Worth
    document.getElementById('stat-total-nw').textContent = fmtCurrency(total);

    // Portfolio
    document.getElementById('stat-nw-portfolio').textContent = fmtCurrency(b.portfolio);
    const portChange = document.getElementById('stat-portfolio-change');
    const retClass = stats.total_return >= 0 ? 'positive' : 'negative';
    portChange.textContent = `${stats.total_return >= 0 ? '+' : ''}${fmtCurrency(stats.total_return)} total return`;
    portChange.className = `metric-change ${retClass}`;

    // Super
    document.getElementById('stat-nw-super').textContent = fmtCurrency(b.super);
    document.getElementById('stat-nw-super-pct').textContent = `${(b.super / total * 100).toFixed(1)}% of net worth`;

    // Cash
    document.getElementById('stat-nw-cash').textContent = fmtCurrency(b.cash);
    document.getElementById('stat-nw-cash-pct').textContent = `${(b.cash / total * 100).toFixed(1)}% of net worth`;

    // Asset allocation doughnut
    renderAllocationChart(b);

  } catch (e) {
    console.error('Failed to load dashboard stats', e);
  }
}

// Fetch current holdings (stocks table + cash/super cards)
async function fetchHoldings() {
  try {
    // Fetch portfolio and breakdown in parallel
    const [pRes, bRes] = await Promise.all([
      fetch('/api/portfolio'),
      fetch('/api/breakdown')
    ]);
    const holdings = await pRes.json();
    const breakdown = await bRes.json();
    rawBreakdown = breakdown;

    // --- Cash + Super cards ---
    document.getElementById('holdings-cash-value').textContent = fmtCurrency(breakdown.cash);
    document.getElementById('holdings-super-value').textContent = fmtCurrency(breakdown.super);

    // Get latest snapshot dates
    try {
      const sRes = await fetch('/api/snapshots');
      const snapshots = await sRes.json();
      if (snapshots.length > 0) {
        const lastCash = [...snapshots].reverse().find(s => s.cash > 0);
        const lastSuper = [...snapshots].reverse().find(s => s.super > 0);
        if (lastCash) document.getElementById('holdings-cash-date').textContent = `Last updated: ${lastCash.date}`;
        if (lastSuper) document.getElementById('holdings-super-date').textContent = `Last updated: ${lastSuper.date}`;
      }
    } catch (_) {}

    // --- Stocks Cards ---
    document.getElementById('holdings-count-badge').textContent = `${holdings.length} Assets`;
    const container = document.getElementById('holdings-cards-container');
    container.innerHTML = '';

    if (holdings.length === 0) {
      container.innerHTML = `<div class="holdings-empty">No active holdings found.</div>`;
      renderPerformanceChart([]);
      return;
    }

    holdings.forEach(h => {
      const returnClass = h.return_aud >= 0 ? 'positive' : 'negative';
      const dailyClass = (h.daily_change || 0) >= 0 ? 'positive' : 'negative';
      const mktBadge = h.exchange === 'ASX' ? 'badge-asx' : 'badge-us';
      const dailySign = (h.daily_change || 0) >= 0 ? '+' : '';

      const logoHtml = h.logo_url ? `<img src="${h.logo_url}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:contain;background:#fff;padding:2px;" onerror="this.style.display='none'">` : '';
      const industryHtml = h.industry ? `<span class="badge" style="background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.2);">${h.industry}</span>` : '';

      container.innerHTML += `
        <div class="holding-card">
          <div class="holding-card-header">
            <div>
              <div style="display:flex;align-items:center;gap:10px;">
                ${logoHtml}
                <span class="holding-card-ticker">${h.ticker}</span>
                <span class="badge ${mktBadge}">${h.exchange}</span>
                ${h.currency === 'USD' ? '<span class="badge badge-us">USD</span>' : '<span class="badge badge-asx">AUD</span>'}
                ${industryHtml}
              </div>
              <div class="holding-card-name">${h.name}</div>
            </div>
            <div style="text-align:right;">
              <div class="holding-card-return ${returnClass}">
                ${h.return_aud >= 0 ? '+' : ''}${fmtCurrency(h.return_aud)}
              </div>
              <div class="${returnClass}" style="font-size:12px;font-weight:700;">
                ${h.return_pct >= 0 ? '+' : ''}${h.return_pct.toFixed(2)}%
              </div>
            </div>
          </div>

          <div class="holding-card-metrics">
            <div>
              <div class="holding-metric-label">Current Price (${h.currency})</div>
              <div class="holding-metric-value">${fmtLocal(h.current_price, h.currency)}</div>
              <div class="holding-metric-sub">${fmtCurrency(h.current_price_aud)} AUD</div>
            </div>
            <div>
              <div class="holding-metric-label">Today's Change</div>
              <div class="holding-metric-value ${dailyClass}">${dailySign}${fmtCurrency(h.daily_change || 0)}</div>
              <div class="holding-metric-sub ${dailyClass}">${dailySign}${(h.daily_change_pct || 0).toFixed(2)}%</div>
            </div>
            <div>
              <div class="holding-metric-label">Market Value (AUD)</div>
              <div class="holding-metric-value">${fmtCurrency(h.value_aud)}</div>
              <div class="holding-metric-sub">${h.weight.toFixed(1)}% of portfolio</div>
            </div>
            <div>
              <div class="holding-metric-label">Cost Base (AUD)</div>
              <div class="holding-metric-value">${fmtCurrency(h.cost_aud)}</div>
              <div class="holding-metric-sub">${h.units.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:4})} shares</div>
            </div>
            <div>
              <div class="holding-metric-label">Avg Cost/Share</div>
              <div class="holding-metric-value">${fmtLocal(h.avg_price, h.currency)}</div>
              <div class="holding-metric-sub">${fmtCurrency(h.avg_price_aud)} AUD</div>
            </div>
          </div>

          <div class="holding-card-footer">
            <div class="holding-card-stats">
              <span class="holding-card-stat">Buys: <strong>${h.buys_count}</strong></span>
              ${h.sells_count > 0 ? `<span class="holding-card-stat">Sells: <strong>${h.sells_count}</strong></span>` : ''}
              <span class="holding-card-stat">Weight: <strong>${h.weight.toFixed(1)}%</strong></span>
            </div>
          </div>
        </div>
      `;
    });

    // Draw performance bar chart
    renderPerformanceChart(holdings);

    // Also load cash accounts + super holdings tables
    fetchCashAccountsTable();
    fetchSuperHoldingsTable();

  } catch (e) {
    console.error('Failed to load holdings', e);
  }
}

// Fetch all transactions (loaded on-demand by stock detail panel)

async function fetchTransactions() {
  try {
    const res = await fetch('/api/transactions');
    rawTransactions = await res.json();
    
    // Render the ledger
    renderLedgerTable(rawTransactions);
  } catch (e) {
    console.error('Failed to fetch transactions', e);
  }
}

// Render ledger rows
function renderLedgerTable(txns) {
  const tbody = document.getElementById('ledger-table-body');
  tbody.innerHTML = '';

  if (txns.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: var(--text-secondary); padding: 32px;">No transactions recorded. Click Add Transaction to start.</td></tr>`;
    return;
  }

  // Render chronologically reversed (newest first)
  const reversed = [...txns].reverse();

  reversed.forEach((t, revIdx) => {
    // Correct index maps back to original array
    const originalIdx = txns.length - 1 - revIdx;

    const actBadge = t.action.toLowerCase() === 'buy' ? 'badge-buy' : (t.action.toLowerCase() === 'split' ? 'badge-asx' : 'badge-sell');
    const mktBadge = t.exchange === 'ASX' ? 'badge-asx' : 'badge-us';
    const isBuy = t.action.toLowerCase() === 'buy';

    // Gain/loss display for buys
    let gainHtml = '<span style="color:var(--text-muted);">—</span>';
    if (isBuy && t.gain_aud !== undefined) {
      const gainClass = t.gain_aud >= 0 ? 'text-success' : 'text-danger';
      const sign = t.gain_aud >= 0 ? '+' : '';
      gainHtml = `<span class="${gainClass}" style="font-weight:700;">${sign}${fmtCurrency(t.gain_aud)}<br><span style="font-size:10px;">${sign}${(t.gain_pct||0).toFixed(2)}%</span></span>`;
    }

    // Current value display for buys
    let nowHtml = '<span style="color:var(--text-muted);">—</span>';
    if (isBuy && t.current_value_aud !== undefined) {
      nowHtml = `<span style="font-weight:600;">${fmtCurrency(t.current_value_aud)}</span>`;
    }

    tbody.innerHTML += `
      <tr>
        <td style="font-family: monospace; font-size: 13px; color: var(--text-secondary);">${t.date}</td>
        <td>${t.logo_url ? `<img src="${t.logo_url}" alt="" style="width:18px;height:18px;border-radius:4px;background:#fff;padding:1px;margin-right:6px;vertical-align:middle;" onerror="this.style.display='none'">` : ''}<span style="font-weight:700;color:var(--color-primary-light);">${t.ticker}</span></td>
        <td><span class="badge ${mktBadge}">${t.exchange}</span></td>
        <td><span class="badge ${actBadge}">${t.action}</span></td>
        <td style="font-weight:600;">${t.currency_label || t.currency || 'AUD'}</td>
        <td>${t.units.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td>${t.price > 0 ? fmtLocal(t.price, t.currency) : '—'}</td>
        <td>${fmtLocal(t.brokerage, t.currency)}</td>
        <td style="font-weight: 700;">${fmtCurrency(t.value)}</td>
        <td style="font-family: monospace; font-size: 12px; color: var(--text-muted);">${t.exch_rate ? t.exch_rate.toFixed(4) : '1.0000'}</td>
        <td>${nowHtml}</td>
        <td>${gainHtml}</td>
        <td>
          <button class="delete-btn" onclick="deleteTxn(${originalIdx})" title="Delete trade">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </td>
      </tr>
    `;
  });
}

// Filter ledger entries on client-side
function filterLedger() {
  const search = document.getElementById('ledger-search').value.toUpperCase().trim();
  const type = document.getElementById('ledger-type-filter').value;
  const market = document.getElementById('ledger-market-filter').value;
  
  const filtered = rawTransactions.filter(t => {
    const matchSearch = t.ticker.includes(search);
    const matchType = type === 'all' || t.action.toLowerCase() === type;
    const matchMarket = market === 'all' || 
                        (market === 'asx' && t.exchange === 'ASX') ||
                        (market === 'us' && ['NASDAQ', 'NYSE', 'US'].includes(t.exchange));
                        
    return matchSearch && matchType && matchMarket;
  });
  
  renderLedgerTable(filtered);
}

// Render Doughnut Allocation Chart (uses breakdown data: cash, super, stocks-active, stocks-passive)
function renderAllocationChart(b) {
  const ctx = document.getElementById('allocationChart').getContext('2d');
  if (allocationChart) allocationChart.destroy();

  const labels = ['Stocks - Active', 'Stocks - Passive', 'Super', 'Cash'];
  const values = [b.stocks_active, b.stocks_passive, b.super, b.cash];
  const colors = ['#6366f1', '#a855f7', '#10b981', '#06b6d4'];

  allocationChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: '#13172e',
        borderWidth: 2,
        hoverOffset: 12
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'right',
          labels: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 },
            boxWidth: 8,
            padding: 10,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: '#13172e',
          borderColor: '#20264b',
          borderWidth: 1,
          bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${context.label}: ${fmtCurrency(val)} (${pct}%)`;
            }
          }
        }
      },
      cutout: '70%'
    }
  });
}

// Render Asset P&L Bar Chart
function renderPerformanceChart(holdings) {
  const ctx = document.getElementById('performanceChart').getContext('2d');
  if (performanceChart) performanceChart.destroy();
  if (!holdings || holdings.length === 0) { performanceChart = null; return; }

  const labels = holdings.map(h => h.ticker);
  const data = holdings.map(h => h.return_pct);
  const bgColors = data.map(val => val >= 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(239, 68, 68, 0.75)');
  const borderColors = data.map(val => val >= 0 ? '#10b981' : '#ef4444');

  performanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ data: data, backgroundColor: bgColors, borderColor: borderColors, borderWidth: 1, borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#13172e', borderColor: '#20264b', borderWidth: 1, bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: { label: ctx => ` Return: ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(2)}%` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 } } },
        y: {
          grid: { color: 'rgba(32, 38, 75, 0.4)' },
          ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 10 }, callback: v => `${v > 0 ? '+' : ''}${v}%` }
        }
      }
    }
  });
}

// Sync Database via backend
async function syncData(isForced = true) {
  const syncBtn = document.getElementById('sidebar-sync-btn');
  const syncTime = document.getElementById('sync-time-str');
  const syncStatus = document.getElementById('sync-status-msg');
  const icon = document.getElementById('sync-icon-svg');
  
  syncBtn.disabled = true;
  syncBtn.classList.add('syncing');
  syncStatus.textContent = 'Syncing market rates...';
  
  try {
    const url = `/api/sync${isForced ? '?force=true' : ''}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    
    if (data.results && data.results.length) {
      // Find errors
      const failed = data.results.filter(r => !r.ok);
      if (failed.length > 0) {
        syncStatus.textContent = `Sync completed with ${failed.length} warning(s)`;
        syncStatus.style.color = 'var(--color-danger)';
      } else {
        syncStatus.textContent = 'Synced successfully';
        syncStatus.style.color = 'var(--color-success)';
      }
      
      const formatTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      syncTime.textContent = `Today, ${formatTime}`;
      syncTime.style.color = 'var(--text-primary)';
      
      // Reload stats & graphs
      await refreshAllData();
    } else {
      syncStatus.textContent = 'No symbols to sync';
      syncStatus.style.color = 'var(--text-muted)';
    }
  } catch (e) {
    console.error('Price Sync Failed', e);
    syncStatus.textContent = 'Connection timeout';
    syncStatus.style.color = 'var(--color-danger)';
  }
  
  syncBtn.classList.remove('syncing');
  syncBtn.disabled = false;
  
  // Reset cooling active status text after 5s
  setTimeout(() => {
    syncStatus.textContent = 'Cooldown active (15m)';
    syncStatus.style.color = 'var(--text-muted)';
  }, 5000);
}

// Add transaction modal controls
function openAddModal() {
  document.getElementById('add-txn-modal').classList.add('active');
}

function closeAddModal() {
  document.getElementById('add-txn-modal').classList.remove('active');
  document.getElementById('txn-form').reset();
  document.getElementById('f-date').valueAsDate = new Date();
  onExchangeChange();
}

function onExchangeChange() {
  const ex = document.getElementById('f-exchange').value;
  const helper = document.getElementById('currency-helper-text');

  if (ex === 'ASX') {
    helper.innerHTML = 'ASX Trades are priced in <strong>AUD</strong>. Fees will be calculated in AUD.';
  } else {
    helper.innerHTML = `US Trades are priced in <strong>USD</strong>. Brokerage is in USD. The AUD conversion rate at the trade date will be fetched automatically.`;
  }
  onActionChange();
}

function onActionChange() {
  const action = document.getElementById('f-action').value;
  const priceField = document.getElementById('f-price');
  const brokerageField = document.getElementById('f-brokerage');
  const helper = document.getElementById('currency-helper-text');

  if (action === 'split') {
    priceField.value = '0';
    priceField.disabled = true;
    priceField.style.opacity = '0.5';
    brokerageField.value = '0';
    brokerageField.disabled = true;
    brokerageField.style.opacity = '0.5';
    helper.innerHTML = 'Stock Split: Enter the <strong>additional shares</strong> received. Price and brokerage are zero.';
  } else {
    priceField.disabled = false;
    priceField.style.opacity = '1';
    brokerageField.disabled = false;
    brokerageField.style.opacity = '1';
    onExchangeChange();
  }
}

// ─── Auto-snapshot on cash/super changes ──────────────────────

async function autoSnapshotIfNewMonth() {
  // Take a snapshot if one doesn't exist for the current month
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const sRes = await fetch('/api/snapshots');
    const snapshots = await sRes.json();
    const hasCurrentMonth = snapshots.some(s => s.date === currentMonth);

    if (!hasCurrentMonth) {
      const caRes = await fetch('/api/cash-accounts');
      const accounts = await caRes.json();
      const cashVal = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

      const latestSuper = snapshots.length > 0 ? snapshots[snapshots.length - 1].super : 0;

      await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentMonth, super: latestSuper, cash: cashVal })
      });
    }
  } catch (e) {
    console.error('Auto-snapshot failed', e);
  }
}

// ─── Cash Accounts CRUD ────────────────────────────────────

async function fetchCashAccountsTable() {
  try {
    const res = await fetch('/api/cash-accounts');
    const accounts = await res.json();
    const tbody = document.getElementById('cash-accounts-tbody');
    tbody.innerHTML = '';
    accounts.forEach((a, i) => {
      tbody.innerHTML += `
        <tr>
          <td><input value="${escHtml(a.institution)}" onchange="updateCashAccount(${i},'institution',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:100%;font-family:var(--font-family);font-size:13px;"></td>
          <td><input value="${escHtml(a.type)}" onchange="updateCashAccount(${i},'type',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:100%;font-family:var(--font-family);font-size:13px;"></td>
          <td><input value="${escHtml(a.name)}" onchange="updateCashAccount(${i},'name',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:100%;font-family:var(--font-family);font-size:13px;"></td>
          <td><input type="number" step="0.01" value="${a.balance}" onchange="updateCashAccount(${i},'balance',parseFloat(this.value))" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:120px;font-family:var(--font-family);font-size:13px;"></td>
          <td><input value="${escHtml(a.country||'AU')}" onchange="updateCashAccount(${i},'country',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:80px;font-family:var(--font-family);font-size:13px;"></td>
          <td><button class="delete-btn" onclick="deleteCashAccount(${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>
        </tr>`;
    });
  } catch (e) { console.error('Failed to load cash accounts', e); }
}

async function updateCashAccount(idx, field, value) {
  try {
    const res = await fetch('/api/cash-accounts');
    const accounts = await res.json();
    accounts[idx][field] = value;
    await fetch('/api/cash-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accounts) });
    // Auto-snapshot for current month if needed
    await autoSnapshotIfNewMonth();
    // Refresh all affected data
    fetchHoldings();
    fetchDashboardStats();
  } catch (e) { console.error('Failed to update cash account', e); }
}

async function addCashAccount() {
  try {
    const res = await fetch('/api/cash-accounts');
    const accounts = await res.json();
    accounts.push({ institution: 'New Bank', type: 'Savings', name: 'New Account', balance: 0, country: 'AU' });
    await fetch('/api/cash-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accounts) });
    fetchCashAccountsTable();
    fetchHoldings();
    fetchDashboardStats();
  } catch (e) { console.error('Failed to add cash account', e); }
}

async function deleteCashAccount(idx) {
  if (!confirm('Remove this cash account?')) return;
  try {
    const res = await fetch('/api/cash-accounts');
    const accounts = await res.json();
    accounts.splice(idx, 1);
    await fetch('/api/cash-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accounts) });
    fetchCashAccountsTable();
    fetchHoldings();
    fetchDashboardStats();
  } catch (e) { console.error('Failed to delete cash account', e); }
}

// ─── Super Holdings CRUD ───────────────────────────────────

async function fetchSuperHoldingsTable() {
  try {
    const [shRes, snapRes] = await Promise.all([
      fetch('/api/super-holdings'),
      fetch('/api/snapshots')
    ]);
    const holdings = await shRes.json();
    const snapshots = await snapRes.json();
    const latestSuper = snapshots.length > 0 ? snapshots[snapshots.length - 1].super : 0;

    const tbody = document.getElementById('super-holdings-tbody');
    tbody.innerHTML = '';
    holdings.forEach((h, i) => {
      const value = (latestSuper * h.allocation_pct / 100).toFixed(2);
      tbody.innerHTML += `
        <tr>
          <td><input value="${escHtml(h.name)}" onchange="updateSuperHolding(${i},'name',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:100%;font-family:var(--font-family);font-size:13px;"></td>
          <td><input value="${escHtml(h.class||'')}" onchange="updateSuperHolding(${i},'class',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:100%;font-family:var(--font-family);font-size:13px;"></td>
          <td><input type="number" step="0.1" value="${h.allocation_pct}" onchange="updateSuperHolding(${i},'allocation_pct',parseFloat(this.value))" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:80px;font-family:var(--font-family);font-size:13px;"></td>
          <td><input value="${escHtml(h.country||'AU')}" onchange="updateSuperHolding(${i},'country',this.value)" style="background:transparent;border:1px solid var(--border-color);color:var(--text-primary);padding:6px;border-radius:6px;width:80px;font-family:var(--font-family);font-size:13px;"></td>
          <td style="font-weight:700;">${fmtCurrency(parseFloat(value))}</td>
          <td><button class="delete-btn" onclick="deleteSuperHolding(${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>
        </tr>`;
    });
  } catch (e) { console.error('Failed to load super holdings', e); }
}

async function updateSuperHolding(idx, field, value) {
  try {
    const res = await fetch('/api/super-holdings');
    const holdings = await res.json();
    holdings[idx][field] = value;
    await fetch('/api/super-holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holdings) });
    fetchSuperHoldingsTable();
    fetchAllocationCountry();
  } catch (e) { console.error('Failed to update super holding', e); }
}

async function addSuperHolding() {
  try {
    const res = await fetch('/api/super-holdings');
    const holdings = await res.json();
    holdings.push({ name: 'New Holding', class: '', allocation_pct: 0, country: 'AU' });
    await fetch('/api/super-holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holdings) });
    fetchSuperHoldingsTable();
    fetchAllocationCountry();
  } catch (e) { console.error('Failed to add super holding', e); }
}

async function deleteSuperHolding(idx) {
  if (!confirm('Remove this super holding?')) return;
  try {
    const res = await fetch('/api/super-holdings');
    const holdings = await res.json();
    holdings.splice(idx, 1);
    await fetch('/api/super-holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holdings) });
    fetchSuperHoldingsTable();
    fetchAllocationCountry();
  } catch (e) { console.error('Failed to delete super holding', e); }
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// POST new transaction
async function submitTransaction(e) {
  e.preventDefault();
  
  const payload = {
    date: document.getElementById('f-date').value,
    exchange: document.getElementById('f-exchange').value,
    ticker: document.getElementById('f-ticker').value,
    name: document.getElementById('f-name').value,
    action: document.getElementById('f-action').value,
    units: parseFloat(document.getElementById('f-units').value),
    price: parseFloat(document.getElementById('f-price').value),
    brokerage: parseFloat(document.getElementById('f-brokerage').value || 0.0)
  };
  
  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.ok) {
      closeAddModal();
      // Sync immediately to get new asset prices
      await syncData(false);
    } else {
      alert(`Error saving transaction: ${data.error}`);
    }
  } catch (err) {
    console.error('Failed to add transaction', err);
    alert('Failed to submit transaction. Check network log.');
  }
}

// DELETE transaction
async function deleteTxn(idx) {
  if (!confirm('Are you sure you want to delete this transaction? This cannot be undone.')) {
    return;
  }

  try {
    const res = await fetch(`/api/transactions/${idx}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      // Force re-fetch of transactions next time ledger is viewed
      rawTransactions = [];
      // Reload stats and graphs
      await refreshAllData();
      // If on transactions tab, re-fetch
      if (document.getElementById('section-transactions').classList.contains('active')) {
        await fetchTransactions();
      }
    } else {
      alert(`Delete failed: ${data.error}`);
    }
  } catch (e) {
    console.error('Failed to delete transaction', e);
  }
}

// ─── Toggle Panels ─────────────────────────────────────────

let historyType = 'cash';

function toggleHistory(type) {
  if (type) historyType = type;
  const panel = document.getElementById('history-slideout');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    panel.classList.add('open');
    document.getElementById('history-title').textContent = historyType === 'cash' ? 'Cash History' : 'Super History';
    document.getElementById('history-col-header').textContent = historyType === 'cash' ? 'Cash' : 'Super';
    fetchSnapshotsTable(historyType);
  }
}

function toggleCashAccounts() {
  const section = document.getElementById('cash-accounts-section');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
  if (section.style.display === 'block') fetchCashAccountsTable();
}

function toggleSuperHoldings() {
  const section = document.getElementById('super-holdings-section');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
  if (section.style.display === 'block') fetchSuperHoldingsTable();
}


async function fetchNetworthTimeline() {
  try {
    const res = await fetch('/api/networth');
    const data = await res.json();
    renderNetworthTimelineChart(data);
  } catch (e) {
    console.error('Failed to load net worth timeline', e);
  }
}

function renderNetworthTimelineChart(data) {
  if (!data.dates || !data.dates.length) return;
  const ctx = document.getElementById('networthTimelineChart').getContext('2d');
  if (networthTimelineChart) networthTimelineChart.destroy();

  const step = Math.max(1, Math.floor(data.dates.length / 200));
  const dates = data.dates.filter((_, i) => i % step === 0);
  const portfolio = data.portfolio.filter((_, i) => i % step === 0);
  const cash = data.cash.filter((_, i) => i % step === 0);
  const sup = data.super.filter((_, i) => i % step === 0);
  const networth = data.net_worth.filter((_, i) => i % step === 0);
  const returnVal = (data.return_val || []).filter((_, i) => i % step === 0);

  networthTimelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        { label: 'Net Worth', data: networth, borderColor: '#f8fafc', borderWidth: 3, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#f8fafc', pointHoverBorderColor: '#13172e', pointHoverBorderWidth: 2 },
        { label: 'Portfolio', data: portfolio, borderColor: '#6366f1', borderWidth: 2, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 0 },
        { label: 'Return (Gain/Loss)', data: returnVal, borderColor: '#f59e0b', borderWidth: 2, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 0, borderDash: [6, 3] },
        { label: 'Super', data: sup, borderColor: '#10b981', borderWidth: 2, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 0, borderDash: [4, 4] },
        { label: 'Cash', data: cash, borderColor: '#06b6d4', borderWidth: 2, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 0, borderDash: [4, 4] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 12 }, boxWidth: 16, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          backgroundColor: '#13172e', titleColor: '#fff', bodyColor: '#cbd5e1', borderColor: '#20264b', borderWidth: 1, padding: 12,
          bodyFont: { family: 'Plus Jakarta Sans' }, titleFont: { family: 'Plus Jakarta Sans', weight: 700 },
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw)}` }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(32, 38, 75, 0.4)' }, ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 10 }, maxTicksLimit: 8 } },
        y: { grid: { color: 'rgba(32, 38, 75, 0.4)' }, ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 10 }, callback: v => fmtCurrency(v, 0) } }
      }
    }
  });
}

async function fetchAllocationCountry() {
  try {
    const res = await fetch('/api/allocation');
    const data = await res.json();
    renderAllocationCountryChart(data);
  } catch (e) { console.error('Failed to load country allocation', e); }
}

function renderAllocationCountryChart(data) {
  const ctx = document.getElementById('allocationCountryChart').getContext('2d');
  if (allocationCountryChart) allocationCountryChart.destroy();

  const entries = Object.entries(data.countries);
  if (!entries.length) return;

  const labels = entries.map(([c]) => c);
  const values = entries.map(([, d]) => d.value);
  const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#84cc16', '#f43f5e', '#3b82f6', '#14b8a6'];

  allocationCountryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{ data: values, backgroundColor: PALETTE.slice(0, labels.length), borderColor: '#13172e', borderWidth: 2, hoverOffset: 12 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'right', labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 }, boxWidth: 8, padding: 10, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          backgroundColor: '#13172e', borderColor: '#20264b', borderWidth: 1, bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: { label: ctx => ` ${ctx.label}: ${fmtCurrency(ctx.raw)} (${entries[ctx.dataIndex][1].pct.toFixed(1)}%)` }
        }
      },
      cutout: '70%'
    }
  });
}

async function fetchMonthlyChange() {
  try {
    const res = await fetch('/api/monthly-change');
    const data = await res.json();
    renderMonthlyChangeChart(data);
  } catch (e) {
    console.error('Failed to load monthly change', e);
  }
}

function renderMonthlyChangeChart(data) {
  if (!data.months || !data.months.length) return;
  const ctx = document.getElementById('monthlyChangeChartCanvas').getContext('2d');
  if (monthlyChangeChart) monthlyChangeChart.destroy();

  const bgColors = data.change.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.75)' : 'rgba(239, 68, 68, 0.75)');
  const borderColors = data.change.map(v => v >= 0 ? '#10b981' : '#ef4444');

  // Format month labels concisely
  const labels = data.months.map(d => {
    const parts = d.split('-');
    return `${parts[1]}/${parts[0].slice(2)}`;
  });

  monthlyChangeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: data.change,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#13172e',
          borderColor: '#20264b',
          borderWidth: 1,
          bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: {
            label: function(context) {
              const idx = context.dataIndex;
              return ` Change: ${fmtCurrency(data.change[idx])} (${data.change_pct[idx] >= 0 ? '+' : ''}${data.change_pct[idx].toFixed(2)}%)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans', size: 9 },
            maxTicksLimit: 12,
            maxRotation: 45
          }
        },
        y: {
          grid: { color: 'rgba(32, 38, 75, 0.4)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans', size: 10 },
            callback: function(value) { return fmtCurrency(value, 0); }
          }
        }
      }
    }
  });
}

async function fetchSnapshotsTable(type) {
  try {
    const res = await fetch('/api/snapshots');
    const snapshots = await res.json();
    const tbody = document.getElementById('snapshots-table-body');
    tbody.innerHTML = '';
    const reversed = [...snapshots].reverse();
    reversed.forEach(s => {
      const val = type === 'cash' ? s.cash : s.super;
      tbody.innerHTML += `
        <tr>
          <td style="font-family: monospace; color: var(--text-secondary);">${s.date}</td>
          <td style="font-weight: 700;">${fmtCurrency(val)}</td>
        </tr>
      `;
    });
  } catch (e) {
    console.error('Failed to load snapshots table', e);
  }
}

// ─── Tax / CGT Tab ──────────────────────────────────────────

function onCgtFYChange() {
  const fyVal = document.getElementById('cgt-fy-select').value;
  const fyText = document.getElementById('cgt-fy-select').selectedOptions[0].text.split(' ')[0];
  document.getElementById('cgt-fy-label').textContent = fyText;
  const [from, to] = fyVal.split('|');
  document.getElementById('cgt-from').value = from;
  document.getElementById('cgt-to').value = to;
  fetchCGT();
}

async function fetchCGT() {
  const from = document.getElementById('cgt-from').value;
  const to = document.getElementById('cgt-to').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const res = await fetch(`/api/cgt?${params}`);
    const data = await res.json();

    const fyLabel = document.getElementById('cgt-fy-label');
    if (data.from && data.to) {
      const fromYear = data.from.substring(0, 4);
      const toYear = data.to.substring(0, 4);
      fyLabel.textContent = `FY${toYear}`;
    }

    document.getElementById('cgt-total-gain').textContent = fmtCurrency(data.total_gain);
    document.getElementById('cgt-losses').textContent = '-' + fmtCurrency(data.losses_applied);
    document.getElementById('cgt-discount').textContent = '-' + fmtCurrency(data.cgt_discount);
    document.getElementById('cgt-net-gain').textContent = fmtCurrency(data.net_gain);

    document.getElementById('cgt-count-badge').textContent = `${data.gains.length} disposals`;

    const tbody = document.getElementById('cgt-table-body');
    if (!data.gains.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:32px;">No disposals in this period.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.gains.forEach(g => {
      const gainClass = g.gain >= 0 ? 'text-success' : 'text-danger';
      const sign = g.gain >= 0 ? '+' : '';
      tbody.innerHTML += `
        <tr>
          <td style="font-family:monospace;font-size:12px;color:var(--text-secondary);">${g.date}</td>
          <td style="font-weight:700;">${g.ticker}</td>
          <td>${g.units.toLocaleString()}</td>
          <td style="font-weight:600;">${fmtCurrency(g.proceeds)}</td>
          <td>${fmtCurrency(g.cost_base)}</td>
          <td class="${gainClass}" style="font-weight:700;">${sign}${fmtCurrency(g.gain)}</td>
          <td>${g.held_12m ? '<span class="badge badge-buy">Yes</span>' : '<span class="badge badge-sell">No</span>'}</td>
          <td>${g.discount_eligible ? '<span class="badge badge-buy">50%</span>' : '<span class="badge" style="background:rgba(100,100,100,0.1);color:var(--text-muted);">—</span>'}</td>
        </tr>`;
    });
  } catch (e) {
    console.error('Failed to fetch CGT', e);
  }
}

// ─── Sync Status Tab ────────────────────────────────────────

async function fetchSyncStatus() {
  try {
    const res = await fetch('/api/sync-status');
    const data = await res.json();
    renderSyncStatus(data);
  } catch (e) {
    console.error('Failed to fetch sync status', e);
  }
}

function renderSyncStatus(rows) {
  document.getElementById('sync-status-count').textContent = `${rows.length} symbols`;
  const tbody = document.getElementById('sync-status-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:32px;">No cached data yet. Click Sync All to populate.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  rows.forEach(r => {
    const today = new Date().toISOString().split('T')[0];
    const isCurrent = r.actual_to >= today;
    const isStale = r.actual_to < new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    // Yahoo Finance status: based on price data freshness
    let yfStatus = '';
    if (r.record_count === 0) {
      yfStatus = '<span class="badge badge-sell">No data</span>';
    } else if (isCurrent) {
      yfStatus = `<span class="badge badge-buy">OK — ${new Date(r.last_synced).toLocaleDateString()}</span>`;
    } else if (isStale) {
      yfStatus = `<span class="badge badge-sell">Stale — ${new Date(r.last_synced).toLocaleDateString()}</span>`;
    } else {
      yfStatus = `<span class="badge badge-asx">OK — ${new Date(r.last_synced).toLocaleDateString()}</span>`;
    }

    // Google status: logo + metadata
    let googleStatus = '';
    if (r.has_meta && r.logo_url) {
      googleStatus = `<span class="badge badge-buy">OK</span>`;
    } else if (r.has_meta) {
      googleStatus = '<span class="badge badge-asx">Partial</span>';
    } else {
      googleStatus = '<span class="badge" style="background:rgba(100,100,100,0.1);color:var(--text-muted);">N/A</span>';
    }

    const logoHtml = r.logo_url
      ? `<img src="${r.logo_url}" alt="" style="width:20px;height:20px;border-radius:4px;object-fit:contain;background:#fff;padding:1px;margin-right:8px;vertical-align:middle;" onerror="this.style.display='none'">`
      : '';

    const infoHtml = r.has_meta
      ? `<span style="font-size:13px;font-weight:600;">${r.industry || r.sector}</span>${r.sector && r.industry ? `<br><span style="font-size:10px;color:var(--text-muted);">${r.sector}</span>` : ''}`
      : '<span style="color:var(--text-muted);">—</span>';

    tbody.innerHTML += `
      <tr>
        <td>${logoHtml}<span style="font-weight:700;font-family:monospace;">${r.symbol}</span></td>
        <td>${r.record_count.toLocaleString()} records</td>
        <td style="font-family:monospace;font-size:11px;color:var(--text-secondary);">${r.actual_from || '—'}<br>→ ${r.actual_to || '—'}</td>
        <td>${infoHtml}</td>
        <td>${yfStatus}</td>
        <td>${googleStatus}</td>
      </tr>`;
  });
}

async function syncDataTab() {
  const btn = document.getElementById('sync-tab-btn');
  const icon = document.getElementById('sync-tab-icon');
  btn.disabled = true;
  btn.classList.add('syncing');
  btn.textContent = 'Syncing...';

  try {
    await fetch('/api/sync?force=true', { method: 'POST' });
    await fetchSyncStatus();
    await refreshAllData();
  } catch (e) {
    console.error('Sync failed', e);
  }

  btn.classList.remove('syncing');
  btn.disabled = false;
  btn.innerHTML = `<svg id="sync-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Sync All`;
}

// ─── Holding Edit / Delete ──────────────────────────────────

// Utility Formatters
function fmtCurrency(n, fractionDigits = 2) {
  return '$' + parseFloat(n).toLocaleString(undefined, { 
    minimumFractionDigits: fractionDigits, 
    maximumFractionDigits: fractionDigits 
  });
}

function fmtLocal(n, currency) {
  if (currency === 'USD') {
    return 'US$' + parseFloat(n).toLocaleString(undefined, { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 4 
    });
  }
  return '$' + parseFloat(n).toLocaleString(undefined, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 4 
  });
}
