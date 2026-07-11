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

// Tab switcher
function switchTab(tabId) {
  document.querySelectorAll('.tab-section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(`section-${tabId}`).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`nav-${tabId}`).classList.add('active');

  const headingEl = document.getElementById('page-main-heading');
  if (tabId === 'dashboard') headingEl.textContent = 'Portfolio Overview';
  else if (tabId === 'holdings') headingEl.textContent = 'Assets';
  else if (tabId === 'transactions') headingEl.textContent = 'Transaction History';
  else if (tabId === 'networth') {
    headingEl.textContent = 'Net Worth Breakdown';
    fetchNetworthTabData();
  }
}

// Refresh all dashboard metrics & tables
async function refreshAllData() {
  await Promise.all([
    fetchDashboardStats(),
    fetchNetworthTimeline(),
    fetchHoldings(),
    fetchTransactions()
  ]);
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

    // --- Stocks Table ---
    document.getElementById('holdings-count-badge').textContent = `${holdings.length} Assets`;
    const tbody = document.getElementById('holdings-table-body');
    tbody.innerHTML = '';

    if (holdings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-secondary); padding: 32px;">No active holdings found.</td></tr>`;
      renderPerformanceChart([]);
      return;
    }

    holdings.forEach(h => {
      const returnClass = h.return_aud >= 0 ? 'text-success' : 'text-danger';
      const mktBadge = h.exchange === 'ASX' ? 'badge-asx' : 'badge-us';

      tbody.innerHTML += `
        <tr style="cursor: pointer;" onclick="viewTickerTransactions('${h.ticker}')" title="Click to filter transactions for ${h.ticker}">
          <td>
            <div style="font-weight: 700;">${h.ticker}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${h.name}</div>
          </td>
          <td><span class="badge ${mktBadge}">${h.exchange}</span></td>
          <td>${h.units.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}</td>
          <td>${fmtLocal(h.avg_price, h.currency)}</td>
          <td>${fmtCurrency(h.avg_price_aud)}</td>
          <td>
            <div>${fmtLocal(h.current_price, h.currency)}</div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${fmtCurrency(h.current_price_aud)} AUD</div>
          </td>
          <td style="font-weight: 700;">${fmtCurrency(h.value_aud)}</td>
          <td>
            <div class="${returnClass}" style="font-weight: 700;">${h.return_aud >= 0 ? '+' : ''}${fmtCurrency(h.return_aud)}</div>
            <div class="${returnClass}" style="font-size: 11px; margin-top: 2px;">${h.return_pct >= 0 ? '+' : ''}${h.return_pct.toFixed(2)}%</div>
          </td>
          <td style="font-weight: 600; color: var(--text-secondary);">${h.weight.toFixed(1)}%</td>
        </tr>
      `;
    });

    // Draw performance bar chart
    renderPerformanceChart(holdings);

  } catch (e) {
    console.error('Failed to load holdings', e);
  }
}

// Click a holding row → jump to Transactions tab filtered by ticker
function viewTickerTransactions(ticker) {
  switchTab('transactions');
  document.getElementById('ledger-search').value = ticker;
  filterLedger();
}

