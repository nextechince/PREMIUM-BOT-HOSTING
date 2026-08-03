const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { exec, spawn, execSync } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

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
const GAME_STATE_FILE = path.join(__dirname, "game_state.json");
const WEBHOOKS_FILE = path.join(__dirname, "webhooks.json");

if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// Initialize bot
const bot = new TelegramBot(API_TOKEN, { polling: true });

// --- Data Persistence ---
let users_db = load_db();
let settings = load_settings();
let tickets = load_tickets();
let logs = load_logs();
let gameState = loadGameState();
let webhooks = loadWebhooks();
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
        "frozen_users": [],
        "resource_limits": {},
        "alert_rules": [],
        "slack_webhook": null,
        "github_repos": {},
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

function loadGameState() {
    if (fs.existsSync(GAME_STATE_FILE)) {
        try { return JSON.parse(fs.readFileSync(GAME_STATE_FILE, 'utf-8')); } 
        catch (e) { return { spins: {}, slots: {}, games: {}, riddles: {} }; }
    }
    return { spins: {}, slots: {}, games: {}, riddles: {} };
}

function saveGameState() {
    fs.writeFileSync(GAME_STATE_FILE, JSON.stringify(gameState, null, 4));
}

function loadWebhooks() {
    if (fs.existsSync(WEBHOOKS_FILE)) {
        try { return JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf-8')); } 
        catch (e) { return {}; }
    }
    return {};
}

function saveWebhooks() {
    fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 4));
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

function isFrozen(user_id) {
    return settings.frozen_users && settings.frozen_users.includes(user_id);
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
    } else if (ext === '.go') {
        cmd = 'go';
        args = ['run', f_path];
    } else {
        cmd = 'bash';
        args = [f_path];
    }

    if (!fs.existsSync(f_path)) {
        bot.sendMessage(user_id, formatText(`❌ File not found: ${f_name}`), { parse_mode: 'HTML' });
        return false;
    }

    try {
        const env = { 
            ...process.env, 
            PORT: 3000 + Math.floor(Math.random() * 1000),
            BOT_DIR: path.dirname(f_path),
            USER_ID: user_id.toString()
        };

        const process = spawn(cmd, args, { 
            shell: true,
            env: env,
            cwd: path.dirname(f_path)
        });

        const procId = `${path.basename(f_path)}_${Date.now()}`;
        
        running_processes[procId] = {
            process: process,
            spawnfile: f_path,
            userId: user_id,
            fileName: f_name,
            startTime: Date.now()
        };

        let errorMsg = "";

        process.stderr.on('data', (data) => {
            const error = data.toString();
            errorMsg += error;
            console.error(`[${f_name}] Error:`, error.substring(0, 200));
            logAction('ERROR', user_id, `Bot ${f_name}: ${error.substring(0, 100)}`);
        });

        process.on('exit', (code, signal) => {
            console.log(`[${f_name}] Process exited with code ${code}, signal ${signal}`);
            if (code !== 0 && code !== null) {
                bot.sendMessage(user_id, formatText(`
⚠️ <b>ʙᴏᴛ ᴄʀᴀsʜᴇᴅ!</b>

ғɪʟᴇ: <code>${f_name}</code>
ᴇʀʀᴏʀ:
<pre>${errorMsg.substring(0, 3000)}</pre>
                `), { parse_mode: 'HTML' }).catch(() => {});
                logAction('CRASH', user_id, `Bot ${f_name} crashed with code ${code}`);
            }
            delete running_processes[procId];
        });

        logAction('RUN', user_id, `Started ${f_name}`);
        return true;
    } catch (e) {
        bot.sendMessage(user_id, formatText(`❌ Error starting bot: ${e.message}`), { parse_mode: 'HTML' });
        return false;
    }
}

// --- MAIN KEYBOARD (2 Buttons Per Line - All User Commands) ---
function main_keyboard(user_id) {
    const isAdminUser = isAdmin(user_id);
    const isAssistantUser = isAssistant(user_id);
    const userData = users_db[user_id.toString()] || {};
    const points = userData.points || 0;
    
    const keyboard = [
        // Row 1: Updates & Help
        [{ text: "📢 Updates" }, { text: "ℹ️ Help" }],
        
        // Row 2: Deploy
        [{ text: "📤 Deploy Bot" }, { text: "🌐 Deploy Website" }],
        
        // Row 3: File Management
        [{ text: "📂 My Files" }, { text: "🏠 My Websites" }],
        
        // Row 4: Points & Referrals
        [{ text: `💰 Points: ${points}` }, { text: "🔗 Referral" }],
        
        // Row 5: Stats & Support
        [{ text: "📊 Statistics" }, { text: "📞 Support" }],
        
        // Row 6: Tickets & Rewards
        [{ text: "🎫 Ticket" }, { text: "🎁 Daily Reward" }],
        
        // Row 7: Games & Fun
        [{ text: "🎮 Games" }, { text: "😂 Meme" }],
        
        // Row 8: Advanced Features
        [{ text: "🔄 Convert" }, { text: "🔍 Analyze" }],
        [{ text: "🔧 AutoFix" }, { text: "🤖 AI Help" }],
        
        // Row 9: Bot Management
        [{ text: "📋 My Bots" }, { text: "⚡ Smart Deploy" }],
        [{ text: "🔐 Encrypt" }, { text: "🔓 Decrypt" }],
        
        // Row 10: Social & Sharing
        [{ text: "📤 Share" }, { text: "⭐ Rate" }],
        [{ text: "📝 Review" }, { text: "🏆 Leaderboard" }],
        
        // Row 11: Test & Simulate
        [{ text: "🧪 Test Bot" }, { text: "📊 Simulate" }],
        
        // Row 12: Admin Panel
        ...(isAdminUser || isAssistantUser ? [[{ text: "👑 Admin Panel" }, { text: "🌍 All Files" }]] : [])
    ];
    
    return { keyboard: keyboard, resize_keyboard: true };
}

// --- GAMES KEYBOARD (2 Buttons Per Line) ---
function games_keyboard() {
    return {
        inline_keyboard: [
            [{ text: "🎰 Spin Wheel", callback_data: "game_spin" }, 
             { text: "🎲 Slot Machine", callback_data: "game_slot" }],
            [{ text: "📝 Quiz", callback_data: "game_quiz" }, 
             { text: "🧩 Daily Riddle", callback_data: "game_riddle" }],
            [{ text: "📊 Game Stats", callback_data: "game_stats" }],
            [{ text: "🔙 Back", callback_data: "back_main" }]
        ]
    };
}

// --- ADMIN MAIN KEYBOARD (2 Buttons Per Line) ---
function admin_keyboard() {
    const m_text = settings.maintenance ? "🔴 Maintenance: ON" : "🟢 Maintenance: OFF";
    return {
        inline_keyboard: [
            // Row 1: User Management
            [{ text: "👥 Users", callback_data: "adm_users" },
             { text: "💰 Points", callback_data: "adm_add_pts" }],
            
            // Row 2: Admin Management
            [{ text: "👑 Admins", callback_data: "adm_manage_admins" },
             { text: "🛡 Assistants", callback_data: "adm_manage_assistants" }],
            
            // Row 3: Ban & Tickets
            [{ text: "🚫 Ban/Unban", callback_data: "adm_ban_user" },
             { text: "📋 Tickets", callback_data: "adm_view_tickets" }],
            
            // Row 4: Settings & Stats
            [{ text: "⚙️ Settings", callback_data: "adm_settings" },
             { text: "📊 Statistics", callback_data: "adm_stats" }],
            
            // Row 5: System & Backup
            [{ text: "🗑 Clear All", callback_data: "adm_clear_all" },
             { text: "💾 Backup", callback_data: "adm_backup" }],
            
            // Row 6: AI & Resources
            [{ text: "🧠 AI Optimize", callback_data: "adm_ai_optimize" },
             { text: "⚙️ Resources", callback_data: "adm_resources" }],
            
            // Row 7: Integrations
            [{ text: "🔗 GitHub", callback_data: "adm_github" },
             { text: "💬 Slack", callback_data: "adm_slack" }],
            
            // Row 8: Advanced
            [{ text: "🐳 Docker", callback_data: "adm_docker" },
             { text: "📡 Webhooks", callback_data: "adm_webhooks" }],
            
            // Row 9: Logs & Broadcast
            [{ text: "📜 Logs", callback_data: "adm_logs" },
             { text: "📢 Broadcast", callback_data: "adm_broadcast" }],
            
            // Row 10: Video & Maintenance
            [{ text: "🎥 Set Video", callback_data: "adm_set_video" },
             { text: m_text, callback_data: "adm_toggle_maint" }],
            
            // Row 11: Back
            [{ text: "🔙 Back", callback_data: "back_main" }]
        ]
    };
}

