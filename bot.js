// bot.js - Complete Fixed Version with Local Image Generation

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const AdmZip = require('adm-zip');
const { createCanvas } = require('canvas');

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
// GENERATE LOCAL IMAGES
// ============================================================

const PHOTOS = {};

function generateLocalImages() {
    const photoDir = STORAGE_DIRS.photos;
    const menuKeys = [
        'main', 'admin', 'plans', 'buy', 'wallet', 'bots', 'bot', 
        'upload', 'stats', 'support', 'broadcast', 'ticket', 'coupon', 
        'security', 'referral', 'help', 'trial', 'profile'
    ];

    const colors = {
        main: '#1E1B4B',
        admin: '#7C2D12',
        plans: '#B45309',
        buy: '#065F46',
        wallet: '#047857',
        bots: '#0E7490',
        bot: '#1F2937',
        upload: '#4338CA',
        stats: '#14532D',
        support: '#0F766E',
        broadcast: '#1E40AF',
        ticket: '#0F766E',
        coupon: '#B91C1C',
        security: '#991B1B',
        referral: '#9333EA',
        help: '#334155',
        trial: '#A21CAF',
        profile: '#1E3A8A',
    };

    const labels = {
        main: 'Main Menu',
        admin: 'Admin Panel',
        plans: 'Plans',
        buy: 'Buy Plan',
        wallet: 'Wallet',
        bots: 'Your Bots',
        bot: 'Bot Control',
        upload: 'Upload Bot',
        stats: 'Stats',
        support: 'Support',
        broadcast: 'Broadcast',
        ticket: 'Tickets',
        coupon: 'Coupons',
        security: 'Security',
        referral: 'Referral',
        help: 'Help',
        trial: 'Free Trial',
        profile: 'Profile',
    };

    for (const key of menuKeys) {
        const filePath = path.join(photoDir, `${key}.png`);
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
            PHOTOS[key] = filePath;
            continue;
        }

        try {
            const canvas = createCanvas(900, 460);
            const ctx = canvas.getContext('2d');

            // Background
            const color = colors[key] || '#1E1B4B';
            const gradient = ctx.createLinearGradient(0, 0, 0, 460);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, '#0F172A');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 900, 460);

            // Accent stripe
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(0, 420, 900, 40);

            // Text
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Title
            const title = labels[key] || key.toUpperCase();
            ctx.font = 'bold 72px Arial';
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(title, 450, 200);

            // Subtitle
            ctx.shadowBlur = 5;
            ctx.font = '24px Arial';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(`${CONFIG.brand} ${CONFIG.version}`, 450, 320);

            // Save
            const buffer = canvas.toBuffer('image/png');
            fs.writeFileSync(filePath, buffer);
            PHOTOS[key] = filePath;
            console.log(`[photos] Generated ${key}.png`);
        } catch (err) {
            console.error(`[photos] Failed to generate ${key}.png:`, err.message);
            // Fallback to a simple colored image
            try {
                const canvas = createCanvas(900, 460);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#1E1B4B';
                ctx.fillRect(0, 0, 900, 460);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = 'bold 48px Arial';
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(labels[key] || key, 450, 230);
                const buffer = canvas.toBuffer('image/png');
                fs.writeFileSync(filePath, buffer);
                PHOTOS[key] = filePath;
            } catch (e) {
                console.error(`[photos] Fallback failed for ${key}:`, e.message);
                PHOTOS[key] = filePath; // Empty file, will be handled as fallback
            }
        }
    }
}