// Fetch all transactions
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
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-secondary); padding: 32px;">No transactions recorded. Click Add Transaction to start.</td></tr>`;
    return;
  }
  
  // Render chronologically reversed (newest first)
  const reversed = [...txns].reverse();
  
  reversed.forEach((t, revIdx) => {
    // Correct index maps back to original array
    const originalIdx = txns.length - 1 - revIdx;
    
    const actBadge = t.action.toLowerCase() === 'buy' ? 'badge-buy' : 'badge-sell';
    const mktBadge = t.exchange === 'ASX' ? 'badge-asx' : 'badge-us';
    
    tbody.innerHTML += `
      <tr>
        <td style="font-family: monospace; font-size: 13px; color: var(--text-secondary);">${t.date}</td>
        <td style="font-weight: 700; color: var(--color-primary-light);">${t.ticker}</td>
        <td><span class="badge ${mktBadge}">${t.exchange}</span></td>
        <td><span class="badge ${actBadge}">${t.action}</span></td>
        <td>${t.units.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td>${fmtLocal(t.price, t.currency)}</td>
        <td>${fmtLocal(t.brokerage, t.currency)}</td>
        <td style="font-weight: 700;">${fmtCurrency(t.value)}</td>
        <td style="font-family: monospace; font-size: 12px; color: var(--text-muted);">${t.exch_rate ? t.exch_rate.toFixed(4) : '1.0000'}</td>
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
}

// ─── Snapshot Modal (Cash / Super) ──────────────────────────

function openSnapshotModal(type) {
  document.getElementById('snapshot-type').value = type;
  const title = type === 'cash' ? 'Update Cash Balance' : 'Update Super Balance';
  document.getElementById('snapshot-modal-title').textContent = title;
  // Default date to 1st of current month
  const now = new Date();
  document.getElementById('snapshot-date').valueAsDate = new Date(now.getFullYear(), now.getMonth(), 1);
  // Pre-fill with current value
  if (rawBreakdown) {
    document.getElementById('snapshot-amount').value = type === 'cash' ? rawBreakdown.cash : rawBreakdown.super;
  }
  document.getElementById('snapshot-modal').classList.add('active');
}

function closeSnapshotModal() {
  document.getElementById('snapshot-modal').classList.remove('active');
  document.getElementById('snapshot-form').reset();
}

async function submitSnapshot(e) {
  e.preventDefault();
  const type = document.getElementById('snapshot-type').value;
  const date = document.getElementById('snapshot-date').value;
  const amount = parseFloat(document.getElementById('snapshot-amount').value);

  if (!date || isNaN(amount)) return;

  // Get the current values from the latest snapshot to preserve the other field
  let cashVal = amount;
  let superVal = amount;
  try {
    const res = await fetch('/api/snapshots');
    const snapshots = await res.json();
    // Find the closest snapshot to this date, or use latest
    const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    if (type === 'cash') {
      superVal = latest ? latest.super : 0;
    } else {
      cashVal = latest ? latest.cash : 0;
    }
  } catch (_) {}

  try {
    const res = await fetch('/api/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, super: superVal, cash: cashVal })
    });
    const data = await res.json();
    if (data.ok) {
      closeSnapshotModal();
      await refreshAllData();
    } else {
      alert(`Error saving snapshot: ${data.error}`);
    }
  } catch (err) {
    console.error('Failed to save snapshot', err);
    alert('Failed to save. Check connection.');
  }
}

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
      // Reload stats and graphs
      await refreshAllData();
    } else {
      alert(`Delete failed: ${data.error}`);
    }
  } catch (e) {
    console.error('Failed to delete transaction', e);
  }
}

// ─── Net Worth Tab ──────────────────────────────────────────

async function fetchNetworthTabData() {
  await Promise.all([
    fetchMonthlyChange(),
    fetchAllocationCountry(),
    fetchSnapshotsTable()
  ]);
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

  networthTimelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        { label: 'Net Worth', data: networth, borderColor: '#f8fafc', borderWidth: 3, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: '#f8fafc', pointHoverBorderColor: '#13172e', pointHoverBorderWidth: 2 },
        { label: 'Portfolio', data: portfolio, borderColor: '#6366f1', borderWidth: 2, backgroundColor: 'transparent', fill: false, tension: 0.15, pointRadius: 0, pointHoverRadius: 0 },
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
  allocationCountryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Australia', 'United States'],
      datasets: [{ data: [data.australia, data.us], backgroundColor: ['#10b981', '#6366f1'], borderColor: '#13172e', borderWidth: 2, hoverOffset: 12 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'right', labels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', weight: 600, size: 11 }, boxWidth: 8, padding: 10, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: {
          backgroundColor: '#13172e', borderColor: '#20264b', borderWidth: 1, bodyFont: { family: 'Plus Jakarta Sans' },
          callbacks: { label: function(ctx) { const pct = ctx.dataIndex === 0 ? data.australia_pct : data.us_pct; return ` ${ctx.label}: ${fmtCurrency(ctx.raw)} (${pct.toFixed(1)}%)`; } }
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

async function fetchSnapshotsTable() {
  try {
    const res = await fetch('/api/snapshots');
    const snapshots = await res.json();
    document.getElementById('snapshots-count-badge').textContent = `${snapshots.length} Months`;
    const tbody = document.getElementById('snapshots-table-body');
    tbody.innerHTML = '';
    // Show newest first
    const reversed = [...snapshots].reverse();
    reversed.forEach(s => {
      const combined = s.super + s.cash;
      tbody.innerHTML += `
        <tr>
          <td style="font-family: monospace; color: var(--text-secondary);">${s.date}</td>
          <td style="font-weight: 700;">${fmtCurrency(s.super)}</td>
          <td style="font-weight: 700;">${fmtCurrency(s.cash)}</td>
          <td style="font-weight: 800; color: var(--color-primary-light);">${fmtCurrency(combined)}</td>
        </tr>
      `;
    });
  } catch (e) {
    console.error('Failed to load snapshots table', e);
  }
}

// ─── End Net Worth Tab ──────────────────────────────────────

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
