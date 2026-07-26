// bot.js 

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, exec } = require('child_process');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const AdmZip = require('adm-zip');
const schedule = require('node-schedule');

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
    token: process.env.BOT_TOKEN || '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4',
    ownerId: parseInt(process.env.OWNER_ID || '0'),
    announceChannel: process.env.ANNOUNCE_CHANNEL || '',
    port: parseInt(process.env.PORT || '10460'),
    brand: 'Pʀᴇᴍɪᴜᴍ Vᴘs Hᴏsᴛɪɴɢ Rᴏʙᴏᴛ',
    version: 'v2.1',
    supportUser: '@NEX_CONTACT_AGENT_BOT',
    updateChannel: 'https://t.me/PREMIUM_BOT_UPDATES',
    maxUploadMB: 75,
    logRingSize: 200,
};

const FOOTER = `\n\n<blockquote>${CONFIG.brand} ${CONFIG.version}</blockquote>`;

// ============================================================
// DATABASE SETUP
// ============================================================

const DB_PATH = path.join(__dirname, 'storage', 'data', 'panel.db');
const STORAGE_DIRS = {
    uploads: path.join(__dirname, 'storage', 'uploads'),
    encfiles: path.join(__dirname, 'storage', 'encfiles'),
    data: path.join(__dirname, 'storage', 'data'),
    logs: path.join(__dirname, 'storage', 'logs'),
    backups: path.join(__dirname, 'storage', 'backups'),
    sandbox: path.join(__dirname, 'sandbox'),
    tickets: path.join(__dirname, 'storage', 'tickets'),
    bot_data: path.join(__dirname, 'storage', 'bot_data'),
    photos: path.join(__dirname, 'storage', 'photos'),
};

Object.values(STORAGE_DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        username TEXT,
        plan TEXT DEFAULT 'free',
        plan_expires TEXT,
        joined TEXT,
        last_seen TEXT,
        banned INTEGER DEFAULT 0,
        ban_reason TEXT,
        wallet REAL DEFAULT 0,
        verified INTEGER DEFAULT 1,
        verified_at TEXT,
        ref_by INTEGER,
        ref_count INTEGER DEFAULT 0,
        ref_credit REAL DEFAULT 0,
        trial_used INTEGER DEFAULT 0,
        bot_slots_bonus INTEGER DEFAULT 0,
        api_key_hash TEXT,
        api_key_created TEXT,
        lang TEXT DEFAULT 'en'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bots (
        id TEXT PRIMARY KEY,
        name TEXT,
        owner INTEGER,
        dir TEXT,
        status TEXT DEFAULT 'stopped',
        created TEXT,
        last_started TEXT,
        last_error TEXT,
        last_exit_code INTEGER,
        last_exit_at TEXT,
        approval_status TEXT,
        approval_reason TEXT,
        source TEXT,
        gh_repo TEXT,
        entry TEXT,
        gh_synced_at INTEGER DEFAULT 0,
        env TEXT,
        cron TEXT,
        enc_files TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        uid INTEGER,
        method TEXT,
        plan TEXT,
        amount REAL,
        status TEXT DEFAULT 'pending',
        ts TEXT,
        approved_by INTEGER,
        approved_at TEXT,
        rejected_by INTEGER,
        rejected_at TEXT,
        kind TEXT,
        telegram_msg_id INTEGER,
        note TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
        uid INTEGER PRIMARY KEY,
        role TEXT,
        added TEXT,
        by_uid INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT,
        uid INTEGER,
        action TEXT,
        detail TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS coupons (
        code TEXT PRIMARY KEY,
        percent INTEGER,
        uses_left INTEGER,
        max_uses INTEGER,
        expiry TEXT,
        created_by INTEGER,
        created_at TEXT,
        used_by TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        uid INTEGER,
        subject TEXT,
        status TEXT DEFAULT 'open',
        messages TEXT,
        opened_at TEXT,
        closed_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS scan_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT,
        uid INTEGER,
        filename TEXT,
        verdict TEXT,
        risk_score INTEGER,
        summary TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT,
        text TEXT,
        plan TEXT,
        by_uid INTEGER
    )`);
});

// ============================================================
// UTILITY HELPERS
// ============================================================

function nowUtc() {
    return new Date().toISOString();
}

function tsIso() {
    return nowUtc();
}

function fmtBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(1)} ${units[i]}`;
}

function fmtDur(ms) {
    if (!ms || ms < 0) return '—';
    let s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    s %= 86400;
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

function fmtTs(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toUTCString();
    } catch {
        return iso;
    }
}

function esc(s) {
    if (!s) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeName(s) {
    s = (s || '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
    return (s || 'bot').slice(0, 48);
}

function randToken(n = 8) {
    return crypto.randomBytes(n).toString('hex').slice(0, n).toUpperCase();
}

function randomId(length = 12) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function safePathJoin(root, ...parts) {
    const final = path.resolve(root, ...parts);
    const rootResolved = path.resolve(root);
    if (!final.startsWith(rootResolved)) {
        throw new Error('path traversal detected');
    }
    return final;
}

function rmrf(p) {
    if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
    }
}

function isOwner(uid) {
    return uid === CONFIG.ownerId;
}

function isAdmin(uid) {
    return new Promise((resolve) => {
        if (isOwner(uid)) return resolve(true);
        db.get('SELECT 1 FROM admins WHERE uid = ?', [uid], (err, row) => {
            resolve(!!row);
        });
    });
}

function adminRole(uid) {
    return new Promise((resolve) => {
        if (isOwner(uid)) return resolve('owner');
        db.get('SELECT role FROM admins WHERE uid = ?', [uid], (err, row) => {
            resolve(row ? row.role : '');
        });
    });
}

function adminCan(uid, action) {
    return new Promise(async (resolve) => {
        const role = await adminRole(uid);
        if (role === 'owner') return resolve(true);
        if (role === 'full-access') return resolve(action !== 'manage_admins');
        if (role === 'manage-users') {
            const allowed = ['view_stats', 'view_users', 'find_user', 'ban_user',
                'give_plan', 'approve_payment', 'reply_ticket', 'broadcast_view',
                'user_note'];
            return resolve(allowed.includes(action));
        }
        if (role === 'view-only') {
            return resolve(['view_stats', 'view_users', 'find_user'].includes(action));
        }
        resolve(false);
    });
}

function audit(uid, action, detail = '') {
    const ts = tsIso();
    db.run('INSERT INTO audit (ts, uid, action, detail) VALUES (?, ?, ?, ?)',
        [ts, uid, action, detail]);
    db.run('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 500)');
}

// ============================================================
// SETTINGS HELPERS
// ============================================================

function getSetting(key, defaultValue = null) {
    return new Promise((resolve) => {
        db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
            if (err || !row) return resolve(defaultValue);
            try {
                resolve(JSON.parse(row.value));
            } catch {
                resolve(row.value);
            }
        });
    });
}

function setSetting(key, value) {
    return new Promise((resolve) => {
        const val = typeof value === 'string' ? value : JSON.stringify(value);
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, val], () => resolve());
    });
}

// ============================================================
// USER MANAGEMENT
// ============================================================

function getOrCreateUser(user, ref = null) {
    return new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [user.id], (err, row) => {
            if (row) {
                db.run('UPDATE users SET last_seen = ? WHERE id = ?',
                    [tsIso(), user.id]);
                return resolve({ user: row, isNew: false });
            }

            const joined = tsIso();
            const newUser = {
                id: user.id,
                name: user.first_name || '',
                username: user.username || '',
                plan: 'free',
                plan_expires: null,
                joined: joined,
                last_seen: joined,
                banned: 0,
                ban_reason: '',
                wallet: 0,
                verified: 1,
                verified_at: joined,
                ref_by: ref && ref !== user.id ? ref : null,
                ref_count: 0,
                ref_credit: 0,
                trial_used: 0,
                bot_slots_bonus: 0,
            };

            db.run(`INSERT INTO users (
                id, name, username, plan, plan_expires, joined, last_seen,
                banned, ban_reason, wallet, verified, verified_at,
                ref_by, ref_count, ref_credit, trial_used, bot_slots_bonus
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    newUser.id, newUser.name, newUser.username,
                    newUser.plan, newUser.plan_expires, newUser.joined,
                    newUser.last_seen, newUser.banned, newUser.ban_reason,
                    newUser.wallet, newUser.verified, newUser.verified_at,
                    newUser.ref_by, newUser.ref_count, newUser.ref_credit,
                    newUser.trial_used, newUser.bot_slots_bonus
                ]);

            if (ref && ref !== user.id) {
                db.get('SELECT * FROM users WHERE id = ?', [ref], (err, refUser) => {
                    if (refUser) {
                        db.run(`UPDATE users SET 
                            ref_count = ref_count + 1,
                            ref_credit = ref_credit + 1,
                            bot_slots_bonus = bot_slots_bonus + 1
                            WHERE id = ?`, [ref]);
                        try {
                            bot.sendMessage(ref,
                                `<blockquote>➕ Referral bonus earned!
                                From: @${user.username || user.first_name}
                                Bonus: +1 bot slot, +1 wallet credit</blockquote>`,
                                { parse_mode: 'HTML' }
                            );
                        } catch {}
                    }
                });
            }

            notifyOwner(
                `<blockquote>➕ New user joined
                Name: ${user.first_name}
                Username: @${user.username || 'Unknown'}
                User ID: ${user.id}</blockquote>`
            );

            resolve({ user: newUser, isNew: true });
        });
    });
}

function listUserBots(uid) {
    return new Promise((resolve) => {
        db.all('SELECT * FROM bots WHERE owner = ?', [uid], (err, rows) => {
            resolve(rows || []);
        });
    });
}

function findBot(botId) {
    return new Promise((resolve) => {
        db.get('SELECT * FROM bots WHERE id = ?', [botId], (err, row) => {
            resolve(row || null);
        });
    });
}

function saveBot(doc) {
    return new Promise((resolve) => {
        db.run(`INSERT OR REPLACE INTO bots (
            id, name, owner, dir, status, created, last_started,
            last_error, last_exit_code, last_exit_at, approval_status,
            approval_reason, source, gh_repo, entry, gh_synced_at,
            env, cron, enc_files
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                doc.id, doc.name, doc.owner, doc.dir, doc.status,
                doc.created, doc.last_started || null,
                doc.last_error || '', doc.last_exit_code || null,
                doc.last_exit_at || null, doc.approval_status || null,
                doc.approval_reason || '', doc.source || 'local',
                doc.gh_repo || '', doc.entry || '',
                doc.gh_synced_at || 0,
                JSON.stringify(doc.env || {}),
                JSON.stringify(doc.cron || {}),
                JSON.stringify(doc.enc_files || [])
            ],
            () => resolve(doc)
        );
    });
}

function deleteBotDoc(botId) {
    return new Promise((resolve) => {
        db.run('DELETE FROM bots WHERE id = ?', [botId], () => resolve());
    });
}

function userMaxBots(user) {
    const plan = user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const base = limits.max_bots || 1;
    return base + (user.bot_slots_bonus || 0);
}

function userPlanActive(user) {
    if (user.plan === 'free') return true;
    if (!user.plan_expires) return false;
    try {
        return new Date(user.plan_expires) > new Date();
    } catch {
        return false;
    }
}

function grantPlan(uid, plan, days = null) {
    return new Promise((resolve) => {
        const pl = PLAN_LIMITS[plan];
        if (!pl) return resolve(false);

        const daysToAdd = days !== null ? days : pl.days;
        let newExpiry = null;

        if (plan !== 'free') {
            let baseDate = new Date();
            db.get('SELECT plan_expires FROM users WHERE id = ?', [uid], (err, row) => {
                if (row && row.plan_expires) {
                    try {
                        const curExp = new Date(row.plan_expires);
                        if (curExp > new Date()) {
                            baseDate = curExp;
                        }
                    } catch {}
                }
                const expiry = new Date(baseDate);
                expiry.setDate(expiry.getDate() + daysToAdd);
                newExpiry = expiry.toISOString();

                db.run(`UPDATE users SET plan = ?, plan_expires = ? WHERE id = ?`,
                    [plan, newExpiry, uid]);

                try {
                    bot.sendMessage(uid,
                        `<b>✅ Plan activated</b>\n` +
                        `Plan: ${pl.name}\n` +
                        `Bots: ${pl.max_bots}\n` +
                        `RAM: ${pl.ram} MB\n` +
                        `Until: ${newExpiry ? newExpiry.slice(0, 10) : 'Lifetime'}` +
                        FOOTER,
                        { parse_mode: 'HTML' }
                    );
                } catch {}

                resolve(true);
            });
        } else {
            db.run(`UPDATE users SET plan = ?, plan_expires = ? WHERE id = ?`,
                ['free', null, uid]);
            resolve(true);
        }
    });
}

// ============================================================
// GLYPHS
// ============================================================

const G = {
    ok: '✓',
    no: '✘',
    warn: '⚠',
    arrow: '→',
    bullet: '•',
    tri: '▸',
    diamond: '◆',
    star: '★',
    spark: '✦',
    back: '↲',
    fwd: '▶',
    plus: '⊕',
    minus: '⊖',
    rec: '◉',
    rec_off: '○',
    div: '━'.repeat(16),
    div_eq: '═'.repeat(16),
    div_dash: '┈'.repeat(16),
    block_on: '■',
    block_off: '□',
    border_top: '═'.repeat(16),
    border_mid: '━'.repeat(16),
    border_bot: '═'.repeat(16),
    play: '▶',
    stop: '■',
    pause: '❙❙',
    refresh: '↻',
    running: '▶',
    stopped: '■',
    lock: '▣',
    unlock: '▢',
    secure: '◈',
    key: '❖',
    shield: '◇',
    ban: '⚔',
    trash: '✖',
    eye: '◉',
    user: '◈',
    users: '◎',
    crown: '♔',
    wallet: '◆',
    premium: '⌬',
    lifetime: '✶',
    gift: '✦',
    ticket: '✿',
    trophy: '★',
    graph: '▪',
    stats: '▪',
    chart_up: '▲',
    plan: '▤',
    broadcast: '⚑',
    chat: '▫',
    folder: '▸',
    upload: '▴',
    download: '▾',
    cloud: '☁',
    settings: '⚙',
    cog: '⚙',
    bolt: '⚡',
    clock: '⏱',
};

// ============================================================
// PLAN LIMITS
// ============================================================

