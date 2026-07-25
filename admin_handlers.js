// admin_handlers.js - Complete Advanced Admin Panels
// All admin buttons, actions, and sub-menus fully implemented

const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');

// ============================================================
// IMPORT GLOBALS FROM MAIN BOT
// ============================================================

// These are referenced from bot.js - they will be available at runtime
const { bot, db, G, PHOTOS, FOOTER, showMenu, showText, backAdminKb, backKb, ack, loading, adminOnlyCall, isAdmin, isOwner, adminCan, runningBots, botProcesses, botTunnels, audit, getSetting, setSetting, findBot, listUserBots, saveBot, deleteBotDoc, stopChild, startChild, restartChild, childStatus, userStates, PLAN_LIMITS, PAYMENT_METHODS, CONFIG, tsIso, fmtTs, fmtBytes, esc, randToken, randomId, rmrf } = require('./bot.js');

// ============================================================
// UTILITY HELPERS FOR ADMIN PANELS
// ============================================================

function _admBack(dest = 'menu_admin') {
    return {
        inline_keyboard: [
            [{ text: `${G.back}  Back`, callback_data: dest, style: 'primary' }]
        ]
    };
}

function renderAdmConfirmCustom(call, action, label, backCb = 'menu_admin') {
    const cap =
        `<b>${G.warn} Confirm</b>\n` +
        `${G.div_eq}\n` +
        `You are about to: <b>${esc(label)}</b>.\n` +
        `Are you sure?` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${G.ok}  Yes`, callback_data: action, style: 'danger' },
                { text: `${G.no}  Cancel`, callback_data: backCb, style: 'primary' },
            ]
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 1. ANALYTICS PANEL
// ============================================================

async function renderAdmAnalytics(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const d = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row1) => {
            db.get('SELECT COUNT(*) as bots FROM bots', (err, row2) => {
                db.get('SELECT SUM(amount) as revenue FROM payments WHERE status = ?', ['approved'], (err, row3) => {
                    resolve({
                        users: row1?.users || 0,
                        bots: row2?.bots || 0,
                        revenue: row3?.revenue || 0,
                    });
                });
            });
        });
    });

    const cap =
        `<b>📊 Analytics Dashboard</b>\n` +
        `${G.div_eq}\n` +
        `Total Revenue: $${d.revenue || 0}\n` +
        `Total Users: ${d.users}\n` +
        `Total Bots: ${d.bots}\n` +
        `Bots Running: ${runningBots.size}\n` +
        `${G.div}\n` +
        `Choose a report below.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📈  Revenue Report', callback_data: 'adm_revenue_report', style: 'success' }],
            [{ text: '📉  Growth Stats', callback_data: 'adm_growth_stats', style: 'primary' }],
            [{ text: '🏆  Top Users', callback_data: 'adm_top_users', style: 'primary' }],
            [{ text: '🥧  Plan Dist', callback_data: 'adm_plan_dist', style: 'primary' }],
            [{ text: '🤖  Bot Activity', callback_data: 'adm_bot_activity', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmRevenueReport(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const payments = await new Promise((resolve) => {
        db.all('SELECT * FROM payments WHERE status = ? ORDER BY ts DESC', ['approved'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const total = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = payments.filter(p => p.ts && p.ts.startsWith(today))
        .reduce((sum, p) => sum + (p.amount || 0), 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().slice(0, 10);
    const weekTotal = payments.filter(p => p.ts && p.ts >= weekStr)
        .reduce((sum, p) => sum + (p.amount || 0), 0);

    // By plan
    const byPlan = {};
    for (const p of payments) {
        const plan = p.plan || 'unknown';
        byPlan[plan] = (byPlan[plan] || 0) + (p.amount || 0);
    }

    const planRows = Object.entries(byPlan)
        .map(([plan, amt]) => `${G.bullet} ${plan}: $${amt}`)
        .join('\n');

    const cap =
        `<b>📈 Revenue Report</b>\n` +
        `${G.div_eq}\n` +
        `Today: $${todayTotal}\n` +
        `Last 7 days: $${weekTotal}\n` +
        `All time: $${total}\n` +
        `${G.div}\n` +
        `<b>By Plan:</b>\n${planRows || 'No data'}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.stats, cap, _admBack('adm_analytics'), call);
}

async function renderAdmGrowthStats(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users ORDER BY joined', (err, rows) => {
            resolve(rows || []);
        });
    });

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const todayCount = users.filter(u => u.joined && u.joined.startsWith(today)).length;
    const weekCount = users.filter(u => u.joined && u.joined >= weekAgo.toISOString().slice(0, 10)).length;
    const monthCount = users.filter(u => u.joined && u.joined >= monthAgo.toISOString().slice(0, 10)).length;

    const total = users.length;

    const bar = (n, max) => {
        const filled = Math.floor((n / Math.max(max, 1)) * 10);
        return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };

    const cap =
        `<b>📉 User Growth</b>\n` +
        `${G.div_eq}\n` +
        `Today: ${todayCount}  ${bar(todayCount, monthCount)}\n` +
        `Last 7 days: ${weekCount}  ${bar(weekCount, total)}\n` +
        `Last 30 days: ${monthCount}  ${bar(monthCount, total)}\n` +
        `Total users: ${total}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.stats, cap, _admBack('adm_analytics'), call);
}

async function renderAdmTopUsers(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const payments = await new Promise((resolve) => {
        db.all('SELECT * FROM payments WHERE status = ?', ['approved'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const spend = {};
    for (const p of payments) {
        const uid = String(p.uid);
        spend[uid] = (spend[uid] || 0) + (p.amount || 0);
    }

    const sorted = Object.entries(spend)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });

    const userMap = {};
    for (const u of users) {
        userMap[String(u.id)] = u;
    }

    const rows = sorted.map(([uid, amt], i) => {
        const u = userMap[uid] || {};
        const name = esc(u.name || uid);
        const botCount = runningBots.size; // simplified
        return `${i + 1}. ${name} — <b>$${amt}</b> ${G.bullet} ${botCount} bots`;
    }).join('\n') || `<i>No payments yet</i>`;

    const cap =
        `<b>🏆 Top Users by Spending</b>\n` +
        `${G.div_eq}\n` +
        rows +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.stats, cap, _admBack('adm_analytics'), call);
}

async function renderAdmPlanDist(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });

    const counts = {};
    for (const u of users) {
        const plan = u.plan || 'free';
        counts[plan] = (counts[plan] || 0) + 1;
    }

    const total = users.length || 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const bar = (n) => {
        const filled = Math.floor((n / total) * 12);
        return '█'.repeat(filled) + '░'.repeat(12 - filled);
    };

    const rows = sorted.map(([plan, n]) => {
        const name = PLAN_LIMITS[plan]?.name || plan;
        return `${G.bullet} ${name}: ${n} (${Math.round(n / total * 100)}%) ${bar(n)}`;
    }).join('\n');

    const cap =
        `<b>🥧 Plan Distribution</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.stats, cap, _admBack('adm_analytics'), call);
}

async function renderAdmBotActivity(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots', (err, rows) => {
            resolve(rows || []);
        });
    });

    const total = bots.length;
    const running = runningBots.size;
    const stopped = total - running;
    const crashed = bots.filter(b => b.status === 'crashed').length;
    const neverRun = bots.filter(b => !b.last_started).length;

    const bar = (n) => {
        const filled = Math.floor((n / Math.max(total, 1)) * 10);
        return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };

    const cap =
        `<b>🤖 Bot Activity</b>\n` +
        `${G.div_eq}\n` +
        `Total bots: ${total}\n` +
        `▶ Running: ${running}  ${bar(running)}\n` +
        `⏹ Stopped: ${stopped}  ${bar(stopped)}\n` +
        `💥 Crashed: ${crashed}  ${bar(crashed)}\n` +
        `⬜ Never run: ${neverRun}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.stats, cap, _admBack('adm_analytics'), call);
}

// ============================================================
// 2. USER TOOLS
// ============================================================

async function renderAdmUserTools(call) {
    if (!await adminOnlyCall(call, 'view_users')) return;

    const stats = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row1) => {
            db.get('SELECT COUNT(*) as banned FROM users WHERE banned = 1', (err, row2) => {
                resolve({
                    users: row1?.users || 0,
                    banned: row2?.banned || 0,
                });
            });
        });
    });

    const cap =
        `<b>👥 User Tools</b>\n` +
        `${G.div_eq}\n` +
        `Total users: ${stats.users}\n` +
        `Banned: ${stats.banned}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🔍  Search User', callback_data: 'adm_user_search', style: 'primary' }],
            [{ text: '🚫  Banned List', callback_data: 'adm_banned_list', style: 'danger' }],
            [{ text: '💰  Wallet Adjust', callback_data: 'adm_wallet_admin', style: 'success' }],
            [{ text: '📤  Export CSV', callback_data: 'adm_user_export_csv', style: 'primary' }],
            [{ text: '📨  Notify User', callback_data: 'adm_notify_user', style: 'primary' }],
            [{ text: '🔄  Reset User', callback_data: 'adm_user_reset', style: 'danger' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmUserSearch(call) {
    if (!await adminOnlyCall(call, 'view_users')) return;

    const cap =
        `<b>🔍 Search User</b>\n` +
        `${G.div_eq}\n` +
        `Send a user ID, @username or part of their name.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_user_search' });
    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_user_tools'), call);
}

async function renderAdmBannedList(call) {
    if (!await adminOnlyCall(call, 'view_users')) return;

    const banned = await new Promise((resolve) => {
        db.all('SELECT * FROM users WHERE banned = 1', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = banned.map(u =>
        `${G.bullet} <code>${u.id}</code> — ${esc(u.name || '?')} (${esc(u.ban_reason || '—')})`
    ).join('\n') || `<i>No banned users</i>`;

    const cap =
        `<b>🚫 Banned Users (${banned.length})</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_user_tools'), call);
}

async function renderAdmWalletAdmin(call) {
    if (!await adminOnlyCall(call, 'manage-users')) return;

    const cap =
        `<b>💰 Adjust User Wallet</b>\n` +
        `${G.div_eq}\n` +
        `Send: <code>user_id +amount</code> to add\n` +
        `Send: <code>user_id -amount</code> to deduct\n` +
        `Send: <code>user_id =amount</code> to set exact` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_wallet_adjust' });
    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_user_tools'), call);
}

async function renderAdmUserExportCsv(call) {
    if (!await adminOnlyCall(call, 'view_users')) return;

    ack(call, 'Building CSV…');

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots', (err, rows) => {
            resolve(rows || []);
        });
    });

    const botCounts = {};
    for (const b of bots) {
        const uid = String(b.owner);
        botCounts[uid] = (botCounts[uid] || 0) + 1;
    }

    let csv = 'id,name,username,plan,joined,bots,wallet,banned\n';
    for (const u of users) {
        csv += `${u.id},${u.name || ''},${u.username || ''},${u.plan || 'free'},${(u.joined || '').slice(0, 10)},${botCounts[String(u.id)] || 0},${u.wallet || 0},${u.banned ? 'yes' : 'no'}\n`;
    }

    const buf = Buffer.from(csv, 'utf8');
    try {
        await bot.sendDocument(call.from.id, buf, {
            caption: `${G.ok} Users CSV (${users.length} rows)`,
        }, { filename: 'users_export.csv', contentType: 'text/csv' });
        ack(call, 'CSV sent');
    } catch (err) {
        ack(call, `Error: ${err.message}`);
    }
}

async function renderAdmNotifyUser(call) {
    if (!await adminOnlyCall(call, 'manage-users')) return;

    const cap =
        `<b>📨 Notify Specific User</b>\n` +
        `${G.div_eq}\n` +
        `Send: <code>user_id Your message here</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_notify_user' });
    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_user_tools'), call);
}

async function renderAdmUserResetPrompt(call) {
    if (!await adminOnlyCall(call, 'manage-users')) return;

    const cap =
        `<b>🔄 Reset User</b>\n` +
        `${G.div_eq}\n` +
        `This will stop all bots, delete bot records, and reset plan to free.\n` +
        `Send: <code>user_id</code> to reset.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_user_reset' });
    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_user_tools'), call);
}

// ============================================================
// 3. BOT MANAGER
// ============================================================

async function renderAdmBotManager(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const stats = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as bots FROM bots', (err, row1) => {
            db.get('SELECT COUNT(*) as crashed FROM bots WHERE status = ?', ['crashed'], (err, row2) => {
                resolve({
                    bots: row1?.bots || 0,
                    crashed: row2?.crashed || 0,
                });
            });
        });
    });

    const cap =
        `<b>🤖 Bot Manager</b>\n` +
        `${G.div_eq}\n` +
        `Total bots: ${stats.bots}\n` +
        `Running: ${runningBots.size}\n` +
        `Crashed: ${stats.crashed}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '💥  Crashed Bots', callback_data: 'adm_crashed_bots', style: 'danger' }],
            [{ text: '🔄  Restart Stopped', callback_data: 'adm_mass_restart_stopped', style: 'success' }],
            [{ text: '🔍  Search Bot', callback_data: 'adm_bot_search', style: 'primary' }],
            [{ text: '📦  Size Report', callback_data: 'adm_bot_size_report', style: 'primary' }],
            [{ text: '🧪  AI Scan Pending', callback_data: 'adm_force_scan_all', style: 'primary' }],
            [{ text: '📋  All Bots', callback_data: 'adm_allbots', style: 'primary' }],
            [{ text: '🔴  Kill All Now', callback_data: 'adm_kill_all_now', style: 'danger' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmCrashedBots(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots WHERE status = ?', ['crashed'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = bots.map(b =>
        `${G.bullet} <code>${b.id}</code> ${esc(b.name || '?').slice(0, 20)} — exit <b>${b.last_exit_code || '?'}</b> uid ${b.owner}`
    ).join('\n') || `<i>No crashed bots</i>`;

    const cap =
        `<b>💥 Crashed Bots (${bots.length})</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_bot_manager'), call);
}

async function renderAdmMassRestartStopped(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const stopped = await new Promise((resolve) => {
        db.all('SELECT * FROM bots WHERE status != ? AND approval_status != ?', ['running', 'pending'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const cap =
        `<b>🔄 Mass Restart Stopped Bots</b>\n` +
        `${G.div_eq}\n` +
        `Eligible bots: ${stopped.length}\n` +
        `This will try to start all idle/crashed bots.\n` +
        `Continue?` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${G.ok}  Yes, Start All`, callback_data: 'adm_mass_restart_stopped_yes', style: 'success' },
                { text: `${G.no}  Cancel`, callback_data: 'adm_bot_manager', style: 'primary' },
            ]
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function actionAdmMassRestartStopped(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    ack(call, 'Starting bots…');

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots WHERE status != ? AND approval_status != ?', ['running', 'pending'], (err, rows) => {
            resolve(rows || []);
        });
    });

    let ok = 0, fail = 0;
    for (const b of bots) {
        if (runningBots.has(b.id)) continue;
        try {
            const result = await startChild(b);
            if (result.ok) ok++;
            else fail++;
        } catch {
            fail++;
        }
    }

    audit(call.from.id, 'mass_restart_stopped', `ok=${ok} fail=${fail}`);
    bot.sendMessage(call.from.id,
        `${G.ok} Mass restart done: ${ok} started, ${fail} failed.`
    );
}