// Generate images on startup
generateLocalImages();

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
                                `<b>➕ Referral bonus earned!</b>\n` +
                                `From: @${user.username || user.first_name}\n` +
                                `Bonus: +1 bot slot, +1 wallet credit`,
                                { parse_mode: 'HTML' }
                            );
                        } catch {}
                    }
                });
            }

            notifyOwner(
                `<b>➕ New user joined</b>\n` +
                `Name: ${user.first_name}\n` +
                `Username: @${user.username || '—'}\n` +
                `User ID: ${user.id}`
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
    ok: '✅',
    no: '❌',
    warn: '⚠️',
    arrow: '➡️',
    bullet: '•',
    tri: '▸',
    diamond: '◆',
    star: '⭐',
    spark: '✦',
    back: '↩️',
    fwd: '▶️',
    plus: '➕',
    minus: '➖',
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
    play: '▶️',
    stop: '⏹️',
    pause: '⏸️',
    refresh: '🔄',
    running: '▶️',
    stopped: '⏹️',
    lock: '🔒',
    unlock: '🔓',
    secure: '🛡️',
    key: '🔑',
    shield: '🛡️',
    ban: '🚫',
    trash: '🗑️',
    eye: '👁️',
    user: '👤',
    users: '👥',
    crown: '👑',
    wallet: '💰',
    premium: '💎',
    lifetime: '♾️',
    gift: '🎁',
    ticket: '🎫',
    trophy: '🏆',
    graph: '📊',
    stats: '📈',
    chart_up: '📈',
    plan: '📋',
    broadcast: '📢',
    chat: '💬',
    folder: '📁',
    upload: '📤',
    download: '📥',
    cloud: '☁️',
    settings: '⚙️',
    cog: '⚙️',
    bolt: '⚡',
    clock: '⏰',
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
        `🚀 <b>NEW BOT STARTED</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🤖 <b>Bot:</b> ${esc(botName)}\n` +
        `🆔 <b>ID:</b> <code>${botId}</code>\n` +
        `👤 <b>User:</b> <a href="${userLink}">${userId}</a>\n` +
        `⏰ <b>Started:</b> ${timeStr} UTC\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ <i>Bot is now live and running!</i>` +
        FOOTER;

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
                        `<b>❌ You are banned</b>\n` +
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
// KEYBOARD BUILDERS WITH STYLES
// ============================================================

function mainMenuKb(admin = false) {
    const kb = {
        inline_keyboard: [
            [
                { text: `📁  My Bots`, callback_data: 'menu_bots' },
                { text: `📤  Upload Bot`, callback_data: 'menu_upload' },
            ],
            [
                { text: `📋  Plans`, callback_data: 'menu_plans' },
                { text: `💰  Buy Plan`, callback_data: 'menu_buy' },
            ],
            [
                { text: `🔗  Referral`, callback_data: 'menu_referral' },
                { text: `👤  Profile`, callback_data: 'menu_profile' },
            ],
            [
                { text: `💳  Wallet`, callback_data: 'menu_wallet' },
                { text: `🎫  Tickets`, callback_data: 'menu_tickets' },
            ],
            [
                { text: `🎁  Free Trial`, callback_data: 'menu_trial' },
                { text: `🏷️  Coupon`, callback_data: 'menu_coupon' },
            ],
            [
                { text: `❓  Help`, callback_data: 'menu_help' },
                { text: `📞  Support`, callback_data: 'menu_support' },
            ],
            [
                { text: `📊  My Stats`, callback_data: 'menu_stats' },
            ],
        ]
    };
    if (admin) {
        kb.inline_keyboard.push([
            [{ text: `🛡️  Admin Panel`, callback_data: 'menu_admin' }]
        ]);
    }
    return kb;
}

function backMainKb() {
    return {
        inline_keyboard: [
            [{ text: `${G.back}  Main Menu`, callback_data: 'menu_main' }]
        ]
    };
}

function backAdminKb() {
    return {
        inline_keyboard: [
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin' }]
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
            { text: `${G.star}  ${val.name}  ${G.bullet}  ${price}`, callback_data: `plan_view_${key}` }
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
                { text: `${G.graph}  Stats`, callback_data: 'adm_stats' },
                { text: `${G.users}  Users`, callback_data: 'adm_users' },
            ],
            [
                { text: `${G.diamond}  All Bots`, callback_data: 'adm_allbots' },
                { text: `${G.wallet}  Payments`, callback_data: 'adm_payments' },
            ],
            [
                { text: `${G.broadcast}  Broadcast`, callback_data: 'adm_broadcast' },
                { text: `${G.ban}  Ban / Unban`, callback_data: 'adm_ban' },
            ],
            [
                { text: `${G.plus}  Give Plan`, callback_data: 'adm_giveplan' },
                { text: `${G.ok}  Approve Pay`, callback_data: 'adm_approve' },
            ],
            [
                { text: `${G.key}  Coupons`, callback_data: 'adm_coupons' },
                { text: `${G.ticket}  Tickets`, callback_data: 'adm_tickets' },
            ],
            [
                { text: `${G.shield}  Admins`, callback_data: 'adm_admins' },
                { text: `${G.eye}  Audit Log`, callback_data: 'adm_audit' },
            ],
            [
                { text: `${G.cog}  GitHub Backup`, callback_data: 'adm_github' },
                { text: `${G.lock}  Security`, callback_data: 'adm_security' },
            ],
            [
                { text: `${G.warn}  Maintenance`, callback_data: 'adm_maint' },
                { text: `${G.settings}  Settings`, callback_data: 'adm_settings' },
            ],
            [
                { text: `📊  Analytics`, callback_data: 'adm_analytics' },
                { text: `👥  User Tools`, callback_data: 'adm_user_tools' },
            ],
            [
                { text: `🤖  Bot Manager`, callback_data: 'adm_bot_manager' },
                { text: `🛡️  Sec Center`, callback_data: 'adm_sec_center' },
            ],
            [
                { text: `💬  Notifications`, callback_data: 'adm_notify_center' },
                { text: `⚙️  Sys Tools`, callback_data: 'adm_sys_tools' },
            ],
            [
                { text: `🐙  Gh Browser`, callback_data: 'adm_gh_browser' },
                { text: `💳  Pay Config`, callback_data: 'adm_pay_config' },
            ],
            [
                { text: `🔧  Bot Config`, callback_data: 'adm_bot_cfg' },
                { text: `🎨  Appearance`, callback_data: 'adm_appearance' },
            ],
            [
                { text: `🎫  Coupon+`, callback_data: 'adm_coupon_plus' },
                { text: `📝  Templates`, callback_data: 'adm_templates' },
            ],
            [
                { text: `🔗  Referral Sys`, callback_data: 'adm_referral_sys' },
                { text: `🧹  Janitor`, callback_data: 'adm_janitor' },
            ],
            [
                { text: `🌐  Webhooks`, callback_data: 'adm_webhooks' },
                { text: `🎯  Feature Flags`, callback_data: 'adm_feature_flags' },
            ],
            [
                { text: `⏱️  Rate Limits`, callback_data: 'adm_rate_config' },
                { text: `📡  Live Monitor`, callback_data: 'adm_live_monitor' },
            ],
            [
                { text: `💎  Rev Goals`, callback_data: 'adm_rev_goals' },
                { text: `⏰  Scheduler`, callback_data: 'adm_scheduler' },
            ],
            [
                { text: `📥  Import/Exp`, callback_data: 'adm_import_export' },
                { text: `🏆  Leaderboard`, callback_data: 'adm_leaderboard' },
            ],
            [
                { text: `🌍  Languages`, callback_data: 'adm_languages' },
                { text: `🤖  Bot Controls`, callback_data: 'adm_bot_controls' },
            ],
            [
                { text: `👤  Subscriptions`, callback_data: 'adm_subscriptions' },
                { text: `🔐  Admin 2FA`, callback_data: 'adm_admin_2fa' },
            ],
            [
                [{ text: `${G.back}  Main Menu`, callback_data: 'menu_main' }]
            ],
        ]
    };
}

function botActionsKb(botId, running, premium = false) {
    const kb = { inline_keyboard: [] };
    if (running) {
        kb.inline_keyboard.push([
            { text: `${G.stop}  Stop`, callback_data: `bot_stop_${botId}` },
            { text: `${G.refresh}  Restart`, callback_data: `bot_restart_${botId}` },
        ]);
    } else {
        kb.inline_keyboard.push([
            { text: `${G.play}  Start`, callback_data: `bot_start_${botId}` },
            { text: `${G.refresh}  Restart`, callback_data: `bot_restart_${botId}` },
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.bolt}  Live Logs`, callback_data: `bot_logs_${botId}` },
        { text: `${G.eye}  Info`, callback_data: `bot_info_${botId}` },
    ]);
    kb.inline_keyboard.push([
        { text: `${G.settings}  Env Vars`, callback_data: `bot_env_${botId}` },
        { text: `${G.cog}  Cron`, callback_data: `bot_cron_${botId}` },
    ]);
    kb.inline_keyboard.push([
        { text: `${G.download}  Install Pkg`, callback_data: `bot_pip_${botId}` },
        { text: `${G.plus}  Clone`, callback_data: `bot_clone_${botId}` },
    ]);
    if (premium) {
        kb.inline_keyboard.push([
            { text: `🌐  Public URL`, callback_data: `bot_tunnel_${botId}` },
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.arrow}  Download`, callback_data: `bot_dl_${botId}` },
        { text: `${G.trash}  Delete`, callback_data: `bot_delete_${botId}` },
    ]);
    kb.inline_keyboard.push([
        [{ text: `${G.back}  My Bots`, callback_data: 'menu_bots' }]
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

function showMenu(chatId, photoKey, caption, kb, call = null) {
    // Get the local photo path
    const photoPath = PHOTOS[photoKey] || PHOTOS['main'];
    
    // Read the image file as a stream
    let photoStream;
    try {
        photoStream = fs.createReadStream(photoPath);
    } catch (err) {
        console.error(`[showMenu] Failed to read photo ${photoKey}:`, err.message);
        // Fallback: send text only
        return showText(chatId, caption, kb, call);
    }

    const opts = {
        parse_mode: 'HTML',
        reply_markup: kb,
    };

    if (call && call.message) {
        // Try to edit existing message
        return bot.editMessageMedia(
            {
                type: 'photo',
                media: photoStream,
                caption: caption,
                parse_mode: 'HTML',
            },
            {
                chat_id: chatId,
                message_id: call.message.message_id,
                reply_markup: kb,
            }
        ).catch(() => {
            // Fallback: send new message
            return bot.sendPhoto(chatId, photoStream, { caption, ...opts });
        });
    }

    return bot.sendPhoto(chatId, photoStream, { caption, ...opts });
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
// VERIFICATION (COMPLETELY REMOVED)
// ============================================================

// All verification functions removed - no captcha, no verification flow

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
        `<b>${esc(CONFIG.brand)} ${CONFIG.version}</b>\n` +
        `${G.div_eq}\n` +
        introBlock +
        `Welcome, <b>${esc(user.name || 'friend')}</b>\n` +
        `Plan: ${plan.name}\n` +
        `Until: ${user.plan_expires ? fmtTs(user.plan_expires) : (plan.price === 0 ? 'Forever' : '—')}\n` +
        `Bots: ${bots.length} / ${userMaxBots(user)} (running ${running})\n` +
        `Wallet: $${user.wallet || 0}\n` +
        `${G.div}\n` +
        `Choose an option below.` +
        FOOTER;

    const admin = await isAdmin(uid);
    return showMenu(chatId, 'main', cap, mainMenuKb(admin), call);
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
                    `<b>👑 You are now the panel owner</b>\n` +
                    `${G.div}\n` +
                    `Owner ID: ${uid}\n` +
                    `Set OWNER_ID env var to lock ownership permanently.`,
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
            `<b>⚠️ Panel under maintenance</b>\n\n` +
            `We will be back shortly. ${CONFIG.supportUser} for urgent issues.`,
            { parse_mode: 'HTML' }
        );
        return;
    }

    const intro = isNew ?
        `You are now registered. Tap <b>Plans</b> or <b>Upload Bot</b> to begin.` :
        `Welcome back, <b>${esc(msg.from.first_name || 'friend')}</b>!`;

    renderMainMenu(msg.chat.id, uid, null, intro);
});