const PLAN_LIMITS = {
    free:       { name: 'Free',       max_bots: 2,   ram: 128,  auto_restart: false, price: 0,    days: 0 },
    starter:    { name: 'Starter',    max_bots: 4,   ram: 256,  auto_restart: true,  price: 1000,   days: 30 },
    basic:      { name: 'Basic',      max_bots: 6,   ram: 512,  auto_restart: true,  price: 1500,  days: 30 },
    pro:        { name: 'Pro',        max_bots: 8,   ram: 2048, auto_restart: true,  price: 2000,  days: 30 },
    enterprise: { name: 'Enterprise', max_bots: 10,  ram: 4096, auto_restart: true,  price: 999,  days: 30 },
    lifetime:   { name: 'Lifetime',   max_bots: 15,  ram: 8192, auto_restart: true,  price: 4000, days: 36500 },
};

// ============================================================
// PAYMENT METHODS
// ============================================================

const PAYMENT_METHODS = {
    bank: { name: 'Bank', number: 'Contact admin', type: 'Bank Transfer', tag: '[BK]' },
};

// ============================================================
// SECRET ENV NAMES
// ============================================================

const SECRET_ENV_NAMES = new Set([
    'BOT_TOKEN', 'OWNER_ID', 'ERROR_BOT_TOKEN',
    'MONGO_URL', 'MONGO_URL_BACKUP',
    'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_KEY_REPO',
    'OWNER_IDS', 'SESSION_SECRET',
    'DATABASE_URL', 'PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD',
    'REPLIT_DB_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
    'ANNOUNCE_CHANNEL',
]);

// ============================================================
// NOTIFY OWNER
// ============================================================

function notifyOwner(html) {
    if (!CONFIG.ownerId) return;
    try {
        bot.sendMessage(CONFIG.ownerId, html, { parse_mode: 'HTML' });
    } catch {}
}

function postAnnouncement(html) {
    if (!CONFIG.announceChannel) return;
    try {
        bot.sendMessage(CONFIG.announceChannel, html, { parse_mode: 'HTML' });
    } catch {}
}

// ============================================================
// ANIMATED BOT STARTED ANNOUNCEMENT
// ============================================================

function sendBotStartedAnnouncement(userId, botName, botId) {
    if (!CONFIG.announceChannel) return;

    const userLink = `tg://user?id=${userId}`;
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const msg =
`<blockquote>🚀 <b>NEW BOT STARTED</b>
━━━━━━━━━━━━━━━━━━━━━━━
🤖 <b>Bot:</b> ${esc(botName)}
<tg-emoji emoji-id="5447410659077661506">🔒</tg-emoji> ID: <code>${botId}</code>
<tg-emoji> emoji-id="5427168083074628963">👤</tg-emoj> User: <a href="${userLink}">${userId}</a>
<tg-emoji> emoji-id="6242308461598610637">⏰</tg-emoji>  Started: ${timeStr} UTC
━━━━━━━━━━━━━━━━━━━━━━━
✨ Bot is now live and running!</blockquote>
${FOOTER}`;

    try {
        bot.sendMessage(CONFIG.announceChannel, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch {}
}

// ============================================================
// RATE LIMITER
// ============================================================

class RateLimiter {
    constructor(maxActions = 40, windowSec = 60) {
        this.max = maxActions;
        this.window = windowSec;
        this.bucket = new Map();
    }

    allow(uid) {
        const now = Date.now();
        const key = String(uid);
        const entry = this.bucket.get(key) || { timestamps: [] };
        entry.timestamps = entry.timestamps.filter(t => now - t < this.window * 1000);
        if (entry.timestamps.length >= this.max) return false;
        entry.timestamps.push(now);
        this.bucket.set(key, entry);
        return true;
    }

    hits(uid) {
        const now = Date.now();
        const key = String(uid);
        const entry = this.bucket.get(key);
        if (!entry) return 0;
        return entry.timestamps.filter(t => now - t < this.window * 1000).length;
    }
}

const rateLimiter = new RateLimiter(40, 60);
const uploadRateLimiter = new RateLimiter(8, 300);

function maybeAutoBan(uid, reason) {
    getSetting('rate_violations', {}).then(violations => {
        const key = String(uid);
        violations[key] = (violations[key] || 0) + 1;
        setSetting('rate_violations', violations);

        if (violations[key] >= 5) {
            db.get('SELECT * FROM users WHERE id = ?', [uid], (err, user) => {
                if (user && !user.banned) {
                    db.run(`UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?`,
                        [`auto: ${reason}`, uid]);
                    audit(0, 'auto_ban', `uid=${uid} reason=${reason}`);
                    notifyOwner(
                        `<b>⚠️ Suspicious Activity</b>\n` +
                        `User <code>${uid}</code> auto-banned (${esc(reason)}).`
                    );
                }
            });
        }
    });
}

// ============================================================
// MAINTENANCE / BAN BLOCK
// ============================================================

function maintenanceBlock(uid) {
    return getSetting('maintenance', false).then(maintenance => {
        if (maintenance) return isAdmin(uid).then(admin => !admin);
        return false;
    });
}

function bannedBlock(msg) {
    const uid = msg.from.id;
    return new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, user) => {
            if (user && user.banned) {
                try {
                    bot.sendMessage(msg.chat.id,
                        `<blockquote>❌ You are banned</blockquote>\n` +
                        `Reason: ${user.ban_reason || '—'}\n` +
                        `Contact ${CONFIG.supportUser} to appeal.`,
                        { parse_mode: 'HTML' }
                    );
                } catch {}
                return resolve(true);
            }
            resolve(false);
        });
    });
}

// ============================================================
// BOT INSTANCE
// ============================================================

const bot = new TelegramBot(CONFIG.token, { polling: true });

// ============================================================
// KEYBOARD BUILDERS
// ============================================================

function mainMenuKb(admin = false) {
    const kb = {
        inline_keyboard: [
            [
                { text: `My Bots`, callback_data: 'menu_bots', style: 'primary' },
                { text: ` Upload Bot`, callback_data: 'menu_upload', style: 'danger' },
            ],
            [
                { text: `Plans`, callback_data: 'menu_plans', style: 'primary' },
                { text: ` Buy Plan`, callback_data: 'menu_buy', style: 'danger' },
            ],
            [
                { text: `Referral`, callback_data: 'menu_referral', style: 'primary' },
                { text: `Profile`, callback_data: 'menu_profile', style: 'danger' },
            ],
            [
                { text: ` Wallet`, callback_data: 'menu_wallet', style: 'primary' },
                { text: `Tickets`, callback_data: 'menu_tickets', style: 'danger' },
            ],
            [
                { text: ` Free Trial`, callback_data: 'menu_trial', style: 'primary' },
                { text: ` Coupon`, callback_data: 'menu_coupon', style: 'danger' },
            ],
            [
                { text: `Help`, callback_data: 'menu_help', style: 'danger' },
                { text: `Support`, callback_data: 'menu_support', style: 'danger' },
            ],
            [
                { text: ` My Stats`, callback_data: 'menu_stats', style: 'sucess' },
            ],
        ]
    };
    if (admin) {
        kb.inline_keyboard.push([
            [{ text: `Admin Panel`, callback_data: 'menu_admin', style: 'danger' }]
        ]);
    }
    return kb;
}

function backMainKb() {
    return {
        inline_keyboard: [
            [{ text: `${G.back}  Main Menu`, callback_data: 'menu_main', style: 'sucess' }]
        ]
    };
}

function backAdminKb() {
    return {
        inline_keyboard: [
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'sucess' }]
        ]
    };
}

function backKb(target, label = 'Back') {
    return {
        inline_keyboard: [
            [{ text: `${G.back}  ${label}`, callback_data: target }]
        ]
    };
}

function plansKb() {
    const kb = { inline_keyboard: [] };
    for (const [key, val] of Object.entries(PLAN_LIMITS)) {
        const price = val.price === 0 ? 'Free' : `${val.price}৳`;
        kb.inline_keyboard.push([
            { text: `${G.star}  ${val.name}  ${G.bullet}  ${price}`,
                callback_data: `plan_view_${key}` }
        ]);
    }
    kb.inline_keyboard.push([
        [{ text: `${G.back}  Main Menu`, callback_data: 'menu_main' }]
    ]);
    return kb;
}

function paymentsKb(plan = null) {
    const kb = { inline_keyboard: [] };
    const suffix = plan ? `_${plan}` : '';
    for (const [key, val] of Object.entries(PAYMENT_METHODS)) {
        kb.inline_keyboard.push([
            { text: `${val.tag}  ${val.name}`, callback_data: `pay_${key}${suffix}` }
        ]);
    }
    kb.inline_keyboard.push([
        [{ text: `${G.back}  Plans`, callback_data: 'menu_plans' }]
    ]);
    return kb;
}

function adminKb() {
    return {
        inline_keyboard: [
            [
                { text: `${G.graph}  Stats`, callback_data: 'adm_stats', style: 'primary' },
                { text: `${G.users}  Users`, callback_data: 'adm_users', style: 'danger' },
            ],
            [
                { text: `${G.diamond}  All Bots`, callback_data: 'adm_allbots', style: 'primary' },
                { text: `${G.wallet}  Payments`, callback_data: 'adm_payments', style: 'danger' },
            ],
            [
                { text: `${G.broadcast}  Broadcast`, callback_data: 'adm_broadcast', style: 'primary' },
                { text: `${G.no}  Ban / Unban`, callback_data: 'adm_ban', style: 'danger' },
            ],
            [
                { text: `${G.plus}  Give Plan`, callback_data: 'adm_giveplan', style: 'primary' },
                { text: `${G.ok}  Approve Pay`, callback_data: 'adm_approve', style: 'danger' },
            ],
            [
                { text: `${G.key}  Coupons`, callback_data: 'adm_coupons', style: 'primary' },
                { text: `${G.ticket}  Tickets`, callback_data: 'adm_tickets', style: 'danger' },
            ],
            [
                { text: `${G.shield}  Admins`, callback_data: 'adm_admins', style: 'primary' },
                { text: `${G.eye}  Audit Log`, callback_data: 'adm_audit', style: 'danger' },
            ],
            [
                { text: `${G.cog}  GitHub Backup`, callback_data: 'adm_github', style: 'primary' },
                { text: `${G.lock}  Security`, callback_data: 'adm_security', style: 'danger' },
            ],
            [
                { text: `${G.warn}  Maintenance`, callback_data: 'adm_maint', style: 'primary' },
                { text: `${G.settings}  Settings`, callback_data: 'adm_settings', style: 'danger' },
            ],
            [
                { text: `📊  Analytics`, callback_data: 'adm_analytics', style: 'primary' },
                { text: `👥  User Tools`, callback_data: 'adm_user_tools', style: 'danger' },
            ],
            [
                { text: `🤖  Bot Manager`, callback_data: 'adm_bot_manager', style: 'primary' },
                { text: `🛡️  Sec Center`, callback_data: 'adm_sec_center', style: 'danger' },
            ],
            [
                { text: `💬  Notifications`, callback_data: 'adm_notify_center', style: 'primary' },
                { text: `⚙️  Sys Tools`, callback_data: 'adm_sys_tools', style: 'danger' },
            ],
            [
                { text: `🐙  Gh Browser`, callback_data: 'adm_gh_browser', style: 'primary' },
                { text: `💳  Pay Config`, callback_data: 'adm_pay_config', style: 'danger' },
            ],
            [
                { text: `🔧  Bot Config`, callback_data: 'adm_bot_cfg', style: 'primary' },
                { text: `🎨  Appearance`, callback_data: 'adm_appearance', style: 'danger' },
            ],
            [
                { text: `🎫  Coupon+`, callback_data: 'adm_coupon_plus', style: 'primary'},
                { text: `📝  Templates`, callback_data: 'adm_templates', style: 'danger' },
            ],
            [
                { text: `🔗  Referral Sys`, callback_data: 'adm_referral_sys', style: 'primary' },
                { text: `🧹  Janitor`, callback_data: 'adm_janitor', style: 'danger' },
            ],
            [
                { text: `🌐  Webhooks`, callback_data: 'adm_webhooks', style: 'primary' },
                { text: `🎯  Feature Flags`, callback_data: 'adm_feature_flags', style: 'danger' },
            ],
            [
                { text: `⏱️  Rate Limits`, callback_data: 'adm_rate_config', style: 'primary' },
                { text: `📡  Live Monitor`, callback_data: 'adm_live_monitor', style: 'danger' },
            ],
            [
                { text: `💎  Rev Goals`, callback_data: 'adm_rev_goals', style: 'primary' },
                { text: `⏰  Scheduler`, callback_data: 'adm_scheduler', style: 'danger' },
            ],
            [
                { text: `📥  Import/Exp`, callback_data: 'adm_import_export', style: 'primary' },
                { text: `🏆  Leaderboard`, callback_data: 'adm_leaderboard', style: 'danger' },
            ],
            [
                { text: `🌍  Languages`, callback_data: 'adm_languages', style: 'primary' },
                { text: `🤖  Bot Controls`, callback_data: 'adm_bot_controls', style: 'danger' },
            ],
            [
                { text: `👤  Subscriptions`, callback_data: 'adm_subscriptions', style: 'primary' },
                { text: `🔐  Admin 2FA`, callback_data: 'adm_admin_2fa', style: 'danger' },
            ],
            [
                [{ text: `${G.back}  Main Menu`, callback_data: 'menu_main', style: 'sucess' }]
            ],
        ]
    };
}

function botActionsKb(botId, running, premium = false) {
    const kb = { inline_keyboard: [] };
    if (running) {
        kb.inline_keyboard.push([
            { text: `${G.stop}  Stop`, callback_data: `bot_stop_${botId}`, style: 'danger' },
            { text: `${G.refresh}  Restart`, callback_data: `bot_restart_${botId}`, style: 'primary' },
        ]);
    } else {
        kb.inline_keyboard.push([
            { text: `${G.play}  Start`, callback_data: `bot_start_${botId}`, style: 'sucess' },
            { text: `${G.refresh}  Restart`, callback_data: `bot_restart_${botId}`, style: 'primary' },
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.bolt}  Live Logs`, callback_data: `bot_logs_${botId}`, style: 'primary' },
        { text: `${G.eye}  Info`, callback_data: `bot_info_${botId}`, style: 'danger' },
    ]);
    kb.inline_keyboard.push([
        { text: `${G.settings}  Env Vars`, callback_data: `bot_env_${botId}`, style: 'primary' },
        { text: `${G.cog}  Cron`, callback_data: `bot_cron_${botId}`, style: 'danger' },
    ]);
    kb.inline_keyboard.push([
        { text: `${G.download}  Install Pkg`, callback_data: `bot_pip_${botId}`, style: 'primary' },
        { text: `${G.plus}  Clone`, callback_data: `bot_clone_${botId}`, style: 'danger' },
    ]);
    if (premium) {
        kb.inline_keyboard.push([
            { text: `🌐  Public URL`, callback_data: `bot_tunnel_${botId}`, style: 'primary' },
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.arrow}  Download`, callback_data: `bot_dl_${botId}`, style: 'primary' },
        { text: `${G.no}  Delete`, callback_data: `bot_delete_${botId}`, style: 'danger' },
    ]);
    kb.inline_keyboard.push([
        [{ text: `${G.back}  My Bots`, callback_data: 'menu_bots', style: 'sucess' }]
    ]);
    return kb;
}