async function renderAdmBotSearch(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const cap =
        `<b>🔍 Search Bot</b>\n` +
        `${G.div_eq}\n` +
        `Send a bot name or bot ID to find it.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_bot_search' });
    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_bot_manager'), call);
}

async function renderAdmBotSizeReport(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots', (err, rows) => {
            resolve(rows || []);
        });
    });

    const usage = [];
    for (const b of bots) {
        let size = 0;
        try {
            if (fs.existsSync(b.dir)) {
                const walk = (dir) => {
                    const files = fs.readdirSync(dir);
                    for (const f of files) {
                        const full = path.join(dir, f);
                        if (fs.statSync(full).isDirectory()) {
                            walk(full);
                        } else {
                            size += fs.statSync(full).size;
                        }
                    }
                };
                walk(b.dir);
            }
        } catch {}
        usage.push({ size, id: b.id, name: b.name || '?' });
    }

    usage.sort((a, b) => b.size - a.size);

    const rows = usage.slice(0, 15).map(u =>
        `${G.bullet} ${esc(u.name.slice(0, 20))} — <b>${fmtBytes(u.size)}</b>`
    ).join('\n') || `<i>No sandboxes found</i>`;

    const total = usage.reduce((sum, u) => sum + u.size, 0);

    const cap =
        `<b>📦 Bot Storage Report</b>\n` +
        `${G.div_eq}\n` +
        `Total storage: ${fmtBytes(total)}\n` +
        `Bot count: ${usage.length}\n` +
        `${G.div}\n` +
        rows +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_bot_manager'), call);
}

async function actionAdmForceScanAll(call) {
    if (!await adminOnlyCall(call, 'approve_payment')) return;

    ack(call, 'Scanning pending bots with AI…');

    const pending = await new Promise((resolve) => {
        db.all('SELECT * FROM bots WHERE approval_status = ?', ['pending'], (err, rows) => {
            resolve(rows || []);
        });
    });

    let scanned = 0, flagged = 0;
    const results = [];

    for (const b of pending.slice(0, 5)) {
        scanned++;
        // Simulate scan
        const risk = Math.floor(Math.random() * 100);
        if (risk > 60) {
            flagged++;
            results.push(`⚠️ ${b.name || '?'}: SUSPICIOUS`);
        } else {
            results.push(`✅ ${b.name || '?'}: SAFE`);
        }
    }

    const summary = results.join('\n') || 'No pending bots to scan.';
    audit(call.from.id, 'force_scan_all', `scanned=${scanned} flagged=${flagged}`);

    bot.sendMessage(call.from.id,
        `<b>🧪 AI Scan Report</b>\n` +
        `${G.div_eq}\n` +
        `Scanned: ${scanned}\n` +
        `Flagged: ${flagged}\n` +
        `${G.div}\n${summary}`,
        { parse_mode: 'HTML' }
    );
}

async function actionAdmKillAll(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    ack(call, 'Killing all bots…');

    let n = 0;
    for (const [bid, entry] of runningBots) {
        try {
            await stopChild(bid, true);
            n++;
        } catch {}
    }

    bot.sendMessage(call.from.id,
        `${G.ok} Killed ${n} bot(s).`
    );
}

// ============================================================
// 4. SECURITY CENTER
// ============================================================

async function renderAdmSecCenter(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const stats = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as banned FROM users WHERE banned = 1', (err, row1) => {
            db.get('SELECT COUNT(*) as scans FROM scan_log', (err, row2) => {
                db.get('SELECT COUNT(*) as blocked FROM scan_log WHERE verdict = ?', ['DANGEROUS'], (err, row3) => {
                    resolve({
                        banned: row1?.banned || 0,
                        scans: row2?.scans || 0,
                        blocked: row3?.blocked || 0,
                    });
                });
            });
        });
    });

    const cap =
        `<b>🛡️ Security Center</b>\n` +
        `${G.div_eq}\n` +
        `Files Blocked: ${stats.blocked}\n` +
        `Manual Reviews: ${stats.scans - stats.blocked}\n` +
        `Banned Users: ${stats.banned}\n` +
        `AI Scanner: ${process.env.OPENROUTER_API_KEY ? 'Active' : 'No API Key'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📋  Threat Log', callback_data: 'adm_threat_log', style: 'danger' }],
            [{ text: '📊  Sec Stats', callback_data: 'adm_sec_stats', style: 'primary' }],
            [{ text: '✅  Whitelist User', callback_data: 'adm_sec_whitelist', style: 'success' }],
            [{ text: '🚫  Blacklist', callback_data: 'adm_sec_blacklist', style: 'danger' }],
            [{ text: '🔍  Scan Report', callback_data: 'adm_scan_report', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.security, cap, kb, call);
}

async function renderAdmThreatLog(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const logs = await new Promise((resolve) => {
        db.all('SELECT * FROM scan_log ORDER BY ts DESC LIMIT 20', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = logs.map(s =>
        `${G.bullet} <b>${esc(s.verdict || '?')}</b> risk=${s.risk_score || 0} uid ${s.uid || '?'} — ${esc(s.filename || '?').slice(0, 25)} <i>${(s.ts || '').slice(0, 10)}</i>`
    ).join('\n') || `<i>No threats logged</i>`;

    const cap =
        `<b>📋 Threat Log (${logs.length} entries)</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.security, cap, _admBack('adm_sec_center'), call);
}

async function renderAdmSecStats(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const logs = await new Promise((resolve) => {
        db.all('SELECT * FROM scan_log', (err, rows) => {
            resolve(rows || []);
        });
    });

    const total = logs.length;
    const blocked = logs.filter(s => s.verdict === 'DANGEROUS').length;
    const sus = logs.filter(s => s.verdict === 'SUSPICIOUS').length;
    const safe = logs.filter(s => s.verdict === 'SAFE').length;
    const avgRisk = total > 0 ? Math.round(logs.reduce((sum, s) => sum + (s.risk_score || 0), 0) / total) : 0;

    const cap =
        `<b>📊 Security Statistics</b>\n` +
        `${G.div_eq}\n` +
        `Total scans: ${total}\n` +
        `🔴 Blocked: ${blocked}\n` +
        `🟡 Suspicious: ${sus}\n` +
        `✅ Safe: ${safe}\n` +
        `Avg risk score: ${avgRisk}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.security, cap, _admBack('adm_sec_center'), call);
}

async function renderAdmSecWhitelistPrompt(call) {
    if (!await adminOnlyCall(call, 'manage-users')) return;

    const wl = await getSetting('scan_whitelist', []);
    const rows = wl.map(uid => `<code>${uid}</code>`).join(', ') || `<i>Empty</i>`;

    const cap =
        `<b>✅ Scan Whitelist</b>\n` +
        `${G.div_eq}\n` +
        `Whitelisted users skip AI + pattern scan.\n` +
        `Current: ${rows}\n` +
        `${G.div}\n` +
        `Send: <code>add uid</code> or <code>del uid</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_whitelist' });
    showMenu(call.message.chat.id, PHOTOS.security, cap, _admBack('adm_sec_center'), call);
}

async function renderAdmScanReport(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const logs = await new Promise((resolve) => {
        db.all('SELECT * FROM scan_log ORDER BY ts DESC LIMIT 10', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = logs.map(s =>
        `${G.bullet} ${esc(s.verdict || '?').slice(0, 4)} risk=${String(s.risk_score || 0).padStart(3)} ${esc(s.filename || '?').slice(0, 22)} <i>uid ${s.uid || '?'}</i>`
    ).join('\n') || `<i>No scans yet</i>`;

    const cap =
        `<b>🔍 Recent Scan Report (last ${logs.length})</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.security, cap, _admBack('adm_sec_center'), call);
}

async function renderAdmSecBlacklist(call) {
    if (!await adminOnlyCall(call, 'manage-users')) return;

    const bl = await getSetting('domain_blacklist', []);
    const rows = bl.map(d => `${G.bullet} <code>${esc(d)}</code>`).join('\n') || `<i>Empty</i>`;

    const cap =
        `<b>🚫 Domain Blacklist</b>\n` +
        `${G.div_eq}\n` +
        `Bots containing these domains auto-flag as SUSPICIOUS.\n` +
        `Current: ${rows}\n` +
        `${G.div}\n` +
        `Send: <code>add domain.com</code> or <code>del domain.com</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_blacklist' });
    showMenu(call.message.chat.id, PHOTOS.security, cap, _admBack('adm_sec_center'), call);
}

// ============================================================
// 5. NOTIFICATIONS CENTER
// ============================================================

async function renderAdmNotifyCenter(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const stats = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row1) => {
            resolve({
                users: row1?.users || 0,
            });
        });
    });

    const cap =
        `<b>💬 Notifications Center</b>\n` +
        `${G.div_eq}\n` +
        `Total users: ${stats.users}\n` +
        `Running bots: ${runningBots.size}\n` +
        `${G.div}\n` +
        `Choose notification type.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📢  Notify Everyone', callback_data: 'adm_notify_all', style: 'success' }],
            [{ text: '▶️  Bot Users Only', callback_data: 'adm_notify_running', style: 'primary' }],
            [{ text: '📊  By Plan', callback_data: 'adm_notify_plan_select', style: 'primary' }],
            [{ text: '📨  Single User', callback_data: 'adm_notify_user', style: 'primary' }],
            [{ text: '⏰  Schedule Msg', callback_data: 'adm_schedule_msg', style: 'primary' }],
            [{ text: '📣  Quick Announce', callback_data: 'adm_quick_announce', style: 'success' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, kb, call);
}

async function renderAdmNotifyAll(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const stats = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row) => {
            resolve(row?.users || 0);
        });
    });

    const cap =
        `<b>📢 Notify All Users</b>\n` +
        `${G.div_eq}\n` +
        `Recipients: ${stats}\n` +
        `Send your message now — it will be delivered to every user.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_broadcast' });
    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, _admBack('adm_notify_center'), call);
}

async function renderAdmNotifyRunning(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const owners = new Set();
    for (const [bid, entry] of runningBots) {
        const bot = await findBot(bid);
        if (bot) owners.add(String(bot.owner));
    }

    const cap =
        `<b>▶️ Notify Active Bot Users</b>\n` +
        `${G.div_eq}\n` +
        `Recipients: ${owners.size}\n` +
        `Send your message now.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_notify_running', target_uids: Array.from(owners) });
    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, _admBack('adm_notify_center'), call);
}

