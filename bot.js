const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { exec, spawn, execSync } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');
const axios = require('axios');
const express = require('express');

// --- Configuration ---
const API_TOKEN = process.env.API_TOKEN || '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4';
const OWNER_ID = parseInt(process.env.OWNER_ID || '7158115683');
const CHANNEL_ID = "@PREMIUM_BOT_HOSTING_UPDATE";
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://p-h.up.railway.app';

// --- Storage Paths ---
const DEPLOY_DIR = path.join(__dirname, "deployed_bots");
const DB_FILE = path.join(__dirname, "users_data.json");
const SETTINGS_FILE = path.join(__dirname, "bot_settings.json");
const TICKETS_FILE = path.join(__dirname, "tickets.json");
const LOGS_FILE = path.join(__dirname, "logs.json");

if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// Initialize bot AFTER all configurations
const bot = new TelegramBot(API_TOKEN, { polling: true });

// --- Data Persistence ---
let users_db = load_db();
let settings = load_settings();
let tickets = load_tickets();
let logs = load_logs();
const running_processes = {};
const userSessions = {};

// --- Load/Save Functions ---
function save_db() {
    fs.writeFileSync(DB_FILE, JSON.stringify(users_db, null, 4), 'utf-8');
}

function load_db() {
    if (fs.existsSync(DB_FILE)) {
        try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { return {}; }
    }
    return {};
}

function save_settings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4), 'utf-8');
}

function load_settings() {
    const defaults = {
        "points_per_referral": 2,
        "hosting_cost": 4,
        "website_cost": 10,
        "maintenance": false,
        "welcome_video": null,
        "owner": OWNER_ID,
        "admins": [OWNER_ID],
        "assistants": [],
        "banned_users": [],
        "points_per_deploy": 1,
        "daily_reward": 2,
        "max_bots_per_user": 5,
        "announce_channel": CHANNEL_ID,
        "welcome_message": "Pʀᴇᴍɪᴜᴍ Bᴏᴛ Hᴏsᴛɪɴɢ Uʟᴛɪᴍᴀᴛᴇ Hᴏsᴛɪɴɢ Bᴏᴛ",
        "support_group": null
    };
    if (fs.existsSync(SETTINGS_FILE)) {
        try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch (e) { return defaults; }
    }
    return defaults;
}

function save_tickets() {
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 4), 'utf-8');
}

function load_tickets() {
    if (fs.existsSync(TICKETS_FILE)) {
        try { return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf-8')); } catch (e) { return {}; }
    }
    return {};
}

function save_logs() {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 4), 'utf-8');
}