function confirmKb(yesCb, noCb = 'menu_main', yesLabel = 'Confirm', noLabel = 'Cancel') {
    return {
        inline_keyboard: [
            [
                { text: `${G.ok}  ${yesLabel}`, callback_data: yesCb },
                { text: `${G.no}  ${noLabel}`, callback_data: noCb },
            ]
        ]
    };
}

// ============================================================
// SHOW MENU / TEXT
// ============================================================

function showMenu(chatId, photo, caption, kb, call = null) {
    const opts = {
        parse_mode: 'HTML',
        reply_markup: kb,
    };

    if (call && call.message) {
        return bot.editMessageMedia(
            {
                type: 'photo',
                media: photo,
                caption: caption,
                parse_mode: 'HTML',
            },
            {
                chat_id: chatId,
                message_id: call.message.message_id,
                reply_markup: kb,
            }
        ).catch(() => {
            return bot.sendPhoto(chatId, photo, { caption, ...opts });
        });
    }

    return bot.sendPhoto(chatId, photo, { caption, ...opts });
}

function showText(chatId, text, kb = null, call = null) {
    const opts = {
        parse_mode: 'HTML',
        reply_markup: kb,
        disable_web_page_preview: true,
    };

    if (call && call.message) {
        return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: call.message.message_id,
            ...opts,
        }).catch(() => {
            return bot.sendMessage(chatId, text, opts);
        });
    }

    return bot.sendMessage(chatId, text, opts);
}

// ============================================================
// LOADING ANIMATION
// ============================================================

const loadingStops = new Map();

function loading(call, label = 'Loading') {
    if (!call || !call.message) {
        try { bot.answerCallbackQuery(call.id, { text: `⏳ ${label}…` }); } catch {}
        return;
    }

    const chatId = call.message.chat.id;
    const msgId = call.message.message_id;
    const isPhoto = call.message.photo !== undefined;

    const existing = loadingStops.get(`${chatId}:${msgId}`);
    if (existing) {
        existing.stop = true;
        loadingStops.delete(`${chatId}:${msgId}`);
    }

    try {
        bot.answerCallbackQuery(call.id, { text: `↻ ${label}…` });
    } catch {}

    const stopFlag = { stop: false };
    loadingStops.set(`${chatId}:${msgId}`, stopFlag);

    let pct = 0;
    const render = () => {
        if (stopFlag.stop) return;
        const bar = '▓'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        const body =
            `<b>↻ ${esc(label)}…</b>\n` +
            `${G.div}\n` +
            `<code>[${bar}] ${pct}%</code>\n` +
            `<i>Please wait</i>` +
            FOOTER;

        const editFn = isPhoto ? bot.editMessageCaption : bot.editMessageText;
        editFn(body, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
        }).catch(() => {});
    };

    render();

    const animate = () => {
        const steps = [25, 38, 52, 65, 78, 88, 92];
        for (const step of steps) {
            if (stopFlag.stop) return;
            pct = step;
            render();
            const start = Date.now();
            while (Date.now() - start < 700) {
                if (stopFlag.stop) return;
            }
        }
    };

    setTimeout(animate, 100);
}

// ============================================================
// ADMIN-ONLY CALL CHECK
// ============================================================

async function adminOnlyCall(call, action = 'view_stats') {
    const uid = call.from.id;
    if (!(await isAdmin(uid))) {
        try { bot.answerCallbackQuery(call.id, { text: 'Owner / admin only.' }); } catch {}
        return false;
    }
    if (!(await adminCan(uid, action))) {
        try { bot.answerCallbackQuery(call.id, { text: 'Insufficient permission.' }); } catch {}
        return false;
    }
    return true;
}

// ============================================================
// ACKNOWLEDGE CALLBACK
// ============================================================

function ack(call, text = '') {
    try {
        bot.answerCallbackQuery(call.id, { text });
    } catch {}
}

// ============================================================
// PHOTOS
// ============================================================

const PHOTOS = {
    main: 'https://placehold.co/900x460/1E1B4B/FFFFFF?text=Main+Menu',
    admin: 'https://placehold.co/900x460/7C2D12/FFFFFF?text=Admin+Panel',
    plans: 'https://placehold.co/900x460/B45309/FFFFFF?text=Plans',
    buy: 'https://placehold.co/900x460/065F46/FFFFFF?text=Buy+Plan',
    wallet: 'https://placehold.co/900x460/047857/FFFFFF?text=Wallet',
    bots: 'https://placehold.co/900x460/0E7490/FFFFFF?text=Your+Bots',
    bot: 'https://placehold.co/900x460/1F2937/FFFFFF?text=Bot+Control',
    upload: 'https://placehold.co/900x460/4338CA/FFFFFF?text=Upload+Bot',
    stats: 'https://placehold.co/900x460/14532D/FFFFFF?text=Stats',
    support: 'https://placehold.co/900x460/0F766E/FFFFFF?text=Support',
    broadcast: 'https://placehold.co/900x460/1E40AF/FFFFFF?text=Broadcast',
    ticket: 'https://placehold.co/900x460/0F766E/FFFFFF?text=Tickets',
    coupon: 'https://placehold.co/900x460/B91C1C/FFFFFF?text=Coupon',
    security: 'https://placehold.co/900x460/991B1B/FFFFFF?text=Security',
    referral: 'https://placehold.co/900x460/9333EA/FFFFFF?text=Referral',
    help: 'https://placehold.co/900x460/334155/FFFFFF?text=Help',
    trial: 'https://placehold.co/900x460/A21CAF/FFFFFF?text=Free+Trial',
    profile: 'https://placehold.co/900x460/1E3A8A/FFFFFF?text=Profile',
};

// ============================================================
// RUNNING BOTS TRACKER
// ============================================================

const runningBots = new Map();
const botLogs = new Map();
const botProcesses = new Map();
const botTunnels = new Map();
const userStates = new Map();

// ============================================================
// START / STOP BOT CHILDREN
// ============================================================

function detectEntry(botDir) {
    const entries = {
        node: ['index.js', 'bot.js', 'main.js', 'app.js'],
        python: ['bot.py', 'main.py', 'app.py', 'run.py'],
    };

    for (const [kind, files] of Object.entries(entries)) {
        for (const file of files) {
            if (fs.existsSync(path.join(botDir, file))) {
                return { kind, entry: file };
            }
        }
    }

    const findFile = (dir, ext) => {
        const files = fs.readdirSync(dir);
        for (const f of files) {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) {
                if (['node_modules', '.deps', '__pycache__', '.git', 'venv'].includes(f)) continue;
                const result = findFile(full, ext);
                if (result) return result;
            } else if (f.endsWith(ext)) {
                return path.relative(botDir, full);
            }
        }
        return null;
    };

    let py = findFile(botDir, '.py');
    if (py) return { kind: 'python', entry: py };

    let js = findFile(botDir, '.js');
    if (js) return { kind: 'node', entry: js };

    return null;
}

function installDeps(botDir, kind, log) {
    return new Promise((resolve) => {
        try {
            if (kind === 'python') {
                const reqFile = path.join(botDir, 'requirements.txt');
                if (fs.existsSync(reqFile)) {
                    log.push(`${G.div} pip install (requirements.txt) ${G.div}`);
                    const proc = spawn('pip3', ['install', '-r', reqFile], {
                        cwd: botDir,
                        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
                    });
                    let output = '';
                    proc.stdout.on('data', (data) => {
                        const lines = data.toString().split('\n');
                        lines.slice(-15).forEach(l => log.push(l));
                        output += data;
                    });
                    proc.stderr.on('data', (data) => {
                        const lines = data.toString().split('\n');
                        lines.slice(-10).forEach(l => log.push(l));
                        output += data;
                    });
                    proc.on('close', (code) => {
                        log.push(`[${G.ok}] requirements.txt done (rc=${code})`);
                        resolve(true);
                    });
                    proc.on('error', () => resolve(false));
                } else {
                    resolve(true);
                }
            } else if (kind === 'node') {
                const pkgFile = path.join(botDir, 'package.json');
                if (!fs.existsSync(pkgFile)) return resolve(false);
                if (fs.existsSync(path.join(botDir, 'node_modules'))) {
                    log.push(`[${G.ok}] node_modules cached, skipping npm install`);
                    return resolve(true);
                }
                log.push(`${G.div} npm install ${G.div}`);
                const proc = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
                    cwd: botDir,
                });
                proc.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.slice(-15).forEach(l => log.push(l));
                });
                proc.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.slice(-10).forEach(l => log.push(l));
                });
                proc.on('close', (code) => {
                    log.push(`[${G.ok}] npm done (rc=${code})`);
                    resolve(true);
                });
                proc.on('error', () => resolve(false));
            } else {
                resolve(false);
            }
        } catch {
            resolve(false);
        }
    });
}

function safeEnv(botDir, extra = null) {
    const env = { ...process.env };
    for (const key of SECRET_ENV_NAMES) {
        delete env[key];
    }
    env.HOME = botDir;
    env.TMPDIR = path.join(botDir, '.tmp_run');
    env.PATH = '/usr/local/bin:/usr/bin:/bin';
    env.NODE_ENV = 'production';

    if (!fs.existsSync(env.TMPDIR)) {
        fs.mkdirSync(env.TMPDIR, { recursive: true });
    }

    if (extra) {
        for (const [k, v] of Object.entries(extra)) {
            if (!SECRET_ENV_NAMES.has(k)) {
                env[k] = String(v);
            }
        }
    }
    return env;
}

async function startChild(botDoc) {
    const bid = botDoc.id;
    if (runningBots.has(bid)) {
        const proc = runningBots.get(bid);
        if (proc && proc.exitCode === null) {
            return { ok: false, error: 'Already running.' };
        }
    }

    const botDir = botDoc.dir;
    if (!fs.existsSync(botDir)) {
        return { ok: false, error: 'Bot folder missing.' };
    }

    const entryInfo = detectEntry(botDir);
    if (!entryInfo) {
        return { ok: false, error: 'No entry file (index.js / bot.py).' };
    }

    const log = [`${G.div_eq} START ${tsIso()} ${G.div_eq}`];
    await installDeps(botDir, entryInfo.kind, log);

    let cmd;
    if (entryInfo.kind === 'node') {
        cmd = ['node', entryInfo.entry];
    } else {
        cmd = ['python3', '-u', entryInfo.entry];
    }

    const env = safeEnv(botDir, botDoc.env ? JSON.parse(botDoc.env) : {});

    try {
        const proc = spawn(cmd[0], cmd.slice(1), {
            cwd: botDir,
            env: env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        runningBots.set(bid, proc);
        botProcesses.set(bid, {
            proc,
            kind: entryInfo.kind,
            started: Date.now(),
            log: log,
            dir: botDir,
            name: botDoc.name,
            owner: botDoc.owner,
            manualStop: false,
        });

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            const logEntry = botProcesses.get(bid);
            if (logEntry) {
                lines.forEach(line => {
                    if (line.trim()) logEntry.log.push(line.trim());
                });
                if (logEntry.log.length > CONFIG.logRingSize) {
                    logEntry.log = logEntry.log.slice(-CONFIG.logRingSize);
                }
            }
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            const logEntry = botProcesses.get(bid);
            if (logEntry) {
                lines.forEach(line => {
                    if (line.trim()) logEntry.log.push(`[stderr] ${line.trim()}`);
                });
                if (logEntry.log.length > CONFIG.logRingSize) {
                    logEntry.log = logEntry.log.slice(-CONFIG.logRingSize);
                }
            }
        });

        proc.on('close', (code) => {
            const entry = botProcesses.get(bid);
            if (entry) {
                entry.log.push(`${G.div} process exited rc=${code} ${G.div}`);
                const manualStop = entry.manualStop;
                runningBots.delete(bid);

                db.get('SELECT * FROM bots WHERE id = ?', [bid], (err, b) => {
                    if (b) {
                        const tail = entry.log.slice(-15).filter(l => l && !l.startsWith(G.div));
                        const errText = tail.slice(-8).join('\n').slice(0, 1500);
                        b.last_error = errText;
                        b.last_exit_code = code;
                        b.last_exit_at = tsIso();
                        if (code !== 0 && code !== null && !manualStop) {
                            b.status = 'crashed';
                        } else {
                            b.status = 'stopped';
                        }
                        saveBot(b);

                        if (!manualStop && code !== 0 && code !== null) {
                            db.get('SELECT plan FROM users WHERE id = ?', [b.owner], (err, user) => {
                                const plan = user ? user.plan : 'free';
                                if (PLAN_LIMITS[plan] && PLAN_LIMITS[plan].auto_restart) {
                                    entry.log.push(`[${G.refresh}] auto-restart in 3s...`);
                                    setTimeout(() => startChild(b), 3000);
                                }
                            });
                        }
                    }
                });
            }
        });

        botDoc.status = 'running';
        botDoc.last_started = tsIso();
        botDoc.last_error = '';
        botDoc.last_exit_code = null;
        await saveBot(botDoc);

        sendBotStartedAnnouncement(botDoc.owner, botDoc.name, botDoc.id);

        return { ok: true, pid: proc.pid, kind: entryInfo.kind };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
}

function stopChild(botId, manual = true) {
    return new Promise((resolve) => {
        const entry = botProcesses.get(botId);
        if (!entry) {
            db.run(`UPDATE bots SET status = 'stopped' WHERE id = ?`, [botId]);
            return resolve({ ok: true });
        }

        entry.manualStop = manual;
        const proc = entry.proc;

        proc.kill('SIGTERM');

        setTimeout(() => {
            if (proc.exitCode === null) {
                proc.kill('SIGKILL');
            }
            runningBots.delete(botId);
            botProcesses.delete(botId);
            db.run(`UPDATE bots SET status = 'stopped' WHERE id = ?`, [botId]);
            resolve({ ok: true });
        }, 3000);
    });
}

function restartChild(botDoc) {
    return new Promise(async (resolve) => {
        await stopChild(botDoc.id, false);
        setTimeout(() => {
            const result = startChild(botDoc);
            resolve(result);
        }, 1000);
    });
}

function childStatus(botId, botDoc) {
    const entry = botProcesses.get(botId);
    const running = entry && entry.proc && entry.proc.exitCode === null;

    let size = 0;
    try {
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
        if (fs.existsSync(botDoc.dir)) walk(botDoc.dir);
    } catch {}

    let cpu = 0, mem = 0;
    if (running && entry && entry.proc) {
        try {
            if (process.platform === 'linux') {
                const stat = fs.readFileSync(`/proc/${entry.proc.pid}/stat`, 'utf8');
                const parts = stat.split(' ');
                const utime = parseInt(parts[13]);
                const stime = parseInt(parts[14]);
                const totalTime = utime + stime;
                const start = Date.now() - entry.started;
                cpu = (totalTime / 100) / (start / 1000) * 100;
                const memStat = fs.readFileSync(`/proc/${entry.proc.pid}/status`, 'utf8');
                const match = memStat.match(/VmRSS:\s+(\d+)/);
                if (match) mem = parseInt(match[1]) * 1024;
            }
        } catch {}
    }

    return {
        running,
        pid: running && entry ? entry.proc.pid : null,
        kind: entry ? entry.kind : '—',
        uptimeMs: running && entry ? Date.now() - entry.started : 0,
        sizeBytes: size,
        logs: entry ? entry.log : [],
        cpuPct: cpu,
        memBytes: mem,
        sandboxed: true,
    };
}

// ============================================================
// VERIFICATION (COMPLETELY REMOVED - Always returns true)
// ============================================================

// All verification functions removed - no captcha, no verification flow
// Users go directly to main menu after /start

// ============================================================
// RENDER MAIN MENU
// ============================================================

async function renderMainMenu(chatId, uid, call = null, intro = null) {
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });
    if (!user) return;

    const plan = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
    const bots = await listUserBots(uid);
    const running = bots.filter(b => runningBots.has(b.id)).length;

    let introBlock = '';
    if (intro) introBlock = `${intro}\n${G.div}\n`;

    const cap =
        `<blockquote>${esc(CONFIG.brand)} ${CONFIG.version}
        ${G.div_eq}
        ᴡᴇʟᴄᴏᴍᴇ, <b>${esc(user.name || 'friend')}</b>
        ᴘʟᴀɴ: ${plan.name}
        ᴜɴᴛɪʟ: ${user.plan_expires ? fmtTs(user.plan_expires) : (plan.price === 0 ? 'Forever' : '—')}
        ʙᴏᴛs: ${bots.length} / ${userMaxBots(user)} (running ${running})
        ᴡᴀʟʟᴇᴛ: $${user.wallet || 0}
        ${G.div}
        ᴄʜᴏᴏsᴇ ᴀɴ ᴏᴘᴛɪᴏɴ ʙᴇʟᴏᴡ.<blockquote`

    const admin = await isAdmin(uid);
    return showMenu(chatId, PHOTOS.main, cap, mainMenuKb(admin), call);
}