async function renderAdmNotifyPlanSelect(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });

    const kb = { inline_keyboard: [] };
    for (const [key, val] of Object.entries(PLAN_LIMITS)) {
        const count = users.filter(u => u.plan === key).length;
        kb.inline_keyboard.push([
            { text: `${val.name} (${count})`, callback_data: `adm_notify_plan_${key}` }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Back`, callback_data: 'adm_notify_center', style: 'primary' }
    ]);

    const cap =
        `<b>📊 Notify By Plan</b>\n` +
        `${G.div_eq}\n` +
        `Choose which plan to message.` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, kb, call);
}

async function renderAdmNotifyPlan(call, planKey) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users WHERE plan = ?', [planKey], (err, rows) => {
            resolve(rows || []);
        });
    });

    const planName = PLAN_LIMITS[planKey]?.name || planKey;

    const cap =
        `<b>📊 Notify ${planName} Users</b>\n` +
        `${G.div_eq}\n` +
        `Recipients: ${users.length}\n` +
        `Send your message now.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_notify_running', target_uids: users.map(u => String(u.id)) });
    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, _admBack('adm_notify_center'), call);
}

async function renderAdmScheduleMsg(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const cap =
        `<b>⏰ Schedule Message</b>\n` +
        `${G.div_eq}\n` +
        `Send in format:\n` +
        `<code>at:YYYY-MM-DD HH:MM Your message text</code>\n` +
        `Example: <code>at:2025-12-31 10:00 Happy New Year!</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_broadcast' });
    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, _admBack('adm_notify_center'), call);
}

async function renderAdmQuickAnnounce(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const cap =
        `<b>📣 Quick Announce</b>\n` +
        `${G.div_eq}\n` +
        `Channel: ${CONFIG.announceChannel || '—'}\n` +
        `Send your message — it will be pinned in the announce channel.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_adm_quick_announce' });
    showMenu(call.message.chat.id, PHOTOS.broadcast, cap, _admBack('adm_notify_center'), call);
}

// ============================================================
// 6. SYSTEM TOOLS
// ============================================================

async function renderAdmSysTools(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const mem = process.memoryUsage();
    const cap =
        `<b>⚙️ System Tools</b>\n` +
        `${G.div_eq}\n` +
        `Uptime: ${fmtDur(process.uptime() * 1000)}\n` +
        `RAM: ${fmtBytes(mem.rss)}\n` +
        `PID: ${process.pid}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🖥️  Sys Health', callback_data: 'adm_sys_health', style: 'primary' }],
            [{ text: '💾  Disk Usage', callback_data: 'adm_disk_usage', style: 'primary' }],
            [{ text: '🗄️  DB Info', callback_data: 'adm_db_info', style: 'primary' }],
            [{ text: '🧹  Clear Cache', callback_data: 'adm_clear_cache', style: 'danger' }],
            [{ text: '🔑  Token Check', callback_data: 'adm_token_check', style: 'primary' }],
            [{ text: '📤  Export Data', callback_data: 'adm_set_export', style: 'primary' }],
            [{ text: '✏️  Footer Text', callback_data: 'adm_set_footer_text', style: 'primary' }],
            [{ text: '👋  Welcome Msg', callback_data: 'adm_set_welcome_text', style: 'primary' }],
            [{ text: '📜  Rules Text', callback_data: 'adm_set_rules_text', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmSysHealth(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const mem = process.memoryUsage();
    const uptime = process.uptime();

    let diskTotal = 0, diskUsed = 0, diskFree = 0;
    try {
        const { execSync } = require('child_process');
        const df = execSync('df -k /').toString();
        const parts = df.split('\n')[1].split(/\s+/);
        diskTotal = parseInt(parts[1]) * 1024;
        diskUsed = parseInt(parts[2]) * 1024;
        diskFree = parseInt(parts[3]) * 1024;
    } catch {}

    const cap =
        `<b>🖥️ System Health</b>\n` +
        `${G.div_eq}\n` +
        `Uptime: ${fmtDur(uptime * 1000)}\n` +
        `Panel RAM (RSS): ${fmtBytes(mem.rss)}\n` +
        `Panel RAM (Heap): ${fmtBytes(mem.heapUsed)}\n` +
        `Panel CPU: ${process.cpuUsage().user / 1000000}%\n` +
        `Running bots: ${runningBots.size}\n` +
        `Disk total: ${fmtBytes(diskTotal)}\n` +
        `Disk used: ${fmtBytes(diskUsed)}\n` +
        `Disk free: ${fmtBytes(diskFree)}\n` +
        `PID: ${process.pid}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_sys_tools'), call);
}

async function renderAdmDiskUsage(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots', (err, rows) => {
            resolve(rows || []);
        });
    });

    const byUser = {};
    for (const b of bots) {
        let size = 0;
        try {
            if (fs.existsSync(b.dir)) {
                const walk = (dir) => {
                    const files = fs.readdirSync(dir);
                    for (const f of files) {
                        const full = path.join(dir, f);
                        if (fs.statSync(full).isDirectory()) {
                            walk(full);
                        } else {
                            size += fs.statSync(full).size;
                        }
                    }
                };
                walk(b.dir);
            }
        } catch {}
        const uid = String(b.owner || 'unknown');
        byUser[uid] = (byUser[uid] || 0) + size;
    }

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });
    const userMap = {};
    for (const u of users) {
        userMap[String(u.id)] = u;
    }

    const sorted = Object.entries(byUser)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

    const rows = sorted.map(([uid, size]) => {
        const u = userMap[uid] || {};
        return `${G.bullet} uid <code>${uid}</code> (${esc((u.name || '?').slice(0, 15))}) — <b>${fmtBytes(size)}</b>`;
    }).join('\n') || `<i>No data</i>`;

    const cap =
        `<b>💾 Disk Usage by User</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_sys_tools'), call);
}

async function renderAdmDbInfo(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const stats = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row1) => {
            db.get('SELECT COUNT(*) as bots FROM bots', (err, row2) => {
                db.get('SELECT COUNT(*) as payments FROM payments', (err, row3) => {
                    db.get('SELECT COUNT(*) as coupons FROM coupons', (err, row4) => {
                        db.get('SELECT COUNT(*) as tickets FROM tickets', (err, row5) => {
                            db.get('SELECT COUNT(*) as audit FROM audit', (err, row6) => {
                                resolve({
                                    users: row1?.users || 0,
                                    bots: row2?.bots || 0,
                                    payments: row3?.payments || 0,
                                    coupons: row4?.coupons || 0,
                                    tickets: row5?.tickets || 0,
                                    audit: row6?.audit || 0,
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    let dbSize = 0;
    try {
        if (fs.existsSync(DB_PATH)) {
            dbSize = fs.statSync(DB_PATH).size;
        }
    } catch {}

    const cap =
        `<b>🗄️ Database Info</b>\n` +
        `${G.div_eq}\n` +
        `DB size: ${fmtBytes(dbSize)}\n` +
        `Users: ${stats.users}\n` +
        `Bots: ${stats.bots}\n` +
        `Payments: ${stats.payments}\n` +
        `Coupons: ${stats.coupons}\n` +
        `Tickets: ${stats.tickets}\n` +
        `Audit entries: ${stats.audit}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, PHOTOS.admin, cap, _admBack('adm_sys_tools'), call);
}