// --- ADMIN USER MANAGEMENT KEYBOARD (2 Buttons Per Line) ---
function admin_users_keyboard() {
    return {
        inline_keyboard: [
            [{ text: "👤 User Info", callback_data: "adm_user_info" },
             { text: "❄️ Freeze User", callback_data: "adm_freeze" }],
            [{ text: "👑 Demote Admin", callback_data: "adm_demote" },
             { text: "📤 Transfer Bot", callback_data: "adm_transfer" }],
            [{ text: "📊 User Stats", callback_data: "adm_user_stats" },
             { text: "📋 Activity", callback_data: "adm_activity" }],
            [{ text: "🔙 Back", callback_data: "adm_back" }]
        ]
    };
}

// --- ADMIN SETTINGS KEYBOARD (2 Buttons Per Line) ---
function settings_keyboard() {
    return {
        inline_keyboard: [
            [{ text: `📦 Host: ${settings.hosting_cost}pts`, callback_data: "adm_set_cost" },
             { text: `🌐 Web: ${settings.website_cost}pts`, callback_data: "adm_set_webcost" }],
            [{ text: `🎯 Referral: ${settings.points_per_referral}pts`, callback_data: "adm_set_ref" },
             { text: `🎁 Daily: ${settings.daily_reward}pts`, callback_data: "adm_set_daily" }],
            [{ text: `📦 Max Bots: ${settings.max_bots_per_user}`, callback_data: "adm_set_maxbots" },
             { text: `📢 Channel`, callback_data: "adm_set_channel" }],
            [{ text: `📝 Welcome Msg`, callback_data: "adm_set_welcome" }],
            [{ text: "🔙 Back", callback_data: "adm_back" }]
        ]
    };
}

// --- ADMIN RESOURCE KEYBOARD (2 Buttons Per Line) ---
function admin_resources_keyboard() {
    return {
        inline_keyboard: [
            [{ text: "💻 CPU Limit", callback_data: "adm_set_cpu" },
             { text: "🧠 Memory Limit", callback_data: "adm_set_memory" }],
            [{ text: "💾 Disk Limit", callback_data: "adm_set_disk" },
             { text: "📊 View Limits", callback_data: "adm_view_limits" }],
            [{ text: "🔙 Back", callback_data: "adm_back" }]
        ]
    };
}

// --- ADMIN INTEGRATION KEYBOARD (2 Buttons Per Line) ---
function admin_integration_keyboard() {
    return {
        inline_keyboard: [
            [{ text: "🔗 GitHub Connect", callback_data: "adm_github_connect" },
             { text: "🔄 GitHub Sync", callback_data: "adm_github_sync" }],
            [{ text: "💬 Slack Connect", callback_data: "adm_slack_connect" },
             { text: "📡 Webhooks", callback_data: "adm_webhook_manager" }],
            [{ text: "🔙 Back", callback_data: "adm_back" }]
        ]
    };
}

// --- ADVANCED FEATURES KEYBOARD (2 Buttons Per Line) ---
function advanced_keyboard() {
    return {
        inline_keyboard: [
            [{ text: "🔄 Convert", callback_data: "adv_convert" },
             { text: "🔍 Analyze", callback_data: "adv_analyze" }],
            [{ text: "🔧 AutoFix", callback_data: "adv_autofix" },
             { text: "🤖 AI Help", callback_data: "adv_ai" }],
            [{ text: "⚡ Smart Deploy", callback_data: "adv_smart_deploy" },
             { text: "📊 Predict", callback_data: "adv_predict" }],
            [{ text: "🔐 Encrypt", callback_data: "adv_encrypt" },
             { text: "🔓 Decrypt", callback_data: "adv_decrypt" }],
            [{ text: "📤 Share", callback_data: "adv_share" },
             { text: "⭐ Rate", callback_data: "adv_rate" }],
            [{ text: "🔙 Back", callback_data: "back_main" }]
        ]
    };
}

// --- BOT MANAGEMENT KEYBOARD (2 Buttons Per Line) ---
function bot_management_keyboard(user_id) {
    const userData = users_db[user_id.toString()] || {};
    const files = userData.files || [];
    const buttons = [];
    
    for (let i = 0; i < files.length; i += 2) {
        const row = [{ text: `🤖 ${files[i]}`, callback_data: `bot_info_${files[i]}` }];
        if (files[i + 1]) {
            row.push({ text: `🤖 ${files[i + 1]}`, callback_data: `bot_info_${files[i + 1]}` });
        }
        buttons.push(row);
    }
    
    buttons.push([{ text: "🔙 Back", callback_data: "back_main" }]);
    
    return { inline_keyboard: buttons };
}