bot.onText(/\/help/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (await bannedBlock(msg)) return;

    const text =
        `<b>${esc(CONFIG.brand)} ${CONFIG.version} — Quick Help</b>\n` +
        `${G.div_eq}\n` +
        `📤 Upload: Send a .py / .js / .zip file or use Upload Bot menu.\n` +
        `🤖 Manage: My Bots → pick a bot → Start / Stop / Logs.\n` +
        `📋 Plans: Plans → Buy Plan → choose method → send proof.\n` +
        `💳 Wallet: Top-up via admin, then spend on plans.\n` +
        `🔗 Refer: Invite friends with your /start link to earn slots.\n` +
        `🎁 Trial: One-time 48-hour Pro trial in the Trial menu.\n` +
        `🎫 Support: Open a ticket from the Tickets menu, or DM ${CONFIG.supportUser}.\n` +
        `${G.div}` +
        FOOTER;

    bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'HTML',
        reply_markup: backMainKb(),
        disable_web_page_preview: true,
    });
});

bot.onText(/\/menu/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (await bannedBlock(msg)) return;
    await getOrCreateUser(msg.from);
    renderMainMenu(msg.chat.id, msg.from.id);
});

bot.onText(/\/id/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    bot.sendMessage(msg.chat.id, `<code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

bot.onText(/\/cancel/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    userStates.delete(msg.from.id);
    bot.sendMessage(msg.chat.id, `${G.ok} Cancelled`);
});

bot.onText(/\/admin/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (!(await isAdmin(msg.from.id))) {
        bot.sendMessage(msg.chat.id, `${G.no} Admin only.`);
        return;
    }
    await getOrCreateUser(msg.from);
    const kb = {
        inline_keyboard: [
            [{ text: `🛡️  Admin Panel`, callback_data: 'menu_admin' }]
        ]
    };
    bot.sendMessage(msg.chat.id, `<b>🛡️ Admin Panel</b>`, {
        parse_mode: 'HTML',
        reply_markup: kb,
    });
});

// ============================================================
// RENDER FUNCTIONS (Core Menus)
// ============================================================

async function renderBotsMenu(call) {
    const uid = call.from.id;
    const bots = await listUserBots(uid);
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });

    let cap =
        `<b>${G.diamond} Your Bots</b>\n` +
        `${G.div_eq}\n` +
        `Slots: ${bots.length} / ${userMaxBots(user)}\n`;

    const kb = { inline_keyboard: [] };

    if (bots.length === 0) {
        cap += `\nYou have not deployed any bots yet. Tap upload bot to begin.`;
    } else {
        for (const b of bots) {
            const running = runningBots.has(b.id);
            const mark = running ? G.play : G.stop;
            kb.inline_keyboard.push([
                { text: `${mark}  ${b.name.slice(0, 30)}`, callback_data: `bot_view_${b.id}` }
            ]);
        }
    }

    kb.inline_keyboard.push([
        { text: `${G.plus}  Upload`, callback_data: 'menu_upload' },
        { text: `${G.back}  Main Menu`, callback_data: 'menu_main' },
    ]);

    showMenu(call.message.chat.id, 'bots', cap + FOOTER, kb, call);
}

async function renderUploadMenu(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });
    const used = (await listUserBots(uid)).length;

    const cap =
        `<b>${G.plus} Upload Bot</b>\n` +
        `${G.div_eq}\n` +
        `Plan: ${PLAN_LIMITS[user.plan]?.name || 'Free'}\n` +
        `Slots: ${used} / ${userMaxBots(user)}\n` +
        `${G.div}\n` +
        `<b>Send your bot file as a document.</b>\n` +
        `Accepted: <code>.zip  .py  .js</code>\n` +
        `Entry detection: <code>bot.py</code>, <code>main.py</code>, ` +
        `<code>app.py</code>, <code>index.js</code>, <code>bot.js</code>.\n` +
        `All files are <b>encrypted at rest</b>.`;

    userStates.set(uid, { flow: 'await_upload' });
    showMenu(call.message.chat.id, 'upload', cap + FOOTER, backMainKb(), call);
}

async function renderPlansMenu(call) {
    const lines = [];
    for (const [key, val] of Object.entries(PLAN_LIMITS)) {
        const price = val.price === 0 ? 'Free' : `${val.price}৳`;
        lines.push(`${G.bullet}  <b>${val.name}</b>: ${val.max_bots} bots ${G.bullet} ${val.ram} MB RAM ${G.bullet} ${price}`);
    }

    const cap =
        `<b>${G.star} Plans</b>\n` +
        `${G.div_eq}\n` +
        lines.join('\n') +
        `\n${G.div}\nTap a plan for full details.` +
        FOOTER;

    showMenu(call.message.chat.id, 'plans', cap, plansKb(), call);
}

async function renderPlanDetail(call, plan) {
    const p = PLAN_LIMITS[plan];
    if (!p) { ack(call, 'Unknown plan'); return; }

    const cap =
        `<b>${G.star} ${p.name} Plan</b>\n` +
        `${G.div_eq}\n` +
        `Max bots: ${p.max_bots}\n` +
        `RAM per bot: ${p.ram} MB\n` +
        `Auto-restart: ${p.auto_restart ? 'Yes' : 'No'}\n` +
        `Duration: ${plan === 'lifetime' ? 'Lifetime' : `${p.days} days`}\n` +
        `Price: ${p.price === 0 ? 'Free' : `${p.price}$`}\n` +
        `${G.div}\n` +
        `Tap buy to choose a payment method.` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    if (plan !== 'free') {
        kb.inline_keyboard.push([
            { text: `${G.spark}  Buy ${p.name}`, callback_data: `plan_buy_${plan}` }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Plans`, callback_data: 'menu_plans' }
    ]);

    showMenu(call.message.chat.id, 'buy', cap, kb, call);
}

async function renderBuyMenu(call) {
    const cap =
        `<b>${G.spark} Buy a Plan</b>\n` +
        `${G.div_eq}\n` +
        `Pick a plan first.` +
        FOOTER;

    showMenu(call.message.chat.id, 'buy', cap, plansKb(), call);
}

async function renderPaymentMethodsFor(call, plan) {
    const p = PLAN_LIMITS[plan];
    if (!p) { ack(call, 'Unknown plan'); return; }

    const cap =
        `<b>${G.wallet} Choose Payment Method</b>\n` +
        `${G.div_eq}\n` +
        `Plan: ${p.name}\n` +
        `Price: $${p.price}\n` +
        `${G.div}\n` +
        `Pick the method you will pay with.` +
        FOOTER;

    showMenu(call.message.chat.id, 'wallet', cap, paymentsKb(plan), call);
}