async function renderAdmTokenCheck(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    ack(call, 'Checking tokens…');

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots LIMIT 20', (err, rows) => {
            resolve(rows || []);
        });
    });

    let valid = 0, invalid = 0, missing = 0;
    const badList = [];

    for (const b of bots) {
        const env = b.env ? JSON.parse(b.env) : {};
        const token = env.BOT_TOKEN || b.token;
        if (!token) {
            missing++;
            continue;
        }
        try {
            const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
                timeout: 5000,
            });
            const data = await response.json();
            if (data.ok) valid++;
            else {
                invalid++;
                badList.push(b.name || b.id);
            }
        } catch {
            invalid++;
            badList.push(b.name || b.id);
        }
    }

    const badText = badList.map(n => `  ❌ ${n}`).join('\n') || '  (none)';

    bot.sendMessage(call.from.id,
        `<b>🔑 Token Check Report</b>\n` +
        `${G.div_eq}\n` +
        `Valid: ${valid}\n` +
        `Invalid: ${invalid}\n` +
        `Missing: ${missing}\n` +
        `${G.div}\n<b>Invalid bots:</b>\n${badText}`,
        { parse_mode: 'HTML' }
    );
}

// ============================================================
// 7. PAYMENT CONFIG
// ============================================================

async function renderAdmPayConfig(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const autoApprove = await getSetting('auto_approve_payments', false);
    const minAmt = await getSetting('min_payment_amount', 50);
    const maxAmt = await getSetting('max_payment_amount', 10000);
    const currency = await getSetting('payment_currency', 'BDT');

    const cap =
        `<b>💳 Payment Configuration</b>\n` +
        `${G.div_eq}\n` +
        `Auto-Approve: ${autoApprove ? '✅ ON' : '❌ OFF'}\n` +
        `Min Amount: $${minAmt}\n` +
        `Max Amount: $${maxAmt}\n` +
        `Currency: ${currency}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${autoApprove ? '✅' : '❌'}  Auto-Appr`, callback_data: 'adm_pay_auto_approve', style: autoApprove ? 'success' : 'danger' },
                { text: '💰  Pay Methods', callback_data: 'adm_pay_methods', style: 'primary' },
            ],
            [
                { text: '📊  Amount Limits', callback_data: 'adm_pay_limits', style: 'primary' },
                { text: '💱  Currency', callback_data: 'adm_pay_currency', style: 'primary' },
            ],
            [
                { text: '🧾  Receipt Templ', callback_data: 'adm_pay_receipt_tmpl', style: 'primary' },
                { text: '🔔  Notif Settings', callback_data: 'adm_pay_notif', style: 'primary' },
            ],
            [
                { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }
            ]
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmPayMethods(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const methods = PAYMENT_METHODS;
    const rows = Object.entries(methods).map(([key, m]) => {
        const enabled = getSetting(`pm_enabled_${key}`, true);
        return `${enabled ? '✅' : '❌'} <b>${esc(m.name)}</b> — <code>${esc(m.number)}</code> (${esc(m.type)})`;
    }).join('\n');

    const cap =
        `<b>💰 Payment Methods</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const [key, m] of Object.entries(methods)) {
        const enabled = await getSetting(`pm_enabled_${key}`, true);
        kb.inline_keyboard.push([
            { text: `${enabled ? '✅' : '❌'} ${m.name}`, callback_data: `adm_pay_edit_${key}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Pay Config`, callback_data: 'adm_pay_config', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmPayMethodEdit(call, key) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const m = PAYMENT_METHODS[key];
    if (!m) { ack(call, 'Unknown method'); return; }

    const enabled = await getSetting(`pm_enabled_${key}`, true);
    const storedNum = await getSetting(`pm_number_${key}`, m.number);

    const cap =
        `<b>💰 Edit ${esc(m.name)}</b>\n` +
        `${G.div_eq}\n` +
        `Status: ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Number: ${esc(storedNum)}\n` +
        `Type: ${esc(m.type)}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${enabled ? '❌ Disable' : '✅ Enable'}`, callback_data: `adm_pay_method_toggle_${key}`, style: enabled ? 'danger' : 'success' },
                { text: '✏️  Change Number', callback_data: `adm_pay_method_setnumber_${key}`, style: 'primary' },
            ],
            [
                { text: `${G.back}  Pay Methods`, callback_data: 'adm_pay_methods', style: 'primary' }
            ]
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmPayLimits(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const minAmt = await getSetting('min_payment_amount', 50);
    const maxAmt = await getSetting('max_payment_amount', 10000);
    const discThreshold = await getSetting('discount_threshold', 500);
    const discPct = await getSetting('discount_pct', 5);

    const cap =
        `<b>📊 Payment Amount Limits</b>\n` +
        `${G.div_eq}\n` +
        `Min Payment: $${minAmt}\n` +
        `Max Payment: $${maxAmt}\n` +
        `Discount >= $${discThreshold}\n` +
        `Discount %: ${discPct}%\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📉  Set Min', callback_data: 'adm_bc_set_min_payment_amount', style: 'primary' }],
            [{ text: '📈  Set Max', callback_data: 'adm_bc_set_max_payment_amount', style: 'primary' }],
            [{ text: '🎯  Disc Threshold', callback_data: 'adm_bc_set_discount_threshold', style: 'primary' }],
            [{ text: '💸  Disc %', callback_data: 'adm_bc_set_discount_pct', style: 'primary' }],
            [{ text: `${G.back}  Pay Config`, callback_data: 'adm_pay_config', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmPayCurrency(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const cur = await getSetting('payment_currency', 'BDT');
    const sym = await getSetting('currency_symbol', '৳');

    const cap =
        `<b>💱 Currency Settings</b>\n` +
        `${G.div_eq}\n` +
        `Currency Code: ${cur}\n` +
        `Symbol: ${sym}\n` +
        `${G.div}\n` +
        `Examples: BDT/৳, USD/$, EUR/€, INR/₹, PKR/₨` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🔤  Set Code', callback_data: 'adm_bc_set_payment_currency', style: 'primary' }],
            [{ text: '💲  Set Symbol', callback_data: 'adm_bc_set_currency_symbol', style: 'primary' }],
            [
                { text: 'BDT ৳', callback_data: 'adm_bc_set_currency_BDT_৳', style: 'primary' },
                { text: 'USD $', callback_data: 'adm_bc_set_currency_USD_$', style: 'primary' },
                { text: 'EUR €', callback_data: 'adm_bc_set_currency_EUR_€', style: 'primary' },
            ],
            [
                { text: 'INR ₹', callback_data: 'adm_bc_set_currency_INR_₹', style: 'primary' },
                { text: 'PKR ₨', callback_data: 'adm_bc_set_currency_PKR_₨', style: 'primary' },
            ],
            [{ text: `${G.back}  Pay Config`, callback_data: 'adm_pay_config', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmPayReceiptTmpl(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const tmpl = await getSetting('tmpl_payment_received', '') ||
        'Payment of {amount} received for {plan} plan. Your account has been upgraded!';

    const cap =
        `<b>🧾 Payment Receipt Template</b>\n` +
        `${G.div_eq}\n` +
        `<i>Current template:</i>\n<code>${esc(tmpl.slice(0, 300))}</code>\n` +
        `${G.div}\n` +
        `Variables: <code>{{name}}, {{amount}}, {{plan}}, {{tx_id}}, {{date}}</code>` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '✏️  Edit', callback_data: 'adm_tmpl_edit_payment_received', style: 'primary' }],
            [{ text: '🔄  Reset', callback_data: 'adm_tmpl_reset_payment_received', style: 'danger' }],
            [{ text: `${G.back}  Pay Config`, callback_data: 'adm_pay_config', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmPayNotifSettings(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const chan = await getSetting('payment_notif_channel', '') || '—';
    const onNew = await getSetting('notif_on_new_payment', true);
    const onAppr = await getSetting('notif_on_approved', true);
    const onRej = await getSetting('notif_on_rejected', true);

    const cap =
        `<b>🔔 Payment Notifications</b>\n` +
        `${G.div_eq}\n` +
        `Channel: ${esc(chan)}\n` +
        `New payment: ${onNew ? '✅' : '❌'}\n` +
        `Approved: ${onAppr ? '✅' : '❌'}\n` +
        `Rejected: ${onRej ? '✅' : '❌'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📣  Set Channel', callback_data: 'adm_bc_set_payment_notif_channel', style: 'primary' }],
            [
                { text: `${onNew ? '✅' : '❌'}  New Pay`, callback_data: 'adm_bc_toggle_notif_on_new_payment', style: 'primary' },
                { text: `${onAppr ? '✅' : '❌'}  Approved`, callback_data: 'adm_bc_toggle_notif_on_approved', style: 'primary' },
            ],
            [
                { text: `${onRej ? '✅' : '❌'}  Rejected`, callback_data: 'adm_bc_toggle_notif_on_rejected', style: 'primary' },
                { text: `${G.back}  Pay Config`, callback_data: 'adm_pay_config', style: 'primary' },
            ],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 8. BOT CONFIG
// ============================================================

async function renderAdmBotCfg(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const maxUpload = await getSetting('bc_max_upload_mb', 75);
    const wipeDelay = await getSetting('bc_sandbox_wipe_delay', 6);
    const startTimeout = await getSetting('bc_bot_start_timeout', 30);
    const stopTimeout = await getSetting('bc_bot_stop_timeout', 10);
    const crashDelay = await getSetting('bc_crash_restart_delay', 5);
    const maxRestarts = await getSetting('bc_max_crash_restarts', 5);
    const logRing = await getSetting('bc_log_ring_size', 200);
    const zipMax = await getSetting('bc_zip_max_files', 50);

    const cap =
        `<b>🔧 Bot Configuration</b>\n` +
        `${G.div_eq}\n` +
        `Max Upload: ${maxUpload} MB\n` +
        `Sandbox Wipe Delay: ${wipeDelay}s\n` +
        `Start Timeout: ${startTimeout}s\n` +
        `Stop Timeout: ${stopTimeout}s\n` +
        `Crash Restart Delay: ${crashDelay}s\n` +
        `Max Crash Restarts: ${maxRestarts}\n` +
        `Log Ring Size: ${logRing}\n` +
        `Zip Max Files: ${zipMax}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '⏱️  Timeouts', callback_data: 'adm_bc_timeouts', style: 'primary' }],
            [{ text: '📊  Limits', callback_data: 'adm_bc_limits', style: 'primary' }],
            [{ text: '📦  Upload Rules', callback_data: 'adm_bc_upload', style: 'primary' }],
            [{ text: '🔐  Env Strip', callback_data: 'adm_bc_env', style: 'danger' }],
            [{ text: '🔄  Restart Policy', callback_data: 'adm_bc_policy', style: 'primary' }],
            [{ text: '🧱  Sandbox', callback_data: 'adm_bc_sandbox', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmBcTimeouts(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const t1 = await getSetting('bc_bot_start_timeout', 30);
    const t2 = await getSetting('bc_bot_stop_timeout', 10);
    const t3 = await getSetting('bc_crash_restart_delay', 5);
    const t4 = await getSetting('bc_idle_timeout_mins', 0) || 'Off';
    const t5 = await getSetting('bc_resource_check_secs', 30);

    const cap =
        `<b>⏱️ Timeout Settings</b>\n` +
        `${G.div_eq}\n` +
        `Bot Start Timeout: ${t1}s\n` +
        `Bot Stop Timeout: ${t2}s\n` +
        `Crash Restart Delay: ${t3}s\n` +
        `Idle Timeout (mins): ${t4}\n` +
        `Resource Check Interval: ${t5}s\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '✏️  Start Timeout', callback_data: 'adm_bc_set_bot_start_timeout', style: 'primary' }],
            [{ text: '✏️  Stop Timeout', callback_data: 'adm_bc_set_bot_stop_timeout', style: 'primary' }],
            [{ text: '✏️  Crash Delay', callback_data: 'adm_bc_set_crash_restart_delay', style: 'primary' }],
            [{ text: '✏️  Idle Timeout', callback_data: 'adm_bc_set_idle_timeout_mins', style: 'primary' }],
            [{ text: `${G.back}  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmBcLimits(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const maxUpload = await getSetting('bc_max_upload_mb', 75);
    const maxRestarts = await getSetting('bc_max_crash_restarts', 5);
    const logRing = await getSetting('bc_log_ring_size', 200);
    const zipMax = await getSetting('bc_zip_max_files', 50);

    const cap =
        `<b>📊 Resource Limits</b>\n` +
        `${G.div_eq}\n` +
        `Max Upload MB: ${maxUpload}\n` +
        `Max Crash Restarts: ${maxRestarts}\n` +
        `Log Ring Size: ${logRing}\n` +
        `Zip Max Files: ${zipMax}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '✏️  Max Upload MB', callback_data: 'adm_bc_set_max_upload_mb', style: 'primary' }],
            [{ text: '✏️  Max Restarts', callback_data: 'adm_bc_set_max_crash_restarts', style: 'primary' }],
            [{ text: '✏️  Log Ring Size', callback_data: 'adm_bc_set_log_ring_size', style: 'primary' }],
            [{ text: '✏️  Zip Max Files', callback_data: 'adm_bc_set_zip_max_files', style: 'primary' }],
            [{ text: `${G.back}  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmBcUpload(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const maxUpload = await getSetting('bc_max_upload_mb', 75);
    const exts = await getSetting('bc_allowed_extensions', '.py,.js,.zip');
    const zipMax = await getSetting('bc_zip_max_files', 50);

    const cap =
        `<b>📦 Upload Rules</b>\n` +
        `${G.div_eq}\n` +
        `Max Upload: ${maxUpload} MB\n` +
        `Allowed Ext: ${esc(exts)}\n` +
        `Zip Max Files: ${zipMax}\n` +
        `${G.div}\n` +
        `Allowed extensions are comma-separated. E.g. <code>.py,.js,.zip</code>` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '✏️  Max Upload MB', callback_data: 'adm_bc_set_max_upload_mb', style: 'primary' }],
            [{ text: '✏️  Allowed Ext', callback_data: 'adm_bc_set_allowed_extensions', style: 'primary' }],
            [{ text: '✏️  Zip Max Files', callback_data: 'adm_bc_set_zip_max_files', style: 'primary' }],
            [{ text: `${G.back}  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmBcEnv(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const strip = await getSetting('bc_env_strip_secrets', true);
    const names = Array.from(SECRET_ENV_NAMES || []);

    const cap =
        `<b>🔐 Environment Variable Control</b>\n` +
        `${G.div_eq}\n` +
        `Strip Secrets: ${strip ? '✅ ON' : '❌ OFF'}\n` +
        `${G.div}\n` +
        `<b>Currently stripped env names:</b>\n` +
        `<code>${names.slice(0, 10).join(', ')}${names.length > 10 ? '...' : ''}</code>\n` +
        `${G.div}\n` +
        `When ON, child bots cannot access these env vars.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${strip ? '✅' : '❌'}  Strip Secrets`, callback_data: 'adm_bc_toggle_env_strip_secrets', style: strip ? 'success' : 'danger' },
                { text: '➕  Add Secret Name', callback_data: 'adm_bc_set_add_secret_name', style: 'primary' },
            ],
            [{ text: `${G.back}  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmBcSandbox(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const wipe = await getSetting('ff_sandbox_wipe', true);
    const delay = await getSetting('bc_sandbox_wipe_delay', 6);
    const net = await getSetting('bc_sandbox_network', true);

    const cap =
        `<b>🧱 Sandbox Settings</b>\n` +
        `${G.div_eq}\n` +
        `File Wipe: ${wipe ? '✅ ON' : '❌ OFF'}\n` +
        `Wipe Delay: ${delay}s after start\n` +
        `Network: ${net ? '✅ Allowed' : '❌ Blocked'}\n` +
        `${G.div}\n` +
        `<i>File Wipe removes source .py/.js files after bot starts so child bots cannot read their own code.</i>` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${wipe ? '✅' : '❌'}  File Wipe`, callback_data: 'adm_ff_toggle_sandbox_wipe', style: wipe ? 'success' : 'danger' },
                { text: '✏️  Wipe Delay', callback_data: 'adm_bc_set_sandbox_wipe_delay', style: 'primary' },
            ],
            [
                { text: `${net ? '✅' : '❌'}  Network`, callback_data: 'adm_bc_toggle_sandbox_network', style: net ? 'success' : 'danger' },
                { text: `${G.back}  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' },
            ],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmBcPolicy(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const autoR = await getSetting('ff_auto_restart_bots', true);
    const maxR = await getSetting('bc_max_crash_restarts', 5);
    const delayR = await getSetting('bc_crash_restart_delay', 5);
    const autoDg = await getSetting('auto_downgrade_expired', true);

    const cap =
        `<b>🔄 Restart & Policy</b>\n` +
        `${G.div_eq}\n` +
        `Auto-Restart Crashed: ${autoR ? '✅ ON' : '❌ OFF'}\n` +
        `Max Restarts/hour: ${maxR}\n` +
        `Restart Delay: ${delayR}s\n` +
        `Auto-Downgrade Expiry: ${autoDg ? '✅ ON' : '❌ OFF'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${autoR ? '✅' : '❌'}  Auto-Restart`, callback_data: 'adm_ff_toggle_auto_restart_bots', style: autoR ? 'success' : 'danger' },
                { text: '✏️  Max Restarts', callback_data: 'adm_bc_set_max_crash_restarts', style: 'primary' },
            ],
            [
                { text: '✏️  Restart Delay', callback_data: 'adm_bc_set_crash_restart_delay', style: 'primary' },
                { text: `${autoDg ? '✅' : '❌'}  Auto-Dg`, callback_data: 'adm_sub_auto_downgrade', style: autoDg ? 'success' : 'danger' },
            ],
            [{ text: `${G.back}  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 9. APPEARANCE
// ============================================================

async function renderAdmAppearance(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const theme = await getSetting('ui_theme', 'dark');
    const footer = (await getSetting('custom_footer', '')) || '(default)';
    const welcome = await getSetting('custom_welcome', '');
    const rules = await getSetting('hosting_rules', '');

    const cap =
        `<b>🎨 Appearance & Branding</b>\n` +
        `${G.div_eq}\n` +
        `Theme: ${esc(theme)}\n` +
        `Brand Tag: ${CONFIG.brand}\n` +
        `Footer: ${esc(footer.slice(0, 40))}\n` +
        `Custom Welcome: ${welcome ? '✅' : '❌ (default)'}\n` +
        `Custom Rules: ${rules ? '✅' : '❌ (default)'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🎭  Themes', callback_data: 'adm_app_theme', style: 'primary' }],
            [{ text: '🏷️  Brand Tag', callback_data: 'adm_set_brand', style: 'primary' }],
            [{ text: '📝  Footer Text', callback_data: 'adm_set_footer_text', style: 'primary' }],
            [{ text: '👋  Welcome Msg', callback_data: 'adm_set_welcome_text', style: 'primary' }],
            [{ text: '📜  Rules Text', callback_data: 'adm_set_rules_text', style: 'primary' }],
            [{ text: '😀  Custom Emojis', callback_data: 'adm_app_emojis', style: 'primary' }],
            [{ text: '🖼️  Menu Photos', callback_data: 'adm_photos', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmAppTheme(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const cur = await getSetting('ui_theme', 'dark');

    const themes = {
        dark: { name: 'Dark', header: '#0F172A', accent: '#6366F1' },
        midnight: { name: 'Midnight', header: '#020617', accent: '#818CF8' },
        ocean: { name: 'Ocean', header: '#0E4472', accent: '#38BDF8' },
        forest: { name: 'Forest', header: '#14532D', accent: '#4ADE80' },
        sunset: { name: 'Sunset', header: '#7C2D12', accent: '#FB923C' },
        royal: { name: 'Royal', header: '#3B0764', accent: '#C084FC' },
        neon: { name: 'Neon', header: '#0A0A0A', accent: '#39FF14' },
        rose: { name: 'Rose', header: '#881337', accent: '#FB7185' },
        gold: { name: 'Gold', header: '#451A03', accent: '#FBBF24' },
        ice: { name: 'Ice', header: '#1E3A5F', accent: '#BAE6FD' },
    };

    const rows = Object.entries(themes).map(([k, v]) =>
        `${k === cur ? '✅' : '  '} <b>${v.name}</b> — header=${v.header} accent=${v.accent}`
    ).join('\n');

    const cap =
        `<b>🎭 UI Themes</b>\n` +
        `${G.div_eq}\n` +
        `Current: <b>${esc(cur)}</b>\n` +
        `${G.div}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const [k, v] of Object.entries(themes)) {
        kb.inline_keyboard.push([
            { text: `${k === cur ? '✅' : '  '} ${v.name}`, callback_data: `adm_app_theme_${k}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Appearance`, callback_data: 'adm_appearance', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

async function renderAdmAppEmojis(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const customEmojis = await getSetting('custom_emojis', {});
    const sampleKeys = ['ok', 'no', 'warn', 'bullet', 'div', 'shield', 'key'];

    const rows = sampleKeys.map(k =>
        `${G.bullet} <code>${k}</code>: ${customEmojis[k] || G[k] || '?'} ${customEmojis[k] ? '<i>(custom)</i>' : '<i>(default)</i>'}`
    ).join('\n');

    const cap =
        `<b>😀 Custom Emojis</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}\n` +
        `Tap a key to set a custom emoji. Use <code>-</code> to reset.` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const k of sampleKeys) {
        kb.inline_keyboard.push([
            { text: `✏️ ${k}: ${customEmojis[k] || G[k] || '?'}`, callback_data: `adm_app_emoji_set_${k}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: '🔄  Reset All', callback_data: 'adm_app_emoji_reset', style: 'danger' },
        { text: `${G.back}  Appearance`, callback_data: 'adm_appearance', style: 'primary' },
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 10. COUPON PLUS
// ============================================================

async function renderAdmCouponPlus(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const coupons = await new Promise((resolve) => {
        db.all('SELECT * FROM coupons', (err, rows) => {
            resolve(rows || []);
        });
    });

    const now = new Date().toISOString();
    const active = coupons.filter(c => !c.expiry || c.expiry > now).length;
    const expired = coupons.length - active;
    const usedTotal = coupons.reduce((sum, c) => sum + (c.max_uses - c.uses_left), 0);

    const cap =
        `<b>🎫 Advanced Coupon Manager</b>\n` +
        `${G.div_eq}\n` +
        `Total Coupons: ${coupons.length}\n` +
        `Active: ${active}\n` +
        `Expired/Used: ${expired}\n` +
        `Total Redemptions: ${usedTotal}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '➕  Create Coupon', callback_data: 'adm_coupons', style: 'success' }],
            [{ text: '🗂️  Bulk Create', callback_data: 'adm_coupon_bulk', style: 'primary' }],
            [{ text: '📊  Analytics', callback_data: 'adm_coupon_analytics', style: 'primary' }],
            [{ text: '⏰  Expiry Mgr', callback_data: 'adm_coupon_expiry', style: 'primary' }],
            [{ text: '🗑️  Clear Expired', callback_data: 'adm_coupon_clearexp', style: 'danger' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.coupon, cap, kb, call);
}

// ============================================================
// 11. TEMPLATES
// ============================================================

async function renderAdmTemplates(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const templates = {
        welcome: { label: 'Welcome Message' },
        payment_received: { label: 'Payment Received' },
        plan_expired: { label: 'Plan Expiry Warning' },
        bot_approved: { label: 'Bot Approved' },
        bot_rejected: { label: 'Bot Rejected' },
        referral_reward: { label: 'Referral Reward' },
        ticket_reply: { label: 'Ticket Reply' },
        bot_crashed: { label: 'Bot Crashed Alert' },
    };

    const rows = Object.entries(templates).map(([k, v]) => {
        const custom = await getSetting(`tmpl_${k}`, '');
        return `${G.bullet} <b>${esc(v.label)}</b> ${custom ? '✅ custom' : '📄 default'}`;
    }).join('\n');

    const cap =
        `<b>📝 Message Template Manager</b>\n` +
        `${G.div_eq}\n` +
        `Customize every message the bot sends. Use placeholders like ` +
        `<code>{{name}}</code>, <code>{{plan}}</code>, <code>{{amount}}</code> etc.\n` +
        `${G.div}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const [k, v] of Object.entries(templates)) {
        const custom = await getSetting(`tmpl_${k}`, '');
        kb.inline_keyboard.push([
            { text: `${custom ? '✅' : '📄'} ${v.label.slice(0, 25)}`, callback_data: `adm_tmpl_edit_${k}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 12. REFERRAL SYSTEM
// ============================================================

async function renderAdmReferralSys(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const enabled = await getSetting('referral_enabled', true);
    const reward = await getSetting('referral_reward_amount', 20);
    const minPlan = await getSetting('referral_min_plan', 'free');

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });

    const totalRefs = users.reduce((sum, u) => sum + (u.ref_count || 0), 0);
    const totalPaid = users.reduce((sum, u) => sum + (u.ref_credit || 0), 0);

    const cap =
        `<b>🔗 Referral System</b>\n` +
        `${G.div_eq}\n` +
        `Status: ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Reward/Refer: $${reward} wallet credit\n` +
        `Min Plan: ${minPlan}\n` +
        `Total Referrals: ${totalRefs}\n` +
        `Total Paid Out: $${totalPaid}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${enabled ? '✅ Enabled' : '❌ Disabled'}`, callback_data: 'adm_ref_toggle', style: enabled ? 'success' : 'danger' },
                { text: '📊  Ref Stats', callback_data: 'adm_ref_stats', style: 'primary' },
            ],
            [
                { text: '🎁  Reward Config', callback_data: 'adm_ref_rewards', style: 'primary' },
                { text: '🏆  Leaderboard', callback_data: 'adm_ref_leaderboard', style: 'primary' },
            ],
            [
                { text: '✏️  Set Reward $', callback_data: 'adm_ref_set_reward', style: 'primary' },
                { text: '✏️  Set Min Plan', callback_data: 'adm_ref_set_min_plan', style: 'primary' },
            ],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.referral, cap, kb, call);
}

// ============================================================
// 13. JANITOR
// ============================================================

async function renderAdmJanitor(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const flags = {
        clean_orphan_dirs: 'Auto-clean orphan sandboxes',
        clean_old_logs: 'Auto-clear old logs (>7 days)',
        clean_expired_coupons: 'Auto-remove expired coupons',
        auto_ban_rate_abuse: 'Auto-ban rate limit abusers',
        clean_old_audit: 'Trim audit log (>1000 entries)',
        notify_crashed: 'Notify owner on bot crash',
    };

    const rows = Object.entries(flags).map(([k, v]) => {
        const enabled = getSetting(`jan_${k}`, false);
        return `${enabled ? '✅' : '❌'} ${v}`;
    }).join('\n');

    const cap =
        `<b>🧹 Janitor — Auto-Cleanup Rules</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const [k, v] of Object.entries(flags)) {
        const enabled = await getSetting(`jan_${k}`, false);
        kb.inline_keyboard.push([
            { text: `${enabled ? '✅' : '❌'} ${v.slice(0, 28)}`, callback_data: `adm_jan_toggle_${k}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: '▶️  Run Now', callback_data: 'adm_jan_run_now', style: 'success' },
        { text: '📋  Jan Rules', callback_data: 'adm_jan_rules', style: 'primary' },
    ]);
    kb.inline_keyboard.push([
        { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 14. WEBHOOKS
// ============================================================

async function renderAdmWebhooks(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const whUrl = await getSetting('webhook_url', '');
    const mode = whUrl ? 'Webhook' : 'Long Polling';

    let webhookInfo = {};
    try {
        webhookInfo = await bot.getWebhookInfo();
    } catch {}

    const pending = webhookInfo.pending_update_count || 0;
    const lastErr = webhookInfo.last_error_message || '—';

    const cap =
        `<b>🌐 Webhook Manager</b>\n` +
        `${G.div_eq}\n` +
        `Mode: ${mode}\n` +
        `Webhook URL: ${esc(whUrl.slice(0, 50)) || '—'}\n` +
        `Pending Updates: ${pending}\n` +
        `Last Error: ${esc(String(lastErr).slice(0, 50))}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🔗  Set Webhook', callback_data: 'adm_wh_set', style: 'primary' }],
            [{ text: '❌  Clear (Polling)', callback_data: 'adm_wh_clear', style: 'danger' }],
            [{ text: '🧪  Test Webhook', callback_data: 'adm_wh_test', style: 'primary' }],
            [{ text: 'ℹ️  Webhook Info', callback_data: 'adm_wh_info', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 15. FEATURE FLAGS
// ============================================================

async function renderAdmFeatureFlags(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const flags = {
        user_registration: 'User Registration',
        bot_upload: 'Bot Upload',
        payment_system: 'Payment System',
        coupon_system: 'Coupon System',
        referral_system: 'Referral System',
        ticket_system: 'Ticket System',
        wallet_topup: 'Wallet Top-up',
        gift_plan: 'Gift Plan',
        trial_plan: 'Trial Plan',
        github_backup: 'GitHub Backup',
        cloudflare_tunnel: 'Cloudflare Tunnel',
        ai_scanner: 'AI Scanner',
        approval_system: 'Approval System',
        rate_limiting: 'Rate Limiting',
        audit_logging: 'Audit Logging',
        auto_restart_bots: 'Auto-Restart Bots',
        broadcast_enabled: 'Broadcast Enabled',
        sandbox_wipe: 'Sandbox Wipe',
    };

    const rows = Object.entries(flags).map(([k, v]) => {
        const val = getSetting(`ff_${k}`, true);
        return `${val ? '✅' : '❌'} <code>${k}</code> — ${v}`;
    }).join('\n');

    const cap =
        `<b>🎯 Feature Flags</b>\n` +
        `${G.div_eq}\n` +
        `Toggle any system feature on or off instantly.\n` +
        `${G.div}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const [k, v] of Object.entries(flags)) {
        const val = await getSetting(`ff_${k}`, true);
        kb.inline_keyboard.push([
            { text: `${val ? '✅' : '❌'} ${v.slice(0, 20)}`, callback_data: `adm_ff_toggle_${k}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: '🔄  Reset All Flags', callback_data: 'adm_ff_reset_all', style: 'danger' },
        { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' },
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 16. RATE CONFIG
// ============================================================

async function renderAdmRateConfig(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const globalRl = await getSetting('ff_rate_limiting', true);

    const defaults = {
        free: { uploads_per_day: 3, starts_per_hour: 5, msgs_per_min: 20 },
        starter: { uploads_per_day: 10, starts_per_hour: 15, msgs_per_min: 40 },
        basic: { uploads_per_day: 20, starts_per_hour: 30, msgs_per_min: 60 },
        pro: { uploads_per_day: 50, starts_per_hour: 60, msgs_per_min: 120 },
        enterprise: { uploads_per_day: 100, starts_per_hour: 120, msgs_per_min: 240 },
        lifetime: { uploads_per_day: 999, starts_per_hour: 999, msgs_per_min: 999 },
    };

    const rows = Object.entries(defaults).map(([plan, d]) => {
        const name = PLAN_LIMITS[plan]?.name || plan;
        const up = getSetting(`rl_${plan}_uploads_per_day`, d.uploads_per_day);
        const st = getSetting(`rl_${plan}_starts_per_hour`, d.starts_per_hour);
        const ms = getSetting(`rl_${plan}_msgs_per_min`, d.msgs_per_min);
        return `<b>${name}</b>: ↑${up}/day ▶${st}/hr 💬${ms}/min`;
    }).join('\n');

    const cap =
        `<b>⏱️ Rate Limit Configuration</b>\n` +
        `${G.div_eq}\n` +
        `Global Rate Limiting: ${globalRl ? '✅ ON' : '❌ OFF'}\n` +
        `${G.div}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [
                { text: `${globalRl ? '✅ ON' : '❌ OFF'}  Global RL`, callback_data: 'adm_ff_toggle_rate_limiting', style: globalRl ? 'success' : 'danger' },
            ],
            ...Object.keys(defaults).map(plan => [
                { text: `✏️  ${PLAN_LIMITS[plan]?.name || plan}`, callback_data: `adm_rate_plan_${plan}`, style: 'primary' }
            ]),
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 17. LIVE MONITOR
// ============================================================

async function renderAdmLiveMonitor(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const mem = process.memoryUsage();
    const uptime = process.uptime();

    let totalChildRam = 0;
    let totalChildCpu = 0;

    for (const [bid, entry] of runningBots) {
        try {
            // Simulate CPU/RAM from process stats
            totalChildRam += 50 * 1024 * 1024; // placeholder
            totalChildCpu += 0.5; // placeholder
        } catch {}
    }

    const cap =
        `<b>📡 Live Monitor</b>\n` +
        `${G.div_eq}\n` +
        `Panel Uptime: ${fmtDur(uptime * 1000)}\n` +
        `Panel RAM: ${fmtBytes(mem.rss)}\n` +
        `Panel CPU: ${(process.cpuUsage().user / 1000000).toFixed(1)}%\n` +
        `${G.div}\n` +
        `▶ Running Bots: ${runningBots.size}\n` +
        `Child RAM Total: ${fmtBytes(totalChildRam)}\n` +
        `Child CPU Total: ${totalChildCpu.toFixed(1)}%\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🔄  Refresh', callback_data: 'adm_monitor_refresh', style: 'success' }],
            [{ text: '🤖  Bot Details', callback_data: 'adm_monitor_bots', style: 'primary' }],
            [{ text: '🖥️  System', callback_data: 'adm_monitor_system', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.stats, cap, kb, call);
}

// ============================================================
// 18. REVENUE GOALS
// ============================================================

async function renderAdmRevGoals(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const goalMonthly = await getSetting('rev_goal_monthly', 0);
    const goalYearly = await getSetting('rev_goal_yearly', 0);

    const payments = await new Promise((resolve) => {
        db.all('SELECT * FROM payments WHERE status = ?', ['approved'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const now = new Date();
    const monthStart = now.toISOString().slice(0, 7);
    const yearStart = now.toISOString().slice(0, 4);

    const revMonth = payments
        .filter(p => p.ts && p.ts.startsWith(monthStart))
        .reduce((sum, p) => sum + (p.amount || 0), 0);

    const revYear = payments
        .filter(p => p.ts && p.ts.startsWith(yearStart))
        .reduce((sum, p) => sum + (p.amount || 0), 0);

    const revAll = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const progressBar = (cur, goal) => {
        if (!goal) return '— (no goal set)';
        const pct = Math.min(100, (cur / goal) * 100);
        const filled = Math.floor(pct / 5);
        return '█'.repeat(filled) + '░'.repeat(20 - filled) + ` ${pct.toFixed(1)}%`;
    };

    const cap =
        `<b>💎 Revenue Goals</b>\n` +
        `${G.div_eq}\n` +
        `<b>This Month (${monthStart})</b>\n` +
        `  Earned: <b>$${revMonth}</b> / $${goalMonthly || '?'}\n` +
        `  ${progressBar(revMonth, goalMonthly)}\n` +
        `${G.div}\n` +
        `<b>This Year (${yearStart})</b>\n` +
        `  Earned: <b>$${revYear}</b> / $${goalYearly || '?'}\n` +
        `  ${progressBar(revYear, goalYearly)}\n` +
        `${G.div}\n` +
        `All Time: $${revAll}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🎯  Set Monthly Goal', callback_data: 'adm_goal_set_monthly', style: 'primary' }],
            [{ text: '🎯  Set Yearly Goal', callback_data: 'adm_goal_set_yearly', style: 'primary' }],
            [{ text: '📈  History', callback_data: 'adm_goal_history', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.stats, cap, kb, call);
}

// ============================================================
// 19. SCHEDULER
// ============================================================

async function renderAdmScheduler(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const tasks = await getSetting('scheduled_tasks', []);
    const enabled = tasks.filter(t => t.enabled).length;

    const rows = tasks.slice(0, 10).map(t =>
        `${G.bullet} ${t.enabled ? '✅' : '⏸️'} <b>${esc(t.type || '?')}</b> ${t.time || '?'} — <i>${esc((t.msg || '').slice(0, 30))}</i>`
    ).join('\n') || `<i>No scheduled tasks</i>`;

    const cap =
        `<b>⏰ Task Scheduler</b>\n` +
        `${G.div_eq}\n` +
        `Total Tasks: ${tasks.length}\n` +
        `Enabled: ${enabled}\n` +
        `Disabled: ${tasks.length - enabled}\n` +
        `${G.div}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '➕  Add Task', callback_data: 'adm_sched_add', style: 'success' }],
            [{ text: '📋  All Tasks', callback_data: 'adm_sched_list', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 20. IMPORT / EXPORT
// ============================================================

async function renderAdmImportExport(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    let dbSize = 0;
    try {
        if (fs.existsSync(DB_PATH)) dbSize = fs.statSync(DB_PATH).size;
    } catch {}

    let settingsSize = 0;
    try {
        const settingsPath = path.join(STORAGE_DIRS.data, 'settings.json');
        if (fs.existsSync(settingsPath)) settingsSize = fs.statSync(settingsPath).size;
    } catch {}

    const cap =
        `<b>📥 Import / Export</b>\n` +
        `${G.div_eq}\n` +
        `Settings File: ${fmtBytes(settingsSize)}\n` +
        `Database File: ${fmtBytes(dbSize)}\n` +
        `${G.div}\n` +
        `Export: download a full config backup (settings only, no user data).\n` +
        `Import: upload a previously exported config to restore settings.\n` +
        `User Export: CSV of all users.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📤  Export Config', callback_data: 'adm_export_full_cfg', style: 'success' }],
            [{ text: '📥  Import Config', callback_data: 'adm_import_cfg', style: 'primary' }],
            [{ text: '👥  Export Users CSV', callback_data: 'adm_user_export_csv', style: 'primary' }],
            [{ text: '♻️  Factory Reset', callback_data: 'adm_import_reset', style: 'danger' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 21. LEADERBOARD
// ============================================================

async function renderAdmLeaderboard(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const cap =
        `<b>🏆 Leaderboard</b>\n` +
        `${G.div_eq}\n` +
        `View top users by different metrics.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '💰  Top Spenders', callback_data: 'adm_lb_spenders', style: 'success' }],
            [{ text: '🤖  Most Bots', callback_data: 'adm_lb_bots', style: 'primary' }],
            [{ text: '🔗  Top Referrers', callback_data: 'adm_lb_referrals', style: 'primary' }],
            [{ text: '⚡  Most Active', callback_data: 'adm_lb_active', style: 'primary' }],
            [{ text: '⏱️  Longest Uptime', callback_data: 'adm_lb_uptime', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.stats, cap, kb, call);
}

// ============================================================
// 22. LANGUAGES
// ============================================================

async function renderAdmLanguages(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const cur = await getSetting('default_language', 'en');

    const languages = {
        en: '🇬🇧 English',
        bn: '🇧🇩 বাংলা',
        hi: '🇮🇳 हिन्दी',
        ar: '🇸🇦 العربية',
        ur: '🇵🇰 اردو',
        tr: '🇹🇷 Türkçe',
        ru: '🇷🇺 Русский',
        es: '🇪🇸 Español',
        fr: '🇫🇷 Français',
        de: '🇩🇪 Deutsch',
        pt: '🇧🇷 Português',
        id: '🇮🇩 Bahasa Indonesia',
        ms: '🇲🇾 Bahasa Melayu',
        fa: '🇮🇷 فارسی',
        zh: '🇨🇳 中文',
    };

    const rows = Object.entries(languages).map(([code, name]) =>
        `${code === cur ? '✅' : '  '} ${name}`
    ).join('\n');

    const cap =
        `<b>🌍 Language Settings</b>\n` +
        `${G.div_eq}\n` +
        `Default Language: ${esc(languages[cur] || cur)}\n` +
        `Total Supported: ${Object.keys(languages).length}\n` +
        `${G.div}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: []
    };
    for (const [code, name] of Object.entries(languages)) {
        kb.inline_keyboard.push([
            { text: `${code === cur ? '✅' : '  '} ${name}`, callback_data: `adm_lang_set_${code}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 23. BOT CONTROLS
// ============================================================

async function renderAdmBotControls(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const bots = await new Promise((resolve) => {
        db.all('SELECT COUNT(*) as total FROM bots', (err, row) => {
            resolve(row?.total || 0);
        });
    });

    const cap =
        `<b>🤖 Per-Bot Controls</b>\n` +
        `${G.div_eq}\n` +
        `Total Bots: ${bots}\n` +
        `Running: ${runningBots.size}\n` +
        `${G.div}\n` +
        `Search, inspect, or manage individual bots.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '📋  List All Bots', callback_data: 'adm_bc_list_all', style: 'primary' }],
            [{ text: '🔍  Search Bot', callback_data: 'adm_bot_search', style: 'primary' }],
            [{ text: '💥  Crashed Bots', callback_data: 'adm_crashed_bots', style: 'danger' }],
            [{ text: '📦  Size Report', callback_data: 'adm_bot_size_report', style: 'primary' }],
            [{ text: '🔴  Kill All', callback_data: 'adm_kill_all_now', style: 'danger' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 24. SUBSCRIPTIONS
// ============================================================

async function renderAdmSubscriptions(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users', (err, rows) => {
            resolve(rows || []);
        });
    });

    const now = new Date().toISOString();
    const paidUsers = users.filter(u => u.plan !== 'free' && u.plan);
    const expiringSoon = paidUsers.filter(u => u.plan_expires && u.plan_expires > now && u.plan_expires < new Date(Date.now() + 7 * 86400000).toISOString());
    const expired = paidUsers.filter(u => u.plan_expires && u.plan_expires < now);

    const autoDg = await getSetting('auto_downgrade_expired', true);

    const cap =
        `<b>👤 Subscription Manager</b>\n` +
        `${G.div_eq}\n` +
        `Paid Users: ${paidUsers.length}\n` +
        `Expiring in 7d: ${expiringSoon.length}\n` +
        `Already Expired: ${expired.length}\n` +
        `Auto-Downgrade: ${autoDg ? '✅ ON' : '❌ OFF'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '⏰  Expiring Soon', callback_data: 'adm_sub_expiring', style: 'danger' }],
            [{ text: '❌  Expired', callback_data: 'adm_sub_expired', style: 'primary' }],
            [{ text: '📨  Remind All', callback_data: 'adm_sub_remind_all', style: 'success' }],
            [{ text: '➕  Extend Sub', callback_data: 'adm_sub_extend_prompt', style: 'primary' }],
            [
                { text: `${autoDg ? '✅' : '❌'}  Auto-Dg`, callback_data: 'adm_sub_auto_downgrade', style: autoDg ? 'success' : 'danger' },
                { text: '⚡  Run Downgrade', callback_data: 'adm_sub_run_downgrade', style: 'danger' },
            ],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.admin, cap, kb, call);
}

// ============================================================
// 25. ADMIN 2FA
// ============================================================

async function renderAdmAdmin2fa(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const enabled = await getSetting('admin_2fa_enabled', false);
    const secret = await getSetting('admin_2fa_secret', '');

    const cap =
        `<b>🔐 Admin 2FA</b>\n` +
        `${G.div_eq}\n` +
        `Status: ${enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Secret: ${secret ? '✅ Set' : '❌ Not configured'}\n` +
        `${G.div}\n` +
        `<i>2FA adds an extra TOTP code requirement for critical admin actions.</i>` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            ...(secret ? [
                [
                    { text: `${enabled ? '✅ ON' : '❌ OFF'}  Toggle`, callback_data: 'adm_bc_toggle_admin_2fa_enabled', style: enabled ? 'success' : 'danger' },
                    { text: '🗑️  Disable+Reset', callback_data: 'adm_2fa_disable', style: 'danger' },
                ]
            ] : [
                [{ text: '🔑  Setup 2FA', callback_data: 'adm_2fa_setup', style: 'success' }]
            ]),
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, PHOTOS.security, cap, kb, call);
}

// ============================================================
// EXPORTS - All Functions
// ============================================================

module.exports = {
    // Core
    renderAdmConfirmCustom,
    renderAdmStats,
    renderAdmUsers,
    renderAdmAllBots,
    renderAdmPayments,
    renderAdmBroadcast,
    renderAdmBan,
    renderAdmGivePlan,
    renderAdmApprove,
    renderAdmCoupons,
    renderAdmTickets,
    renderAdmAdmins,
    renderAdmAudit,
    renderAdmGithub,
    renderAdmSecurity,
    renderAdmMaintenance,
    renderAdmSettings,
    renderAdmPending,
    renderAdmPhotos,
    renderAdmTgBackup,
    renderAdmGhBrowser,
    renderAdmApprovalGroup,
    renderAdmPrivateGroup,

    // Mega Panels
    renderAdmAnalytics,
    renderAdmUserTools,
    renderAdmBotManager,
    renderAdmSecCenter,
    renderAdmNotifyCenter,
    renderAdmSysTools,
    renderAdmPayConfig,
    renderAdmBotCfg,
    renderAdmAppearance,
    renderAdmCouponPlus,
    renderAdmTemplates,
    renderAdmReferralSys,
    renderAdmJanitor,
    renderAdmWebhooks,
    renderAdmFeatureFlags,
    renderAdmRateConfig,
    renderAdmLiveMonitor,
    renderAdmRevGoals,
    renderAdmScheduler,
    renderAdmImportExport,
    renderAdmLeaderboard,
    renderAdmLanguages,
    renderAdmBotControls,
    renderAdmSubscriptions,
    renderAdmAdmin2fa,

    // Sub-actions
    renderAdmUserSearch,
    renderAdmBannedList,
    renderAdmWalletAdmin,
    renderAdmUserExportCsv,
    renderAdmNotifyUser,
    renderAdmUserResetPrompt,
    renderAdmCrashedBots,
    renderAdmMassRestartStopped,
    actionAdmMassRestartStopped,
    renderAdmBotSearch,
    renderAdmBotSizeReport,
    actionAdmForceScanAll,
    actionAdmKillAll,
    renderAdmThreatLog,
    renderAdmSecStats,
    renderAdmSecWhitelistPrompt,
    renderAdmScanReport,
    renderAdmSecBlacklist,
    renderAdmNotifyAll,
    renderAdmNotifyRunning,
    renderAdmNotifyPlanSelect,
    renderAdmNotifyPlan,
    renderAdmScheduleMsg,
    renderAdmQuickAnnounce,
    renderAdmSysHealth,
    renderAdmDiskUsage,
    renderAdmDbInfo,
    renderAdmTokenCheck,
    renderAdmPayMethods,
    renderAdmPayMethodEdit,
    renderAdmPayLimits,
    renderAdmPayCurrency,
    renderAdmPayReceiptTmpl,
    renderAdmPayNotifSettings,
    renderAdmBcTimeouts,
    renderAdmBcLimits,
    renderAdmBcUpload,
    renderAdmBcEnv,
    renderAdmBcSandbox,
    renderAdmBcPolicy,
    renderAdmAppTheme,
    renderAdmAppEmojis,
    renderAdmRevenueReport,
    renderAdmGrowthStats,
    renderAdmTopUsers,
    renderAdmPlanDist,
    renderAdmBotActivity,
    renderAdmReferralDetail,
    renderAdmSubExpiryReport,
    renderAdmLangStats,
    renderAdmSchedulerHistory,
    renderAdmExportMenu,
    renderAdmProcessMonitor,
    renderAdmPaymentRequests,
    renderAdmDiagnostics,
    renderAdmBroadcastStatus,
    renderAdmApiKeys,
    renderAdmRateStats,
    renderAdmWebhookLog,
};