// --- WELCOME MESSAGE ---
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

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    const uid = msg.from.id;
    const uidStr = uid.toString();
    const text = msg.text;

    // Check if banned
    if (isBanned(uid)) {
        return bot.sendMessage(msg.chat.id, formatText('🚫 <b>ʏᴏᴜ ᴀʀᴇ ʙᴀɴɴᴇᴅ ғʀᴏᴍ ᴜsɪɴɢ ᴛʜɪs ʙᴏᴛ!</b>'), { parse_mode: 'HTML' });
    }

    // Check if frozen
    if (isFrozen(uid) && !isAdmin(uid)) {
        return bot.sendMessage(msg.chat.id, formatText('❄️ <b>ʏᴏᴜʀ ᴀᴄᴄᴏᴜɴᴛ ɪs ғʀᴏᴢᴇɴ!</b>\n\nContact admin for assistance.'), { parse_mode: 'HTML' });
    }

    // Handle sessions
    if (userSessions[uidStr]) {
        await handleSessionInput(msg);
        return;
    }

    if (!text) return;

    // --- START COMMAND ---
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
            
            const notification = formatText(`
👤 <b>ɴᴇᴡ ᴜsᴇʀ ᴊᴏɪɴᴇᴅ!</b>

<blockquote>🆔 ɪᴅ: <code>${uid}</code>
👤 ᴜsᴇʀɴᴀᴍᴇ: @${msg.from.username || 'N/A'}
📛 ɴᴀᴍᴇ: ${msg.from.first_name} ${msg.from.last_name || ''}
⏰ ᴛɪᴍᴇ: ${new Date().toLocaleString()}
📊 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${Object.keys(users_db).length}</blockquote>
            `);
            
            notifyAdmins(notification);
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

    // --- MENU COMMANDS ---
    switch(text) {
        case "📢 Updates":
            const markup = { 
                inline_keyboard: [[{ text: "📢 JOIN CHANNEL", url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }]] 
            };
            bot.sendMessage(msg.chat.id, formatText('📢 <b>ᴊᴏɪɴ ᴏᴜʀ ᴜᴘᴅᴀᴛᴇ ᴄʜᴀɴɴᴇʟ</b>'), { 
                parse_mode: 'HTML', 
                reply_markup: markup 
            });
            break;

        case "ℹ️ Help":
            bot.sendMessage(msg.chat.id, formatText(`
❓ <b>Help & Commands</b>

<blockquote>📤 Deploy Bot - Deploy any bot file
🌐 Deploy Website - Deploy website
📂 My Files - View your bots
🏠 My Websites - View websites
💰 Points - Check balance
🔗 Referral - Get referral link
📊 Statistics - Global stats
📞 Support - Contact support
🎫 Ticket - Create support ticket
🎁 Daily Reward - Claim daily bonus
🎮 Games - Play games
😂 Meme - Generate meme
🔄 Convert - Convert code
🔍 Analyze - Analyze code
🔧 AutoFix - Auto-fix errors
🤖 AI Help - AI assistant
📋 My Bots - Manage bots
⚡ Smart Deploy - AI deployment
🔐 Encrypt - Encrypt files
🔓 Decrypt - Decrypt files
📤 Share - Share bot
⭐ Rate - Rate bot
📝 Review - Review bots
🏆 Leaderboard - Top users
🧪 Test Bot - Test deployment
📊 Simulate - Simulate traffic</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📤 Deploy Bot":
            const userDataDeploy = users_db[uidStr] || { points: 0 };
            if (userDataDeploy.points < settings.hosting_cost) {
                return bot.sendMessage(msg.chat.id, formatText(`❌ ɴᴇᴇᴅ <b>${settings.hosting_cost}</b> ᴘᴏɪɴᴛs.`), { parse_mode: 'HTML' });
            }
            const fileCount = (userDataDeploy.files || []).length;
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
• .ᴢɪᴘ (ᴘʀᴏᴊᴇᴄᴛ)</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🌐 Deploy Website":
            const userDataWeb = users_db[uidStr] || { points: 0 };
            if (userDataWeb.points < settings.website_cost) {
                return bot.sendMessage(msg.chat.id, formatText(`❌ ɴᴇᴇᴅ <b>${settings.website_cost}</b> ᴘᴏɪɴᴛs.`), { parse_mode: 'HTML' });
            }
            userSessions[uidStr] = { step: 'AWAITING_WEBSITE_NAME' };
            bot.sendMessage(msg.chat.id, formatText(`
🌐 <b>ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ</b>

<blockquote>sᴇɴᴅ ᴀ ɴᴀᴍᴇ ғᴏʀ ʏᴏᴜʀ ᴡᴇʙsɪᴛᴇ:
(ᴇ.ɢ., ᴍʏ-sɪᴛᴇ, ᴘᴏʀᴛғᴏʟɪᴏ, ᴇᴛᴄ.)</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📂 My Files":
            const userFiles = users_db[uidStr] || { files: [] };
            const files = userFiles.files || [];
            if (files.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ <b>ɴᴏ ᴅᴇᴘʟᴏʏᴇᴅ ғɪʟᴇs.</b>'), { parse_mode: 'HTML' });
            }
            files.forEach((f_name) => {
                const f_path = path.normalize(path.join(DEPLOY_DIR, `${uid}_${f_name}`));
                let isRunning = false;
                for (const [pid, proc] of Object.entries(running_processes)) {
                    if (proc.spawnfile === f_path || proc.fileName === f_name) {
                        isRunning = true;
                        break;
                    }
                }
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

        case "🏠 My Websites":
            const userWebsites = users_db[uidStr] || { websites: [] };
            const websites = userWebsites.websites || [];
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

        case "💰 Points":
            const userPoints = users_db[uidStr] || { points: 0 };
            bot.sendMessage(msg.chat.id, formatText(`
💰 <b>ʏᴏᴜʀ ʙᴀʟᴀɴᴄᴇ</b>

<blockquote>💎 ᴘᴏɪɴᴛs: <b>${userPoints.points || 0}</b>
📦 ʙᴏᴛs: ${(userPoints.files || []).length}/${settings.max_bots_per_user}
🌐 ᴡᴇʙsɪᴛᴇs: ${(userPoints.websites || []).length}
🎁 ᴅᴀɪʟʏ: ${settings.daily_reward} pts</blockquote>
            `), { parse_mode: "HTML" });
            break;

        case "🔗 Referral":
            const botInfo = await bot.getMe();
            const ref_link = `https://t.me/${botInfo.username}?start=${uid}`;
            bot.sendMessage(msg.chat.id, formatText(`
🔗 <b>ʏᴏᴜʀ ʀᴇғᴇʀʀᴀʟ ʟɪɴᴋ:</b>

<code>${ref_link}</code>

<blockquote>🎯 ʙᴏɴᴜs: ${settings.points_per_referral} ᴘᴛs ᴘᴇʀ ʀᴇғᴇʀʀᴀʟ</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📊 Statistics":
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
🌐 ᴡᴇʙsɪᴛᴇs: ${totalWebsites}
💎 ᴛᴏᴛᴀʟ ᴘᴏɪɴᴛs: ${totalPoints}</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📞 Support":
            const supportMarkup = {
                inline_keyboard: [
                    [{ text: "📱 Contact Owner", url: "https://t.me/NEX_CONTACT_AGENT_BOT" }]
                ]
            };
            bot.sendMessage(msg.chat.id, formatText(`
📞 <b>ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ</b>

<blockquote>👤 Owner: @NEX_CONTACT_AGENT_BOT
📢 Channel: ${CHANNEL_ID}</blockquote>
            `), { parse_mode: 'HTML', reply_markup: supportMarkup });
            break;

        case "🎫 Ticket":
            userSessions[uidStr] = { step: 'AWAITING_TICKET_ISSUE' };
            bot.sendMessage(msg.chat.id, formatText(`
📝 <b>ᴄʀᴇᴀᴛᴇ sᴜᴘᴘᴏʀᴛ ᴛɪᴄᴋᴇᴛ</b>

<blockquote>ᴅᴇsᴄʀɪʙᴇ ʏᴏᴜʀ ɪssᴜᴇ ɪɴ ᴅᴇᴛᴀɪʟ</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🎁 Daily Reward":
            const dailyUser = users_db[uidStr] || {};
            const lastDaily = dailyUser.last_daily ? new Date(dailyUser.last_daily) : null;
            const now = new Date();
            
            if (lastDaily && (now - lastDaily) < 24 * 60 * 60 * 1000) {
                const hoursLeft = Math.ceil(24 - (now - lastDaily) / (60 * 60 * 1000));
                return bot.sendMessage(msg.chat.id, formatText(`
⏰ <b>ʀᴇᴡᴀʀᴅ ᴀʟʀᴇᴀᴅʏ ᴄʟᴀɪᴍᴇᴅ!</b>

<blockquote>ᴄᴏᴍᴇ ʙᴀᴄᴋ ɪɴ ${hoursLeft} ʜᴏᴜʀs</blockquote>
                `), { parse_mode: 'HTML' });
            }
            
            users_db[uidStr].points = (users_db[uidStr].points || 0) + settings.daily_reward;
            users_db[uidStr].last_daily = now.toISOString();
            save_db();
            
            bot.sendMessage(msg.chat.id, formatText(`
🎁 <b>ᴅᴀɪʟʏ ʀᴇᴡᴀʀᴅ ᴄʟᴀɪᴍᴇᴅ!</b>

<blockquote>💰 +${settings.daily_reward} ᴘᴏɪɴᴛs
💎 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ: ${users_db[uidStr].points}</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🎮 Games":
            bot.sendMessage(msg.chat.id, formatText('🎮 <b>Games Center</b>\n\nChoose a game to play!'), { 
                parse_mode: 'HTML', 
                reply_markup: games_keyboard() 
            });
            break;

        case "😂 Meme":
            // Simple meme generator
            const memeTypes = [
                "doge", "drake", "disastergirl", "troll", "successkid", 
                "grumpycat", "pepe", "spiderman", "distractedboyfriend"
            ];
            const randomMeme = memeTypes[Math.floor(Math.random() * memeTypes.length)];
            const topText = encodeURIComponent("Me deploying bots");
            const bottomText = encodeURIComponent("It works!");
            const memeUrl = `https://api.memegen.link/images/${randomMeme}/${topText}/${bottomText}.jpg`;
            
            try {
                const response = await axios.get(memeUrl, { responseType: 'stream' });
                bot.sendPhoto(msg.chat.id, response.data, {
                    caption: formatText(`😂 <b>Meme</b>\n\nType: ${randomMeme}`),
                    parse_mode: 'HTML'
                });
            } catch (error) {
                bot.sendMessage(msg.chat.id, formatText(`😂 <b>Meme</b>\n\n${topText}\n${bottomText}`), { parse_mode: 'HTML' });
            }
            break;

        case "🔄 Convert":
            userSessions[uidStr] = { step: 'AWAITING_CONVERT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔄 <b>Code Converter</b>

<blockquote>Send the file to convert
Supported: Python ↔ JavaScript</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🔍 Analyze":
            // Analyze code
            const analyzeFiles = users_db[uidStr]?.files || [];
            if (analyzeFiles.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ No files to analyze'), { parse_mode: 'HTML' });
            }
            let analysis = '📊 <b>Code Analysis</b>\n\n';
            analyzeFiles.forEach(file => {
                const filePath = path.join(DEPLOY_DIR, `${uid}_${file}`);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const lines = content.split('\n').length;
                    const functions = (content.match(/function|def|async/g) || []).length;
                    analysis += `<blockquote>📄 ${file}\n📏 Lines: ${lines}\n📝 Functions: ${functions}</blockquote>\n`;
                }
            });
            bot.sendMessage(msg.chat.id, formatText(analysis), { parse_mode: 'HTML' });
            break;

        case "🔧 AutoFix":
            userSessions[uidStr] = { step: 'AWAITING_FIX_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔧 <b>Auto-Fix</b>

<blockquote>Send the file to fix common errors</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🤖 AI Help":
            userSessions[uidStr] = { step: 'AWAITING_AI_QUERY' };
            bot.sendMessage(msg.chat.id, formatText(`
🤖 <b>AI Assistant</b>

<blockquote>Send your question</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📋 My Bots":
            const botFiles = users_db[uidStr]?.files || [];
            if (botFiles.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ No bots deployed'), { parse_mode: 'HTML' });
            }
            bot.sendMessage(msg.chat.id, formatText('🤖 <b>Your Bots</b>'), { 
                parse_mode: 'HTML', 
                reply_markup: bot_management_keyboard(uid) 
            });
            break;

        case "⚡ Smart Deploy":
            userSessions[uidStr] = { step: 'AWAITING_SMART_DEPLOY' };
            bot.sendMessage(msg.chat.id, formatText(`
⚡ <b>Smart Deploy</b>

<blockquote>Send your bot file for AI-optimized deployment</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🔐 Encrypt":
            userSessions[uidStr] = { step: 'AWAITING_ENCRYPT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔐 <b>Encrypt File</b>

<blockquote>Send the file to encrypt</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🔓 Decrypt":
            userSessions[uidStr] = { step: 'AWAITING_DECRYPT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔓 <b>Decrypt File</b>

<blockquote>Send the .encrypted file</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📤 Share":
            const shareFiles = users_db[uidStr]?.files || [];
            if (shareFiles.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ No bots to share'), { parse_mode: 'HTML' });
            }
            const shareKeyboard = {
                inline_keyboard: shareFiles.map(file => [
                    { text: `📤 ${file}`, callback_data: `share_${file}` }
                ])
            };
            bot.sendMessage(msg.chat.id, formatText('📤 <b>Share Bot</b>\n\nSelect a bot to share'), { 
                parse_mode: 'HTML', 
                reply_markup: shareKeyboard 
            });
            break;

        case "⭐ Rate":
            bot.sendMessage(msg.chat.id, formatText(`
⭐ <b>Rate a Bot</b>

<blockquote>Usage: /rate bot_name rating (1-5)
Example: /rate mybot 5</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📝 Review":
            userSessions[uidStr] = { step: 'AWAITING_REVIEW' };
            bot.sendMessage(msg.chat.id, formatText(`
📝 <b>Write a Review</b>

<blockquote>Send your review in format:
Bot name: Your review (1-5 stars)</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "🏆 Leaderboard":
            const sorted = Object.entries(users_db)
                .sort((a, b) => (b[1].points || 0) - (a[1].points || 0))
                .slice(0, 10);
            
            let leaderMsg = '🏆 <b>TOP 10 USERS</b>\n\n';
            sorted.forEach(([userId, data], index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                leaderMsg += `${medal} <code>${userId}</code> - ${data.points} pts\n`;
            });
            
            bot.sendMessage(msg.chat.id, formatText(leaderMsg), { parse_mode: 'HTML' });
            break;

        case "🧪 Test Bot":
            userSessions[uidStr] = { step: 'AWAITING_TEST_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🧪 <b>Test Bot</b>

<blockquote>Send your bot file to test before deployment</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "📊 Simulate":
            userSessions[uidStr] = { step: 'AWAITING_SIMULATE' };
            bot.sendMessage(msg.chat.id, formatText(`
📊 <b>Simulate Traffic</b>

<blockquote>Send bot name and number of requests
Format: bot_name 100</blockquote>
            `), { parse_mode: 'HTML' });
            break;

        case "👑 Admin Panel":
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

        case "🌍 All Files":
            if (isAdmin(uid) || isAssistant(uid)) {
                bot.sendMessage(msg.chat.id, formatText('🔍 <b>ɢʟᴏʙᴀʟ ғɪʟᴇ ᴄᴏɴᴛʀᴏʟ</b>'), { parse_mode: 'HTML' });
                Object.keys(users_db).forEach((target_uid) => {
                    const userData = users_db[target_uid] || {};
                    const files = userData.files || [];
                    files.forEach((f_name) => {
                        const f_path = path.normalize(path.join(DEPLOY_DIR, `${target_uid}_${f_name}`));
                        let isRunning = false;
                        for (const [pid, proc] of Object.entries(running_processes)) {
                            if (proc.spawnfile === f_path || proc.fileName === f_name) {
                                isRunning = true;
                                break;
                            }
                        }
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

        default:
            // Handle unknown commands
            if (text.startsWith('/')) {
                bot.sendMessage(msg.chat.id, formatText('❌ <b>Unknown command. Use /start</b>'), { parse_mode: 'HTML' });
            }
            break;
    }
});

// --- SESSION INPUT HANDLER ---
async function handleSessionInput(message) {
    const uid = message.from.id.toString();
    const session = userSessions[uid];

    if (!session) return;

    switch(session.step) {
        case 'AWAITING_DEPLOYMENT_FILE':
            if (!message.document) {
                bot.sendMessage(message.chat.id, formatText('❌ Please send a file'), { parse_mode: 'HTML' });
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
✅ Name set: <b>${message.text}</b>

<blockquote>Now send your website files (ZIP or HTML)</blockquote>
                `), { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(message.chat.id, formatText('❌ Please send a valid name'), { parse_mode: 'HTML' });
            }
            break;

        case 'AWAITING_WEBSITE_FILE':
            if (message.document) {
                const siteName = session.siteName || `site-${Date.now()}`;
                delete userSessions[uid];
                await processWebsiteUpload(message, siteName);
            } else {
                bot.sendMessage(message.chat.id, formatText('❌ Please send a file'), { parse_mode: 'HTML' });
            }
            break;

        case 'AWAITING_TICKET_ISSUE':
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

<blockquote>🆔: ${ticketId}
👤: <code>${uid}</code>
📝: ${message.text}</blockquote>
                `), { parse_mode: 'HTML', reply_markup: markup });
            });
            
            bot.sendMessage(message.chat.id, formatText(`
✅ <b>ᴛɪᴄᴋᴇᴛ ᴄʀᴇᴀᴛᴇᴅ!</b>

<blockquote>🆔: ${ticketId}</blockquote>
            `), { parse_mode: 'HTML' });
            logAction('TICKET', uid, `Created ticket ${ticketId}`);
            break;

        case 'AWAITING_CONVERT_FILE':
            if (message.document) {
                delete userSessions[uid];
                const file_name = message.document.file_name;
                const file_path = path.join(DEPLOY_DIR, `${uid}_${file_name}`);
                const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
                const tempFileName = path.basename(tempPath);
                const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
                fs.renameSync(tempFilePath, file_path);
                
                // Simple conversion (Python to JS or JS to Python)
                const content = fs.readFileSync(file_path, 'utf-8');
                let converted = '';
                let newExt = '';
                
                if (file_name.endsWith('.py')) {
                    converted = content
                        .replace(/def\s+(\w+)\(([^)]*)\):/g, 'function $1($2) {')
                        .replace(/print\((.*?)\)/g, 'console.log($1)')
                        .replace(/if\s+(.*?):/g, 'if ($1) {')
                        .replace(/else:/g, '} else {')
                        .replace(/for\s+(\w+)\s+in\s+(.*?):/g, 'for (let $1 of $2) {');
                    newExt = '.js';
                } else if (file_name.endsWith('.js')) {
                    converted = content
                        .replace(/function\s+(\w+)\(([^)]*)\)\s*{/g, 'def $1($2):')
                        .replace(/console\.log\((.*?)\)/g, 'print($1)')
                        .replace(/if\s+\((.*?)\)\s*{/g, 'if $1:')
                        .replace(/} else\s*{/g, 'else:')
                        .replace(/for\s+\(let\s+(\w+)\s+of\s+(.*?)\)\s*{/g, 'for $1 in $2:')
                        .replace(/;/g, '');
                    newExt = '.py';
                } else {
                    return bot.sendMessage(message.chat.id, formatText('❌ Only Python or JavaScript files supported'), { parse_mode: 'HTML' });
                }
                
                const newFileName = file_name.replace(/\.[^.]+$/, '') + newExt;
                const newFilePath = path.join(DEPLOY_DIR, `${uid}_${newFileName}`);
                fs.writeFileSync(newFilePath, converted);
                
                bot.sendMessage(message.chat.id, formatText(`
✅ <b>Code Converted!</b>

<blockquote>📄 Original: ${file_name}
🔄 New: ${newFileName}</blockquote>
                `), { parse_mode: 'HTML' });
                logAction('CONVERT', uid, `Converted ${file_name} to ${newFileName}`);
            }
            break;

        case 'AWAITING_FIX_FILE':
            if (message.document) {
                delete userSessions[uid];
                const file_name = message.document.file_name;
                const file_path = path.join(DEPLOY_DIR, `${uid}_${file_name}`);
                const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
                const tempFileName = path.basename(tempPath);
                const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
                fs.renameSync(tempFilePath, file_path);
                
                const content = fs.readFileSync(file_path, 'utf-8');
                let fixed = content;
                let fixes = [];
                
                // Fix common issues
                if (file_name.endsWith('.py')) {
                    if (!content.includes('import os')) {
                        fixed = 'import os\n' + fixed;
                        fixes.push('Added missing os import');
                    }
                    if (!content.includes('import sys')) {
                        fixed = 'import sys\n' + fixed;
                        fixes.push('Added missing sys import');
                    }
                    if (content.includes('print ') && !content.includes('print(')) {
                        fixed = fixed.replace(/print\s+([^;]+);/g, 'print($1)');
                        fixes.push('Fixed print syntax');
                    }
                } else if (file_name.endsWith('.js')) {
                    if (!content.includes('const express')) {
                        fixed = 'const express = require("express");\n' + fixed;
                        fixes.push('Added express import');
                    }
                    if (!content.includes('const app')) {
                        fixed += '\nconst app = express();\napp.listen(3000);';
                        fixes.push('Added express boilerplate');
                    }
                }
                
                fs.writeFileSync(file_path, fixed);
                
                bot.sendMessage(message.chat.id, formatText(`
🔧 <b>Auto-Fix Complete!</b>

<blockquote>📄 File: ${file_name}
✅ Fixes applied: ${fixes.length}</blockquote>
${fixes.map(f => `• ${f}`).join('\n')}
                `), { parse_mode: 'HTML' });
                logAction('FIX', uid, `Fixed ${file_name}`);
            }
            break;

        case 'AWAITING_AI_QUERY':
            delete userSessions[uid];
            // Simple AI response
            const query = message.text.toLowerCase();
            let response = "I'm an AI assistant. Here are some tips:\n\n";
            
            if (query.includes('deploy') || query.includes('bot')) {
                response += "• Use /deploy to deploy your bot\n";
                response += "• Supported: Python, Node.js, Ruby, Go\n";
                response += "• You can also deploy ZIP projects\n";
            } else if (query.includes('points') || query.includes('point')) {
                response += "• Get points by: Daily rewards, Referrals, Deploying\n";
                response += "• Use /daily to claim daily bonus\n";
                response += "• Referral bonus: " + settings.points_per_referral + " points\n";
            } else if (query.includes('error') || query.includes('fix')) {
                response += "• Use /autofix to auto-fix common errors\n";
                response += "• Check logs with /logs command\n";
                response += "• Create a ticket for support\n";
            } else {
                response += "• /help - Show all commands\n";
                response += "• /start - Restart the bot\n";
                response += "• Create a ticket for support\n";
            }
            
            bot.sendMessage(message.chat.id, formatText(`
🤖 <b>AI Assistant</b>

${response}
            `), { parse_mode: 'HTML' });
            break;

        case 'AWAITING_SMART_DEPLOY':
            if (message.document) {
                delete userSessions[uid];
                // Smart deploy with optimization
                const file_name = message.document.file_name;
                const file_path = path.join(DEPLOY_DIR, `${uid}_${file_name}`);
                const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
                const tempFileName = path.basename(tempPath);
                const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
                fs.renameSync(tempFilePath, file_path);
                
                // Check if file has main/entry point
                const content = fs.readFileSync(file_path, 'utf-8');
                let hasMain = false;
                let suggestions = [];
                
                if (file_name.endsWith('.py')) {
                    hasMain = content.includes('if __name__ == "__main__"');
                    if (!hasMain) {
                        suggestions.push("Add if __name__ == '__main__' as entry point");
                    }
                    if (!content.includes('import os')) {
                        suggestions.push("Import os for better compatibility");
                    }
                } else if (file_name.endsWith('.js')) {
                    hasMain = content.includes('app.listen') || content.includes('module.exports');
                    if (!hasMain) {
                        suggestions.push("Add app.listen() or module.exports");
                    }
                }
                
                // Deploy with optimization
                if (run_user_file(file_path, parseInt(uid), file_name)) {
                    users_db[uid].points -= settings.hosting_cost;
                    if (!users_db[uid].files) users_db[uid].files = [];
                    if (!users_db[uid].files.includes(file_name)) {
                        users_db[uid].files.push(file_name);
                    }
                    save_db();
                    
                    bot.sendMessage(message.chat.id, formatText(`
⚡ <b>Smart Deploy Complete!</b>

<blockquote>📄 File: ${file_name}
🟢 Status: Running
💰 Cost: ${settings.hosting_cost} points</blockquote>

💡 <b>Optimization Suggestions:</b>
${suggestions.map(s => `• ${s}`).join('\n')}
                    `), { parse_mode: 'HTML' });
                    logAction('SMART_DEPLOY', uid, `Smart deployed ${file_name}`);
                }
            }
            break;

        case 'AWAITING_ENCRYPT_FILE':
            if (message.document) {
                delete userSessions[uid];
                const file_name = message.document.file_name;
                const file_path = path.join(DEPLOY_DIR, `${uid}_${file_name}`);
                const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
                const tempFileName = path.basename(tempPath);
                const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
                fs.renameSync(tempFilePath, file_path);
                
                const content = fs.readFileSync(file_path, 'utf-8');
                const password = 'default123'; // In production, get from user
                const encrypted = encryptText(content, password);
                const encryptedPath = file_path + '.encrypted';
                fs.writeFileSync(encryptedPath, encrypted);
                
                bot.sendMessage(message.chat.id, formatText(`
🔐 <b>File Encrypted!</b>

<blockquote>📄 File: ${file_name}
🔐 Output: ${file_name}.encrypted
🔑 Password: ${password}</blockquote>
                `), { parse_mode: 'HTML' });
                logAction('ENCRYPT', uid, `Encrypted ${file_name}`);
            }
            break;

        case 'AWAITING_DECRYPT_FILE':
            if (message.document) {
                delete userSessions[uid];
                const file_name = message.document.file_name;
                const file_path = path.join(DEPLOY_DIR, `${uid}_${file_name}`);
                const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
                const tempFileName = path.basename(tempPath);
                const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
                fs.renameSync(tempFilePath, file_path);
                
                try {
                    const encrypted = fs.readFileSync(file_path, 'utf-8');
                    const password = 'default123';
                    const decrypted = decryptText(encrypted, password);
                    const originalName = file_name.replace('.encrypted', '');
                    const decryptedPath = path.join(DEPLOY_DIR, `${uid}_${originalName}`);
                    fs.writeFileSync(decryptedPath, decrypted);
                    
                    bot.sendMessage(message.chat.id, formatText(`
🔓 <b>File Decrypted!</b>

<blockquote>🔐 File: ${file_name}
📄 Output: ${originalName}</blockquote>
                    `), { parse_mode: 'HTML' });
                    logAction('DECRYPT', uid, `Decrypted ${file_name}`);
                } catch (error) {
                    bot.sendMessage(message.chat.id, formatText(`❌ Decryption failed! Wrong password or corrupted file.`), { parse_mode: 'HTML' });
                }
            }
            break;

        case 'AWAITING_TEST_FILE':
            if (message.document) {
                delete userSessions[uid];
                const file_name = message.document.file_name;
                const file_path = path.join(DEPLOY_DIR, `${uid}_test_${file_name}`);
                const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
                const tempFileName = path.basename(tempPath);
                const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
                fs.renameSync(tempFilePath, file_path);
                
                // Test run with timeout
                const testResult = await new Promise((resolve) => {
                    const testProcess = spawn('node', [file_path]);
                    let output = '';
                    testProcess.stdout.on('data', (data) => {
                        output += data.toString();
                    });
                    testProcess.stderr.on('data', (data) => {
                        output += data.toString();
                    });
                    setTimeout(() => {
                        testProcess.kill('SIGTERM');
                        resolve({ output, status: 'completed' });
                    }, 5000);
                });
                
                bot.sendMessage(message.chat.id, formatText(`
🧪 <b>Test Complete!</b>

<blockquote>📄 File: ${file_name}
📊 Status: ${testResult.status}</blockquote>

<pre>${testResult.output.substring(0, 1000)}</pre>
                `), { parse_mode: 'HTML' });
                fs.unlinkSync(file_path);
            }
            break;

        case 'AWAITING_SIMULATE':
            if (message.text) {
                delete userSessions[uid];
                const parts = message.text.split(' ');
                if (parts.length < 2) {
                    return bot.sendMessage(message.chat.id, formatText('❌ Format: bot_name requests'), { parse_mode: 'HTML' });
                }
                const botName = parts[0];
                const requests = parseInt(parts[1]);
                
                if (isNaN(requests) || requests < 1) {
                    return bot.sendMessage(message.chat.id, formatText('❌ Invalid number of requests'), { parse_mode: 'HTML' });
                }
                
                // Simulate traffic
                let simulated = 0;
                let errors = 0;
                const startTime = Date.now();
                
                for (let i = 0; i < Math.min(requests, 100); i++) {
                    try {
                        // Simulate request
                        await new Promise(resolve => setTimeout(resolve, 50));
                        simulated++;
                    } catch (e) {
                        errors++;
                    }
                }
                
                const duration = Date.now() - startTime;
                
                bot.sendMessage(message.chat.id, formatText(`
📊 <b>Simulation Complete!</b>

<blockquote>🤖 Bot: ${botName}
📊 Requests: ${simulated}
❌ Errors: ${errors}
⏱ Duration: ${duration}ms
📈 Success Rate: ${((simulated / Math.min(requests, 100)) * 100).toFixed(1)}%</blockquote>
                `), { parse_mode: 'HTML' });
                logAction('SIMULATE', uid, `Simulated ${simulated} requests for ${botName}`);
            }
            break;

        case 'AWAITING_REVIEW':
            delete userSessions[uid];
            const reviewText = message.text;
            // Store review
            if (!settings.reviews) settings.reviews = {};
            const reviewId = `review_${Date.now()}`;
            settings.reviews[reviewId] = {
                user_id: parseInt(uid),
                username: message.from.username || 'N/A',
                review: reviewText,
                timestamp: new Date().toISOString()
            };
            save_settings();
            
            bot.sendMessage(message.chat.id, formatText(`
✅ <b>Review Submitted!</b>

<blockquote>📝 ${reviewText}</blockquote>
            `), { parse_mode: 'HTML' });
            logAction('REVIEW', uid, `Submitted review`);
            break;

        default:
            delete userSessions[uid];
            bot.sendMessage(message.chat.id, formatText('❌ Session expired. Please try again.'), { parse_mode: 'HTML' });
            break;
    }
}

// --- CALLBACK QUERY HANDLER ---
bot.on('callback_query', async (call) => {
    const uid = call.from.id;
    const data = call.data;
    const uidStr = uid.toString();

    // --- Back to Main ---
    if (data === "back_main") {
        bot.editMessageText(formatText('🔙 Back to Main Menu'), {
            chat_id: call.message.chat.id,
            message_id: call.message.message_id,
            parse_mode: 'HTML',
            reply_markup: main_keyboard(uid)
        });
        bot.answerCallbackQuery(call.id);
        return;
    }

    // --- Game Callbacks ---
    if (data === "game_spin") {
        bot.answerCallbackQuery(call.id, { text: "🎰 Use /spin to play!" });
    } else if (data === "game_slot") {
        bot.answerCallbackQuery(call.id, { text: "🎲 Use /slot to play!" });
    } else if (data === "game_quiz") {
        bot.answerCallbackQuery(call.id, { text: "📝 Use /quiz to play!" });
    } else if (data === "game_riddle") {
        bot.answerCallbackQuery(call.id, { text: "🧩 Use /daily_riddle to play!" });
    } else if (data === "game_stats") {
        const stats = gameState[uidStr] || { spins: 0, slots: 0, wins: 0 };
        bot.sendMessage(call.message.chat.id, formatText(`
📊 <b>Game Stats</b>

<blockquote>🎰 Spins: ${stats.spins || 0}
🎲 Slots: ${stats.slots || 0}
🏆 Wins: ${stats.wins || 0}</blockquote>
        `), { parse_mode: 'HTML' });
        bot.answerCallbackQuery(call.id);
    }

    // --- File Management Callbacks ---
    if (data.includes("_") && !data.startsWith("adm_") && !data.startsWith("ticket_") && !data.startsWith("del_site") && !data.startsWith("game_") && !data.startsWith("adv_") && !data.startsWith("bot_info_") && !data.startsWith("share_")) {
        const parts = data.split("_");
        const action = parts[0];
        const target_uid = parts[parts.length - 1];
        const f_name = parts.slice(1, -1).join("_");
        const f_path = path.normalize(path.join(DEPLOY_DIR, `${target_uid}_${f_name}`));

        if (action === "stop") {
            let stopped = false;
            for (const [procId, proc] of Object.entries(running_processes)) {
                if (proc.spawnfile === f_path || proc.fileName === f_name) {
                    if (proc.process && proc.process.kill) {
                        proc.process.kill('SIGTERM');
                    }
                    delete running_processes[procId];
                    stopped = true;
                    bot.answerCallbackQuery(call.id, { text: "✅ Stopped" });
                    logAction('STOP', uid, `Stopped ${f_name}`);
                    break;
                }
            }
            if (!stopped) {
                bot.answerCallbackQuery(call.id, { text: "⚠️ Not running" });
            }
        } else if (action === "run") {
            if (fs.existsSync(f_path)) {
                if (run_user_file(f_path, parseInt(target_uid), f_name)) {
                    bot.answerCallbackQuery(call.id, { text: "✅ Running" });
                    logAction('RUN', uid, `Started ${f_name}`);
                } else {
                    bot.answerCallbackQuery(call.id, { text: "❌ Failed to start" });
                }
            } else {
                bot.answerCallbackQuery(call.id, { text: "❌ File not found!" });
            }
        } else if (action === "down") {
            if (fs.existsSync(f_path)) {
                try {
                    const stats = fs.statSync(f_path);
                    if (stats.isDirectory()) {
                        const zipPath = `${f_path}.zip`;
                        const zip = new AdmZip();
                        zip.addLocalFolder(f_path);
                        zip.writeZip(zipPath);
                        await bot.sendDocument(call.message.chat.id, zipPath);
                        fs.unlinkSync(zipPath);
                    } else {
                        await bot.sendDocument(call.message.chat.id, f_path);
                    }
                    bot.answerCallbackQuery(call.id, { text: "📥 Downloading..." });
                    logAction('DOWNLOAD', uid, `Downloaded ${f_name}`);
                } catch (err) {
                    bot.answerCallbackQuery(call.id, { text: "❌ Download failed" });
                }
            } else {
                bot.answerCallbackQuery(call.id, { text: "❌ File not found!" });
            }
        } else if (action === "del") {
            // Kill process
            for (const [procId, proc] of Object.entries(running_processes)) {
                if (proc.spawnfile === f_path || proc.fileName === f_name) {
                    if (proc.process && proc.process.kill) {
                        proc.process.kill('SIGTERM');
                    }
                    delete running_processes[procId];
                    break;
                }
            }
            
            // Delete file
            if (fs.existsSync(f_path)) {
                try {
                    if (fs.lstatSync(f_path).isDirectory()) {
                        fs.rmSync(f_path, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(f_path);
                    }
                } catch (err) {}
            }
            
            // Remove from database
            if (users_db[target_uid] && users_db[target_uid].files) {
                users_db[target_uid].files = users_db[target_uid].files.filter(f => f !== f_name);
                save_db();
            }
            
            bot.deleteMessage(call.message.chat.id, call.message.message_id);
            bot.answerCallbackQuery(call.id, { text: "🗑 Deleted" });
            logAction('DELETE', uid, `Deleted ${f_name}`);
        } else if (action === "logs") {
            const botLogs = logs.filter(l => l.details.includes(f_name) && l.user_id === parseInt(target_uid));
            if (botLogs.length === 0) {
                bot.answerCallbackQuery(call.id, { text: "No logs available" });
                return;
            }
            let logMsg = formatText(`📋 <b>Logs for ${f_name}</b>\n\n`);
            botLogs.slice(-20).forEach(log => {
                logMsg += `<blockquote>${new Date(log.timestamp).toLocaleString()}: ${log.action}</blockquote>\n`;
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
                const websiteDir = path.join(DEPLOY_DIR, `${user_id}_website_${site.name}`);
                if (fs.existsSync(websiteDir)) {
                    try {
                        fs.rmSync(websiteDir, { recursive: true, force: true });
                    } catch (err) {}
                }
                
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
✅ <b>Ticket Closed</b>

<blockquote>🆔: ${ticketId}</blockquote>
                `), { parse_mode: 'HTML' });
                
                bot.editMessageText(formatText(`✅ <b>Ticket Closed</b>\n\nTicket ${ticketId} closed.`), {
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
            case "adm_back":
                bot.editMessageText(formatText('🎛 <b>ᴀᴅᴍɪɴ ᴄᴏɴᴛʀᴏʟ ᴄᴇɴᴛᴇʀ</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: admin_keyboard()
                });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_users":
                bot.editMessageText(formatText('👥 <b>User Management</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: admin_users_keyboard()
                });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_settings":
                bot.editMessageText(formatText('⚙️ <b>Bot Settings</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: settings_keyboard()
                });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_resources":
                bot.editMessageText(formatText('⚙️ <b>Resource Management</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: admin_resources_keyboard()
                });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_github":
            case "adm_slack":
            case "adm_webhooks":
                bot.editMessageText(formatText('🔗 <b>Integrations</b>'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: admin_integration_keyboard()
                });
                bot.answerCallbackQuery(call.id);
                break;

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

            case "adm_set_cost":
                userSessions[uidStr] = { step: 'AWAITING_COST_CHANGE' };
                bot.sendMessage(call.message.chat.id, formatText('💰 Enter new hosting cost:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_set_webcost":
                userSessions[uidStr] = { step: 'AWAITING_WEBSITE_COST' };
                bot.sendMessage(call.message.chat.id, formatText('🌐 Enter new website cost:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_set_ref":
                userSessions[uidStr] = { step: 'AWAITING_REF_BONUS' };
                bot.sendMessage(call.message.chat.id, formatText('🎯 Enter new referral bonus:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_set_daily":
                userSessions[uidStr] = { step: 'AWAITING_DAILY_REWARD' };
                bot.sendMessage(call.message.chat.id, formatText('🎁 Enter new daily reward:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_set_maxbots":
                userSessions[uidStr] = { step: 'AWAITING_MAX_BOTS' };
                bot.sendMessage(call.message.chat.id, formatText('📦 Enter max bots per user:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_set_channel":
                userSessions[uidStr] = { step: 'AWAITING_CHANNEL' };
                bot.sendMessage(call.message.chat.id, formatText('📢 Enter announcement channel (@channel):'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_set_welcome":
                userSessions[uidStr] = { step: 'AWAITING_WELCOME_MSG' };
                bot.sendMessage(call.message.chat.id, formatText('📝 Enter new welcome message:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_broadcast":
                userSessions[uidStr] = { step: 'AWAITING_BROADCAST' };
                bot.sendMessage(call.message.chat.id, formatText('📝 Send broadcast message:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_add_pts":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_TARGET_ID' };
                bot.sendMessage(call.message.chat.id, formatText('👤 Send user ID:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_add_all_pts":
                userSessions[uidStr] = { step: 'AWAITING_ADD_ALL_POINTS' };
                bot.sendMessage(call.message.chat.id, formatText('🌟 Enter points for all users:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_manage_admins":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'add_admin' };
                bot.sendMessage(call.message.chat.id, formatText('👑 Send user ID to add as admin:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_manage_assistants":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'add_assistant' };
                bot.sendMessage(call.message.chat.id, formatText('🛡 Send user ID to add as assistant:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_ban_user":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'ban_user' };
                bot.sendMessage(call.message.chat.id, formatText('🚫 Send user ID to ban:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_demote":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'demote_admin' };
                bot.sendMessage(call.message.chat.id, formatText('👑 Send user ID to demote from admin:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_freeze":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'freeze_user' };
                bot.sendMessage(call.message.chat.id, formatText('❄️ Send user ID to freeze:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_view_tickets": {
                const openTickets = Object.keys(tickets).filter(id => tickets[id].status === 'open');
                if (openTickets.length === 0) {
                    bot.answerCallbackQuery(call.id, { text: "No open tickets 📭" });
                    return;
                }
                let ticketMsg = formatText('📋 <b>Open Tickets</b>\n\n');
                openTickets.forEach(id => {
                    const ticket = tickets[id];
                    ticketMsg += `<blockquote>🆔 ${id}\n👤 ${ticket.user_id}\n📝 ${ticket.issue.substring(0, 50)}...</blockquote>\n`;
                });
                bot.sendMessage(call.message.chat.id, ticketMsg, { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id, { text: `📋 ${openTickets.length} tickets` });
                break;
            }

            case "adm_stats": {
                const memoryUsage = (1 - os.freemem() / os.totalmem()) * 100;
                const totalUsers = Object.keys(users_db).length;
                const activeBots = Object.values(running_processes).length;
                const totalPoints = Object.values(users_db).reduce((acc, u) => acc + (u.points || 0), 0);
                
                bot.sendMessage(call.message.chat.id, formatText(`
🖥 <b>Server Statistics</b>

<blockquote>📊 RAM: ${memoryUsage.toFixed(1)}%
👥 Users: ${totalUsers}
🤖 Active Bots: ${activeBots}
💎 Total Points: ${totalPoints}
👑 Admins: ${settings.admins.length}
🛡 Assistants: ${settings.assistants.length}</blockquote>
                `), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;
            }

            case "adm_logs": {
                const recentLogs = logs.slice(-20);
                let logMsg = formatText('📜 <b>Recent Logs</b>\n\n');
                recentLogs.forEach(log => {
                    logMsg += `<pre>${new Date(log.timestamp).toLocaleString()}\n${log.action}: ${log.details}</pre>\n`;
                });
                bot.sendMessage(call.message.chat.id, logMsg, { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;
            }

            case "adm_clear_all": {
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
                                } catch (err) {}
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
                                } catch (err) {}
                            }
                        });
                        userData.websites = [];
                    }
                });
                save_db();
                
                Object.keys(running_processes).forEach(procId => {
                    try {
                        if (running_processes[procId].process && running_processes[procId].process.kill) {
                            running_processes[procId].process.kill('SIGTERM');
                        }
                        delete running_processes[procId];
                    } catch (err) {}
                });
                
                bot.answerCallbackQuery(call.id, { text: `✅ Deleted ${deletedCount} files` });
                logAction('CLEAR_ALL', uid, `Cleared all files (${deletedCount} items)`);
                break;
            }

            case "adm_backup": {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupDir = path.join(__dirname, `backup_${timestamp}`);
                fs.mkdirSync(backupDir, { recursive: true });
                
                const files = [DB_FILE, SETTINGS_FILE, TICKETS_FILE, LOGS_FILE, GAME_STATE_FILE, WEBHOOKS_FILE];
                files.forEach(file => {
                    if (fs.existsSync(file)) {
                        fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
                    }
                });
                
                const zip = new AdmZip();
                zip.addLocalFolder(backupDir);
                const zipPath = path.join(__dirname, `backup_${timestamp}.zip`);
                zip.writeZip(zipPath);
                
                await bot.sendDocument(call.message.chat.id, zipPath);
                fs.rmSync(backupDir, { recursive: true, force: true });
                fs.unlinkSync(zipPath);
                bot.answerCallbackQuery(call.id, { text: "💾 Backup created!" });
                logAction('BACKUP', uid, 'Created system backup');
                break;
            }

            case "adm_ai_optimize": {
                let recommendations = [];
                Object.keys(users_db).forEach(userId => {
                    const files = users_db[userId].files || [];
                    files.forEach(file => {
                        const filePath = path.join(DEPLOY_DIR, `${userId}_${file}`);
                        if (fs.existsSync(filePath)) {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            if (file.endsWith('.js')) {
                                const vars = (content.match(/const\s+(\w+)/g) || []).length;
                                const used = (content.match(/\b(\w+)\b/g) || []).length;
                                if (vars > used / 2) {
                                    recommendations.push(`Remove unused variables in ${file}`);
                                }
                            }
                        }
                    });
                });
                
                let optMsg = '🧠 <b>AI Optimization Report</b>\n\n';
                if (recommendations.length === 0) {
                    optMsg += '✅ All bots are optimized! 🎉';
                } else {
                    recommendations.slice(0, 10).forEach((rec, i) => {
                        optMsg += `${i+1}. ${rec}\n`;
                    });
                }
                bot.sendMessage(call.message.chat.id, formatText(optMsg), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;
            }

            case "adm_set_video":
                userSessions[uidStr] = { step: 'AWAITING_WELCOME_VIDEO' };
                bot.sendMessage(call.message.chat.id, formatText('📹 Send welcome video:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_docker":
                bot.sendMessage(call.message.chat.id, formatText(`
🐳 <b>Docker Management</b>

<blockquote>Commands:
/docker list - List containers
/docker start name - Start
/docker stop name - Stop
/docker restart name - Restart
/docker logs name - View logs
/docker stats - Statistics</blockquote>
                `), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            default:
                bot.answerCallbackQuery(call.id);
                break;
        }
    }
});

// --- PROCESS UPLOAD ---
async function process_upload(message) {
    const f_name = message.document.file_name;
    const uid = message.from.id.toString();
    const f_path = path.normalize(path.join(DEPLOY_DIR, `${uid}_${f_name}`));

    const progressMsg = await bot.sendMessage(message.chat.id, formatText('⏳ <b>Deploying...</b>'), { parse_mode: 'HTML' });

    try {
        const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
        const tempFileName = path.basename(tempPath);
        const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
        fs.renameSync(tempFilePath, f_path);

        // Handle ZIP
        if (f_name.endsWith('.zip')) {
            const baseName = f_name.replace('.zip', '');
            const extractDir = path.join(DEPLOY_DIR, `${uid}_${baseName}`);
            if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
            
            const zip = new AdmZip(f_path);
            zip.extractAllTo(extractDir, true);
            fs.unlinkSync(f_path);
            
            const files = fs.readdirSync(extractDir);
            let mainFile = null;
            const priority = ['.js', '.py', '.rb', '.go', '.sh'];
            for (const ext of priority) {
                const found = files.find(f => f.endsWith(ext));
                if (found) {
                    mainFile = found;
                    break;
                }
            }
            
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
✅ <b>Deployment Successful!</b>

<blockquote>📄 File: ${mainFile}
🟢 Status: Running
💰 Cost: ${settings.hosting_cost} points</blockquote>
                    `), { chat_id: message.chat.id, message_id: progressMsg.message_id, parse_mode: 'HTML' });
                }
            }
            return;
        }

        // Single file
        if (run_user_file(f_path, parseInt(uid), f_name)) {
            users_db[uid].points -= settings.hosting_cost;
            if (!users_db[uid].files) users_db[uid].files = [];
            if (!users_db[uid].files.includes(f_name)) {
                users_db[uid].files.push(f_name);
            }
            save_db();
            await announceDeployment(uid, f_name);
            await bot.editMessageText(formatText(`
✅ <b>Deployment Successful!</b>

<blockquote>📄 File: ${f_name}
🟢 Status: Running
💰 Cost: ${settings.hosting_cost} points</blockquote>
            `), { chat_id: message.chat.id, message_id: progressMsg.message_id, parse_mode: 'HTML' });
            logAction('DEPLOY', uid, `Deployed ${f_name}`);
        }
    } catch (err) {
        console.error('Deployment error:', err);
        await bot.editMessageText(formatText(`❌ Error: ${err.message}`), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        logAction('DEPLOY_ERROR', uid, `Failed to deploy: ${err.message}`);
    }
}

// --- WEBSITE UPLOAD ---
async function processWebsiteUpload(message, siteName) {
    const uid = message.from.id.toString();
    const file_name = message.document.file_name;
    const websiteDir = path.join(DEPLOY_DIR, `${uid}_website_${siteName}`);
    
    if (!fs.existsSync(websiteDir)) fs.mkdirSync(websiteDir, { recursive: true });

    const progressMsg = await bot.sendMessage(message.chat.id, formatText('⏳ <b>Deploying website...</b>'), { parse_mode: 'HTML' });

    try {
        const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
        const tempFileName = path.basename(tempPath);
        const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
        
        if (file_name.endsWith('.zip')) {
            const zip = new AdmZip(tempFilePath);
            zip.extractAllTo(websiteDir, true);
            fs.unlinkSync(tempFilePath);
        } else {
            const destPath = path.join(websiteDir, file_name);
            fs.renameSync(tempFilePath, destPath);
            if (file_name.endsWith('.html') && !file_name.toLowerCase().includes('index')) {
                const newPath = path.join(websiteDir, 'index.html');
                fs.renameSync(destPath, newPath);
            }
        }

        const subpath = `${uid}_website_${siteName}`;
        const fullUrl = `${RAILWAY_URL}/${subpath}`;
        
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
        
        await bot.editMessageText(formatText(`
✅ <b>Website Deployed!</b>

<blockquote>🌐 URL: <a href="${fullUrl}">${fullUrl}</a>
📦 Name: ${siteName}
💰 Cost: ${settings.website_cost} points</blockquote>
        `), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        
        logAction('WEBSITE', uid, `Deployed website ${siteName}`);
    } catch (err) {
        console.error('Website deployment error:', err);
        await bot.editMessageText(formatText(`❌ Error: ${err.message}`), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        logAction('WEBSITE_ERROR', uid, `Failed to deploy website: ${err.message}`);
    }
}

// --- ANNOUNCE DEPLOYMENT ---
async function announceDeployment(user_id, file_name) {
    const botInfo = await bot.getMe();
    const announcement = formatText(`
🚀 <b>New Bot Deployed!</b> 🚀

<blockquote>👤 User: <code>${user_id}</code>
🤖 Bot: ${file_name}</blockquote>
    `);
    
    const markup = {
        inline_keyboard: [
            [{ text: "🚀 Deploy Now", url: `https://t.me/${botInfo.username}?start` }]
        ]
    };
    
    await announceToChannel(announcement, 'HTML', { reply_markup: markup });
}

// --- ENCRYPT/DECRYPT FUNCTIONS ---
function encryptText(text, password) {
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decryptText(encrypted, password) {
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(password, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// --- EXPRESS SERVER ---
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(DEPLOY_DIR));

app.get('/:userId_website_*', (req, res) => {
    const fullPath = req.params[0];
    const userId = req.params.userId;
    const websiteDir = path.join(DEPLOY_DIR, `${userId}_website_${fullPath}`);
    
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
                res.sendFile(websiteDir);
            }
        }
    } else {
        res.status(404).send('Website not found');
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        users: Object.keys(users_db).length,
        bots: Object.values(running_processes).length
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${port}`);
});

// --- ERROR HANDLERS ---
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    logAction('ERROR', 'SYSTEM', `Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    logAction('ERROR', 'SYSTEM', `Unhandled Rejection: ${reason}`);
});

// --- STARTUP ---
console.log("🤖 ⚡ ULTIMATE HOSTING BOT ONLINE!");
console.log(`👑 Owner: ${settings.owner}`);
console.log(`👥 Admins: ${settings.admins.length}`);
console.log(`🛡 Assistants: ${settings.assistants.length}`);
console.log(`📊 Total Users: ${Object.keys(users_db).length}`);
console.log(`💰 Host Cost: ${settings.hosting_cost}`);
console.log(`🎁 Daily Reward: ${settings.daily_reward}`);
console.log(`🌐 Railway URL: ${RAILWAY_URL}`);
console.log(`📡 Port: ${port}`);