// ============================================================
// COMMAND HANDLERS
// ============================================================

bot.onText(/\/start/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    const uid = msg.from.id;

    if (!rateLimiter.allow(uid)) {
        maybeAutoBan(uid, 'rate');
        return;
    }
    if (await bannedBlock(msg)) return;

    if (CONFIG.ownerId <= 0) {
        const stored = await getSetting('owner_id', 0);
        if (stored > 0) {
            CONFIG.ownerId = stored;
        } else {
            CONFIG.ownerId = uid;
            await setSetting('owner_id', uid);
            audit(uid, 'owner_claim', `first /start, uid=${uid}`);
            try {
                bot.sendMessage(msg.chat.id,
                    `<blockquote>👑 ʏᴏᴜ ᴀʀᴇ ɴᴏᴡ ᴛʜᴇ ᴘᴀɴᴇʟ ᴏᴡɴᴇʀ
                    ${G.div}
                    ᴏᴡɴᴇʀ ɪᴅ: ${uid}
                    sᴇᴛ ᴏᴡɴᴇʀ_ɪᴅ ᴇɴᴠ ᴠᴀʀ ᴛᴏ ʟᴏᴄᴋ ᴏᴡɴᴇʀsʜɪᴘ ᴘᴇʀᴍᴀɴᴇɴᴛʟʏ.</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            } catch {}
        }
    }

    let ref = null;
    const parts = msg.text ? msg.text.split(/\s+/) : [];
    if (parts.length > 1 && /^\d+$/.test(parts[1])) {
        ref = parseInt(parts[1]);
    }

    const { user, isNew } = await getOrCreateUser(msg.from, ref);

    if (await maintenanceBlock(uid)) {
        bot.sendMessage(msg.chat.id,
            `<b>⚠️ sʏsᴛᴇᴍ ᴜɴᴅᴇʀ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ</b>\n\n` +
            `ᴡᴇ ᴡɪʟʟ ʙᴇ ʙᴀᴄᴋ sʜᴏʀᴛʟʏ. ${CONFIG.supportUser} ғᴏʀ ᴜʀɢᴇɴᴛ ɪssᴜᴇs.`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    // NO VERIFICATION - Directly show main menu
    const intro = isNew ?
        `ʏᴏᴜ ᴀʀᴇ ɴᴏᴡ ʀᴇɢɪsᴛᴇʀᴇᴅ. ᴛᴀᴘ <b>ᴘʟᴀɴs</b> ᴏʀ <b>ᴜᴘʟᴏᴀᴅ ʙᴏᴛ</b> ᴛᴏ ʙᴇɢɪɴ.` :
        `ᴡᴇʟᴄᴏᴍᴇ ʙᴀᴄᴋ, <b>${esc(msg.from.first_name || 'friend')}</b>!`;

    renderMainMenu(msg.chat.id, uid, null, intro);
});

bot.onText(/\/help/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (await bannedBlock(msg)) return;

    const text =
        `<blockquote>${esc(CONFIG.brand)} ${CONFIG.version} — ǫᴜɪᴄᴋ ʜᴇʟᴘ</blockquote>\n` +
        `${G.div_eq}\n` +
        `ᴜᴘʟᴏᴀᴅ: sᴇɴᴅ ᴀ .ᴘʏ  / .ᴊs / .ᴢɪᴘ ғɪʟᴇ ᴏʀ ᴜsᴇ ᴜᴘʟᴏᴀᴅ ʙᴏᴛ ᴍᴇɴᴜ.\n` +
        `ᴍᴀɴᴀɢᴇ: ᴍʏ ʙᴏᴛs → ᴘɪᴄᴋ ᴀ ʙᴏᴛ → sᴛᴀʀᴛ / sᴛᴏᴘ / ʟᴏɢs...\n` +
        `ᴘʟᴀɴs: ᴘʟᴀɴs → ʙᴜʏ ᴘʟᴀɴ → ᴄʜᴏᴏsᴇ ᴍᴇᴛʜᴏᴅ → sᴇɴᴅ ᴘʀᴏᴏғ.\n` +
        `ᴡᴀʟʟᴇᴛ: ᴛᴏᴘ-ᴜᴘ ᴠɪᴀ ᴀᴅᴍɪɴ, ᴛʜᴇɴ sᴘᴇɴᴅ ᴏɴ ᴘʟᴀɴs.\n` +
        `ʀᴇғᴇʀ: ɪɴᴠɪᴛᴇ ғʀɪᴇɴᴅs ᴡɪᴛʜ ʏᴏᴜʀ ʟɪɴᴋ ᴛᴏ ᴇᴀʀɴ sʟᴏᴛs.\n` +
        `ᴛʀɪᴀʟ: ᴏɴᴇ-ᴛɪᴍᴇ 48-ʜᴏᴜʀ ᴘʀᴏ ᴛʀɪᴀʟ ɪɴ ᴛʜᴇ ᴛʀɪᴀʟ ᴍᴇɴᴜ.\n` +
        `sᴜᴘᴘᴏʀᴛ: ᴏᴘᴇɴ ᴀ ᴛɪᴄᴋᴇᴛ ғʀᴏᴍ ᴛʜᴇ ᴛɪᴄᴋᴇᴛs ᴍᴇɴᴜ, ᴏʀ ᴅᴍ ${CONFIG.supportUser}.\n` +
        `${G.div}` +
        FOOTER;

    bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML',
        reply_markup: backMainKb(),
        disable_web_page_preview: true,
    });
});

bot.onText(/\/menu/, async (msg) => {
    if (await bannedBlock(msg)) return;
    await getOrCreateUser(msg.from);
    renderMainMenu(msg.chat.id, msg.from.id);
});

bot.onText(/\/id/, async (msg) => {
    bot.sendMessage(msg.chat.id, `<code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

bot.onText(/\/cancel/, async (msg) => {
    userStates.delete(msg.from.id);
    bot.sendMessage(msg.chat.id, `${G.ok} Cancelled`);
});

bot.onText(/\/admin/, async (msg) => {
    if (!(await isAdmin(msg.from.id))) {
        bot.sendMessage(msg.chat.id, `${G.no} Admin only.`);
        return;
    }
    await getOrCreateUser(msg.from);
    const kb = {
        inline_keyboard: [
            [{ text: `${G.shield}  ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ`, callback_data: 'menu_admin', style: 'sucess' }]
        ]
    };
    bot.sendMessage(msg.chat.id, `<b>${G.shield} Admin Panel</b>`, {
        parse_mode: 'HTML',
        reply_markup: kb,
    });
});

// ============================================================
// DOCUMENT HANDLER (Upload)
// ============================================================

bot.on('document', async (msg) => {
    if (await bannedBlock(msg)) return;

    const uid = msg.from.id;
    if (!rateLimiter.allow(uid)) {
        maybeAutoBan(uid, 'rate');
        return;
    }
    if (!uploadRateLimiter.allow(uid)) {
        bot.sendMessage(msg.chat.id, `${G.warn} Too many uploads, slow down.`);
        maybeAutoBan(uid, 'upload spam');
        return;
    }
    if (await maintenanceBlock(uid)) return;

    await getOrCreateUser(msg.from);

    const st = userStates.get(uid) || {};
    if (st.flow === 'await_payment_proof') {
        return handlePaymentProof(msg, st);
    }
    if (st.flow === 'await_topup_proof') {
        return handleTopupProof(msg);
    }

    handleBotUpload(msg);
});

// ============================================================
// PHOTO HANDLER
// ============================================================

bot.on('photo', async (msg) => {
    if (await bannedBlock(msg)) return;

    const uid = msg.from.id;
    if (!rateLimiter.allow(uid)) return;
    await getOrCreateUser(msg.from);

    const st = userStates.get(uid) || {};

    if (st.flow === 'await_admin_photo' && await isAdmin(uid)) {
        const key = st.photo_key || '';
        if (!PHOTO_KEYS_FRIENDLY[key]) {
            bot.sendMessage(msg.chat.id, `${G.no} Unknown photo key.`);
            userStates.delete(uid);
            return;
        }

        try {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            const file = await bot.getFile(fileId);
            const url = `https://api.telegram.org/file/bot${CONFIG.token}/${file.file_path}`;
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const raw = response.data;

            const ok = replaceMenuPhoto(key, raw);
            userStates.delete(uid);
            const label = PHOTO_KEYS_FRIENDLY[key] || key;
            if (ok) {
                audit(uid, 'menu_photo_replace', `key=${key} bytes=${raw.length}`);
                bot.sendMessage(msg.chat.id,
                    `<b>${G.ok} Banner updated</b>\n` +
                    `Menu: ${label}\n` +
                    `Size: ${fmtBytes(raw.length)}`,
                    { parse_mode: 'HTML' }
                );
            } else {
                bot.sendMessage(msg.chat.id, `${G.no} Failed to save photo.`);
            }
        } catch (err) {
            bot.sendMessage(msg.chat.id, `${G.no} Error: ${esc(String(err))}`, { parse_mode: 'HTML' });
        }
        return;
    }

    if (st.flow === 'await_payment_proof') {
        return handlePaymentProof(msg, st);
    }
    if (st.flow === 'await_topup_proof') {
        return handleTopupProof(msg);
    }
});

// ============================================================
// HANDLE BOT UPLOAD
// ============================================================

async function handleBotUpload(msg) {
    const uid = msg.from.id;
    const doc = msg.document;
    if (!doc) return;

    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });
    if (!user) return;

    const bots = await listUserBots(uid);
    if (bots.length >= userMaxBots(user)) {
        bot.sendMessage(msg.chat.id,
            `${G.no} You hit your bot slot limit. Upgrade or delete one.`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    if (doc.file_size && doc.file_size > CONFIG.maxUploadMB * 1024 * 1024) {
        bot.sendMessage(msg.chat.id,
            `${G.no} File too big (${CONFIG.maxUploadMB} MB limit).`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    const fname = doc.file_name || 'upload.bin';
    if (!/^[A-Za-z0-9._\-]+$/.test(fname)) {
        bot.sendMessage(msg.chat.id, `${G.warn} Suspicious filename, please rename.`);
        return;
    }

    try {
        const file = await bot.getFile(doc.file_id);
        const url = `https://api.telegram.org/file/bot${CONFIG.token}/${file.file_path}`;
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const raw = response.data;

        const botId = randomId(8);
        const botDir = path.join(STORAGE_DIRS.sandbox, `${uid}_${botId}`);
        fs.mkdirSync(botDir, { recursive: true });

        const name = safeName(path.parse(fname).name);
        const botDoc = {
            id: botId,
            name: name,
            owner: uid,
            dir: botDir,
            created: tsIso(),
            status: 'stopped',
            enc_files: [],
            env: {},
            cron: {},
            approval_status: 'approved',
        };

        let filesAdded = [];
        if (fname.toLowerCase().endsWith('.zip')) {
            const zip = new AdmZip(raw);
            const entries = zip.getEntries();
            for (const entry of entries) {
                if (entry.isDirectory) continue;
                const rel = entry.entryName.replace(/\\/g, '/');
                if (rel.startsWith('/') || rel.includes('..')) continue;
                try {
                    safePathJoin(botDir, rel);
                } catch {
                    continue;
                }
                filesAdded.push({ name: rel, data: entry.getData() });
            }
        } else {
            filesAdded.push({ name: fname, data: Buffer.from(raw) });
        }

        const scanResult = await runSecurityScan(filesAdded, uid);
        if (scanResult.recommendation === 'REJECT') {
            rmrf(botDir);
            const threatLines = (scanResult.threats || []).slice(0, 5).map(t => `• ${esc(t)}`).join('\n');
            bot.sendMessage(msg.chat.id,
                `<b>🚫 File Blocked — Security Threat Detected</b>\n` +
                `${G.div}\n` +
                `File: ${fname}\n` +
                `Risk Score: ${scanResult.riskScore}/100\n` +
                `Verdict: ${scanResult.verdict}\n` +
                `${G.div}\n` +
                `<b>Threats found:</b>\n${threatLines || 'See admin alert'}`,
                { parse_mode: 'HTML' }
            );
            notifyOwner(
                `<b>🚨 DANGEROUS FILE BLOCKED BY SCANNER</b>\n` +
                `${G.div}\n` +
                `User: ${msg.from.first_name} (@${msg.from.username || '-'})\n` +
                `User ID: ${uid}\n` +
                `File: ${fname}\n` +
                `Risk: ${scanResult.riskScore}/100\n` +
                `Verdict: ${scanResult.verdict}\n` +
                `<b>Top threats:</b>\n${(scanResult.threats || []).slice(0, 3).map(t => `• ${esc(t)}`).join('\n')}`
            );
            audit(uid, 'security_reject', `file=${fname} risk=${scanResult.riskScore}`);
            return;
        }

        const encFiles = [];
        for (const f of filesAdded) {
            const keyId = randomId(16);
            const key = crypto.randomBytes(32);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, crypto.randomBytes(12));
            const encrypted = Buffer.concat([cipher.update(f.data), cipher.final()]);
            const tag = cipher.getAuthTag();
            const encPath = path.join(STORAGE_DIRS.encfiles, `${uid}_${Date.now()}_${safeName(f.name)}.enc`);
            fs.writeFileSync(encPath, Buffer.concat([encrypted, tag]));

            encFiles.push({
                key_id: keyId,
                enc_path: encPath,
                filename: path.basename(f.name),
                rel_path: f.name,
            });
        }

        botDoc.enc_files = JSON.stringify(encFiles);
        await saveBot(botDoc);

        const result = await startChild(botDoc);

        userStates.delete(uid);

        const cap =
            `<b>${result.ok ? G.ok : G.no} Bot uploaded${result.ok ? ' and started' : ''}</b>\n` +
            `${G.div}\n` +
            `Name: ${name}\n` +
            `Files: ${filesAdded.length}\n` +
            `Size: ${fmtBytes(raw.length)}\n` +
            `${result.ok ? '' : `Error: ${esc(result.error || 'Unknown error')}`}` +
            FOOTER;

        bot.sendMessage(msg.chat.id, cap, { parse_mode: 'HTML' });

        notifyOwner(
            `<b>${G.upload} ɴᴇᴡ ʙᴏᴛ ᴜᴘʟᴏᴀᴅ</b>\n` +
            `${G.div}\n` +
            `ғɪʟᴇ: ${fname}\n` +
            `ᴜsᴇʀ: ${msg.from.first_name} (@${msg.from.username || '-'})\n` +
            `ᴜsᴇʀ ɪᴅ: ${uid}\n` +
            `ʙᴏᴛ ɴᴀᴍᴇ: ${name}\n` +
            `ғɪʟᴇs: ${filesAdded.length}\n` +
            `sɪᴢᴇ: ${fmtBytes(raw.length)}\n` +
            `sᴛsᴛᴜs: ${result.ok ? 'Started' : 'Failed to start'}\n` +
            `${G.div}`
        );

    } catch (err) {
        bot.sendMessage(msg.chat.id,
            `${G.no} Upload error: <code>${esc(String(err))}</code>`,
            { parse_mode: 'HTML' }
        );
    }
}

// ============================================================
// SECURITY SCANNER (SIMPLIFIED)
// ============================================================

async function runSecurityScan(files, uid) {
    const threats = [];
    let riskScore = 0;
    let verdict = 'SAFE';

    for (const f of files) {
        const content = f.data.toString('utf8');
        if (/os\.system|subprocess\.call|eval\(/.test(content)) {
            threats.push('Suspicious system calls detected');
            riskScore += 30;
        }
        if (/open\(\s*['"]\/etc\/passwd/.test(content)) {
            threats.push('Attempts to read /etc/passwd');
            riskScore += 50;
        }
        if (/base64\.b64decode.*exec/.test(content)) {
            threats.push('Base64 decode + execute pattern');
            riskScore += 40;
        }
        if (/__import__\s*\(\s*['"]os['"]/.test(content)) {
            threats.push('Dynamic OS import detected');
            riskScore += 30;
        }
        if (/\d{8,10}:[A-Za-z0-9_-]{35}/.test(content)) {
            threats.push('Hardcoded bot token found');
            riskScore += 10;
        }
    }

    if (riskScore >= 70) {
        verdict = 'DANGEROUS';
    } else if (riskScore >= 35) {
        verdict = 'SUSPICIOUS';
    }

    const recommendation = verdict === 'DANGEROUS' ? 'REJECT' :
                           verdict === 'SUSPICIOUS' ? 'MANUAL_REVIEW' : 'APPROVE';

    db.run(`INSERT INTO scan_log (ts, uid, filename, verdict, risk_score, summary)
            VALUES (?, ?, ?, ?, ?, ?)`,
        [tsIso(), uid, files[0]?.name || 'unknown', verdict, riskScore, threats.join(', ')]);

    return {
        verdict,
        riskScore,
        recommendation,
        threats,
        summary: threats.length ? threats.join(', ') : 'No threats found',
    };
}

// ============================================================
// PAYMENT PROOF HANDLERS
// ============================================================

async function handlePaymentProof(msg, st) {
    const uid = msg.from.id;
    const method = st.method || 'unknown';
    const plan = st.plan;
    const p = plan ? PLAN_LIMITS[plan] : null;
    const pid = randomId(8);

    let amount = p ? p.price : 0;
    if (msg.caption) {
        const match = msg.caption.match(/\d+/);
        if (match) amount = parseInt(match[0]);
    }

    const payment = {
        id: pid,
        uid: uid,
        method: method,
        plan: plan,
        amount: amount,
        status: 'pending',
        ts: tsIso(),
        kind: 'payment',
        telegram_msg_id: msg.message_id,
    };

    db.run(`INSERT INTO payments (id, uid, method, plan, amount, status, ts, kind, telegram_msg_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pid, uid, method, plan, amount, 'pending', tsIso(), 'payment', msg.message_id]);

    userStates.delete(uid);

    try {
        await bot.forwardMessage(CONFIG.ownerId, msg.chat.id, msg.message_id);
    } catch {}

    const kb = {
        inline_keyboard: [
            [
                { text: `${G.ok}  Approve`, callback_data: `payapprove_${pid}`, style: 'sucess' },
                { text: `${G.no}  Reject`, callback_data: `payreject_${pid}`, style: 'danger' },
            ]
        ]
    };

    notifyOwner(
        `<b>${G.wallet} ɴᴇᴡ ᴘᴀʏᴍᴇɴᴛ ᴘʀᴏᴏғ</b>\n` +
        `ɪᴅ: ${pid}\n` +
        `ғʀᴏᴍ: ${uid}\n` +
        `ᴍᴇᴛʜᴏᴅ: ${method}\n` +
        `ᴘʟᴀɴ: ${plan || '—'}\n` +
        `ᴀᴍᴏɪɴᴛ: $${amount}`
    );

    try {
        bot.sendMessage(CONFIG.ownerId,
            `<b>Decide #${pid}</b>`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    } catch {}

    bot.sendMessage(msg.chat.id,
        `<b>${G.ok} Proof received</b> #${pid} — await admin.`,
        { parse_mode: 'HTML' }
    );
}

async function handleTopupProof(msg) {
    const uid = msg.from.id;
    const pid = randomId(8);

    let amount = 0;
    if (msg.caption) {
        const match = msg.caption.match(/\d+/);
        if (match) amount = parseInt(match[0]);
    }

    db.run(`INSERT INTO payments (id, uid, method, plan, amount, status, ts, kind, telegram_msg_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pid, uid, 'topup', null, amount, 'pending', tsIso(), 'wallet_topup', msg.message_id]);

    userStates.delete(uid);

    try {
        await bot.forwardMessage(CONFIG.ownerId, msg.chat.id, msg.message_id);
    } catch {}

    const kb = {
        inline_keyboard: [
            [
                { text: `${G.ok}  Approve`, callback_data: `payapprove_${pid}`, style: 'sucess' },
                { text: `${G.no}  Reject`, callback_data: `payreject_${pid}`, style: 'danger' },
            ]
        ]
    };

    notifyOwner(
        `<b>${G.wallet} ᴡᴀʟʟᴇᴛ ᴛᴏᴘ-ᴜᴘ</b>\n` +
        `ɪᴅ: ${pid}\n` +
        `ғʀᴏᴍ: ${uid}\n` +
        `ᴀᴍᴏᴜɴᴛ: $${amount}`
    );

    try {
        bot.sendMessage(CONFIG.ownerId,
            `<b>Decide #${pid}</b>`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    } catch {}

    bot.sendMessage(msg.chat.id,
        `<b>${G.ok} ᴛᴏᴘ-ᴜᴘ ᴘʀᴏᴏғ ʀᴇᴄᴇɪᴠᴇᴅ</b>`,
        { parse_mode: 'HTML' }
    );
}

// ============================================================
// PAYMENT APPROVE/REJECT
// ============================================================

async function actionPaymentApprove(call, pid) {
    if (!await adminOnlyCall(call, 'approve_payment')) return;

    db.get('SELECT * FROM payments WHERE id = ?', [pid], async (err, pay) => {
        if (!pay) {
            ack(call, 'Not found');
            return;
        }
        if (['approved', 'rejected'].includes(pay.status)) {
            ack(call, `Already ${pay.status}.`);
            return;
        }

        loading(call, 'Approving payment');

        db.run(`UPDATE payments SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?`,
            ['approved', call.from.id, tsIso(), pid]);

        if (pay.kind === 'wallet_topup') {
            db.get('SELECT * FROM users WHERE id = ?', [pay.uid], (err, user) => {
                if (user) {
                    const newWallet = (user.wallet || 0) + (pay.amount || 0);
                    db.run(`UPDATE users SET wallet = ? WHERE id = ?`, [newWallet, pay.uid]);
                    try {
                        bot.sendMessage(pay.uid,
                            `<b>${G.ok} Wallet credited</b>\n` +
                            `Amount: $${pay.amount}`,
                            { parse_mode: 'HTML' }
                        );
                    } catch {}
                }
            });
        } else if (pay.plan) {
            grantPlan(pay.uid, pay.plan);
        }

        audit(call.from.id, 'pay_approve', `pid=${pid}`);
        ack(call, 'Approved');
        try {
            bot.editMessageText(`<b>${G.ok} Approved #${pid}</b>`, {
                chat_id: call.message.chat.id,
                message_id: call.message.message_id,
                parse_mode: 'HTML',
            });
        } catch {}
    });
}

async function actionPaymentReject(call, pid) {
    if (!await adminOnlyCall(call, 'approve_payment')) return;

    db.get('SELECT * FROM payments WHERE id = ?', [pid], async (err, pay) => {
        if (!pay) {
            ack(call, 'Not found');
            return;
        }
        if (['approved', 'rejected'].includes(pay.status)) {
            ack(call, `Already ${pay.status}.`);
            return;
        }

        loading(call, 'Rejecting payment');

        db.run(`UPDATE payments SET status = ?, rejected_by = ?, rejected_at = ? WHERE id = ?`,
            ['rejected', call.from.id, tsIso(), pid]);

        audit(call.from.id, 'pay_reject', `pid=${pid}`);
        ack(call, 'Rejected');
        try {
            bot.editMessageText(`<b>${G.no} Rejected #${pid}</b>`, {
                chat_id: call.message.chat.id,
                message_id: call.message.message_id,
                parse_mode: 'HTML',
            });
        } catch {}
    });
}

// ============================================================
// PHOTO REPLACEMENT
// ============================================================

function replaceMenuPhoto(key, fileBytes) {
    if (!PHOTO_KEYS_FRIENDLY[key]) return false;
    const outDir = STORAGE_DIRS.photos;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const customOut = path.join(outDir, `custom_${key}.png`);
    const plainOut = path.join(outDir, `${key}.png`);
    try {
        fs.writeFileSync(customOut, fileBytes);
        fs.writeFileSync(plainOut, fileBytes);
        PHOTOS[key] = customOut;
        return true;
    } catch {
        return false;
    }
}

// ============================================================
// CALLBACK QUERY ROUTER
// ============================================================

const seenCallbacks = new Set();

bot.on('callback_query', async (call) => {
    const callId = call.id;
    if (seenCallbacks.has(callId)) return;
    seenCallbacks.add(callId);
    setTimeout(() => seenCallbacks.delete(callId), 10000);

    const uid = call.from.id;
    if (!rateLimiter.allow(uid)) {
        ack(call, 'Slow down.');
        maybeAutoBan(uid, 'callback rate');
        return;
    }
    if (await bannedBlock(call.message)) {
        ack(call);
        return;
    }
    await getOrCreateUser(call.from);
    if (await maintenanceBlock(uid)) {
        ack(call, 'Maintenance mode');
        return;
    }

    // NO VERIFICATION CHECK - Always proceed

    const data = call.data || '';
    try {
        await routeCallback(call, data);
    } catch (err) {
        console.error('Callback error:', err);
        try {
            bot.sendMessage(call.message.chat.id,
                `<b>${G.no}</b> Error: <code>${esc(String(err))}</code>`,
                { parse_mode: 'HTML' }
            );
        } catch {}
    }
});

// ============================================================
// CALLBACK ROUTER (Core + Admin)
// ============================================================

async function routeCallback(call, data) {
    // Core menus
    if (data === 'menu_main') { ack(call); renderMainMenu(call.message.chat.id, call.from.id, call); return; }
    if (data === 'menu_bots') { ack(call); renderBotsMenu(call); return; }
    if (data === 'menu_upload') { ack(call); renderUploadMenu(call); return; }
    if (data === 'menu_plans') { ack(call); renderPlansMenu(call); return; }
    if (data === 'menu_buy') { ack(call); renderBuyMenu(call); return; }
    if (data === 'menu_profile') { ack(call); renderProfile(call); return; }
    if (data === 'menu_referral') { ack(call); renderReferral(call); return; }
    if (data === 'menu_wallet') { ack(call); renderWallet(call); return; }
    if (data === 'menu_help') { ack(call); renderHelp(call); return; }
    if (data === 'menu_support') { ack(call); renderSupport(call); return; }
    if (data === 'menu_tickets') { ack(call); renderUserTickets(call); return; }
    if (data === 'menu_trial') { ack(call); renderTrial(call); return; }
    if (data === 'menu_coupon') { ack(call); renderCoupon(call); return; }
    if (data === 'menu_stats') { ack(call); renderUserStats(call); return; }
    if (data === 'menu_admin') { ack(call); renderAdmin(call); return; }

    // Plans
    if (data.startsWith('plan_view_')) {
        ack(call);
        const plan = data.split('_')[2];
        renderPlanDetail(call, plan);
        return;
    }
    if (data.startsWith('plan_buy_')) {
        ack(call);
        const plan = data.split('_')[2];
        renderPaymentMethodsFor(call, plan);
        return;
    }

    // Payment
    if (data.startsWith('pay_') && data !== 'pay_proof') {
        ack(call);
        renderPaymentScreen(call, data);
        return;
    }
    if (data === 'pay_proof') {
        ack(call);
        startProofFlow(call);
        return;
    }

    // Bot actions
    if (data.startsWith('bot_view_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderBotView(call, botId);
        return;
    }
    if (data.startsWith('bot_start_')) {
        ack(call);
        const botId = data.split('_')[2];
        await actionBotStart(call, botId);
        return;
    }
    if (data.startsWith('bot_stop_')) {
        ack(call);
        const botId = data.split('_')[2];
        await actionBotStop(call, botId);
        return;
    }
    if (data.startsWith('bot_restart_')) {
        ack(call);
        const botId = data.split('_')[2];
        await actionBotRestart(call, botId);
        return;
    }
    if (data.startsWith('bot_logs_')) {
        ack(call);
        const botId = data.split('_')[2];
        await actionBotLogs(call, botId);
        return;
    }
    if (data.startsWith('bot_info_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderBotView(call, botId);
        return;
    }
    if (data.startsWith('bot_env_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderEnvMenu(call, botId);
        return;
    }
    if (data.startsWith('env_add_')) {
        ack(call);
        const botId = data.split('_')[2];
        startEnvAdd(call, botId);
        return;
    }
    if (data.startsWith('env_del_')) {
        ack(call);
        const parts = data.split('_');
        if (parts.length >= 4) {
            const botId = parts[2];
            const key = parts.slice(3).join('_');
            actionEnvDelete(call, botId, key);
        }
        return;
    }
    if (data.startsWith('bot_cron_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderCron(call, botId);
        return;
    }
    if (data.startsWith('bot_clone_')) {
        ack(call);
        const botId = data.split('_')[2];
        actionBotClone(call, botId);
        return;
    }
    if (data.startsWith('bot_dl_')) {
        ack(call);
        const botId = data.split('_')[2];
        actionBotDownload(call, botId);
        return;
    }
    if (data.startsWith('bot_pip_')) {
        ack(call);
        const botId = data.split('_')[2];
        startPipInstallFlow(call, botId);
        return;
    }
    if (data.startsWith('bot_tunnel_')) {
        ack(call);
        const botId = data.split('_')[2];
        startTunnelFlow(call, botId);
        return;
    }
    if (data.startsWith('bot_delete_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderBotDeleteConfirm(call, botId);
        return;
    }
    if (data.startsWith('bot_delyes_')) {
        ack(call);
        const botId = data.split('_')[2];
        actionBotDelete(call, botId);
        return;
    }
    if (data.startsWith('bot_delfiles_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderBotDelfilesConfirm(call, botId);
        return;
    }
    if (data.startsWith('bot_delall_')) {
        ack(call);
        const botId = data.split('_')[2];
        renderBotDelallConfirm(call, botId);
        return;
    }
    if (data.startsWith('bot_delfilesyes_')) {
        ack(call);
        const botId = data.split('_')[2];
        actionBotDelfiles(call, botId);
        return;
    }
    if (data.startsWith('bot_delalyes_')) {
        ack(call);
        const botId = data.split('_')[2];
        actionBotDelall(call, botId);
        return;
    }

    // Approval
    if (data.startsWith('appr_ok_')) {
        if (!await adminOnlyCall(call, 'approve_payment')) return;
        const botId = data.split('_')[2];
        const res = await approveBot(botId, call.from.id);
        ack(call, res.ok ? 'Approved' : `Err: ${res.error || ''}`);
        try {
            bot.editMessageReplyMarkup(call.message.chat.id, call.message.message_id, { reply_markup: null });
        } catch {}
        return;
    }
    if (data.startsWith('appr_no_')) {
        if (!await adminOnlyCall(call, 'approve_payment')) return;
        const botId = data.split('_')[2];
        const res = await rejectBot(botId, call.from.id, 'rejected by admin');
        ack(call, res.ok ? 'Rejected' : `Err: ${res.error || ''}`);
        try {
            bot.editMessageReplyMarkup(call.message.chat.id, call.message.message_id, { reply_markup: null });
        } catch {}
        return;
    }

    // Admin sub-routes
    if (data.startsWith('adm_')) {
        if (!await adminOnlyCall(call, 'view_stats')) return;
        ack(call);
        renderAdminSubroute(call, data);
        return;
    }

    // GitHub
    if (data.startsWith('gh_')) {
        if (!await adminOnlyCall(call, 'view_stats')) return;
        ack(call);
        renderGithubSubroute(call, data);
        return;
    }

    // Misc
    if (data === 'trial_claim') { ack(call); actionTrialClaim(call); return; }
    if (data === 'coupon_redeem') { ack(call); startCouponFlow(call); return; }
    if (data === 'ticket_open') { ack(call); startTicketFlow(call); return; }
    if (data.startsWith('ticket_view_')) {
        ack(call);
        const tid = data.split('_')[2];
        renderTicketView(call, tid);
        return;
    }
    if (data.startsWith('ticket_close_')) {
        ack(call);
        const tid = data.split('_')[2];
        actionTicketClose(call, tid);
        return;
    }
    if (data.startsWith('ticket_reply_')) {
        ack(call);
        const tid = data.split('_')[2];
        startTicketReply(call, tid);
        return;
    }
    if (data === 'wallet_topup') { ack(call); startWalletTopup(call); return; }
    if (data === 'wallet_gift') { ack(call); startWalletGift(call); return; }
    if (data.startsWith('payapprove_')) {
        ack(call);
        const pid = data.split('_')[1];
        actionPaymentApprove(call, pid);
        return;
    }
    if (data.startsWith('payreject_')) {
        ack(call);
        const pid = data.split('_')[1];
        actionPaymentReject(call, pid);
        return;
    }

    ack(call, '?');
}

// ============================================================
// RENDER FUNCTIONS (Core Menus - Keep Original)
// ============================================================

async function renderBotsMenu(call) { ... }
async function renderUploadMenu(call) { ... }
async function renderPlansMenu(call) { ... }
async function renderPlanDetail(call, plan) { ... }
async function renderBuyMenu(call) { ... }
async function renderPaymentMethodsFor(call, plan) { ... }
async function renderPaymentScreen(call, data) { ... }
async function startProofFlow(call) { ... }
async function renderProfile(call) { ... }
async function renderReferral(call) { ... }
async function renderWallet(call) { ... }
async function renderHelp(call) { ... }
async function renderSupport(call) { ... }
async function renderTrial(call) { ... }
async function actionTrialClaim(call) { ... }
async function renderCoupon(call) { ... }
async function renderUserStats(call) { ... }

// ============================================================
// BOT VIEW FUNCTIONS (Keep Original)
// ============================================================

async function renderBotView(call, botId) { ... }
async function actionBotStart(call, botId) { ... }
async function actionBotStop(call, botId) { ... }
async function actionBotRestart(call, botId) { ... }
async function actionBotLogs(call, botId) { ... }
async function renderEnvMenu(call, botId) { ... }
async function startEnvAdd(call, botId) { ... }
async function actionEnvDelete(call, botId, key) { ... }
async function renderCron(call, botId) { ... }
async function renderBotDeleteConfirm(call, botId) { ... }
async function actionBotDelete(call, botId) { ... }
async function renderBotDelfilesConfirm(call, botId) { ... }
async function actionBotDelfiles(call, botId) { ... }
async function renderBotDelallConfirm(call, botId) { ... }
async function actionBotDelall(call, botId) { ... }
async function actionBotClone(call, botId) { ... }
async function actionBotDownload(call, botId) { ... }
async function startPipInstallFlow(call, botId) { ... }
async function startTunnelFlow(call, botId) { ... }

// ============================================================
// ADMIN PANEL (Keep Original)
// ============================================================

async function renderAdmin(call) { ... }

// ============================================================
// ADMIN SUBROUTE (Keep Original)
// ============================================================

async function renderAdminSubroute(call, data) { ... }
async function renderGithubSubroute(call, data) { ... }

// ============================================================
// ADMIN FUNCTIONS (Keep Original)
// ============================================================

async function renderAdminStats(call) { ... }
async function renderAdminUsers(call) { ... }
async function renderAdminAllBots(call) { ... }
async function renderAdminPayments(call) { ... }
async function renderAdminBroadcast(call) { ... }
async function renderAdminBan(call) { ... }
async function renderAdminGivePlan(call) { ... }
async function renderAdminApprove(call) { ... }
async function renderAdminCoupons(call) { ... }
async function renderAdminTickets(call) { ... }
async function renderAdminAdmins(call) { ... }
async function renderAdminAudit(call) { ... }
async function renderAdminGithub(call) { ... }
async function renderAdminSecurity(call) { ... }
async function renderAdminMaintenance(call) { ... }
async function renderAdminSettings(call) { ... }
async function renderAdminPending(call) { ... }
async function renderAdminPhotos(call) { ... }

// ============================================================
// APPROVAL SYSTEM (Keep Original)
// ============================================================

async function approveBot(botId, adminUid) { ... }
async function rejectBot(botId, adminUid, reason = '') { ... }

// ============================================================
// TICKETS (Keep Original)
// ============================================================

async function renderUserTickets(call) { ... }
async function startTicketFlow(call) { ... }
async function renderTicketView(call, tid) { ... }
async function startTicketReply(call, tid) { ... }
async function actionTicketClose(call, tid) { ... }

// ============================================================
// TEXT MESSAGE HANDLER - COMPLETE IMPLEMENTATIONS
// ============================================================

bot.on('text', async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (await bannedBlock(msg)) return;

    const uid = msg.from.id;
    const text = (msg.text || '').trim();

    if (text.startsWith('/')) return;

    if (!rateLimiter.allow(uid)) {
        maybeAutoBan(uid, 'rate');
        return;
    }

    await getOrCreateUser(msg.from);
    if (await maintenanceBlock(uid)) return;

    const st = userStates.get(uid) || {};
    const flow = st.flow || '';

    try {
        // ---- Env var ----
        if (flow === 'await_env_kv') {
            const botDoc = await findBot(st.bot_id);
            if (!botDoc || (botDoc.owner !== uid && !(await isAdmin(uid)))) {
                bot.sendMessage(msg.chat.id, `${G.no} Bot not found`);
                userStates.delete(uid);
                return;
            }
            const kv = text;
            if (!kv.includes('=')) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>KEY=VALUE</code>`, { parse_mode: 'HTML' });
                return;
            }
            const [key, ...valParts] = kv.split('=');
            const k = key.trim().toUpperCase();
            const v = valParts.join('=').trim();
            if (!k) {
                bot.sendMessage(msg.chat.id, `${G.no} Empty key`);
                return;
            }
            const env = botDoc.env ? JSON.parse(botDoc.env) : {};
            env[k] = v;
            botDoc.env = JSON.stringify(env);
            await saveBot(botDoc);
            audit(uid, 'env_set', `bot=${botDoc.id} key=${k}`);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} <code>${esc(k)}</code> saved.`, { parse_mode: 'HTML' });
            return;
        }

        // ---- Pip install ----
        if (flow === 'await_pip_install') {
            const botDoc = await findBot(st.bot_id);
            if (!botDoc) {
                bot.sendMessage(msg.chat.id, `${G.no} Bot not found`);
                userStates.delete(uid);
                return;
            }
            const packages = text.split(/\s+/).filter(p => p);
            if (packages.length === 0) {
                bot.sendMessage(msg.chat.id, `${G.no} No packages`);
                userStates.delete(uid);
                return;
            }
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `⏳ Installing ${packages.slice(0, 5).join(' ')}…`);

            setTimeout(async () => {
                try {
                    const botDir = botDoc.dir;
                    const proc = spawn('pip3', ['install'].concat(packages.slice(0, 10)), {
                        cwd: botDir,
                    });
                    let output = '';
                    proc.stdout.on('data', (data) => { output += data.toString(); });
                    proc.stderr.on('data', (data) => { output += data.toString(); });
                    proc.on('close', (code) => {
                        const ok = code === 0;
                        audit(uid, 'pip_install', `bot=${botDoc.id} ok=${ok}`);
                        bot.sendMessage(msg.chat.id,
                            `<b>${ok ? 'OK' : G.no} pip install</b>\n` +
                            `<pre>${esc(output.slice(-1500))}</pre>`,
                            { parse_mode: 'HTML' }
                        );
                    });
                } catch (err) {
                    bot.sendMessage(msg.chat.id,
                        `${G.no} pip error: <code>${esc(String(err))}</code>`,
                        { parse_mode: 'HTML' }
                    );
                }
            }, 500);
            return;
        }

        // ---- Tunnel port ----
        if (flow === 'await_tunnel_port') {
            userStates.delete(uid);
            const port = parseInt(text);
            if (isNaN(port) || port < 1 || port > 65535) {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid port`);
                return;
            }
            bot.sendMessage(msg.chat.id,
                `🌐 Tunnel on port ${port} — cloudflared must be installed on the server.`
            );
            return;
        }

        // ---- Cron ----
        if (flow === 'await_cron') {
            const botDoc = await findBot(st.bot_id);
            if (!botDoc || (botDoc.owner !== uid && !(await isAdmin(uid)))) {
                bot.sendMessage(msg.chat.id, `${G.no} Bot not found`);
                userStates.delete(uid);
                return;
            }
            const parts = text.split(/\s+/);
            if (parts.length >= 2 && ['restart_hours', 'backup_hours'].includes(parts[0])) {
                const val = parseInt(parts[1]);
                if (isNaN(val) || val < 0) {
                    bot.sendMessage(msg.chat.id, `${G.no} Bad number`);
                    return;
                }
                const cron = botDoc.cron ? JSON.parse(botDoc.cron) : {};
                cron[parts[0]] = val;
                botDoc.cron = JSON.stringify(cron);
                await saveBot(botDoc);
                audit(uid, 'cron_set', `bot=${botDoc.id} ${parts[0]}=${val}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id,
                    `${G.ok} Saved: <code>${parts[0]} = ${val}</code>`,
                    { parse_mode: 'HTML' }
                );
            } else {
                bot.sendMessage(msg.chat.id,
                    `${G.no} Use: <code>restart_hours N</code> or <code>backup_hours N</code>`,
                    { parse_mode: 'HTML' }
                );
            }
            return;
        }

        // ---- Admin find user ----
        if (flow === 'await_admin_finduser') {
            userStates.delete(uid);
            const targetUid = parseInt(text);
            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Bad uid`);
                return;
            }
            const user = await new Promise((resolve) => {
                db.get('SELECT * FROM users WHERE id = ?', [targetUid], (err, row) => resolve(row));
            });
            if (!user) {
                bot.sendMessage(msg.chat.id, `${G.no} User not found`);
                return;
            }
            const bots = await listUserBots(targetUid);
            const cap =
                `<b>${G.user} User Info</b>\n` +
                `${G.div_eq}\n` +
                `ID: ${targetUid}\n` +
                `Name: ${user.name}\n` +
                `Username: @${user.username || '—'}\n` +
                `Plan: ${user.plan}\n` +
                `Joined: ${fmtTs(user.joined)}\n` +
                `Bots: ${bots.length}\n` +
                `Wallet: $${user.wallet || 0}\n` +
                `Banned: ${user.banned ? 'Yes' : 'No'}\n` +
                `Verified: ${user.verified ? 'Yes' : 'No'}\n` +
                `${G.div}` +
                FOOTER;
            bot.sendMessage(msg.chat.id, cap, { parse_mode: 'HTML' });
            return;
        }

        // ---- Ban command ----
        if (flow === 'await_ban_cmd') {
            userStates.delete(uid);
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>ban uid reason</code> or <code>unban uid</code>`, { parse_mode: 'HTML' });
                return;
            }
            const op = parts[0].toLowerCase();
            const targetUid = parseInt(parts[1]);
            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Bad uid`);
                return;
            }
            const reason = parts.slice(2).join(' ') || 'banned by admin';

            if (op === 'ban') {
                db.run(`UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?`, [reason, targetUid]);
                audit(uid, 'ban_user', `uid=${targetUid}`);
                bot.sendMessage(msg.chat.id, `${G.ok} Banned ${targetUid}`);
            } else if (op === 'unban') {
                db.run(`UPDATE users SET banned = 0, ban_reason = '' WHERE id = ?`, [targetUid]);
                audit(uid, 'unban_user', `uid=${targetUid}`);
                bot.sendMessage(msg.chat.id, `${G.ok} Unbanned ${targetUid}`);
            } else {
                bot.sendMessage(msg.chat.id, `${G.no} Unknown command. Use ban or unban.`);
            }
            return;
        }

        // ---- Give plan ----
        if (flow === 'await_giveplan') {
            userStates.delete(uid);
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>uid plan [days]</code>`, { parse_mode: 'HTML' });
                return;
            }
            const targetUid = parseInt(parts[0]);
            const plan = parts[1];
            const days = parts.length >= 3 ? parseInt(parts[2]) : null;

            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Bad uid`);
                return;
            }
            if (!PLAN_LIMITS[plan]) {
                bot.sendMessage(msg.chat.id, `${G.no} Unknown plan: ${plan}`);
                return;
            }

            const ok = await grantPlan(targetUid, plan, days);
            audit(uid, 'give_plan', `uid=${targetUid} plan=${plan} days=${days}`);
            bot.sendMessage(msg.chat.id,
                ok ? `${G.ok} Given ${plan} to ${targetUid}` : `${G.no} User not found`
            );
            return;
        }

        // ---- Broadcast ----
        if (flow === 'await_broadcast') {
            if (!await isAdmin(uid)) {
                userStates.delete(uid);
                return;
            }
            let broadcastText = text;
            let planFilter = null;
            let scheduledAt = null;

            if (text.startsWith('plan:')) {
                const parts = text.split(/\s+/);
                planFilter = parts[0].replace('plan:', '');
                broadcastText = parts.slice(1).join(' ');
            } else if (text.startsWith('at:')) {
                const parts = text.split(/\s+/);
                scheduledAt = parts[0].replace('at:', '');
                broadcastText = parts.slice(1).join(' ');
            }

            if (!broadcastText) {
                bot.sendMessage(msg.chat.id, `${G.no} Empty message`);
                userStates.delete(uid);
                return;
            }

            if (scheduledAt) {
                try {
                    const when = new Date(scheduledAt);
                    if (isNaN(when.getTime())) throw new Error();
                    db.run(`INSERT INTO scheduled_broadcasts (at, text, plan, by_uid) VALUES (?, ?, ?, ?)`,
                        [when.toISOString(), broadcastText, planFilter, uid]);
                    audit(uid, 'broadcast_scheduled', `at=${scheduledAt}`);
                    bot.sendMessage(msg.chat.id, `${G.ok} Scheduled for ${scheduledAt}`);
                } catch {
                    bot.sendMessage(msg.chat.id, `${G.no} Bad datetime format (use YYYY-MM-DD HH:MM)`);
                }
                userStates.delete(uid);
                return;
            }

            bot.sendMessage(msg.chat.id, `⏳ Broadcasting…`);

            setTimeout(async () => {
                const users = await new Promise((resolve) => {
                    db.all('SELECT * FROM users', (err, rows) => resolve(rows || []));
                });
                let sent = 0, fail = 0;
                for (const u of users) {
                    if (u.banned) continue;
                    if (planFilter && u.plan !== planFilter) continue;
                    try {
                        await bot.sendMessage(u.id,
                            `<b>📢 ${CONFIG.brand}</b>\n${G.div}\n${esc(broadcastText)}`,
                            { parse_mode: 'HTML', disable_web_page_preview: true }
                        );
                        sent++;
                    } catch {
                        fail++;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
                audit(uid, 'broadcast_sent', `sent=${sent} fail=${fail}`);
                try {
                    bot.sendMessage(uid, `${G.ok} Broadcast done: ${sent} sent, ${fail} fail.`);
                } catch {}
            }, 500);

            userStates.delete(uid);
            return;
        }

        // ---- Coupon user ----
        if (flow === 'await_coupon') {
            const code = text.toUpperCase();
            userStates.delete(uid);

            db.get('SELECT * FROM coupons WHERE code = ?', [code], async (err, coupon) => {
                if (!coupon) {
                    bot.sendMessage(msg.chat.id, `${G.no} Invalid code`);
                    return;
                }
                if (coupon.uses_left <= 0) {
                    bot.sendMessage(msg.chat.id, `${G.no} Code expired`);
                    return;
                }

                db.run(`UPDATE coupons SET uses_left = uses_left - 1 WHERE code = ?`, [code]);
                audit(uid, 'coupon_redeem', `code=${code}`);
                bot.sendMessage(msg.chat.id,
                    `<b>${G.ok} Coupon applied</b>: <code>${esc(code)}</code>\n` +
                    `Discount: ${coupon.percent}% off next plan purchase`,
                    { parse_mode: 'HTML' }
                );
            });
            return;
        }

        // ---- Ticket subject ----
        if (flow === 'await_ticket_subject') {
            userStates.set(uid, { flow: 'await_ticket_body', subject: text });
            bot.sendMessage(msg.chat.id, `${G.ticket} Now send the ticket body.`);
            return;
        }

        // ---- Ticket body ----
        if (flow === 'await_ticket_body') {
            const subject = st.subject || 'Support';
            const tid = randomId(6);

            db.run(`INSERT INTO tickets (id, uid, subject, status, messages, opened_at)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                [tid, uid, subject, 'open', JSON.stringify([{ from: 'user', text: text, ts: tsIso() }]), tsIso()]);

            userStates.delete(uid);
            bot.sendMessage(msg.chat.id,
                `<b>${G.ok} Ticket opened #${tid}</b>`,
                { parse_mode: 'HTML' }
            );

            notifyOwner(
                `<b>${G.ticket} New Ticket #${tid}</b>\n` +
                `From: ${uid}\n` +
                `Subject: ${subject}\n` +
                `Body: ${text.slice(0, 400)}`
            );
            return;
        }

        // ---- Ticket reply ----
        if (flow === 'await_ticket_reply') {
            const tid = st.tid;
            const ticket = await new Promise((resolve) => {
                db.get('SELECT * FROM tickets WHERE id = ?', [tid], (err, row) => resolve(row));
            });

            if (!ticket || (ticket.uid !== uid && !(await isAdmin(uid)))) {
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.no} Not found`);
                return;
            }

            const messages = ticket.messages ? JSON.parse(ticket.messages) : [];
            const who = (await isAdmin(uid) && ticket.uid !== uid) ? 'admin' : 'user';
            messages.push({ from: who, text: text, ts: tsIso() });

            db.run(`UPDATE tickets SET messages = ? WHERE id = ?`, [JSON.stringify(messages), tid]);
            userStates.delete(uid);

            const target = who === 'user' ? CONFIG.ownerId : ticket.uid;
            try {
                bot.sendMessage(target,
                    `<b>${G.ticket} Ticket #${tid}</b> — ${who} replied\n${esc(text).slice(0, 1000)}`,
                    { parse_mode: 'HTML' }
                );
            } catch {}

            bot.sendMessage(msg.chat.id, `${G.ok} Reply sent`);
            return;
        }

        // ---- Payment proof text ----
        if (flow === 'await_payment_proof') {
            const match = text.match(/\d+/);
            if (match) {
                const amount = parseInt(match[0]);
                const fakeMsg = { ...msg, caption: text };
                return handlePaymentProof(fakeMsg, st);
            }
            bot.sendMessage(msg.chat.id, `${G.no} Please send a payment screenshot or transaction ID.`);
            return;
        }

        // ---- Topup proof text ----
        if (flow === 'await_topup_proof') {
            const match = text.match(/\d+/);
            if (match) {
                const fakeMsg = { ...msg, caption: text };
                return handleTopupProof(fakeMsg);
            }
            bot.sendMessage(msg.chat.id, `${G.no} Please send a screenshot or include the amount.`);
            return;
        }

        // ---- Gift target ----
        if (flow === 'await_gift_target') {
            const targetUid = parseInt(text);
            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Bad uid`);
                return;
            }
            const user = await new Promise((resolve) => {
                db.get('SELECT * FROM users WHERE id = ?', [targetUid], (err, row) => resolve(row));
            });
            if (!user) {
                bot.sendMessage(msg.chat.id, `${G.no} User not found`);
                return;
            }
            userStates.set(uid, { flow: 'await_gift_confirm', target: targetUid });
            bot.sendMessage(msg.chat.id,
                `<b>${G.warn} Confirm gift</b>\n` +
                `To: ${targetUid}\n` +
                `Send <code>YES</code> to confirm.`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        // ---- Gift confirm ----
        if (flow === 'await_gift_confirm') {
            userStates.delete(uid);
            if (text.toUpperCase() !== 'YES') {
                bot.sendMessage(msg.chat.id, `${G.no} Cancelled`);
                return;
            }

            const target = st.target;
            const me = await new Promise((resolve) => {
                db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
            });

            if (!me || me.plan === 'free' || !me.plan) {
                bot.sendMessage(msg.chat.id, `${G.no} No active plan to gift`);
                return;
            }

            const plan = me.plan;
            const expiry = me.plan_expires;

            db.run(`UPDATE users SET plan = 'free', plan_expires = NULL WHERE id = ?`, [uid]);
            db.run(`UPDATE users SET plan = ?, plan_expires = ? WHERE id = ?`, [plan, expiry, target]);

            audit(uid, 'plan_gift', `to=${target} plan=${plan}`);
            bot.sendMessage(msg.chat.id, `${G.ok} Plan gifted to ${target}`);

            try {
                bot.sendMessage(target,
                    `<b>${G.spark} You received a gift plan</b>\n` +
                    `Plan: ${PLAN_LIMITS[plan]?.name || plan}`,
                    { parse_mode: 'HTML' }
                );
            } catch {}
            return;
        }

        // ---- GitHub config flows ----
        if (flow === 'await_gh_token') {
            await setSetting('github_token', text);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Token saved`);
            return;
        }
        if (flow === 'await_gh_repo') {
            await setSetting('github_repo', text);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Repo saved`);
            return;
        }
        if (flow === 'await_gh_branch') {
            await setSetting('github_branch', text);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Branch saved`);
            return;
        }
        if (flow === 'await_gh_interval') {
            const val = Math.max(15, parseInt(text) || 360);
            await setSetting('github_interval_min', val);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Interval saved`);
            return;
        }

        // ---- Settings flows ----
        if (flow === 'await_set_brand') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            const newBrand = text.slice(0, 64);
            if (!newBrand) {
                bot.sendMessage(msg.chat.id, `${G.no} Empty`);
                userStates.delete(uid);
                return;
            }
            CONFIG.brand = newBrand;
            await setSetting('brand_tag', newBrand);
            audit(uid, 'set_brand', newBrand);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Brand: <b>${esc(newBrand)}</b>`, { parse_mode: 'HTML' });
            return;
        }

        if (flow === 'await_set_announce') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            let v = text.trim();
            if (v === '-') v = '';
            CONFIG.announceChannel = v;
            await setSetting('announce_channel', v);
            audit(uid, 'set_announce', v || '(cleared)');
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id,
                `${G.ok} Announce channel: <code>${esc(v) || '—'}</code>`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (flow === 'await_set_owner') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            const newOwner = parseInt(text);
            if (isNaN(newOwner) || newOwner <= 0) {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid id`);
                return;
            }
            CONFIG.ownerId = newOwner;
            await setSetting('owner_id', newOwner);
            audit(uid, 'transfer_owner', `new=${newOwner}`);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id,
                `${G.ok} Ownership transferred to <code>${newOwner}</code>.`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (flow === 'await_set_footer') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            const v = text.trim();
            await setSetting('custom_footer', v === '-' ? '' : v);
            audit(uid, 'set_footer', v);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Footer updated.`);
            return;
        }

        if (flow === 'await_set_welcome') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            await setSetting('custom_welcome', text.trim());
            audit(uid, 'set_welcome', '');
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Welcome message updated.`);
            return;
        }

        if (flow === 'await_set_rules') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            await setSetting('hosting_rules', text.trim());
            audit(uid, 'set_rules', '');
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `${G.ok} Hosting rules updated.`);
            return;
        }

        // ---- Admin flows ----
        if (flow === 'await_adm_user_search') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const q = text.toLowerCase();
            const users = await new Promise((resolve) => {
                db.all('SELECT * FROM users', (err, rows) => resolve(rows || []));
            });
            const results = users.filter(u => 
                String(u.id).includes(q) || 
                (u.username || '').toLowerCase().includes(q) || 
                (u.name || '').toLowerCase().includes(q)
            ).slice(0, 10);
            
            const rows = results.map(u => {
                return `${G.bullet} <code>${u.id}</code> <b>${esc(u.name || '?')}</b> @${esc(u.username || '—')} plan=${u.plan || 'free'}`;
            }).join('\n') || `<i>No users found</i>`;
            
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id,
                `<b>🔍 Search Results</b>\n${G.div_eq}\n${rows}`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (flow === 'await_adm_wallet_adjust') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>uid +amount</code> or <code>uid -amount</code> or <code>uid =amount</code>`, { parse_mode: 'HTML' });
                return;
            }
            const targetUid = parseInt(parts[0]);
            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid user ID`);
                return;
            }
            const op = parts[1][0];
            const amount = parseFloat(parts[1].slice(1));
            if (isNaN(amount) || amount < 0) {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid amount`);
                return;
            }
            
            db.get('SELECT * FROM users WHERE id = ?', [targetUid], (err, user) => {
                if (!user) {
                    bot.sendMessage(msg.chat.id, `${G.no} User not found`);
                    return;
                }
                let newBalance = user.wallet || 0;
                if (op === '+') newBalance += amount;
                else if (op === '-') newBalance = Math.max(0, newBalance - amount);
                else if (op === '=') newBalance = amount;
                else {
                    bot.sendMessage(msg.chat.id, `${G.no} Use +, -, or =`);
                    return;
                }
                db.run(`UPDATE users SET wallet = ? WHERE id = ?`, [newBalance, targetUid]);
                audit(uid, 'wallet_adjust', `uid=${targetUid} old=${user.wallet || 0} new=${newBalance}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id,
                    `${G.ok} User <code>${targetUid}</code> wallet: <b>$${user.wallet || 0}</b> → <b>$${newBalance}</b>`,
                    { parse_mode: 'HTML' }
                );
            });
            return;
        }

        if (flow === 'await_adm_notify_user') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>user_id message</code>`, { parse_mode: 'HTML' });
                return;
            }
            const targetUid = parseInt(parts[0]);
            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid user ID`);
                return;
            }
            const message = parts.slice(1).join(' ');
            try {
                await bot.sendMessage(targetUid,
                    `<b>📨 Message from Admin</b>\n${G.div}\n${esc(message)}`,
                    { parse_mode: 'HTML' }
                );
                audit(uid, 'notify_user', `to=${targetUid}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.ok} Message sent to <code>${targetUid}</code>`, { parse_mode: 'HTML' });
            } catch (err) {
                bot.sendMessage(msg.chat.id, `${G.no} Failed to send: ${esc(err.message)}`, { parse_mode: 'HTML' });
            }
            return;
        }

        if (flow === 'await_adm_user_reset') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            const targetUid = parseInt(text);
            if (isNaN(targetUid)) {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid user ID`);
                return;
            }
            
            // Stop all their bots
            const bots = await listUserBots(targetUid);
            for (const b of bots) {
                await stopChild(b.id, true);
            }
            
            // Reset user
            db.run(`UPDATE users SET plan = 'free', plan_expires = NULL, wallet = 0 WHERE id = ?`, [targetUid]);
            db.run('DELETE FROM bots WHERE owner = ?', [targetUid]);
            
            audit(uid, 'user_reset', `uid=${targetUid}`);
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id,
                `${G.ok} User <code>${targetUid}</code> reset to free plan, all bots removed.`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (flow === 'await_adm_bot_search') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const q = text.toLowerCase();
            const bots = await new Promise((resolve) => {
                db.all('SELECT * FROM bots', (err, rows) => resolve(rows || []));
            });
            const results = bots.filter(b => 
                b.id.toLowerCase().includes(q) || 
                (b.name || '').toLowerCase().includes(q)
            ).slice(0, 10);
            
            const rows = results.map(b => {
                const running = runningBots.has(b.id);
                return `${G.bullet} <code>${b.id}</code> <b>${esc(b.name || '?')}</b> uid=${b.owner} ${running ? '▶ running' : '⏹ stopped'}`;
            }).join('\n') || `<i>No bots found</i>`;
            
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id,
                `<b>🔍 Bot Search</b>\n${G.div_eq}\n${rows}`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (flow === 'await_adm_notify_running') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const targetUids = st.target_uids || [];
            const message = text;
            
            userStates.delete(uid);
            bot.sendMessage(msg.chat.id, `⏳ Sending to ${targetUids.length} users…`);
            
            setTimeout(async () => {
                let sent = 0, fail = 0;
                for (const uid of targetUids) {
                    try {
                        await bot.sendMessage(parseInt(uid),
                            `<b>📢 Admin Message</b>\n${G.div}\n${esc(message)}`,
                            { parse_mode: 'HTML' }
                        );
                        sent++;
                    } catch {
                        fail++;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
                audit(uid, 'notify_targeted', `sent=${sent} fail=${fail}`);
                try {
                    bot.sendMessage(uid, `${G.ok} Sent to ${sent} users (${fail} failed).`);
                } catch {}
            }, 500);
            return;
        }

        if (flow === 'await_adm_quick_announce') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            if (!CONFIG.announceChannel) {
                bot.sendMessage(msg.chat.id, `${G.no} Announce channel not configured.`);
                userStates.delete(uid);
                return;
            }
            try {
                await bot.sendMessage(CONFIG.announceChannel,
                    `📣 <b>${CONFIG.brand}</b>\n${G.div}\n${esc(text)}`,
                    { parse_mode: 'HTML' }
                );
                audit(uid, 'quick_announce', '');
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.ok} Announcement sent!`);
            } catch (err) {
                bot.sendMessage(msg.chat.id, `${G.no} Failed: ${esc(err.message)}`, { parse_mode: 'HTML' });
            }
            return;
        }

        if (flow === 'await_adm_whitelist') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Use: <code>add uid</code> or <code>del uid</code>`, { parse_mode: 'HTML' });
                return;
            }
            const op = parts[0].toLowerCase();
            const targetUid = parts[1];
            
            let whitelist = await getSetting('scan_whitelist', []);
            if (op === 'add') {
                if (!whitelist.includes(targetUid)) whitelist.push(targetUid);
                await setSetting('scan_whitelist', whitelist);
                audit(uid, 'whitelist_add', targetUid);
                bot.sendMessage(msg.chat.id, `${G.ok} Added <code>${targetUid}</code> to whitelist.`, { parse_mode: 'HTML' });
            } else if (op === 'del') {
                whitelist = whitelist.filter(id => id !== targetUid);
                await setSetting('scan_whitelist', whitelist);
                audit(uid, 'whitelist_del', targetUid);
                bot.sendMessage(msg.chat.id, `${G.ok} Removed <code>${targetUid}</code> from whitelist.`, { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(msg.chat.id, `${G.no} Use <code>add</code> or <code>del</code>`, { parse_mode: 'HTML' });
            }
            userStates.delete(uid);
            return;
        }

        if (flow === 'await_adm_blacklist') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Use: <code>add domain.com</code> or <code>del domain.com</code>`, { parse_mode: 'HTML' });
                return;
            }
            const op = parts[0].toLowerCase();
            const domain = parts[1];
            
            let blacklist = await getSetting('domain_blacklist', []);
            if (op === 'add') {
                if (!blacklist.includes(domain)) blacklist.push(domain);
                await setSetting('domain_blacklist', blacklist);
                audit(uid, 'blacklist_add', domain);
                bot.sendMessage(msg.chat.id, `${G.ok} Added <code>${domain}</code> to blacklist.`, { parse_mode: 'HTML' });
            } else if (op === 'del') {
                blacklist = blacklist.filter(d => d !== domain);
                await setSetting('domain_blacklist', blacklist);
                audit(uid, 'blacklist_del', domain);
                bot.sendMessage(msg.chat.id, `${G.ok} Removed <code>${domain}</code> from blacklist.`, { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(msg.chat.id, `${G.no} Use <code>add</code> or <code>del</code>`, { parse_mode: 'HTML' });
            }
            userStates.delete(uid);
            return;
        }

    } catch (err) {
        console.error('Text handler error:', err);
        bot.sendMessage(msg.chat.id,
            `${G.no} Error: <code>${esc(String(err))}</code>`,
            { parse_mode: 'HTML' }
        );
    }
});

// ============================================================
// SCHEDULED TASKS
// ============================================================

function checkScheduledBroadcasts() {
    setInterval(async () => {
        try {
            const now = new Date();
            const rows = await new Promise((resolve) => {
                db.all('SELECT * FROM scheduled_broadcasts WHERE at <= ?', [now.toISOString()], (err, rows) => {
                    resolve(rows || []);
                });
            });

            for (const row of rows) {
                const users = await new Promise((resolve) => {
                    db.all('SELECT * FROM users', (err, rows) => resolve(rows || []));
                });
                let sent = 0, fail = 0;
                for (const u of users) {
                    if (u.banned) continue;
                    if (row.plan && u.plan !== row.plan) continue;
                    try {
                        await bot.sendMessage(u.id,
                            `<b>📢 ${CONFIG.brand}</b>\n${G.div}\n${esc(row.text)}`,
                            { parse_mode: 'HTML', disable_web_page_preview: true }
                        );
                        sent++;
                    } catch {
                        fail++;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
                audit(row.by_uid || 0, 'broadcast_run', `sent=${sent} fail=${fail}`);
                db.run('DELETE FROM scheduled_broadcasts WHERE id = ?', [row.id]);
            }
        } catch (err) {
            console.error('Scheduled broadcast error:', err);
        }
    }, 60000);
}

function checkExpiredPlans() {
    setInterval(async () => {
        try {
            const now = new Date().toISOString();
            const users = await new Promise((resolve) => {
                db.all('SELECT * FROM users WHERE plan != ? AND plan_expires <= ?', ['free', now], (err, rows) => {
                    resolve(rows || []);
                });
            });

            for (const u of users) {
                db.run(`UPDATE users SET plan = 'free', plan_expires = NULL WHERE id = ?`, [u.id]);
                try {
                    bot.sendMessage(u.id,
                        `<b>${G.warn} Plan expired</b>\n\n` +
                        `Your plan has expired. You have been downgraded to <b>Free</b>.\n` +
                        `Renew anytime from the Buy Plan menu.${FOOTER}`,
                        { parse_mode: 'HTML' }
                    );
                } catch {}
            }
        } catch (err) {
            console.error('Expiry checker error:', err);
        }
    }, 60000);
}

function checkExpiryReminders() {
    setInterval(async () => {
        try {
            const now = new Date();
            const in7Days = new Date(now);
            in7Days.setDate(in7Days.getDate() + 7);
            const users = await new Promise((resolve) => {
                db.all('SELECT * FROM users WHERE plan != ? AND plan_expires IS NOT NULL', ['free'], (err, rows) => {
                    resolve(rows || []);
                });
            });

            for (const u of users) {
                const expiry = new Date(u.plan_expires);
                const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
                if (daysLeft >= 1 && daysLeft <= 7) {
                    try {
                        bot.sendMessage(u.id,
                            `<b>${G.warn} Plan ending soon</b>\n\n` +
                            `Your <b>${PLAN_LIMITS[u.plan]?.name || u.plan}</b> plan ` +
                            `expires in <b>${daysLeft} day(s)</b>.\n` +
                            `Renew now to avoid downgrade.${FOOTER}`,
                            { parse_mode: 'HTML' }
                        );
                    } catch {}
                }
            }
        } catch (err) {
            console.error('Reminder checker error:', err);
        }
    }, 3600000);
}

function janitorCleanup() {
    setInterval(async () => {
        try {
            const bots = await new Promise((resolve) => {
                db.all('SELECT * FROM bots', (err, rows) => resolve(rows || []));
            });
            const validKeys = new Set(bots.map(b => `${b.owner}_${b.id}`));

            const sandboxDir = STORAGE_DIRS.sandbox;
            if (fs.existsSync(sandboxDir)) {
                const entries = fs.readdirSync(sandboxDir);
                let removed = 0;
                for (const entry of entries) {
                    if (!validKeys.has(entry)) {
                        const full = path.join(sandboxDir, entry);
                        if (fs.statSync(full).isDirectory()) {
                            rmrf(full);
                            removed++;
                        }
                    }
                }
                if (removed > 0) {
                    console.log(`[janitor] Removed ${removed} orphan sandboxes`);
                }
            }
        } catch (err) {
            console.error('Janitor error:', err);
        }
    }, 3600000);
}

// ============================================================
// EXPRESS KEEP-ALIVE SERVER
// ============================================================

const app = express();

app.get('/', (req, res) => {
    res.json({
        ok: true,
        brand: CONFIG.brand,
        uptime: process.uptime(),
        runningBots: runningBots.size,
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'alive' });
});

app.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`[keepalive] Running on port ${CONFIG.port}`);
});

// ============================================================
// STARTUP
// ============================================================

console.log(`========================================`);
console.log(`   ${CONFIG.brand} ${CONFIG.version}`);
console.log(`   Owner ID: ${CONFIG.ownerId}`);
console.log(`   Announce Channel: ${CONFIG.announceChannel || '—'}`);
console.log(`========================================`);

// Start background tasks
checkScheduledBroadcasts();
checkExpiredPlans();
checkExpiryReminders();
janitorCleanup();

// Auto-start bots that were running
db.all('SELECT * FROM bots WHERE status = ?', ['running'], (err, rows) => {
    if (rows) {
        for (const b of rows) {
            setTimeout(() => startChild(b), 1000);
        }
    }
});

console.log('[bot] Polling started...');