function load_logs() {
    if (fs.existsSync(LOGS_FILE)) {
        try { return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8')); } catch (e) { return []; }
    }
    return [];
}

// --- Formatting ---
function formatText(text) {
    return `<blockquote>${text}</blockquote>`;
}

function logAction(action, user_id, details) {
    logs.push({
        timestamp: new Date().toISOString(),
        action: action,
        user_id: user_id,
        details: details
    });
    if (logs.length > 1000) logs.shift();
    save_logs();
}

// --- Check Permissions ---
function isAdmin(user_id) {
    return settings.admins.includes(user_id) || user_id === settings.owner;
}

function isAssistant(user_id) {
    return settings.assistants.includes(user_id) || isAdmin(user_id);
}

function isBanned(user_id) {
    return settings.banned_users.includes(user_id);
}

// --- Announcements ---
async function announceToChannel(message, parse_mode = 'HTML', extra = {}) {
    try {
        if (settings.announce_channel) {
            await bot.sendMessage(settings.announce_channel, message, { 
                parse_mode, 
                ...extra,
                disable_web_page_preview: true 
            });
            return true;
        }
    } catch (error) {
        console.error('❌ Channel announcement failed:', error.message);
        return false;
    }
}

function notifyAdmins(message, parse_mode = 'HTML', extra = {}) {
    const recipients = [...settings.admins, settings.owner];
    recipients.forEach(adminId => {
        if (adminId !== settings.owner) {
            bot.sendMessage(adminId, message, { parse_mode, ...extra })
                .catch(() => {});
        }
    });
}

// --- Run User File ---
function run_user_file(f_path, user_id, f_name) {
    const ext = path.extname(f_name).toLowerCase();
    let cmd, args;

    if (ext === '.py') {
        cmd = 'python3';
        args = [f_path];
    } else if (ext === '.js') {
        cmd = 'node';
        args = [f_path];
    } else if (ext === '.rb') {
        cmd = 'ruby';
        args = [f_path];
    } else {
        cmd = 'bash';
        args = [f_path];
    }

    try {
        const process = spawn(cmd, args, { 
            shell: true,
            env: { ...process.env, PORT: 3000 + Object.keys(running_processes).length }
        });
        const procId = `${f_path}_${Date.now()}`;
        running_processes[procId] = process;

        let errorMsg = "";
        let outputMsg = "";
        process.stderr.on('data', (data) => {
            errorMsg += data.toString();
            logAction('ERROR', user_id, `Bot ${f_name}: ${data.toString().substring(0, 100)}`);
        });
        process.stdout.on('data', (data) => {
            outputMsg += data.toString();
        });

        setTimeout(() => {
            if (process.exitCode !== null) {
                const log = errorMsg || "Exited with unknown error.";
                bot.sendMessage(user_id, formatText(`
⚠️ <b>ʀᴜɴᴛɪᴍᴇ ᴇʀʀᴏʀ!</b>

ғɪʟᴇ: <code>${f_name}</code>
ᴇʀʀᴏʀ:
<pre>${log.substring(0, 3000)}</pre>
                `), { parse_mode: 'HTML' });
                if (running_processes[procId]) delete running_processes[procId];
                logAction('CRASH', user_id, `Bot ${f_name} crashed`);
            }
        }, 5000);

        logAction('RUN', user_id, `Started ${f_name}`);
        return true;
    } catch (e) {
        bot.sendMessage(user_id, formatText(`❌ Error: ${e.message}`), { parse_mode: 'HTML' });
        return false;
    }
}

// --- Main Keyboard ---
function main_keyboard(user_id) {
    const isAdminUser = isAdmin(user_id);
    const isAssistantUser = isAssistant(user_id);
    const userData = users_db[user_id.toString()] || {};
    const points = userData.points || 0;
    
    const keyboard = [
        [{ text: "📢 Updates Channel" }],
        [{ text: "📤 Deploy Bot" }, { text: "🌐 Deploy Website" }],
        [{ text: "📂 My Files" }, { text: "🏠 My Websites" }],
        [{ text: `💰 Points: ${points}` }, { text: "🔗 Referral Link" }],
        [{ text: "📊 Statistics" }, { text: "📞 Contact Owner" }],
        [{ text: "🎫 Support Ticket" }, { text: "🎁 Daily Reward" }]
    ];
    
    if (isAdminUser || isAssistantUser) {
        keyboard.push([{ text: "👑 Admin Panel" }, { text: "🌍 All Files Control" }]);
    }
    
    return { keyboard: keyboard, resize_keyboard: true };
}

// --- Admin Panel Keyboard ---
function admin_keyboard() {
    const m_text = settings.maintenance ? "🔴 Maintenance: ON" : "🟢 Maintenance: OFF";
    const inline_keyboard = [
        [{ text: "➕ Add Points", callback_data: "adm_add_pts" },
        { text: "🌟 Add Points to All", callback_data: "adm_add_all_pts" }],
        [{ text: "📢 Broadcast", callback_data: "adm_broadcast" },
        { text: "👥 Manage Admins", callback_data: "adm_manage_admins" }],
        [{ text: "🛡 Manage Assistants", callback_data: "adm_manage_assistants" },
        { text: "🚫 Ban/Unban User", callback_data: "adm_ban_user" }],
        [{ text: "📋 Tickets", callback_data: "adm_view_tickets" },
        { text: "⚙️ Settings", callback_data: "adm_settings" }],
        [{ text: "📊 Statistics", callback_data: "adm_stats" },
        { text: "📜 Logs", callback_data: "adm_logs" }],
        [{ text: "🗑 Clear All Files", callback_data: "adm_clear_all" }],
        [{ text: "🎥 Set Welcome Video", callback_data: "adm_set_video" }]
    ];
    
    if (settings.welcome_video) {
        inline_keyboard.push([{ text: "❌ Remove Video", callback_data: "adm_del_video" }]);
    }
    
    inline_keyboard.push([{ text: m_text, callback_data: "adm_toggle_maint" }]);
    
    return { inline_keyboard: inline_keyboard };
}

// --- Settings Keyboard ---
function settings_keyboard() {
    return {
        inline_keyboard: [
            [{ text: `📦 Host Cost: ${settings.hosting_cost} pts`, callback_data: "adm_set_cost" }],
            [{ text: `🌐 Website Cost: ${settings.website_cost} pts`, callback_data: "adm_set_webcost" },
           { text: `🎯 Referral Bonus: ${settings.points_per_referral} pts`, callback_data: "adm_set_ref" }],
            [{ text: `🎁 Daily Reward: ${settings.daily_reward} pts`, callback_data: "adm_set_daily" },
            { text: `📦 Max Bots: ${settings.max_bots_per_user}`, callback_data: "adm_set_maxbots" }],
            [{ text: `📢 Announce Channel`, callback_data: "adm_set_channel" }],
            [{ text: "🔙 Back to Admin", callback_data: "adm_back" }]
        ]
    };
}

// --- Manage Users Keyboard ---
function manage_users_keyboard() {
    return {
        inline_keyboard: [
            [{ text: "➕ Add Admin", callback_data: "adm_add_admin" },
            { text: "➖ Remove Admin", callback_data: "adm_remove_admin" }],
            [{ text: "➕ Add Assistant", callback_data: "adm_add_assistant" },
            { text: "➖ Remove Assistant", callback_data: "adm_remove_assistant" }],
            [{ text: "👥 List All Admins", callback_data: "adm_list_admins" }],
            [{ text: "🔙 Back", callback_data: "adm_back" }]
        ]
    };
}

// --- Welcome Message ---
function get_welcome_text(msg) {
    const user = msg.from;
    const userData = users_db[user.id.toString()] || { points: 0 };
    const points = userData.points || 0;
    const status = settings.maintenance ? '🔴 MAINTENANCE' : '🟢 ONLINE';
    
    return formatText(`
⚜️<b>Pʀᴇᴍɪᴜᴍ Hᴏsᴛɪɴɢ Bᴏᴛ</b> ⚜️
<b>ᴜʟᴛɪᴍᴀᴛᴇ 24/7 ᴄʟᴏᴜᴅ sᴇʀᴠɪᴄᴇ</b>

👋 <b>ᴡᴇʟᴄᴏᴍᴇ:</b> ${user.first_name.toUpperCase()}

📤 <b>ᴅᴇᴘʟᴏʏ ᴀɴʏᴛʜɪɴɢ:</b>
• ʙᴏᴛs (ᴘʏᴛʜᴏɴ/ɴᴏᴅᴇ.ᴊs/ʀᴜʙʏ)
• ᴡᴇʙsɪᴛᴇs (ʜᴛᴍʟ/ʀᴇᴀᴄᴛ/ᴠᴜᴇ)
• ᴀᴜᴛᴏ ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs
• ᴠᴇʀᴄᴇʟ ɪɴᴛᴇɢʀᴀᴛɪᴏɴ

━━━━━━━━━━━━━━━━━━
🆔 <b>ɪᴅ:</b> <code>${user.id}</code>
💰 <b>ᴘᴏɪɴᴛs:</b> <code>${points}</code>
⚡ <b>sᴛᴀᴛᴜs:</b> ${status}
🏆 <b>ʀᴏʟᴇ:</b> ${isAdmin(user.id) ? '👑 Admin' : isAssistant(user.id) ? '🛡 Assistant' : '👤 User'}
━━━━━━━━━━━━━━━━━━

${settings.welcome_message}

👇 <b>ᴜsᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ!</b>
    `);
}

// --- Main Message Handler ---
bot.on('message', async (msg) => {
    const uid = msg.from.id;
    const uidStr = uid.toString();
    const text = msg.text;

    // Check if banned
    if (isBanned(uid)) {
        return bot.sendMessage(msg.chat.id, formatText('🚫 <b>ʏᴏᴜ ᴀʀᴇ ʙᴀɴɴᴇᴅ ғʀᴏᴍ ᴜsɪɴɢ ᴛʜɪs ʙᴏᴛ!</b>'), { parse_mode: 'HTML' });
    }

    // Handle sessions
    if (userSessions[uidStr]) {
        await handleSessionInput(msg);
        return;
    }

    if (!text) return;

    // /start command
    if (text.startsWith('/start')) {
        if (settings.maintenance && !isAdmin(uid)) {
            return bot.sendMessage(msg.chat.id, formatText('⚠️ <b>sʏsᴛᴇᴍ ɪs ᴜɴᴅᴇʀ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ.</b>'), { parse_mode: 'HTML' });
        }

        let is_new = !users_db[uidStr];
        if (is_new) {
            users_db[uidStr] = { 
                points: 10, 
                files: [], 
                websites: [],
                last_daily: null,
                join_date: new Date().toISOString()
            };
            
            // Handle referral
            const params = text.split(' ');
            if (params.length > 1) {
                const ref_id = params[1];
                if (users_db[ref_id] && ref_id !== uidStr) {
                    users_db[ref_id].points += settings.points_per_referral || 2;
                    bot.sendMessage(parseInt(ref_id), formatText(`
🎁 <b>ʀᴇғᴇʀʀᴀʟ ʙᴏɴᴜs!</b>

<blockquote>ᴜsᴇʀ <code>${uidStr}</code> ᴊᴏɪɴᴇᴅ!
+${settings.points_per_referral} ᴘᴏɪɴᴛs!</blockquote>
                    `), { parse_mode: 'HTML' }).catch(() => {});
                }
            }
            save_db();
            
            // --- NOTIFY ADMINS ---
            const notification = formatText(`
👤 <b>ɴᴇᴡ ᴜsᴇʀ ᴊᴏɪɴᴇᴅ!</b>

<blockquote>🆔 ɪᴅ: <code>${uid}</code>
👤 ᴜsᴇʀɴᴀᴍᴇ: @${msg.from.username || 'N/A'}
📛 ɴᴀᴍᴇ: ${msg.from.first_name} ${msg.from.last_name || ''}
⏰ ᴛɪᴍᴇ: ${new Date().toLocaleString()}
📊 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${Object.keys(users_db).length}</blockquote>
            `);
            
            notifyAdmins(notification);
            
            // Announce to channel
            await announceToChannel(`
📊 <b>ɴᴇᴡ ᴜsᴇʀ ʀᴇɢɪsᴛᴇʀᴇᴅ!</b>

<blockquote>ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${Object.keys(users_db).length}
ɴᴇᴡ: ${msg.from.first_name}</blockquote>
            `);
            
            logAction('JOIN', uid, 'New user registered');
        }

        const caption = get_welcome_text(msg);
        if (settings.welcome_video) {
            bot.sendVideo(msg.chat.id, settings.welcome_video, { 
                caption: caption, 
                parse_mode: 'HTML', 
                reply_markup: main_keyboard(uid) 
            }).catch(() => {
                bot.sendMessage(msg.chat.id, caption, { parse_mode: 'HTML', reply_markup: main_keyboard(uid) });
            });
        } else {
            bot.sendMessage(msg.chat.id, caption, { parse_mode: 'HTML', reply_markup: main_keyboard(uid) });
        }
        return;
    }

    // --- Menu Commands ---
    switch(text) {
        case "📢 Updates Channel": {
            const markup = { 
                inline_keyboard: [[{ text: "📢 JOIN CHANNEL", url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }]] 
            };
            bot.sendMessage(msg.chat.id, formatText('📢 <b>ᴊᴏɪɴ ᴏᴜʀ ᴜᴘᴅᴀᴛᴇ ɢʀᴏᴜᴘ ᴛᴏ ʀᴇᴄᴇɪᴠᴇ ᴅᴀɪʟʏ ᴜᴘᴅᴀᴛᴇ ᴏɴ ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛs</b>'), { 
                parse_mode: 'HTML', 
                reply_markup: markup 
            });
            break;
        }

        case "📤 Deploy Bot": {
            const userData = users_db[uidStr] || { points: 0 };
            if (userData.points < settings.hosting_cost) {
                return bot.sendMessage(msg.chat.id, formatText(`❌ ɴᴇᴇᴅ <b>${settings.hosting_cost}</b> ᴘᴏɪɴᴛs.`), { parse_mode: 'HTML' });
            }
            const fileCount = (userData.files || []).length;
            if (fileCount >= settings.max_bots_per_user) {
                return bot.sendMessage(msg.chat.id, formatText(`❌ ᴍᴀx <b>${settings.max_bots_per_user}</b> ʙᴏᴛs ᴘᴇʀ ᴜsᴇʀ.`), { parse_mode: 'HTML' });
            }
            userSessions[uidStr] = { step: 'AWAITING_DEPLOYMENT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
📤 <b>sᴇɴᴅ ʏᴏᴜʀ ʙᴏᴛ ғɪʟᴇ:</b>

<blockquote>sᴜᴘᴘᴏʀᴛᴇᴅ ғᴏʀᴍᴀᴛs:
• .ᴘʏ (ᴘʏᴛʜᴏɴ)
• .ᴊs (ɴᴏᴅᴇ.ᴊs)  
• .ʀʙ (ʀᴜʙʏ)
• .ɢᴏ (ɢᴏ)
• .sʜ (sʜᴇʟʟ)
• .ᴢɪᴘ (ᴘʀᴏᴊᴇᴄᴛ)

ᴀɴʏ ʙᴏᴛ ᴛʏᴘᴇ:
• ᴛᴇʟᴇɢʀᴀᴍ ʙᴏᴛs
• ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs
• ᴅɪsᴄᴏʀᴅ ʙᴏᴛs
• ᴄᴜsᴛᴏᴍ ʙᴏᴛs</blockquote>
            `), { parse_mode: 'HTML' });
            break;
        }

        case "🌐 Deploy Website": {
            const userData = users_db[uidStr] || { points: 0 };
            if (userData.points < settings.website_cost) {
                return bot.sendMessage(msg.chat.id, formatText(`❌ ɴᴇᴇᴅ <b>${settings.website_cost}</b> ᴘᴏɪɴᴛs.`), { parse_mode: 'HTML' });
            }
            userSessions[uidStr] = { step: 'AWAITING_WEBSITE_NAME' };
            bot.sendMessage(msg.chat.id, formatText(`
🌐 <b>ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ</b>

<blockquote>sᴇɴᴅ ᴀ ɴᴀᴍᴇ ғᴏʀ ʏᴏᴜʀ ᴡᴇʙsɪᴛᴇ:
(ᴇ.ɢ., ᴍʏ-sɪᴛᴇ, ᴘᴏʀᴛғᴏʟɪᴏ, ᴇᴛᴄ.)</blockquote>
            `), { parse_mode: 'HTML' });
            break;
        }

        case "📂 My Files": {
            const userData = users_db[uidStr] || { files: [] };
            const files = userData.files || [];
            if (files.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ <b>ɴᴏ ᴅᴇᴘʟᴏʏᴇᴅ ғɪʟᴇs.</b>'), { parse_mode: 'HTML' });
            }
            files.forEach((f_name) => {
                const f_path = path.normalize(path.join(DEPLOY_DIR, `${uid}_${f_name}`));
                const isRunning = Object.values(running_processes).some(p => p.spawnfile === f_path);
                const status = isRunning ? "🟢 Running" : "🔴 Stopped";

                const markup = {
                    inline_keyboard: [
                        [{ text: "▶️ RUN", callback_data: `run_${f_name}_${uid}` }, 
                         { text: "⏸ STOP", callback_data: `stop_${f_name}_${uid}` }],
                        [{ text: "📥 Download", callback_data: `down_${f_name}_${uid}` }, 
                         { text: "❌ DELETE", callback_data: `del_${f_name}_${uid}` }],
                        [{ text: "📋 Logs", callback_data: `logs_${f_name}_${uid}` }]
                    ]
                };
                bot.sendMessage(msg.chat.id, formatText(`
📄 <code>${f_name}</code>
Status: ${status}
                `), { reply_markup: markup, parse_mode: "HTML" });
            });
            break;
        }

        case "🏠 My Websites": {
            const userData = users_db[uidStr] || { websites: [] };
            const websites = userData.websites || [];
            if (websites.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ <b>ɴᴏ ᴅᴇᴘʟᴏʏᴇᴅ ᴡᴇʙsɪᴛᴇs.</b>'), { parse_mode: 'HTML' });
            }
            websites.forEach((site) => {
                const fullUrl = site.fullUrl || `${RAILWAY_URL}/${site.url}`;
                const markup = {
                    inline_keyboard: [
                        [{ text: "🌐 Open", url: fullUrl }],
                        [{ text: "❌ Delete", callback_data: `del_site_${site.id}_${uid}` }]
                    ]
                };
                bot.sendMessage(msg.chat.id, formatText(`
🌐 <b>${site.name}</b>
ᴜʀʟ: <a href="${fullUrl}">${fullUrl}</a>
ᴅᴇᴘʟᴏʏᴇᴅ: ${new Date(site.date).toLocaleDateString()}
sᴛᴀᴛᴜs: ${site.status || '🟢 Active'}
                `), { reply_markup: markup, parse_mode: "HTML" });
            });
            break;
        }

        case "💰 Points": {
            const userData = users_db[uidStr] || { points: 0 };
            const points = userData.points || 0;
            bot.sendMessage(msg.chat.id, formatText(`
💰 <b>ʏᴏᴜʀ ʙᴀʟᴀɴᴄᴇ</b>

<blockquote>💎 ᴘᴏɪɴᴛs: <b>${points}</b>
📦 ʙᴏᴛs: ${(userData.files || []).length}/${settings.max_bots_per_user}
🌐 ᴡᴇʙsɪᴛᴇs: ${(userData.websites || []).length}
🎁 ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ: ${settings.daily_reward} pts</blockquote>

Use /daily to claim daily reward!
            `), { parse_mode: "HTML" });
            break;
        }

        case "🔗 Referral Link": {
            const botInfo = await bot.getMe();
            const ref_link = `https://t.me/${botInfo.username}?start=${uid}`;
            const userData = users_db[uidStr] || {};
            const referrals = userData.referrals || 0;
            bot.sendMessage(msg.chat.id, formatText(`
🔗 <b>ʏᴏᴜʀ ʀᴇғᴇʀʀᴀʟ ʟɪɴᴋ:</b>

<code>${ref_link}</code>

<blockquote>🎯 ʙᴏɴᴜs: ${settings.points_per_referral} ᴘᴛs ᴘᴇʀ ʀᴇғᴇʀʀᴀʟ
👥 ᴛᴏᴛᴀʟ ʀᴇғᴇʀʀᴀʟs: ${referrals}</blockquote>

sʜᴀʀᴇ ᴛʜɪs ʟɪɴᴋ ᴀɴᴅ ᴇᴀʀɴ ᴘᴏɪɴᴛs! 🚀
            `), { parse_mode: 'HTML' });
            break;
        }

        case "📊 Statistics": {
            const totalUsers = Object.keys(users_db).length;
            const uploaders = Object.values(users_db).filter(u => u.files && u.files.length > 0).length;
            const activeBots = Object.values(running_processes).length;
            const totalWebsites = Object.values(users_db).reduce((acc, u) => acc + (u.websites?.length || 0), 0);
            const totalPoints = Object.values(users_db).reduce((acc, u) => acc + (u.points || 0), 0);
            
            bot.sendMessage(msg.chat.id, formatText(`
📊 <b>ɢʟᴏʙᴀʟ sᴛᴀᴛɪsᴛɪᴄs</b>

<blockquote>👥 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}
📤 ᴀᴄᴛɪᴠᴇ ᴜᴘʟᴏᴀᴅᴇʀs: ${uploaders}
🤖 ʙᴏᴛs ʀᴜɴɴɪɴɢ: ${activeBots}
🌐 ᴡᴇʙsɪᴛᴇs ᴅᴇᴘʟᴏʏᴇᴅ: ${totalWebsites}
💎 ᴛᴏᴛᴀʟ ᴘᴏɪɴᴛs: ${totalPoints}
👑 ᴀᴅᴍɪɴs: ${settings.admins.length}
🛡 ᴀssɪsᴛᴀɴᴛs: ${settings.assistants.length}</blockquote>

📈 sʏsᴛᴇᴍ ᴜᴘᴛɪᴍᴇ: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
            `), { parse_mode: 'HTML' });
            break;
        }

        case "📞 Contact Owner": {
            const markup = {
                inline_keyboard: [
                    [{ text: "📱 Contact Owner", url: "https://t.me/NEX_CONTACT_AGENT_BOT" }]
                ]
            };
            bot.sendMessage(msg.chat.id, formatText(`
📞 <b>ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ</b>

<blockquote>👤 ᴏᴡɴᴇʀ: @NEX_CONTACT_AGENT_BOT
📢 Channel: ${CHANNEL_ID}</blockquote>

ғᴏʀ ǫᴜɪᴄᴋ sᴜᴘᴘᴏʀᴛ, ᴄʀᴇᴀᴛᴇ ᴀ ᴛɪᴄᴋᴇᴛ ᴜsɪɴɢ ᴛʜᴇ sᴜᴘᴘᴏʀᴛ ᴛɪᴄᴋᴇᴛ ʙᴜᴛᴛᴏɴ!
            `), { parse_mode: 'HTML', reply_markup: markup });
            break;
        }

        case "🎫 Support Ticket": {
            userSessions[uidStr] = { step: 'AWAITING_TICKET_ISSUE' };
            bot.sendMessage(msg.chat.id, formatText(`
📝 <b>ᴄʀᴇᴀᴛᴇ sᴜᴘᴘᴏʀᴛ ᴛɪᴄᴋᴇᴛ</b>

<blockquote>ᴅᴇsᴄʀɪʙᴇ ʏᴏᴜʀ ɪssᴜᴇ ɪɴ ᴅᴇᴛᴀɪʟ:
• ᴡʜᴀᴛ's ɴᴏᴛ ᴡᴏʀᴋɪɴɢ?
• ᴡʜᴀᴛ ᴅɪᴅ ʏᴏᴜ ᴛʀʏ?
• ᴀɴʏ ᴇʀʀᴏʀ ᴍᴇssᴀɢᴇs?</blockquote>

ᴀᴅᴍɪɴs ᴡɪʟʟ ʀᴇsᴘᴏɴᴅ sʜᴏʀᴛʟʏ!
            `), { parse_mode: 'HTML' });
            break;
        }

        case "🎁 Daily Reward": {
            const userData = users_db[uidStr] || {};
            const lastDaily = userData.last_daily ? new Date(userData.last_daily) : null;
            const now = new Date();
            
            if (lastDaily && (now - lastDaily) < 24 * 60 * 60 * 1000) {
                const hoursLeft = Math.ceil(24 - (now - lastDaily) / (60 * 60 * 1000));
                return bot.sendMessage(msg.chat.id, formatText(`
⏰ <b>ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ ᴀʟʀᴇᴀᴅʏ ᴄʟᴀɪᴍᴇᴅ!</b>

<blockquote>ᴄᴏᴍᴇ ʙᴀᴄᴋ ɪɴ ${hoursLeft} ʜᴏᴜʀs!</blockquote>
                `), { parse_mode: 'HTML' });
            }
            
            users_db[uidStr].points = (users_db[uidStr].points || 0) + settings.daily_reward;
            users_db[uidStr].last_daily = now.toISOString();
            save_db();
            
            bot.sendMessage(msg.chat.id, formatText(`
🎁 <b>ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ ᴄʟᴀɪᴍᴇᴅ!</b>

<blockquote>💰 +${settings.daily_reward} ᴘᴏɪɴᴛs
💎 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ: ${users_db[uidStr].points} ᴘᴏɪɴᴛs</blockquote>

ᴄᴏᴍᴇ ʙᴀᴄᴋ ᴛᴏᴍᴏʀʀᴏᴡ ғᴏʀ ᴍᴏʀᴇ! 🌟
            `), { parse_mode: 'HTML' });
            break;
        }

        case "👑 Admin Panel": {
            if (isAdmin(uid) || isAssistant(uid)) {
                bot.sendMessage(msg.chat.id, formatText('🎛 <b>ᴀᴅᴍɪɴ ᴄᴏɴᴛʀᴏʟ ᴄᴇɴᴛᴇʀ</b>'), { 
                    parse_mode: 'HTML', 
                    reply_markup: admin_keyboard() 
                });
                logAction('ADMIN_PANEL', uid, 'Opened admin panel');
            } else {
                bot.sendMessage(msg.chat.id, formatText('❌ <b>ᴀᴄᴄᴇss ᴅᴇɴɪᴇᴅ!</b>'), { parse_mode: 'HTML' });
            }
            break;
        }

        case "🌍 All Files Control": {
            if (isAdmin(uid) || isAssistant(uid)) {
                bot.sendMessage(msg.chat.id, formatText('🔍 <b>ɢʟᴏʙᴀʟ ғɪʟᴇ ᴄᴏɴᴛʀᴏʟ</b>'), { parse_mode: 'HTML' });
                Object.keys(users_db).forEach((target_uid) => {
                    const userData = users_db[target_uid] || {};
                    const files = userData.files || [];
                    files.forEach((f_name) => {
                        const f_path = path.normalize(path.join(DEPLOY_DIR, `${target_uid}_${f_name}`));
                        const isRunning = Object.values(running_processes).some(p => p.spawnfile === f_path);
                        const status = isRunning ? "🟢" : "🔴";

                        const markup = {
                            inline_keyboard: [
                                [{ text: "▶️ RUN", callback_data: `run_${f_name}_${target_uid}` }, 
                                 { text: "⏸ STOP", callback_data: `stop_${f_name}_${target_uid}` }],
                                [{ text: "📥 Download", callback_data: `down_${f_name}_${target_uid}` }, 
                                 { text: "🗑 DEL", callback_data: `del_${f_name}_${target_uid}` }]
                            ]
                        };
                        bot.sendMessage(msg.chat.id, formatText(`
👤 ᴜsᴇʀ: <code>${target_uid}</code>
📄 ғɪʟᴇ: <code>${f_name}</code> ${status}
                        `), { reply_markup: markup, parse_mode: 'HTML' });
                    });
                });
            }
            break;
        }

        default: {
            // Check for commands
            if (text.startsWith('/')) {
                if (text === '/daily') {
                    // Handle /daily command
                    const userData = users_db[uidStr] || {};
                    const lastDaily = userData.last_daily ? new Date(userData.last_daily) : null;
                    const now = new Date();
                    
                    if (lastDaily && (now - lastDaily) < 24 * 60 * 60 * 1000) {
                        const hoursLeft = Math.ceil(24 - (now - lastDaily) / (60 * 60 * 1000));
                        return bot.sendMessage(msg.chat.id, formatText(`
⏰ <b>ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ ᴀʟʀᴇᴀᴅʏ ᴄʟᴀɪᴍᴇᴅ!</b>

<blockquote>ᴄᴏᴍᴇ ʙᴀᴄᴋ ɪɴ ${hoursLeft} ʜᴏᴜʀs!</blockquote>
                        `), { parse_mode: 'HTML' });
                    }
                    
                    users_db[uidStr].points = (users_db[uidStr].points || 0) + settings.daily_reward;
                    users_db[uidStr].last_daily = now.toISOString();
                    save_db();
                    
                    bot.sendMessage(msg.chat.id, formatText(`
🎁 <b>ᴅᴀɪʟʏ Reward ᴄʟᴀɪᴍᴇᴅ!</b>

<blockquote>💰 +${settings.daily_reward} ᴘᴏɪɴᴛs
💎 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ: ${users_db[uidStr].points} points</blockquote>
                    `), { parse_mode: 'HTML' });
                } else if (text === '/points') {
                    const userData = users_db[uidStr] || { points: 0 };
                    bot.sendMessage(msg.chat.id, formatText(`💰 ʙᴀʟᴀɴᴄᴇ: <b>${userData.points || 0}</b> points`), { parse_mode: 'HTML' });
                } else if (text === '/help') {
                    bot.sendMessage(msg.chat.id, formatText(`
❓ <b>ʜᴇʟᴘ & ᴄᴏᴍᴍᴀɴᴅs</b>

<blockquote>/start - sᴛᴀʀᴛ ᴛʜᴇ ʙᴏᴛ
/daily - ᴄʟᴀɪᴍ ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ
/points - ᴄʜᴇᴄᴋ ᴘᴏɪɴᴛs
/help - sʜᴏᴡ ᴛʜɪs ʜᴇʟᴘ</blockquote>

ᴜsᴇ ᴛʜᴇ ʙᴜᴛᴛᴏɴs ғᴏʀ ᴍᴏʀᴇ ғᴇᴀᴛᴜʀᴇs!
                    `), { parse_mode: 'HTML' });
                } else {
                    bot.sendMessage(msg.chat.id, formatText('❌ <b>ᴜɴᴋɴᴏᴡɴ ᴄᴏᴍᴍᴀɴᴅ. ᴜsᴇ /start</b>'), { parse_mode: 'HTML' });
                }
            }
        }
    }
});

// --- Session Input Handler ---
async function handleSessionInput(message) {
    const uid = message.from.id.toString();
    const session = userSessions[uid];

    switch(session.step) {
        case 'AWAITING_DEPLOYMENT_FILE':
            if (!message.document) {
                bot.sendMessage(message.chat.id, formatText('❌ ɴᴏᴛ ᴀ ғɪʟᴇ. ᴄᴀɴᴄᴇʟᴇᴅ.'), { parse_mode: 'HTML' });
                delete userSessions[uid];
                return;
            }
            delete userSessions[uid];
            await process_upload(message);
            break;

        case 'AWAITING_WEBSITE_NAME':
            if (message.text) {
                session.siteName = message.text;
                session.step = 'AWAITING_WEBSITE_FILE';
                bot.sendMessage(message.chat.id, formatText(`
✅ ɴᴀᴍᴇ sᴇᴛ: <b>${message.text}</b>

<blockquote>ɴᴏᴡ sᴇɴᴅ ʏᴏᴜʀ ᴡᴇʙsɪᴛᴇ ғɪʟᴇs:
• ʜᴛᴍʟ/ᴄss/ᴊs ғɪʟᴇs
• ʀᴇᴀᴄᴛ/ᴠᴜᴇ ᴘʀᴏᴊᴇᴄᴛ
• ᴀɴʏ sᴛᴀᴛɪᴄ ᴡᴇʙsɪᴛᴇ
• ᴢɪᴘ ᴏғ ᴡᴇʙsɪᴛᴇ ғᴏʟᴅᴇʀ</blockquote>
                `), { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(message.chat.id, formatText('❌ ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴀ ᴠᴀʟɪᴅ ɴᴀᴍᴇ.'), { parse_mode: 'HTML' });
            }
            break;

        case 'AWAITING_WEBSITE_FILE':
            if (message.document) {
                const siteName = session.siteName || `site-${Date.now()}`;
                delete userSessions[uid];
                await processWebsiteUpload(message, siteName);
            } else {
                bot.sendMessage(message.chat.id, formatText('❌ ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴀ ғɪʟᴇ.'), { parse_mode: 'HTML' });
            }
            break;

        case 'AWAITING_BROADCAST':
            delete userSessions[uid];
            let count = 0;
            const msgText = message.text;
            Object.keys(users_db).forEach((u) => {
                bot.sendMessage(parseInt(u), formatText(`
📢 <b>ʙʀᴏᴀᴅᴄᴀsᴛ ᴍᴇssᴀɢᴇ</b>

${msgText}

<blockquote>📅 ${new Date().toLocaleString()}</blockquote>
                `), { parse_mode: 'HTML' })
                    .then(() => count++)
                    .catch(() => {});
            });
            setTimeout(() => {
                bot.sendMessage(message.chat.id, formatText(`✅ ʙʀᴏᴀᴅᴄᴀsᴛ sᴇɴᴛ ᴛᴏ ${count} ᴜsᴇʀs!`), { parse_mode: 'HTML' });
                logAction('BROADCAST', uid, `Sent broadcast to ${count} users`);
            }, 2000);
            break;

        case 'AWAITING_WELCOME_VIDEO':
            delete userSessions[uid];
            if (message.video) {
                settings.welcome_video = message.video.file_id;
                save_settings();
                bot.sendMessage(message.chat.id, formatText('✅ ᴡᴇʟᴄᴏᴍᴇ ᴠɪᴅᴇᴏ sᴇᴛ!'), { parse_mode: 'HTML' });
                logAction('SET_VIDEO', uid, 'Set welcome video');
            } else {
                bot.sendMessage(message.chat.id, formatText('❌ ɴᴏᴛ ᴀ ᴠɪᴅᴇᴏ.'), { parse_mode: 'HTML' });
            }
            break;

        case 'AWAITING_ADMIN_TARGET_ID':
            session.targetUser = message.text;
            session.step = 'AWAITING_ADMIN_POINTS';
            bot.sendMessage(message.chat.id, formatText('💰 <b>ʜᴏᴡ ᴍᴀɴʏ ᴘᴏɪɴᴛs?</b>'), { parse_mode: 'HTML' });
            break;

        case 'AWAITING_ADMIN_POINTS': {
            const target = session.targetUser;
            const ptsToAdd = parseInt(message.text);
            delete userSessions[uid];

            if (isNaN(ptsToAdd) || ptsToAdd < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ.'), { parse_mode: 'HTML' });
            }

            if (users_db[target]) {
                users_db[target].points = (users_db[target].points || 0) + ptsToAdd;
                save_db();
                bot.sendMessage(message.chat.id, formatText(`✅ ᴀᴅᴅᴇᴅ ${ptsToAdd} ᴛᴏ ${target}`), { parse_mode: 'HTML' });
                bot.sendMessage(parseInt(target), formatText(`
🎉 <b>ᴘᴏɪɴᴛs ᴀᴅᴅᴇᴅ!</b>

<blockquote>💰 +${ptsToAdd} ᴘᴏɪɴᴛs
💎 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ: ${users_db[target].points}</blockquote>
                `), { parse_mode: 'HTML' }).catch(() => {});
                logAction('ADD_POINTS', uid, `Added ${ptsToAdd} to ${target}`);
            } else {
                bot.sendMessage(message.chat.id, formatText('❌ ᴜsᴇʀ ɴᴏᴛ ғᴏᴜɴᴅ.'), { parse_mode: 'HTML' });
            }
            break;
        }

        case 'AWAITING_ADD_ALL_POINTS': {
            const ptsAll = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(ptsAll) || ptsAll < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ Invalid number.'), { parse_mode: 'HTML' });
            }
            
            let userCount = 0;
            Object.keys(users_db).forEach((u) => {
                users_db[u].points = (users_db[u].points || 0) + ptsAll;
                userCount++;
                bot.sendMessage(parseInt(u), formatText(`
🌟 <b>ɢʟᴏʙᴀʟ ʙᴏɴᴜs!</b>

<blockquote>🎉 +${ptsAll} ᴘᴏɪɴᴛs ᴀᴅᴅᴇᴅ!
💰 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ.: ${users_db[u].points}</blockquote>
                `), { parse_mode: 'HTML' }).catch(() => {});
            });
            save_db();
            bot.sendMessage(message.chat.id, formatText(`✅ ᴀᴅᴅᴇᴅ ${ptsAll} ᴘᴏɪɴᴛs ᴛᴏ ${userCount} ᴜsᴇʀs!`), { parse_mode: 'HTML' });
            logAction('ADD_ALL', uid, `Added ${ptsAll} to ${userCount} users`);
            break;
        }

        case 'AWAITING_TICKET_ISSUE': {
            delete userSessions[uid];
            const ticketId = `T${Date.now().toString().slice(-8)}`;
            tickets[ticketId] = {
                user_id: parseInt(uid),
                username: message.from.username || 'N/A',
                issue: message.text,
                status: 'open',
                created_at: new Date().toISOString(),
                responses: []
            };
            save_tickets();
            
            // Notify all admins and assistants
            const recipients = [...settings.admins, ...settings.assistants, settings.owner];
            recipients.forEach(adminId => {
                const markup = {
                    inline_keyboard: [
                        [{ text: "📝 Reply", callback_data: `ticket_reply_${ticketId}` }],
                        [{ text: "✅ Close", callback_data: `ticket_close_${ticketId}` }]
                    ]
                };
                bot.sendMessage(adminId, formatText(`
🎫 <b>ɴᴇᴡ ᴛɪᴄᴋᴇᴛ!</b>

<blockquote>🆔 ᴛɪᴄᴋᴇᴛ: <code>${ticketId}</code>
👤 ᴜsᴇʀ: <code>${uid}</code>
👤 ᴜsᴇʀɴᴀᴍᴇ: @${message.from.username || 'N/A'}
📝 ɪssᴜᴇ: ${message.text}
⏰ ᴛɪᴍᴇ: ${new Date().toLocaleString()}</blockquote>
                `), { parse_mode: 'HTML', reply_markup: markup });
            });
            
            bot.sendMessage(message.chat.id, formatText(`
✅ <b>ᴛɪᴄᴋᴇᴛ ᴄʀᴇᴀᴛᴇᴅ!</b>

<blockquote>🆔 ᴛɪᴄᴋᴇᴛ: <code>${ticketId}</code>
📝 ɪssᴜᴇ: ${message.text}</blockquote>

ᴀᴅᴍɪɴs ʜᴀᴠᴇ ʙᴇᴇɴ ɴᴏᴛɪғɪᴇᴅ. ᴡᴇ'ʟʟ ʀᴇsᴘᴏɴᴅ sʜᴏʀᴛʟʏ!
            `), { parse_mode: 'HTML' });
            logAction('TICKET', uid, `Created ticket ${ticketId}`);
            break;
        }

        case 'AWAITING_ADMIN_MANAGE': {
            const action = session.action;
            const targetId = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(targetId)) {
                return bot.sendMessage(message.chat.id, formatText('❌ ɪɴᴠᴀʟɪᴅ ɪᴅ.'), { parse_mode: 'HTML' });
            }
            
            if (action === 'add_admin') {
                if (!settings.admins.includes(targetId)) {
                    settings.admins.push(targetId);
                    save_settings();
                    bot.sendMessage(message.chat.id, formatText(`✅ User ${targetId} is now admin!`), { parse_mode: 'HTML' });
                    bot.sendMessage(targetId, formatText(`
👑 <b>ʏᴏᴜ ᴀʀᴇ ɴᴏᴡ ᴀɴ ᴀᴅᴍɪɴ!</b>

<blockquote>ᴀᴄᴄᴇss ᴛʜᴇ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ ғʀᴏᴍ ᴛʜᴇ ᴍᴀɪɴ ᴍᴇɴᴜ!</blockquote>
                    `), { parse_mode: 'HTML' });
                    logAction('ADD_ADMIN', uid, `Added admin ${targetId}`);
                } else {
                    bot.sendMessage(message.chat.id, formatText(`❌ User ${targetId} is already admin.`), { parse_mode: 'HTML' });
                }
            } else if (action === 'remove_admin') {
                if (settings.admins.includes(targetId) && targetId !== settings.owner) {
                    settings.admins = settings.admins.filter(id => id !== targetId);
                    save_settings();
                    bot.sendMessage(message.chat.id, formatText(`✅ Removed admin ${targetId}`), { parse_mode: 'HTML' });
                    logAction('REMOVE_ADMIN', uid, `Removed admin ${targetId}`);
                } else {
                    bot.sendMessage(message.chat.id, formatText(`❌ Cannot remove this user.`), { parse_mode: 'HTML' });
                }
            } else if (action === 'add_assistant') {
                if (!settings.assistants.includes(targetId)) {
                    settings.assistants.push(targetId);
                    save_settings();
                    bot.sendMessage(message.chat.id, formatText(`✅ User ${targetId} is now assistant!`), { parse_mode: 'HTML' });
                    bot.sendMessage(targetId, formatText(`
🛡 <b>ʏᴏᴜ ᴀʀᴇ ɴᴏᴡ ᴀɴ ᴀssɪsᴛᴀɴᴛ!</b>

<blockquote>ʏᴏᴜ ᴄᴀɴ ᴀᴄᴄᴇss ʟɪᴍɪᴛᴇᴅ ᴀᴅᴍɪɴ ғᴇᴀᴛᴜʀᴇs!</blockquote>
                    `), { parse_mode: 'HTML' });
                    logAction('ADD_ASSISTANT', uid, `Added Assistant ${targetId}`);
                } else {
                    bot.sendMessage(message.chat.id, formatText(`❌ User ${targetId} is already assistant.`), { parse_mode: 'HTML' });
                }
            } else if (action === 'remove_assistant') {
                if (settings.assistants.includes(targetId)) {
                    settings.assistants = settings.assistants.filter(id => id !== targetId);
                    save_settings();
                    bot.sendMessage(message.chat.id, formatText(`✅ ʀᴇᴍᴏᴠᴇᴅ ᴀssɪsᴛᴀɴᴛ ${targetId}`), { parse_mode: 'HTML' });
                    logAction('REMOVE_ASSISTANT', uid, `Removed assistant ${targetId}`);
                } else {
                    bot.sendMessage(message.chat.id, formatText(`❌ User ${targetId} is not an assistant.`), { parse_mode: 'HTML' });
                }
            } else if (action === 'ban_user') {
                if (!settings.banned_users.includes(targetId)) {
                    settings.banned_users.push(targetId);
                    save_settings();
                    bot.sendMessage(message.chat.id, formatText(`🚫 User ${targetId} banned!`), { parse_mode: 'HTML' });
                    bot.sendMessage(targetId, formatText(`
🚫 <b> ʏᴏᴜ ʜᴀᴠᴇ ʙᴇᴇɴ ʙᴀɴɴᴇᴅ!</b>

<blockquote>ᴄᴏɴᴛᴀᴄᴛ @NEX_CONTACT_AGENT_BOT ғᴏʀ ᴀᴘᴘᴇᴀʟ.</blockquote>
                    `), { parse_mode: 'HTML' }).catch(() => {});
                    logAction('BAN_USER', uid, `Banned user ${targetId}`);
                } else {
                    bot.sendMessage(message.chat.id, formatText(`❌ ᴜsᴇʀ ${targetId} ɪs ᴀʟʀᴇᴀᴅʏ ʙᴀɴɴᴇᴅ.`), { parse_mode: 'HTML' });
                }
            } else if (action === 'unban_user') {
                if (settings.banned_users.includes(targetId)) {
                    settings.banned_users = settings.banned_users.filter(id => id !== targetId);
                    save_settings();
                    bot.sendMessage(message.chat.id, formatText(`✅ User ${targetId} unbanned!`), { parse_mode: 'HTML' });
                    bot.sendMessage(targetId, formatText(`
✅ <b>ʏᴏᴜ ʜᴀᴠᴇ ʙᴇᴇɴ ᴜɴʙᴀɴɴᴇᴅ!</b>

<blockquote>ᴡᴇʟᴄᴏᴍᴇ ʙᴀᴄᴋ! 🎉</blockquote>
                    `), { parse_mode: 'HTML' }).catch(() => {});
                    logAction('UNBAN_USER', uid, `Unbanned user ${targetId}`);
                } else {
                    bot.sendMessage(message.chat.id, formatText(`❌ ᴜsᴇʀ ${targetId} ɪs ɴᴏᴛ ʙᴀɴɴᴇᴅ.`), { parse_mode: 'HTML' });
                }
            }
            break;
        }

        case 'AWAITING_COST_CHANGE': {
            const cost = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(cost) || cost < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ.'), { parse_mode: 'HTML' });
            }
            
            settings.hosting_cost = cost;
            save_settings();
            bot.sendMessage(message.chat.id, formatText(`✅ ʜᴏsᴛɪɴɢ ᴄᴏsᴛ sᴇᴛ ᴛᴏ ${cost} points!`), { parse_mode: 'HTML' });
            logAction('SET_COST', uid, `Set hosting cost to ${cost}`);
            break;
        }

        case 'AWAITING_WEBSITE_COST': {
            const webCost = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(webCost) || webCost < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ.'), { parse_mode: 'HTML' });
            }
            
            settings.website_cost = webCost;
            save_settings();
            bot.sendMessage(message.chat.id, formatText(`✅ ᴡᴇʙsɪᴛᴇ ᴄᴏsᴛ sᴇᴛ ᴛᴏ ${webCost} ᴘᴏɪɴᴛs!`), { parse_mode: 'HTML' });
            logAction('SET_WEBSITE_COST', uid, `Set website cost to ${webCost}`);
            break;
        }

        case 'AWAITING_REF_BONUS': {
            const refBonus = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(refBonus) || refBonus < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ.'), { parse_mode: 'HTML' });
            }
            
            settings.points_per_referral = refBonus;
            save_settings();
            bot.sendMessage(message.chat.id, formatText(`✅ ʀᴇғᴇʀʀᴀʟ ʙᴏɴᴜs sᴇᴛ ᴛᴏ ${refBonus} ᴘᴏɪɴᴛs!`), { parse_mode: 'HTML' });
            logAction('SET_REF', uid, `Set referral bonus to ${refBonus}`);
            break;
        }

        case 'AWAITING_DAILY_REWARD': {
            const dailyReward = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(dailyReward) || dailyReward < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ ɪɴᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ.'), { parse_mode: 'HTML' });
            }
            
            settings.daily_reward = dailyReward;
            save_settings();
            bot.sendMessage(message.chat.id, formatText(`✅ ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ sᴇᴛ ᴛᴏ ${dailyReward} ᴘᴏɪɴᴛs!`), { parse_mode: 'HTML' });
            logAction('SET_DAILY', uid, `Set daily reward to ${dailyReward}`);
            break;
        }

        case 'AWAITING_MAX_BOTS': {
            const maxBots = parseInt(message.text);
            delete userSessions[uid];
            
            if (isNaN(maxBots) || maxBots < 0) {
                return bot.sendMessage(message.chat.id, formatText('❌ Invalid number.'), { parse_mode: 'HTML' });
            }
            
            settings.max_bots_per_user = maxBots;
            save_settings();
            bot.sendMessage(message.chat.id, formatText(`✅ ᴍᴀx ʙᴏᴛs ᴘᴇʀ ᴜsᴇʀ sᴇᴛ ᴛᴏ ${maxBots}!`), { parse_mode: 'HTML' });
            logAction('SET_MAXBOTS', uid, `Set max bots to ${maxBots}`);
            break;
        }

        case 'AWAITING_CHANNEL': {
            const channel = message.text;
            delete userSessions[uid];
            
            if (channel.startsWith('@')) {
                settings.announce_channel = channel;
                save_settings();
                bot.sendMessage(message.chat.id, formatText(`✅ ᴀɴɴᴏᴜɴᴄᴇ ᴄʜᴀɴɴᴇʟ sᴇᴛ ᴛᴏ ${channel}!`), { parse_mode: 'HTML' });
                logAction('SET_CHANNEL', uid, `Set channel to ${channel}`);
            } else {
                bot.sendMessage(message.chat.id, formatText(`❌ ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴀ ᴠᴀʟɪᴅ ᴄʜᴀɴɴᴇʟ (e.g., @channelname).`), { parse_mode: 'HTML' });
            }
            break;
        }

        case 'AWAITING_WELCOME_MSG': {
            const welcomeMsg = message.text;
            delete userSessions[uid];
            
            settings.welcome_message = welcomeMsg;
            save_settings();
            bot.sendMessage(message.chat.id, formatText(`✅ ᴡᴇʟᴄᴏᴍᴇ ᴍᴇssᴀɢᴇ ᴜᴘᴅᴀᴛᴇᴅ!`), { parse_mode: 'HTML' });
            logAction('SET_WELCOME', uid, 'Updated welcome message');
            break;
        }
    }
}