async function renderPaymentScreen(call, data) {
    const parts = data.split('_');
    const method = parts[1];
    const plan = parts.length >= 3 ? parts[2] : null;
    const pm = PAYMENT_METHODS[method];
    if (!pm) { ack(call, 'Unknown method'); return; }

    const p = plan ? PLAN_LIMITS[plan] : null;

    let cap =
        `<b>${pm.tag} ${pm.name} — Payment</b>\n` +
        `${G.div_eq}\n` +
        `Number: ${pm.number}\n` +
        `Type: ${pm.type}\n`;

    if (p) {
        cap += `Plan: ${p.name}\nAmount: $${p.price}\n`;
    }

    cap +=
        `${G.div}\n` +
        `<b>How to pay:</b>\n` +
        `1. Send the exact amount to the number above.\n` +
        `2. Tap send proof and forward your receipt screenshot.\n` +
        `3. Wait for admin approval (usually within 1 hour).\n` +
        `${G.div}` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    userStates.set(call.from.id, { flow: 'await_payment_proof', method, plan });
    kb.inline_keyboard.push([
        { text: `${G.plus}  Send Proof`, callback_data: 'pay_proof' }
    ]);
    kb.inline_keyboard.push([
        { text: `${G.back}  Methods`, callback_data: `plan_buy_${plan}` }
    ]);

    showMenu(call.message.chat.id, 'pay', cap, kb, call);
}

async function startProofFlow(call) {
    userStates.set(call.from.id, { flow: 'await_payment_proof' });
    bot.sendMessage(call.message.chat.id,
        `${G.plus} Send your payment screenshot or transaction id text now.\n` +
        `Use /cancel to abort.`
    );
}

async function renderProfile(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });
    if (!user) return;

    const plan = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
    const bots = await listUserBots(uid);

    const cap =
        `<b>${G.user} Profile</b>\n` +
        `${G.div_eq}\n` +
        `Name: ${user.name}\n` +
        `Username: @${user.username || '—'}\n` +
        `User ID: ${uid}\n` +
        `Plan: ${plan.name}\n` +
        `Until: ${user.plan_expires ? fmtTs(user.plan_expires) : (plan.price === 0 ? 'Forever' : '—')}\n` +
        `Wallet: $${user.wallet || 0}\n` +
        `Bots: ${bots.length} / ${userMaxBots(user)}\n` +
        `Joined: ${fmtTs(user.joined)}\n` +
        `Referrals: ${user.ref_count || 0}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'profile', cap, backMainKb(), call);
}

async function renderReferral(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });

    const me = await bot.getMe();
    const link = `https://t.me/${me.username}?start=${uid}`;

    const cap =
        `<b>${G.users} Referral</b>\n` +
        `${G.div_eq}\n` +
        `Your link: ${link}\n` +
        `Referrals: ${user.ref_count || 0}\n` +
        `Bonus slots: ${user.bot_slots_bonus || 0}\n` +
        `${G.div}\n` +
        `Each friend who joins via your link gives you +1 bot slot.` +
        FOOTER;

    showMenu(call.message.chat.id, 'referral', cap, backMainKb(), call);
}

async function renderWallet(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });

    const cap =
        `<b>${G.wallet} Wallet</b>\n` +
        `${G.div_eq}\n` +
        `Balance: $${user.wallet || 0}\n` +
        `${G.div}\n` +
        `Top up by sending payment proof. Admin will credit your wallet.` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    kb.inline_keyboard.push([
        { text: `${G.plus}  Top Up`, callback_data: 'wallet_topup' }
    ]);
    if (user.plan && user.plan !== 'free') {
        kb.inline_keyboard.push([
            { text: `${G.spark}  Gift Plan`, callback_data: 'wallet_gift' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Main Menu`, callback_data: 'menu_main' }
    ]);

    showMenu(call.message.chat.id, 'wallet', cap, kb, call);
}

async function renderHelp(call) {
    const cap =
        `<b>${G.rec} Help</b>\n` +
        `${G.div_eq}\n` +
        `📤 Upload: Send a .py / .js / .zip file\n` +
        `▶️ Run: My Bots → pick → Start\n` +
        `📋 Logs: My Bots → pick → Live Logs\n` +
        `🔧 Env: My Bots → pick → Env Vars\n` +
        `📋 Plans: Plans → Buy Plan → method\n` +
        `🏷️ Coupon: Coupon menu → Redeem\n` +
        `🎁 Trial: One-time 48h Pro trial\n` +
        `🔗 Refer: Earn slots by inviting friends\n` +
        `🎫 Tickets: Open a private support ticket\n` +
        `${G.div}\n` +
        `Updates: ${CONFIG.updateChannel}` +
        FOOTER;

    showMenu(call.message.chat.id, 'help', cap, backMainKb(), call);
}

async function renderSupport(call) {
    const cap =
        `<b>${G.broadcast} Support</b>\n` +
        `${G.div_eq}\n` +
        `DM: ${CONFIG.supportUser}\n` +
        `Channel: ${CONFIG.updateChannel}\n` +
        `${G.div}\n` +
        `Or open a ticket from the Tickets menu for tracked help.` +
        FOOTER;

    showMenu(call.message.chat.id, 'support', cap, backMainKb(), call);
}

async function renderTrial(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });

    const cap =
        `<b>${G.eye} Free Trial</b>\n` +
        `${G.div_eq}\n` +
        `Get a free 48-hour Pro trial — one time per account.\n` +
        `Status: ${user.trial_used ? 'Already used' : 'Available'}` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    if (!user.trial_used) {
        kb.inline_keyboard.push([
            { text: `${G.ok}  Claim 48h Pro Trial`, callback_data: 'trial_claim' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Main Menu`, callback_data: 'menu_main' }
    ]);

    showMenu(call.message.chat.id, 'trial', cap, kb, call);
}

async function actionTrialClaim(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });

    if (user.trial_used) {
        ack(call, 'Already used');
        return;
    }

    db.run(`UPDATE users SET trial_used = 1 WHERE id = ?`, [uid]);
    await grantPlan(uid, 'pro', 2);
    audit(0, 'trial_grant', `uid=${uid}`);
    ack(call, 'Trial activated!');
    renderMainMenu(call.message.chat.id, uid, call);
}

async function renderCoupon(call) {
    const cap =
        `<b>${G.key} Coupon</b>\n` +
        `${G.div_eq}\n` +
        `Have a discount code? Tap redeem and send the code.` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    kb.inline_keyboard.push([
        { text: `${G.plus}  Redeem Code`, callback_data: 'coupon_redeem' }
    ]);
    kb.inline_keyboard.push([
        { text: `${G.back}  Main Menu`, callback_data: 'menu_main' }
    ]);

    showMenu(call.message.chat.id, 'coupon', cap, kb, call);
}