// --- Callback Query Handler ---
bot.on('callback_query', async (call) => {
    const uid = call.from.id;
    const data = call.data;
    const uidStr = uid.toString();

    // --- File Management ---
    if (data.includes("_") && !data.startsWith("adm_") && !data.startsWith("ticket_") && !data.startsWith("del_site")) {
        const parts = data.split("_");
        const action = parts[0];
        const target_uid = parts[parts.length - 1];
        const f_name = parts.slice(1, -1).join("_");
        const f_path = path.normalize(path.join(DEPLOY_DIR, `${target_uid}_${f_name}`));

        if (action === "stop") {
            for (const [procId, proc] of Object.entries(running_processes)) {
                if (proc.spawnfile === f_path) {
                    proc.kill('SIGTERM');
                    delete running_processes[procId];
                    bot.answerCallbackQuery(call.id, { text: "✅ Stopped" });
                    logAction('STOP', uid, `Stopped ${f_name}`);
                    break;
                }
            }
        } else if (action === "run") {
            if (fs.existsSync(f_path)) {
                if (run_user_file(f_path, parseInt(target_uid), f_name)) {
                    bot.answerCallbackQuery(call.id, { text: "✅ Running" });
                    logAction('RUN', uid, `Started ${f_name}`);
                }
            } else {
                bot.answerCallbackQuery(call.id, { text: "❌ File not found!" });
            }
        } else if (action === "down") {
            if (fs.existsSync(f_path)) {
                await bot.sendDocument(call.message.chat.id, f_path);
                bot.answerCallbackQuery(call.id, { text: "📥 Downloading..." });
                logAction('DOWNLOAD', uid, `Downloaded ${f_name}`);
            } else {
                bot.answerCallbackQuery(call.id, { text: "❌ File not found!" });
            }
        } else if (action === "del") {
            // Kill process if running
            for (const [procId, proc] of Object.entries(running_processes)) {
                if (proc.spawnfile === f_path) {
                    proc.kill('SIGTERM');
                    delete running_processes[procId];
                    break;
                }
            }
            
            // Delete the file/directory
            if (fs.existsSync(f_path)) {
                try {
                    if (fs.lstatSync(f_path).isDirectory()) {
                        fs.rmSync(f_path, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(f_path);
                    }
                } catch (err) {
                    console.error('Delete error:', err);
                }
            }
            
            // Remove from database
            if (users_db[target_uid] && users_db[target_uid].files) {
                users_db[target_uid].files = users_db[target_uid].files.filter(f => f !== f_name);
                save_db();
            }
            
            // Also check if it's a website directory
            Object.keys(users_db).forEach(userId => {
                if (users_db[userId] && users_db[userId].websites) {
                    users_db[userId].websites = users_db[userId].websites.filter(site => {
                        const sitePath = path.join(DEPLOY_DIR, `${userId}_website_${site.name}`);
                        if (sitePath === f_path || f_path.includes(site.name)) {
                            return false;
                        }
                        return true;
                    });
                    save_db();
                }
            });
            
            bot.deleteMessage(call.message.chat.id, call.message.message_id);
            bot.answerCallbackQuery(call.id, { text: "🗑 Deleted" });
            logAction('DELETE', uid, `Deleted ${f_name}`);
        } else if (action === "logs") {
            // Get logs for this bot
            const botLogs = logs.filter(l => l.details.includes(f_name) && l.user_id === parseInt(target_uid));
            if (botLogs.length === 0) {
                bot.answerCallbackQuery(call.id, { text: "No logs available" });
                return;
            }
            let logMsg = formatText(`📋 <b>Logs for ${f_name}</b>\n\n`);
            botLogs.slice(-20).forEach(log => {
                logMsg += `<blockquote>${new Date(log.timestamp).toLocaleString()}: ${log.action} - ${log.details}</blockquote>\n`;
            });
            bot.sendMessage(call.message.chat.id, logMsg, { parse_mode: 'HTML' });
        }
    }

    // --- Website Management ---
    if (data.startsWith("del_site_")) {
        const parts = data.split("_");
        const siteId = parts[2];
        const user_id = parts[3];
        
        if (users_db[user_id]?.websites) {
            const site = users_db[user_id].websites.find(s => s.id === siteId);
            if (site) {
                // Delete website directory
                const websiteDir = path.join(DEPLOY_DIR, `${user_id}_website_${site.name}`);
                if (fs.existsSync(websiteDir)) {
                    try {
                        fs.rmSync(websiteDir, { recursive: true, force: true });
                    } catch (err) {
                        console.error('Delete website error:', err);
                    }
                }
                
                // Remove from database
                users_db[user_id].websites = users_db[user_id].websites.filter(s => s.id !== siteId);
                save_db();
                
                bot.deleteMessage(call.message.chat.id, call.message.message_id);
                bot.answerCallbackQuery(call.id, { text: "🗑 Website deleted" });
                logAction('DELETE_SITE', uid, `Deleted website ${siteId}`);
            }
        }
    }

    // --- Ticket Management ---
    if (data.startsWith("ticket_")) {
        const parts = data.split("_");
        const action = parts[1];
        const ticketId = parts[2];
        
        if (action === "reply") {
            userSessions[uidStr] = { step: 'AWAITING_TICKET_REPLY', ticketId: ticketId };
            bot.sendMessage(call.message.chat.id, formatText(`📝 <b>Reply to ticket ${ticketId}</b>\n\nSend your reply:`), { parse_mode: 'HTML' });
            bot.answerCallbackQuery(call.id, { text: "Reply mode activated" });
        } else if (action === "close") {
            if (tickets[ticketId] && tickets[ticketId].status === 'open') {
                tickets[ticketId].status = 'closed';
                tickets[ticketId].closed_at = new Date().toISOString();
                save_tickets();
                
                bot.sendMessage(tickets[ticketId].user_id, formatText(`
✅ <b>ᴛɪᴄᴋᴇᴛ ᴄʟᴏsᴇᴅ</b>

<blockquote>🆔 ᴛɪᴄᴋᴇᴛ: ${ticketId}
ʏᴏᴜʀ ᴛɪᴄᴋᴇᴛ ʜᴀs ʙᴇᴇɴ ᴄʟᴏsᴇᴅ.</blockquote>
                `), { parse_mode: 'HTML' });
                
                bot.editMessageText(formatText(`✅ <b>ᴛɪᴄᴋᴇᴛ ᴄʟᴏsᴇᴅ</b>\n\nᴛɪᴄᴋᴇᴛ ${ticketId} ᴄʟᴏsᴇᴅ ʙʏ ᴀᴅᴍɪɴ.`), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML'
                });
                bot.answerCallbackQuery(call.id, { text: "✅ Ticket closed" });
                logAction('CLOSE_TICKET', uid, `Closed ticket ${ticketId}`);
            }
        }
    }

    // --- Admin Callbacks ---
    if (isAdmin(uid) || isAssistant(uid)) {
        switch(data) {
            case "adm_toggle_maint":
                settings.maintenance = !settings.maintenance;
                save_settings();
                bot.editMessageReplyMarkup(admin_keyboard(), { 
                    chat_id: call.message.chat.id, 
                    message_id: call.message.message_id 
                });
                bot.answerCallbackQuery(call.id, { 
                    text: settings.maintenance ? "🔴 Maintenance ON" : "🟢 Maintenance OFF" 
                });
                logAction('MAINTENANCE', uid, `Toggled maintenance to ${settings.maintenance}`);
                break;

            case "adm_settings":
                bot.editMessageText(formatText('⚙️ <b>ʙᴏᴛ sᴇᴛᴛɪɴɢs</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: settings_keyboard()
                });
                break;

            case "adm_set_cost":
                userSessions[uidStr] = { step: 'AWAITING_COST_CHANGE' };
                bot.sendMessage(call.message.chat.id, formatText('💰 ᴇɴᴛᴇʀ ɴᴇᴡ ʜᴏsᴛɪɴɢ ᴄᴏsᴛ:'), { parse_mode: 'HTML' });
                break;

            case "adm_set_webcost":
                userSessions[uidStr] = { step: 'AWAITING_WEBSITE_COST' };
                bot.sendMessage(call.message.chat.id, formatText('🌐 ᴇɴᴛᴇʀ ɴᴇᴡ ᴡᴇʙsɪᴛᴇ ᴄᴏsᴛ:'), { parse_mode: 'HTML' });
                break;

            case "adm_set_ref":
                userSessions[uidStr] = { step: 'AWAITING_REF_BONUS' };
                bot.sendMessage(call.message.chat.id, formatText('🎯 ᴇɴᴛᴇʀ ɴᴇᴡ ʀᴇғᴇʀʀᴀʟ ʙᴏɴᴜs:'), { parse_mode: 'HTML' });
                break;

            case "adm_set_daily":
                userSessions[uidStr] = { step: 'AWAITING_DAILY_REWARD' };
                bot.sendMessage(call.message.chat.id, formatText('🎁 ᴇɴᴛᴇʀ ɴᴇᴡ ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ:'), { parse_mode: 'HTML' });
                break;

            case "adm_set_maxbots":
                userSessions[uidStr] = { step: 'AWAITING_MAX_BOTS' };
                bot.sendMessage(call.message.chat.id, formatText('📦 ᴇɴᴛᴇʀ ᴍᴀx ʙᴏᴛs ᴘᴇʀ.ᴜsᴇʀ:'), { parse_mode: 'HTML' });
                break;

            case "adm_set_channel":
                userSessions[uidStr] = { step: 'AWAITING_CHANNEL' };
                bot.sendMessage(call.message.chat.id, formatText('📢 ᴇɴᴛᴇʀ ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛ ᴄʜᴀɴɴᴇʟ (e.g., @channel):'), { parse_mode: 'HTML' });
                break;

            case "adm_broadcast":
                userSessions[uidStr] = { step: 'AWAITING_BROADCAST' };
                bot.sendMessage(call.message.chat.id, formatText('📝 sᴇɴᴅ ʙʀᴏᴀᴅᴄᴀsᴛ ᴍᴇssᴀɢᴇ:'), { parse_mode: 'HTML' });
                break;

            case "adm_del_video":
                settings.welcome_video = null;
                save_settings();
                bot.answerCallbackQuery(call.id, { text: "✅ Video deleted" });
                bot.editMessageReplyMarkup(admin_keyboard(), { 
                    chat_id: call.message.chat.id, 
                    message_id: call.message.message_id 
                });
                logAction('DELETE_VIDEO', uid, 'Deleted welcome video');
                break;

            case "adm_set_video":
                userSessions[uidStr] = { step: 'AWAITING_WELCOME_VIDEO' };
                bot.sendMessage(call.message.chat.id, formatText('📹 sᴇɴᴅ ᴡᴇʟᴄᴏᴍᴇ ᴠɪᴅᴇᴏ:'), { parse_mode: 'HTML' });
                break;

            case "adm_add_pts":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_TARGET_ID' };
                bot.sendMessage(call.message.chat.id, formatText('👤 sᴇɴᴅ ᴜsᴇʀ ɪᴅ:'), { parse_mode: 'HTML' });
                break;

            case "adm_add_all_pts":
                userSessions[uidStr] = { step: 'AWAITING_ADD_ALL_POINTS' };
                bot.sendMessage(call.message.chat.id, formatText('🌟 ᴇɴᴛᴇʀ ᴘᴏɪɴᴛs ғᴏʀ ᴀʟʟ ᴜsᴇʀs:'), { parse_mode: 'HTML' });
                break;

            case "adm_manage_admins":
                bot.editMessageText(formatText('👥 <b>ᴜsᴇʀ ᴍᴀɴᴀɢᴇᴍᴇɴᴛ</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: manage_users_keyboard()
                });
                break;

            case "adm_manage_assistants":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'add_assistant' };
                bot.sendMessage(call.message.chat.id, formatText('🛡 Send ᴜsᴇʀ ɪᴅ ᴛᴏ ᴀᴅᴅ ᴀs ᴀssɪsᴛᴀɴᴛ:'), { parse_mode: 'HTML' });
                break;

            case "adm_ban_user":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'ban_user' };
                bot.sendMessage(call.message.chat.id, formatText('🚫 sᴇɴᴅ ᴜsᴇʀ ɪᴅ ᴛᴏ ʙᴀɴ:'), { parse_mode: 'HTML' });
                break;

            case "adm_add_admin":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'add_admin' };
                bot.sendMessage(call.message.chat.id, formatText('👑 sᴇɴᴅ ᴜsᴇʀ ɪᴅ ᴛᴏ ᴀᴅᴅ ᴀs ᴀᴅᴍɪɴ:'), { parse_mode: 'HTML' });
                break;

            case "adm_remove_admin":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'remove_admin' };
                bot.sendMessage(call.message.chat.id, formatText('👑 sᴇɴᴅ ᴜsᴇʀ ɪᴅ ᴛᴏ ʀᴇᴍᴏᴠᴇ ғʀᴏᴍ ᴀᴅᴍɪɴs:'), { parse_mode: 'HTML' });
                break;

            case "adm_remove_assistant":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'remove_assistant' };
                bot.sendMessage(call.message.chat.id, formatText('🛡 sᴇɴᴅ ᴜsᴇʀ ɪᴅ ᴛᴏ ʀᴇᴍᴏᴠᴇ ғʀᴏᴍ ᴀssɪsᴛᴀɴᴛs:'), { parse_mode: 'HTML' });
                break;

            case "adm_list_admins": {
                let msg = formatText('👥 <b>Admins & ᴀssɪsᴛᴀɴᴛs</b>\n\n');
                msg += `<b>👑 ᴏᴡɴᴇʀ:</b> <code>${settings.owner}</code>\n\n`;
                msg += `<b>👥 ᴀᴅᴍɪɴs:</b>\n`;
                settings.admins.forEach(id => {
                    msg += `  • <code>${id}</code>\n`;
                });
                msg += `\n<b>🛡 ᴀssɪsᴛᴀɴᴛs:</b>\n`;
                settings.assistants.forEach(id => {
                    msg += `  • <code>${id}</code>\n`;
                });
                msg += `\n<b>🚫 ʙᴀɴɴᴇᴅ ᴜsᴇʀs:</b>\n`;
                settings.banned_users.forEach(id => {
                    msg += `  • <code>${id}</code>\n`;
                });
                bot.sendMessage(call.message.chat.id, msg, { parse_mode: 'HTML' });
                break;
            }

            case "adm_clear_all": {
                // Clear all deployed files
                let deletedCount = 0;
                Object.keys(users_db).forEach(userId => {
                    const userData = users_db[userId];
                    if (userData.files) {
                        userData.files.forEach(f_name => {
                            const f_path = path.join(DEPLOY_DIR, `${userId}_${f_name}`);
                            if (fs.existsSync(f_path)) {
                                try {
                                    if (fs.lstatSync(f_path).isDirectory()) {
                                        fs.rmSync(f_path, { recursive: true, force: true });
                                    } else {
                                        fs.unlinkSync(f_path);
                                    }
                                    deletedCount++;
                                } catch (err) {
                                    console.error('Delete error:', err);
                                }
                            }
                        });
                        userData.files = [];
                    }
                    if (userData.websites) {
                        userData.websites.forEach(site => {
                            const websiteDir = path.join(DEPLOY_DIR, `${userId}_website_${site.name}`);
                            if (fs.existsSync(websiteDir)) {
                                try {
                                    fs.rmSync(websiteDir, { recursive: true, force: true });
                                    deletedCount++;
                                } catch (err) {
                                    console.error('Delete website error:', err);
                                }
                            }
                        });
                        userData.websites = [];
                    }
                });
                save_db();
                
                // Kill all running processes
                Object.keys(running_processes).forEach(procId => {
                    try {
                        running_processes[procId].kill('SIGTERM');
                        delete running_processes[procId];
                    } catch (err) {
                        console.error('Kill process error:', err);
                    }
                });
                
                bot.answerCallbackQuery(call.id, { text: `✅ Deleted ${deletedCount} files` });
                logAction('CLEAR_ALL', uid, `Cleared all files (${deletedCount} items)`);
                break;
            }

            case "adm_view_tickets": {
                const openTickets = Object.keys(tickets).filter(id => tickets[id].status === 'open');
                if (openTickets.length === 0) {
                    bot.answerCallbackQuery(call.id, { text: "No open tickets 📭" });
                    return;
                }
                let ticketMsg = formatText('📋 <b>ᴏᴘᴇɴ ᴛɪᴄᴋᴇᴛs</b>\n\n');
                openTickets.forEach(id => {
                    const ticket = tickets[id];
                    ticketMsg += `<blockquote>🆔 ${id}\n👤 ᴜsᴇʀ: <code>${ticket.user_id}</code>\n📝 ${ticket.issue.substring(0, 50)}${ticket.issue.length > 50 ? '...' : ''}\n⏰ ${new Date(ticket.created_at).toLocaleString()}</blockquote>\n`;
                });
                bot.sendMessage(call.message.chat.id, ticketMsg, { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id, { text: `📋 ${openTickets.length} tickets sent` });
                break;
            }

            case "adm_stats": {
                const memoryUsage = (1 - os.freemem() / os.totalmem()) * 100;
                const cpuCores = os.cpus().length;
                const uptime = process.uptime();
                const totalUsers = Object.keys(users_db).length;
                const activeBots = Object.values(running_processes).length;
                const totalPoints = Object.values(users_db).reduce((acc, u) => acc + (u.points || 0), 0);
                
                bot.sendMessage(call.message.chat.id, formatText(`
🖥 <b>sᴇʀᴠᴇʀ sᴛᴀᴛɪsᴛɪᴄs</b>

<blockquote>📊 ʀᴀᴍ ᴜsᴀɢᴇ: ${memoryUsage.toFixed(1)}%
💻 ᴄᴘᴜ ᴄᴏʀᴇs: ${cpuCores}
⏱ ᴜᴘᴛɪᴍᴇ: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m
📦 ᴘʟᴀᴛғᴏʀᴍ: ${os.platform()}
👥 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}
🤖 ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeBots}
💎 ᴛᴏᴛᴀʟ ᴘᴏɪɴᴛs: ${totalPoints}
👑 ᴀᴅᴍɪɴs: ${settings.admins.length}
🛡 ᴀssɪsᴛᴀɴᴛs: ${settings.assistants.length}
📋 ᴏᴘᴇɴ ᴛɪᴄᴋᴇᴛs: ${Object.keys(tickets).filter(id => tickets[id].status === 'open').length}</blockquote>
                `), { parse_mode: 'HTML' });
                break;
            }

            case "adm_logs": {
                const recentLogs = logs.slice(-20);
                let logMsg = formatText('📜 <b>ʀᴇᴄᴇɴᴛ ʟᴏɢs</b>\n\n');
                recentLogs.forEach(log => {
                    logMsg += `<pre>${new Date(log.timestamp).toLocaleString()}\n${log.action}: ${log.details}</pre>\n`;
                });
                bot.sendMessage(call.message.chat.id, logMsg, { parse_mode: 'HTML' });
                break;
            }

            case "adm_back":
                bot.editMessageText(formatText('🎛 <b>ᴀᴅᴍɪɴ ᴄᴏɴᴛʀᴏʟ ᴄᴇɴᴛᴇʀ</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: admin_keyboard()
                });
                break;
        }
    }
});