async function renderUserStats(call) {
    const uid = call.from.id;
    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [uid], (err, row) => resolve(row));
    });
    const bots = await listUserBots(uid);
    const running = bots.filter(b => runningBots.has(b.id)).length;

    const payments = await new Promise((resolve) => {
        db.all('SELECT * FROM payments WHERE uid = ? AND status = ?', [uid, 'approved'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const tickets = await new Promise((resolve) => {
        db.all('SELECT * FROM tickets WHERE uid = ?', [uid], (err, rows) => {
            resolve(rows || []);
        });
    });

    const cap =
        `<b>${G.graph} My Stats</b>\n` +
        `${G.div_eq}\n` +
        `Name: ${user.name}\n` +
        `User ID: ${uid}\n` +
        `Plan: ${PLAN_LIMITS[user.plan]?.name || 'Free'}\n` +
        `Expires: ${user.plan_expires ? fmtTs(user.plan_expires) : 'Forever'}\n` +
        `${G.div}\n` +
        `Total Bots: ${bots.length}\n` +
        `Running: ${running}\n` +
        `Slots: ${bots.length} / ${userMaxBots(user)}\n` +
        `${G.div}\n` +
        `Payments: ${payments.length}\n` +
        `Wallet: $${user.wallet || 0}\n` +
        `${G.div}\n` +
        `Referrals: ${user.ref_count || 0}\n` +
        `Bonus Slots: ${user.bot_slots_bonus || 0}\n` +
        `Free Trial: ${user.trial_used ? 'Used' : 'Available'}\n` +
        `Tickets: ${tickets.length}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'stats', cap, backMainKb(), call);
}

// ============================================================
// BOT VIEW FUNCTIONS
// ============================================================

async function renderBotView(call, botId) {
    const botDoc = await findBot(botId);
    if (!botDoc) { ack(call, 'Not found'); return; }

    if (botDoc.owner !== call.from.id && !(await isAdmin(call.from.id))) {
        ack(call, 'Not yours');
        return;
    }

    const status = childStatus(botId, botDoc);
    const running = status.running;

    let errBlock = '';
    if (!running) {
        const rc = botDoc.last_exit_code;
        const lastErr = botDoc.last_error || '';
        if (lastErr || (rc !== null && rc !== 0)) {
            errBlock =
                `\n${G.div}\n` +
                `<b>${G.no} Last error${rc !== null && rc !== 0 ? ` (exit ${rc})` : ''}</b>\n` +
                `<pre>${esc(lastErr || '(no log captured)').slice(0, 900)}</pre>`;
        }
    }

    const appr = (botDoc.approval_status || '').toLowerCase();
    let statusLabel = '';
    if (appr === 'pending') statusLabel = '⏳ Pending Approval';
    else if (appr === 'rejected') statusLabel = '❌ Rejected';
    else if (running) statusLabel = '▶️ Running';
    else if (botDoc.status === 'crashed') statusLabel = '💥 Crashed';
    else statusLabel = '⏹️ Stopped';

    let srcInfo = '';
    if (botDoc.source && ['github', 'github_browser'].includes(botDoc.source)) {
        srcInfo = `\nSource: 🐙 GitHub\nRepo: ${botDoc.gh_repo || '?'}`;
    }

    const cap =
        `<b>${G.diamond} ${esc(botDoc.name)}</b>\n` +
        `${G.div_eq}\n` +
        `Status: ${statusLabel}\n` +
        `Kind: ${status.kind || '—'}\n` +
        `PID: ${status.pid ? '••••' : '—'}\n` +
        `Uptime: ${fmtDur(status.uptimeMs)}\n` +
        `Size: ${fmtBytes(status.sizeBytes)}\n` +
        `CPU: ${status.cpuPct.toFixed(1)}%\n` +
        `Memory: ${fmtBytes(status.memBytes)}\n` +
        `Created: ${fmtTs(botDoc.created)}` +
        srcInfo +
        errBlock +
        `\n${G.div}` +
        FOOTER;

    const user = await new Promise((resolve) => {
        db.get('SELECT * FROM users WHERE id = ?', [botDoc.owner], (err, row) => resolve(row));
    });
    const isPremium = user && user.plan && user.plan !== 'free' && userPlanActive(user);

    showMenu(call.message.chat.id, 'bot', cap, botActionsKb(botId, running, isPremium), call);
}

async function actionBotStart(call, botId) {
    const botDoc = await findBot(botId);
    if (!botDoc || (botDoc.owner !== call.from.id && !(await isAdmin(call.from.id)))) {
        ack(call, 'Not found / not yours');
        return;
    }

    loading(call, 'Starting bot');
    const result = await startChild(botDoc);
    ack(call, result.ok ? 'Started' : `Err: ${result.error || ''}`);
    renderBotView(call, botId);
}

async function actionBotStop(call, botId) {
    const botDoc = await findBot(botId);
    if (!botDoc || (botDoc.owner !== call.from.id && !(await isAdmin(call.from.id)))) {
        ack(call, 'Not found / not yours');
        return;
    }

    loading(call, 'Stopping bot');
    await stopChild(botId, true);
    ack(call, 'Stopped');
    renderBotView(call, botId);
}

async function actionBotRestart(call, botId) {
    const botDoc = await findBot(botId);
    if (!botDoc || (botDoc.owner !== call.from.id && !(await isAdmin(call.from.id)))) {
        ack(call, 'Not found / not yours');
        return;
    }

    loading(call, 'Restarting bot');
    const result = await restartChild(botDoc);
    ack(call, result.ok ? 'Restarted' : `Err: ${result.error || ''}`);
    renderBotView(call, botId);
}

async function actionBotLogs(call, botId) {
    const botDoc = await findBot(botId);
    if (!botDoc || (botDoc.owner !== call.from.id && !(await isAdmin(call.from.id)))) {
        ack(call, 'Not found');
        return;
    }

    const entry = botProcesses.get(botId);
    const logs = entry ? entry.log : [];
    const last = logs.length > 0 ? logs.slice(-60) : ['(no logs yet)'];

    const cap =
        `<b>${G.bolt} Live Logs — ${esc(botDoc.name)}</b>\n` +
        `${G.div_eq}\n` +
        `<pre>${esc(last.join('\n')).slice(0, 3500)}</pre>\n` +
        `${G.div}` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    kb.inline_keyboard.push([
        { text: `${G.refresh}  Refresh Logs`, callback_data: `bot_logs_${botId}` },
        { text: `${G.back}  Back`, callback_data: `bot_view_${botId}` },
    ]);

    showText(call.message.chat.id, cap, kb, call);
}

async function renderEnvMenu(call, botId) {
    const botDoc = await findBot(botId);
    if (!botDoc || (botDoc.owner !== call.from.id && !(await isAdmin(call.from.id)))) {
        ack(call, 'Not found');
        return;
    }

    const env = botDoc.env ? JSON.parse(botDoc.env) : {};
    const rows = Object.entries(env).slice(0, 20)
        .map(([k, v]) => `${G.bullet} <b>${esc(k)}</b> = <code>${'*'.repeat(Math.min(String(v).length, 6))}…</code>`)
        .join('\n') || `<i>no variables yet</i>`;

    const cap =
        `<b>${G.settings} Env Vars — ${esc(botDoc.name)}</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    kb.inline_keyboard.push([
        { text: `${G.plus}  Add Variable`, callback_data: `env_add_${botId}` }
    ]);
    for (const [k] of Object.entries(env).slice(0, 10)) {
        kb.inline_keyboard.push([
            { text: `${G.no}  Delete ${k}`, callback_data: `env_del_${botId}_${k}` }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Bot`, callback_data: `bot_view_${botId}` }
    ]);

    showMenu(call.message.chat.id, 'bot', cap, kb, call);
}

// ============================================================
// ADMIN PANEL
// ============================================================

async function renderAdmin(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const d = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row1) => {
            db.get('SELECT COUNT(*) as bots FROM bots', (err, row2) => {
                db.get('SELECT COUNT(*) as pending FROM payments WHERE status = ?', ['pending'], (err, row3) => {
                    resolve({
                        users: row1?.users || 0,
                        bots: row2?.bots || 0,
                        pending: row3?.pending || 0,
                    });
                });
            });
        });
    });

    const revenue = await new Promise((resolve) => {
        db.get('SELECT SUM(amount) as total FROM payments WHERE status = ?', ['approved'], (err, row) => {
            resolve(row?.total || 0);
        });
    });

    const cap =
        `<b>🛡️ Admin Panel</b>\n` +
        `${G.div_eq}\n` +
        `👥 Users: ${d.users}\n` +
        `🤖 Bots: ${d.bots}\n` +
        `▶️ Running: ${runningBots.size}\n` +
        `💰 Revenue: $${revenue}\n` +
        `⏳ Pending: ${d.pending}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'admin', cap, adminKb(), call);
}

// ============================================================
// ADMIN SUBROUTE
// ============================================================

async function renderAdminSubroute(call, data) {
    // Admin stats
    if (data === 'adm_stats') return renderAdminStats(call);
    if (data === 'adm_users') return renderAdminUsers(call);
    if (data === 'adm_allbots') return renderAdminAllBots(call);
    if (data === 'adm_payments') return renderAdminPayments(call);
    if (data === 'adm_broadcast') return renderAdminBroadcast(call);
    if (data === 'adm_ban') return renderAdminBan(call);
    if (data === 'adm_giveplan') return renderAdminGivePlan(call);
    if (data === 'adm_approve') return renderAdminPayments(call);
    if (data === 'adm_coupons') return renderAdminCoupons(call);
    if (data === 'adm_tickets') return renderAdminTickets(call);
    if (data === 'adm_admins') return renderAdminAdmins(call);
    if (data === 'adm_audit') return renderAdminAudit(call);
    if (data === 'adm_github') return renderAdminGithub(call);
    if (data === 'adm_security') return renderAdminSecurity(call);
    if (data === 'adm_maint') return renderAdminMaintenance(call);
    if (data === 'adm_settings') return renderAdminSettings(call);
    if (data === 'adm_pending') return renderAdminPending(call);
    if (data === 'adm_photos') return renderAdminPhotos(call);

    // Mega panels - simplified
    if (data === 'adm_analytics') return renderAdminStats(call);
    if (data === 'adm_user_tools') return renderAdminUsers(call);
    if (data === 'adm_bot_manager') return renderAdminAllBots(call);
    if (data === 'adm_sec_center') return renderAdminSecurity(call);
    if (data === 'adm_notify_center') return renderAdminBroadcast(call);
    if (data === 'adm_sys_tools') return renderAdminSettings(call);

    ack(call, '?');
}

// ============================================================
// ADMIN STATS
// ============================================================

async function renderAdminStats(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const d = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as users FROM users', (err, row1) => {
            db.get('SELECT COUNT(*) as bots FROM bots', (err, row2) => {
                db.get('SELECT COUNT(*) as payments FROM payments WHERE status = ?', ['approved'], (err, row3) => {
                    db.get('SELECT SUM(amount) as revenue FROM payments WHERE status = ?', ['approved'], (err, row4) => {
                        resolve({
                            users: row1?.users || 0,
                            bots: row2?.bots || 0,
                            payments: row3?.payments || 0,
                            revenue: row4?.revenue || 0,
                        });
                    });
                });
            });
        });
    });

    const cap =
        `<b>📊 System Stats</b>\n` +
        `${G.div_eq}\n` +
        `👥 Total users: ${d.users}\n` +
        `🤖 Total bots: ${d.bots}\n` +
        `▶️ Bots running: ${runningBots.size}\n` +
        `💰 Revenue: $${d.revenue}\n` +
        `💳 Payments: ${d.payments}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'stats', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN USERS
// ============================================================

async function renderAdminUsers(call) {
    if (!await adminOnlyCall(call, 'view_users')) return;

    const users = await new Promise((resolve) => {
        db.all('SELECT * FROM users ORDER BY joined DESC LIMIT 20', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = users.map(u =>
        `${G.bullet} <code>${u.id}</code> — ${esc(u.name)} ` +
        `(@${esc(u.username || '—')}) ${G.bullet} <i>${PLAN_LIMITS[u.plan]?.name || u.plan}</i>`
    ).join('\n') || `<i>no users yet</i>`;

    const cap =
        `<b>${G.users} Recent Users</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}\n` +
        `Send a numeric user id to look one up.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_admin_finduser' });
    showMenu(call.message.chat.id, 'admin', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN ALL BOTS
// ============================================================

async function renderAdminAllBots(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const bots = await new Promise((resolve) => {
        db.all('SELECT * FROM bots', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = bots.slice(0, 25).map(b =>
        `${G.bullet} <code>${b.id}</code> — ${esc(b.name)} ` +
        `${G.bullet} uid ${b.owner} ` +
        `${runningBots.has(b.id) ? '▶ running' : '⏹ stopped'}`
    ).join('\n') || `<i>no bots</i>`;

    const cap =
        `<b>${G.diamond} All Bots (${bots.length})</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'admin', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN PAYMENTS
// ============================================================

async function renderAdminPayments(call) {
    if (!await adminOnlyCall(call, 'approve_payment')) return;

    const payments = await new Promise((resolve) => {
        db.all('SELECT * FROM payments WHERE status = ? ORDER BY ts DESC', ['pending'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = payments.map(p =>
        `${G.bullet} <code>${p.id}</code> ${G.bullet} uid ${p.uid} ` +
        `${G.bullet} ${esc(p.plan || '—')} ${G.bullet} ${esc(p.method)}`
    ).join('\n') || `<i>no pending payments</i>`;

    const cap =
        `<b>${G.wallet} Pending Payments</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'admin', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN BROADCAST
// ============================================================

async function renderAdminBroadcast(call) {
    if (!await adminOnlyCall(call, 'broadcast_view')) return;

    const cap =
        `<b>${G.broadcast} Broadcast</b>\n` +
        `${G.div_eq}\n` +
        `Send message text now.\n` +
        `Prefix <code>plan:pro</code> — only pro users.\n` +
        `Prefix <code>at:YYYY-MM-DD HH:MM</code> — schedule.` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_broadcast' });
    showMenu(call.message.chat.id, 'broadcast', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN BAN
// ============================================================

async function renderAdminBan(call) {
    if (!await adminOnlyCall(call, 'ban_user')) return;

    const cap =
        `<b>${G.no} Ban / Unban</b>\n` +
        `${G.div_eq}\n` +
        `Send: <code>ban user_id reason</code>\n` +
        `Send: <code>unban user_id</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_ban_cmd' });
    showMenu(call.message.chat.id, 'admin', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN GIVE PLAN
// ============================================================

async function renderAdminGivePlan(call) {
    if (!await adminOnlyCall(call, 'give_plan')) return;

    const cap =
        `<b>${G.plus} Give Plan</b>\n` +
        `${G.div_eq}\n` +
        `Send: <code>user_id plan [days]</code>\n` +
        `Plans: ${Object.keys(PLAN_LIMITS).join(', ')}` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_giveplan' });
    showMenu(call.message.chat.id, 'admin', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN COUPONS
// ============================================================

async function renderAdminCoupons(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const coupons = await new Promise((resolve) => {
        db.all('SELECT * FROM coupons', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = coupons.map(c =>
        `${G.bullet} <code>${esc(c.code)}</code> — ${esc(c.percent)}% ${G.bullet} ${esc(c.uses_left)} uses left`
    ).join('\n') || `<i>no coupons yet</i>`;

    const cap =
        `<b>${G.key} Coupons</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}\n` +
        `Send: <code>add CODE PERCENT USES</code>\n` +
        `Send: <code>del CODE</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_coupon_admin' });
    showMenu(call.message.chat.id, 'coupon', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN TICKETS
// ============================================================

async function renderAdminTickets(call) {
    if (!await adminOnlyCall(call, 'reply_ticket')) return;

    const tickets = await new Promise((resolve) => {
        db.all('SELECT * FROM tickets WHERE status = ? ORDER BY opened_at DESC', ['open'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = tickets.map(t =>
        `${G.bullet} <code>${t.id}</code> uid ${t.uid} — ${esc(t.subject).slice(0, 40)}`
    ).join('\n') || `<i>no open tickets</i>`;

    const cap =
        `<b>${G.ticket} Open Tickets</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    for (const t of tickets) {
        kb.inline_keyboard.push([
            { text: `${G.eye}  #${t.id}`, callback_data: `ticket_view_${t.id}` }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Admin`, callback_data: 'menu_admin' }
    ]);

    showMenu(call.message.chat.id, 'ticket', cap, kb, call);
}

// ============================================================
// ADMIN ADMINS
// ============================================================

async function renderAdminAdmins(call) {
    if (!await isOwner(call.from.id)) {
        ack(call, 'Owner only');
        return;
    }

    const admins = await new Promise((resolve) => {
        db.all('SELECT * FROM admins', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = admins.map(a =>
        `${G.bullet} <code>${a.uid}</code> — ${esc(a.role)}`
    ).join('\n') || `<i>no extra admins yet</i>`;

    const cap =
        `<b>${G.shield} Admins</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}\n` +
        `Send: <code>add uid role</code>\n` +
        `Roles: <code>view-only</code>, <code>manage-users</code>, <code>full-access</code>\n` +
        `Send: <code>del uid</code>` +
        FOOTER;

    userStates.set(call.from.id, { flow: 'await_admin_admins' });
    showMenu(call.message.chat.id, 'admin', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN AUDIT
// ============================================================

async function renderAdminAudit(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const auditLog = await new Promise((resolve) => {
        db.all('SELECT * FROM audit ORDER BY id DESC LIMIT 25', (err, rows) => {
            resolve(rows || []);
        });
    });

    const rows = auditLog.map(a =>
        `${G.bullet} ${esc(a.ts).slice(11, 19)} uid ${a.uid} → ${esc(a.action)} ${esc(a.detail || '').slice(0, 60)}`
    ).join('\n') || `<i>no audit entries yet</i>`;

    const cap =
        `<b>${G.eye} Recent Audit</b>\n` +
        `${G.div_eq}\n` +
        rows +
        `\n${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'security', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN GITHUB
// ============================================================

async function renderAdminGithub(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const cap =
        `<b>${G.cog} GitHub Backup</b>\n` +
        `${G.div_eq}\n` +
        `Configured: ${await getSetting('github_token') ? '✅' : '❌'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '🔑  Set Token', callback_data: 'gh_set_token', style: 'primary' }],
            [{ text: '📦  Set Repo', callback_data: 'gh_set_repo', style: 'primary' }],
            [{ text: '🌿  Set Branch', callback_data: 'gh_set_branch', style: 'primary' }],
            [{ text: '⏰  Set Interval', callback_data: 'gh_set_interval', style: 'primary' }],
            [{ text: '💾  Backup Now', callback_data: 'gh_backup_now', style: 'success' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, 'admin', cap, kb, call);
}

// ============================================================
// ADMIN SECURITY
// ============================================================

async function renderAdminSecurity(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const scans = await new Promise((resolve) => {
        db.all('SELECT * FROM scan_log', (err, rows) => {
            resolve(rows || []);
        });
    });

    const cap =
        `<b>${G.lock} Security</b>\n` +
        `${G.div_eq}\n` +
        `Scan log entries: ${scans.length}\n` +
        `Blocked uploads: ${scans.filter(s => s.verdict === 'DANGEROUS').length}\n` +
        `${G.div}` +
        FOOTER;

    showMenu(call.message.chat.id, 'security', cap, backAdminKb(), call);
}

// ============================================================
// ADMIN MAINTENANCE
// ============================================================

async function renderAdminMaintenance(call) {
    if (!await isOwner(call.from.id)) {
        ack(call, 'Owner only');
        return;
    }

    const on = await getSetting('maintenance', false);

    const cap =
        `<b>${G.warn} Maintenance Mode</b>\n` +
        `${G.div_eq}\n` +
        `Status: ${on ? '✅ ON' : '❌ OFF'}\n` +
        `${G.div}\n` +
        `When enabled, only admins can use the bot.` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: on ? '🔄  Turn OFF' : '🔄  Turn ON', callback_data: 'adm_maint_toggle', style: on ? 'danger' : 'success' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, 'admin', cap, kb, call);
}

// ============================================================
// ADMIN SETTINGS
// ============================================================

async function renderAdminSettings(call) {
    if (!await adminOnlyCall(call, 'view_stats')) return;

    const on = await getSetting('maintenance', false);

    const cap =
        `<b>${G.settings} Settings</b>\n` +
        `${G.div_eq}\n` +
        `Brand: ${CONFIG.brand}\n` +
        `Announce Ch: ${CONFIG.announceChannel || '—'}\n` +
        `Maintenance: ${on ? 'ON' : 'OFF'}\n` +
        `${G.div}` +
        FOOTER;

    const kb = {
        inline_keyboard: [
            [{ text: '✏️  Brand Name', callback_data: 'adm_set_brand', style: 'primary' }],
            [{ text: '📢  Announce Ch', callback_data: 'adm_set_announce', style: 'primary' }],
            [{ text: '👑  Transfer Owner', callback_data: 'adm_set_owner', style: 'danger' }],
            [{ text: '🔧  Maintenance', callback_data: 'adm_maint', style: 'danger' }],
            [{ text: '🔄  Restart All Bots', callback_data: 'adm_set_restart_all', style: 'success' }],
            [{ text: '🔴  Stop All Bots', callback_data: 'adm_set_stop_all', style: 'danger' }],
            [{ text: '🧹  Clean Orphans', callback_data: 'adm_set_clean_orphans', style: 'primary' }],
            [{ text: '📤  Export Data', callback_data: 'adm_set_export', style: 'primary' }],
            [{ text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }],
        ]
    };

    showMenu(call.message.chat.id, 'admin', cap, kb, call);
}

// ============================================================
// ADMIN PENDING
// ============================================================

async function renderAdminPending(call) {
    if (!await adminOnlyCall(call, 'approve_payment')) return;

    const pending = await new Promise((resolve) => {
        db.all('SELECT * FROM bots WHERE approval_status = ?', ['pending'], (err, rows) => {
            resolve(rows || []);
        });
    });

    const cap =
        `<b>${G.eye} Pending Uploads (${pending.length})</b>\n` +
        `${G.div_eq}\n` +
        (pending.length ? pending.map(b => 
            `${G.bullet} <code>${b.id}</code> — ${esc(b.name)} ${G.bullet} uid ${b.owner}`
        ).join('\n') : `<i>No pending uploads</i>`) +
        `\n${G.div}` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    for (const b of pending) {
        kb.inline_keyboard.push([
            { text: `${G.ok}  Approve`, callback_data: `appr_ok_${b.id}`, style: 'success' },
            { text: `${G.no}  Reject`, callback_data: `appr_no_${b.id}`, style: 'danger' },
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, 'admin', cap, kb, call);
}

// ============================================================
// ADMIN PHOTOS
// ============================================================

async function renderAdminPhotos(call) {
    if (!await isOwner(call.from.id) && !(await adminCan(call.from.id, 'manage_admins'))) {
        ack(call, 'Owner / full-access only.');
        return;
    }

    const cap =
        `<b>${G.upload} Menu Photos</b>\n` +
        `${G.div_eq}\n` +
        `Tap a menu to replace its banner. Send a photo when prompted.` +
        FOOTER;

    const kb = { inline_keyboard: [] };
    for (const key of Object.keys(PHOTOS)) {
        kb.inline_keyboard.push([
            { text: `🖼️  ${key.charAt(0).toUpperCase() + key.slice(1)}`, callback_data: `adm_photo_${key}`, style: 'primary' }
        ]);
    }
    kb.inline_keyboard.push([
        { text: `${G.back}  Admin`, callback_data: 'menu_admin', style: 'primary' }
    ]);

    showMenu(call.message.chat.id, 'admin', cap, kb, call);
}

// ============================================================
// TEXT MESSAGE HANDLER (State flows)
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
            const fakeMsg = { ...msg, caption: text };
            return handlePaymentProof(fakeMsg, st);
        }

        // ---- Topup proof text ----
        if (flow === 'await_topup_proof') {
            const fakeMsg = { ...msg, caption: text };
            return handleTopupProof(fakeMsg);
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

        // ---- Admin coupon ----
        if (flow === 'await_coupon_admin') {
            if (!await isAdmin(uid)) { userStates.delete(uid); return; }
            const parts = text.split(/\s+/);
            if (parts.length < 2) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>add CODE PCT USES</code> or <code>del CODE</code>`, { parse_mode: 'HTML' });
                return;
            }
            const op = parts[0].toLowerCase();
            const code = parts[1].toUpperCase();

            if (op === 'add' && parts.length >= 4) {
                const pct = parseInt(parts[2]);
                const uses = parseInt(parts[3]);
                if (isNaN(pct) || isNaN(uses)) {
                    bot.sendMessage(msg.chat.id, `${G.no} Invalid numbers`);
                    return;
                }
                db.run(`INSERT OR REPLACE INTO coupons (code, percent, uses_left, max_uses, created_at) VALUES (?, ?, ?, ?, ?)`,
                    [code, pct, uses, uses, tsIso()]);
                audit(uid, 'coupon_add', `code=${code}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.ok} Coupon ${code} created`);
            } else if (op === 'del') {
                db.run('DELETE FROM coupons WHERE code = ?', [code]);
                audit(uid, 'coupon_del', `code=${code}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.ok} Coupon ${code} deleted`);
            } else {
                bot.sendMessage(msg.chat.id, `${G.no} Invalid command. Use add or del.`);
            }
            return;
        }

        // ---- Admin admins ----
        if (flow === 'await_admin_admins') {
            if (!await isOwner(uid)) { userStates.delete(uid); return; }
            const parts = text.split(/\s+/);
            if (parts.length < 3) {
                bot.sendMessage(msg.chat.id, `${G.no} Format: <code>add uid role</code> or <code>del uid</code>`, { parse_mode: 'HTML' });
                return;
            }
            const op = parts[0].toLowerCase();
            const targetUid = parseInt(parts[1]);

            if (op === 'add') {
                const role = parts[2];
                if (!['view-only', 'manage-users', 'full-access'].includes(role)) {
                    bot.sendMessage(msg.chat.id, `${G.no} Invalid role`);
                    return;
                }
                db.run(`INSERT OR REPLACE INTO admins (uid, role, added, by_uid) VALUES (?, ?, ?, ?)`,
                    [targetUid, role, tsIso(), uid]);
                audit(uid, 'admin_add', `uid=${targetUid} role=${role}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.ok} Admin ${targetUid} added with role ${role}`);
            } else if (op === 'del') {
                db.run('DELETE FROM admins WHERE uid = ?', [targetUid]);
                audit(uid, 'admin_del', `uid=${targetUid}`);
                userStates.delete(uid);
                bot.sendMessage(msg.chat.id, `${G.ok} Admin ${targetUid} removed`);
            } else {
                bot.sendMessage(msg.chat.id, `${G.no} Use add or del`);
            }
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
                { text: `${G.ok}  Approve`, callback_data: `payapprove_${pid}` },
                { text: `${G.no}  Reject`, callback_data: `payreject_${pid}` },
            ]
        ]
    };

    notifyOwner(
        `<b>${G.wallet} New Payment Proof</b>\n` +
        `ID: ${pid}\n` +
        `From: ${uid}\n` +
        `Method: ${method}\n` +
        `Plan: ${plan || '—'}\n` +
        `Amount: $${amount}`
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
                { text: `${G.ok}  Approve`, callback_data: `payapprove_${pid}` },
                { text: `${G.no}  Reject`, callback_data: `payreject_${pid}` },
            ]
        ]
    };

    notifyOwner(
        `<b>${G.wallet} Wallet Top-up</b>\n` +
        `ID: ${pid}\n` +
        `From: ${uid}\n` +
        `Amount: $${amount}`
    );

    try {
        bot.sendMessage(CONFIG.ownerId,
            `<b>Decide #${pid}</b>`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    } catch {}

    bot.sendMessage(msg.chat.id,
        `<b>${G.ok} Top-up proof received</b>`,
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
// APPROVAL SYSTEM
// ============================================================

async function approveBot(botId, adminUid) {
    const botDoc = await findBot(botId);
    if (!botDoc) return { ok: false, error: 'Bot not found.' };

    botDoc.approval_status = 'approved';
    botDoc.approval_reason = '';
    botDoc.status = 'stopped';
    await saveBot(botDoc);
    audit(adminUid, 'approve_bot', `bot=${botId}`);

    try {
        bot.sendMessage(botDoc.owner,
            `<b>${G.ok} Your bot was approved</b>\n` +
            `Bot: ${botDoc.name}\n` +
            `Starting it now…`,
            { parse_mode: 'HTML' }
        );
    } catch {}

    setTimeout(() => startChild(botDoc), 1000);
    return { ok: true };
}

async function rejectBot(botId, adminUid, reason = '') {
    const botDoc = await findBot(botId);
    if (!botDoc) return { ok: false, error: 'Bot not found.' };

    botDoc.approval_status = 'rejected';
    botDoc.approval_reason = reason || 'rejected by admin';
    botDoc.status = 'rejected';
    await saveBot(botDoc);

    rmrf(botDoc.dir);
    await deleteBotDoc(botId);

    audit(adminUid, 'reject_bot', `bot=${botId} reason=${reason}`);

    try {
        bot.sendMessage(botDoc.owner,
            `<b>${G.no} Your bot was rejected</b>\n` +
            `Bot: ${botDoc.name}\n` +
            `Reason: ${reason || 'No reason given'}`,
            { parse_mode: 'HTML' }
        );
    } catch {}

    return { ok: true };
}

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