// --- Process Upload (Bot Deployment) ---
async function process_upload(message) {
    const f_name = message.document.file_name;
    const uid = message.from.id.toString();
    const f_path = path.normalize(path.join(DEPLOY_DIR, `${uid}_${f_name}`));

    const progressMsg = await bot.sendMessage(message.chat.id, formatText('⏳ <b>ᴅᴇᴘʟᴏʏɪɴɢ...</b>'), { parse_mode: 'HTML' });

    try {
        const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
        fs.renameSync(tempPath, f_path);

        // Handle ZIP files
        if (f_name.endsWith('.zip')) {
            const extractDir = path.join(DEPLOY_DIR, `${uid}_${f_name.replace('.zip', '')}`);
            const zip = new AdmZip(f_path);
            zip.extractAllTo(extractDir, true);
            fs.unlinkSync(f_path);
            
            // Detect and run the main file
            const files = fs.readdirSync(extractDir);
            const mainFile = files.find(f => f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.rb'));
            if (mainFile) {
                const mainPath = path.join(extractDir, mainFile);
                if (run_user_file(mainPath, parseInt(uid), mainFile)) {
                    users_db[uid].points -= settings.hosting_cost;
                    if (!users_db[uid].files) users_db[uid].files = [];
                    if (!users_db[uid].files.includes(mainFile)) {
                        users_db[uid].files.push(mainFile);
                    }
                    save_db();
                    await announceDeployment(uid, mainFile);
                    await bot.editMessageText(formatText(`
✅ <b>ᴅᴇᴘʟᴏʏᴍᴇɴᴛ sᴜᴄᴄᴇssғᴜʟ!</b>

<blockquote>📄 ғɪʟᴇ: <code>${mainFile}</code>
🟢 sᴛᴀᴛᴜs: ʀᴜɴɴɪɴɢ
💰 ᴄᴏsᴛ: ${settings.hosting_cost} ᴘᴏɪɴᴛs</blockquote>
                    `), { chat_id: message.chat.id, message_id: progressMsg.message_id, parse_mode: 'HTML' });
                }
            }
            return;
        }

        // Install dependencies for single file
        const content = fs.readFileSync(f_path, 'utf-8');
        const ext = path.extname(f_name).toLowerCase();
        
        if (ext === '.py') {
            const pyLibs = [...content.matchAll(/^(?:import|from)\s+([\w\d_]+)/gm)].map(m => m[1]);
            const uniqueLibs = [...new Set(pyLibs)].filter(l => !['os','sys','time','fs','path','subprocess','json','re','math','random','datetime'].includes(l));
            if (uniqueLibs.length > 0) {
                execSync(`pip install ${uniqueLibs.join(' ')}`, { stdio: 'inherit' });
            }
        } else if (ext === '.js') {
            const jsLibs = [...content.matchAll(/(?:require\(|from\s+)['"]([\w\d_-]+)['"]/g)].map(m => m[1]);
            const uniqueLibs = [...new Set(jsLibs)].filter(l => !['os','fs','path','child_process','http','https','url','util','crypto'].includes(l));
            if (uniqueLibs.length > 0) {
                execSync(`npm install ${uniqueLibs.join(' ')}`, { stdio: 'inherit' });
            }
        }

        if (run_user_file(f_path, parseInt(uid), f_name)) {
            users_db[uid].points -= settings.hosting_cost;
            if (!users_db[uid].files) users_db[uid].files = [];
            if (!users_db[uid].files.includes(f_name)) {
                users_db[uid].files.push(f_name);
            }
            save_db();
            
            await announceDeployment(uid, f_name);
            
            await bot.editMessageText(formatText(`
✅ <b>ᴅᴇᴘʟᴏʏᴍᴇɴᴛ sᴜᴄᴄᴇssғᴜʟ!</b>

<blockquote>📄 ғɪʟᴇ: <code>${f_name}</code>
🟢 sᴛᴀᴛᴜs: ʀᴜɴɴɪɴɢ
💰 ᴄᴏsᴛ: ${settings.hosting_cost} ᴘᴏɪɴᴛs</blockquote>
            `), { chat_id: message.chat.id, message_id: progressMsg.message_id, parse_mode: 'HTML' });
            
            logAction('DEPLOY', uid, `Deployed ${f_name}`);
        }
    } catch (err) {
        bot.editMessageText(formatText(`❌ Error: ${err.message}`), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        logAction('DEPLOY_ERROR', uid, `Failed to deploy: ${err.message}`);
    }
}

// --- Announce Deployment ---
async function announceDeployment(user_id, file_name) {
    const botInfo = await bot.getMe();
    const announcement = formatText(`
🚀 <b>ɴᴇᴡ ʙᴏᴛ ᴅᴇᴘʟᴏʏᴇᴅ!</b> 🚀

<blockquote>👤 ᴜsᴇʀ: <code>${user_id}</code>
🤖 ʙᴏᴛ: <code>${file_name}</code>
📦 ᴛʏᴘᴇ.: ${path.extname(file_name).toUpperCase()}
⏰ ᴛɪᴍᴇ: ${new Date().toLocaleString()}</blockquote>

🔥 <b>ᴅᴇᴘʟᴏʏ ʏᴏᴜʀ ᴏᴡɴ ʙᴏᴛ ɴᴏᴡ!</b>
    `);
    
    const markup = {
        inline_keyboard: [
            [{ text: "🚀 Deploy Now", url: `https://t.me/${botInfo.username}?start` }]
        ]
    };
    
    await announceToChannel(announcement, 'HTML', { reply_markup: markup });
}

// --- Process Website Upload ---
async function processWebsiteUpload(message, siteName) {
    const uid = message.from.id.toString();
    const file_name = message.document.file_name;
    const websiteDir = path.join(DEPLOY_DIR, `${uid}_website_${siteName}`);
    
    if (!fs.existsSync(websiteDir)) fs.mkdirSync(websiteDir, { recursive: true });

    const progressMsg = await bot.sendMessage(message.chat.id, formatText('⏳ <b>ᴅᴇᴘʟᴏʏɪɴɢ ᴡᴇʙsɪᴛᴇ...</b>'), { parse_mode: 'HTML' });

    try {
        const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
        
        if (file_name.endsWith('.zip')) {
            const zip = new AdmZip(tempPath);
            zip.extractAllTo(websiteDir, true);
            fs.unlinkSync(tempPath);
        } else {
            const destPath = path.join(websiteDir, file_name);
            fs.renameSync(tempPath, destPath);
            if (file_name.endsWith('.html') && !file_name.toLowerCase().includes('index')) {
                const newPath = path.join(websiteDir, 'index.html');
                fs.renameSync(destPath, newPath);
            }
        }

        // Generate the correct URL
        const subpath = `${uid}_website_${siteName}`;
        const fullUrl = `${RAILWAY_URL}/${subpath}`;
        
        // Save website info with correct URL
        if (!users_db[uid].websites) users_db[uid].websites = [];
        users_db[uid].websites.push({
            id: Date.now().toString(),
            name: siteName,
            url: subpath,
            fullUrl: fullUrl,
            date: new Date().toISOString(),
            status: '🟢 Active'
        });
        
        users_db[uid].points -= settings.website_cost;
        save_db();
        
        // Announce website deployment
        const announcement = formatText(`
🌐 <b>ɴᴇᴡ ᴡᴇʙsɪᴛᴇ ᴅᴇᴘʟᴏʏᴇᴅ!</b> 🌐

<blockquote>👤 ᴜsᴇʀ: <code>${uid}</code>
🌍 sɪᴛᴇ: ${siteName}
🔗 ᴜʀʟ: <a href="${fullUrl}">${fullUrl}</a>
⏰ ᴛɪᴍᴇ: ${new Date().toLocaleString()}</blockquote>
        `);
        
        await announceToChannel(announcement);
        
        await bot.editMessageText(formatText(`
✅ <b>ᴡᴇʙsɪᴛᴇ ᴅᴇᴘʟᴏʏᴇᴅ!</b>

<blockquote>🌐 ᴜʀʟ: <a href="${fullUrl}">${fullUrl}</a>
📦 ɴᴀᴍᴇ: ${siteName}
💰 ᴄᴏsᴛ: ${settings.website_cost} points</blockquote>
        `), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        
        logAction('WEBSITE', uid, `Deployed website ${siteName} at ${fullUrl}`);
    } catch (err) {
        bot.editMessageText(formatText(`❌ Error: ${err.message}`), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        logAction('WEBSITE_ERROR', uid, `Failed to deploy website: ${err.message}`);
    }
}

// --- Ticket Reply Handler ---
bot.on('message', async (msg) => {
    const uid = msg.from.id.toString();
    const session = userSessions[uid];
    
    if (session && session.step === 'AWAITING_TICKET_REPLY') {
        const ticketId = session.ticketId;
        delete userSessions[uid];
        
        if (tickets[ticketId] && tickets[ticketId].status === 'open') {
            tickets[ticketId].responses.push({
                admin_id: parseInt(uid),
                message: msg.text,
                timestamp: new Date().toISOString()
            });
            save_tickets();
            
            // Send to user
            bot.sendMessage(tickets[ticketId].user_id, formatText(`
📨 <b>ᴛɪᴄᴋᴇᴛ ʀᴇsᴘᴏɴsᴇ</b>

<blockquote>🆔 ᴛɪᴄᴋᴇᴛ: ${ticketId}
📝 ʀᴇᴘʟʏ: ${msg.text}
👤 ᴀᴅᴍɪɴ: <code>${uid}</code></blockquote>
            `), { parse_mode: 'HTML' });
            
            bot.sendMessage(msg.chat.id, formatText(`✅ ʀᴇᴘʟʏ sᴇɴᴛ ᴛᴏ ᴜsᴇʀ!`), { parse_mode: 'HTML' });
            logAction('TICKET_REPLY', uid, `Replied to ticket ${ticketId}`);
        } else {
            bot.sendMessage(msg.chat.id, formatText(`❌ ᴛɪᴄᴋᴇᴛ ɴᴏᴛ ғᴏᴜɴᴅ ᴏʀ ᴄʟᴏsᴇᴅ.`), { parse_mode: 'HTML' });
        }
    }
});

// --- Express Server for Railway ---
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from deployed websites
app.use(express.static(DEPLOY_DIR));

// Route for deployed websites - FIXED
app.get('/:userId_website_*', (req, res) => {
    // The full path after the first underscore
    const fullPath = req.params[0];
    const userId = req.params.userId;
    
    // Construct the actual directory path
    const websiteDir = path.join(DEPLOY_DIR, `${userId}_website_${fullPath}`);
    
    console.log(`Looking for website: ${websiteDir}`);
    
    if (fs.existsSync(websiteDir)) {
        // Check if index.html exists
        const indexPath = path.join(websiteDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            // If no index.html, serve the directory listing or first HTML file
            const files = fs.readdirSync(websiteDir);
            const htmlFile = files.find(f => f.endsWith('.html'));
            if (htmlFile) {
                res.sendFile(path.join(websiteDir, htmlFile));
            } else {
                res.sendFile(websiteDir);
            }
        }
    } else {
        res.status(404).send(`
            <h1>❌ Website Not Found</h1>
            <p>The website directory <code>${userId}_website_${fullPath}</code> does not exist.</p>
            <p>Available directories:</p>
            <ul>
                ${fs.readdirSync(DEPLOY_DIR).map(dir => `<li>${dir}</li>`).join('')}
            </ul>
        `);
    }
});

// Alternative route for simpler URLs
app.get('/site/:userId/:siteName', (req, res) => {
    const { userId, siteName } = req.params;
    const websiteDir = path.join(DEPLOY_DIR, `${userId}_website_${siteName}`);
    
    console.log(`Looking for website: ${websiteDir}`);
    
    if (fs.existsSync(websiteDir)) {
        const indexPath = path.join(websiteDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            const files = fs.readdirSync(websiteDir);
            const htmlFile = files.find(f => f.endsWith('.html'));
            if (htmlFile) {
                res.sendFile(path.join(websiteDir, htmlFile));
            } else {
                res.status(404).send('No HTML file found');
            }
        }
    } else {
        res.status(404).send('Website not found');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        users: Object.keys(users_db).length,
        bots: Object.keys(running_processes).length,
        deployed_files: fs.readdirSync(DEPLOY_DIR).length
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${port}`);
    console.log(`📡 Health check: ${RAILWAY_URL}/health`);
    console.log(`📁 Deploy directory: ${DEPLOY_DIR}`);
});

// --- Error Handlers ---
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    logAction('ERROR', 'SYSTEM', `Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    logAction('ERROR', 'SYSTEM', `Unhandled Rejection: ${reason}`);
});

// --- Startup ---
console.log("🤖 ⚡ ULTIMATE HOSTING BOT ONLINE!");
console.log(`👑 Owner: ${settings.owner}`);
console.log(`👥 Admins: ${settings.admins.length}`);
console.log(`🛡 Assistants: ${settings.assistants.length}`);
console.log(`📊 Total Users: ${Object.keys(users_db).length}`);
console.log(`📢 Announce Channel: ${settings.announce_channel}`);
console.log(`💰 Host Cost: ${settings.hosting_cost}`);
console.log(`🎁 Daily Reward: ${settings.daily_reward}`);
console.log(`🌐 Railway URL: ${RAILWAY_URL}`);
console.log(`📡 Port: ${port}`);