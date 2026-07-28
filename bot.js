const TelegramBot = require('node-telegram-bot-api').default || require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');
const axios = require('axios');
const FormData = require('form-data');

// --- CONFIGURATION ---
const API_TOKEN = '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4';
const ADMIN_ID = 7158115683;
const OWNER_ID = 7158115683;
const ASSISTANT_ID = 8060333824;
const CHANNEL_ID = "@PREMIUM_BOT_HOSTING_UPDATE";
const ANNOUNCE_CHANNEL = "@PREMIUM_HOSTING_UPDATES";
const FORCE_JOIN_CHANNEL = [
    "@PREMIUM_BOT_HOSTING_UPDATE",
    "@PREMIUM_HOSTING_UPDATES", 
    "@zaydentechy",  
    "@zayden_tech_back"                         
];

const VERCEL_TOKEN = 'vcp_6mbOjlw4KUuRP26U6RSNqyksTiwuDgMNf0JHjC6vCzB0OSrplx1fFYhm';
const VERCEL_TEAM_ID = 'team_ovNrPTbBV82txvRthHfeBLQZ';

const bot = new TelegramBot(API_TOKEN, { polling: true });

// FILES WILL BE SAVED AROUND HERE 🙃
const DB_FILE = path.join(__dirname, "users_data.json");
const SETTINGS_FILE = path.join(__dirname, "bot_settings.json");
const DEPLOY_DIR = path.join(__dirname, "deployed_bots");
const LOGS_DIR = path.join(__dirname, "logs");
const BACKUP_DIR = path.join(__dirname, "backups");
const WEBSITES_DIR = path.join(__dirname, "websites");

[DEPLOY_DIR, LOGS_DIR, BACKUP_DIR, WEBSITES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- DATA STORE ---
let users_db = loadDB();
let settings = loadSettings();
const running_processes = {};
const userSessions = {};
let messageCounters = {};
const pendingDeploys = {};

// --- PERSISTENCE ---
function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) { return {}; }
    }
    return {};
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(users_db, null, 2), 'utf-8');
}

function loadSettings() {
    const defaults = {
        points_per_referral: 5,
        bot_cost: 5,
        website_cost: 15,
        whatsapp_cost: 20,
        discord_cost: 10,
        maintenance: false,
        welcome_video: null,
        max_bots_per_user: 4,
        max_websites_per_user: 2,
        free_trial_days: 3,
        backup_interval: 86400,
        auto_cleanup: true,
        rate_limit: 30,
        vercel_token: VERCEL_TOKEN,
        vercel_team_id: VERCEL_TEAM_ID,
        force_join: false,
        notify_admins_on_join: true,
        star_prices: { basic: 15, premium: 30, pro: 50 },
        plans: {
            basic: { bots: 5, websites: 2, points: 50, price: 15 },
            premium: { bots: 15, websites: 5, points: 150, price: 30 },
            pro: { bots: 30, websites: 10, points: 400, price: 50 }
        }
    };
    if (fs.existsSync(SETTINGS_FILE)) {
        try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch (e) { return defaults; }
    }
    return defaults;
}

function saveSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// --- LOGGING ---
function logAction(userId, action, details = '') {
    const logEntry = {
        timestamp: new Date().toISOString(),
        userId,
        action,
        details
    };
    const logFile = path.join(LOGS_DIR, `actions_${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

// --- NOTIFY ADMINS ---
function notifyAdmins(message) {
    const admins = [ADMIN_ID, OWNER_ID, ASSISTANT_ID];
    for (const admin of admins) {
        bot.sendMessage(admin, message, { parse_mode: 'HTML' }).catch(() => {});
    }
}

// --- CHECK ADMIN ---
function isAdmin(userId) {
    return userId === ADMIN_ID.toString() || userId === OWNER_ID.toString() || userId === ASSISTANT_ID.toString();
}

// --- FORCE JOIN CHECK (MULTIPLE CHANNELS) ---
async function checkForceJoin(userId) {
    if (!settings.force_join) return true;
    
    // If it's a string, convert to array
    const channels = Array.isArray(FORCE_JOIN_CHANNEL) ? FORCE_JOIN_CHANNEL : [FORCE_JOIN_CHANNEL];
    
    // Check if user is in ANY of the channels
    for (const channel of channels) {
        try {
            const member = await bot.getChatMember(channel, userId);
            if (member.status === 'member' || member.status === 'administrator' || member.status === 'creator') {
                return true; // User is in at least one channel ✅
            }
        } catch (error) {
            // Channel might be private or user not in it
            continue; // Try next channel
        }
    }
    
    return false; // User is not in any channel ❌
}

// --- AUTO DEPENDENCY DETECTION ---
async function detectAndInstallDependencies(filePath, fileName, userId) {
    const ext = path.extname(fileName).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');
    const dependencies = [];
    const dir = path.dirname(filePath);

    // Check for package.json
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            if (pkg.dependencies) {
                Object.keys(pkg.dependencies).forEach(dep => dependencies.push(dep));
            }
        } catch (e) {}
    }

    // Check for requirements.txt
    const requirementsPath = path.join(dir, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
        const reqs = fs.readFileSync(requirementsPath, 'utf-8').split('\n').filter(r => r.trim());
        reqs.forEach(req => dependencies.push(req));
    }

    // Auto-detect from code
    if (ext === '.py') {
        const importRegex = /^(?:import|from)\s+([\w\d_]+)/gm;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            const lib = match[1].split('.')[0];
            const commonLibs = ['os', 'sys', 'time', 'datetime', 'json', 're', 'math', 'random', 'string', 'collections', 'itertools', 'functools', 'typing', 'abc', 'io', 'hashlib', 'base64', 'hmac', 'uuid', 'threading', 'multiprocessing', 'subprocess', 'socket', 'select', 'errno', 'pwd', 'grp', 'signal', 'mmap', 'resource', 'fcntl', 'posix', 'pwd', 'grp', 'crypt', 'termios', 'tty', 'pty', 'fcntl', 'pipes', 'shutil', 'tempfile', 'glob', 'fnmatch', 'linecache', 'filecmp', 'dircache', 'stat', 'statvfs', 'fileinput', 'zipfile', 'tarfile', 'gzip', 'bz2', 'lzma', 'zlib', 'crypt', 'hashlib', 'secrets', 'hmac', 'binascii', 'quopri', 'uu', 'base64', 'binhex', 'colorsys', 'csv', 'configparser', 'datetime', 'calendar', 'locale', 'gettext', 'argparse', 'optparse', 'getopt', 'cmd', 'shlex'];
            if (!commonLibs.includes(lib)) {
                dependencies.push(lib);
            }
        }
    } else if (ext === '.js') {
        const requireRegex = /require\(['"]([\w\d_\-@\/]+)['"]\)/g;
        const importRegex2 = /from\s+['"]([\w\d_\-@\/]+)['"]/g;
        let match;
        const commonModules = ['fs', 'path', 'os', 'http', 'https', 'url', 'querystring', 'crypto', 'zlib', 'stream', 'events', 'util', 'child_process', 'cluster', 'net', 'dgram', 'readline', 'tty', 'dns', 'assert', 'buffer', 'domain', 'console', 'timers', 'vm', 'v8', 'worker_threads', 'perf_hooks'];
        while ((match = requireRegex.exec(content)) !== null) {
            const lib = match[1];
            if (!commonModules.includes(lib) && !lib.startsWith('.')) {
                dependencies.push(lib);
            }
        }
        while ((match = importRegex2.exec(content)) !== null) {
            const lib = match[1];
            if (!commonModules.includes(lib) && !lib.startsWith('.')) {
                dependencies.push(lib);
            }
        }
    }

    // Install dependencies
    if (dependencies.length > 0) {
        const uniqueDeps = [...new Set(dependencies)];
        let installMsg = `📦 <blockquote>Installing Dependencies...</blockquote>\n`;
        installMsg += `\n📦 ${uniqueDeps.join(', ')}`;
        bot.sendMessage(userId, installMsg, { parse_mode: 'HTML' });

        if (ext === '.py' || fs.existsSync(requirementsPath)) {
            for (const dep of uniqueDeps) {
                await new Promise((resolve) => {
                    exec(`pip install ${dep}`, (error) => {
                        resolve();
                    });
                });
            }
        } else if (ext === '.js' || fs.existsSync(packageJsonPath)) {
            await new Promise((resolve) => {
                exec(`npm install ${uniqueDeps.join(' ')}`, { cwd: dir }, (error) => {
                    resolve();
                });
            });
        }

        bot.sendMessage(userId, `✅ <blockquote>Dependencies Installed Successfully</blockquote>`, { parse_mode: 'HTML' });
        return true;
    }
    return false;
}

// --- DETECT BOT TYPE ---
function detectBotType(filePath, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for Baileys (WhatsApp)
    if (content.includes('@whiskeysockets/baileys') || content.includes('baileys') || 
        content.includes('makeWASocket') || content.includes('useMultiFileAuthState')) {
        return 'whatsapp';
    }

    // WhatsApp libraries
    if (content.includes('whatsapp-web.js') || content.includes('venom-bot') || 
        content.includes('yowsup') || content.includes('wwebjs')) {
        return 'whatsapp';
    }

    // Telegram libraries
    if (content.includes('telebot') || content.includes('aiogram') || 
        content.includes('python-telegram-bot') || content.includes('node-telegram-bot-api') ||
        content.includes('Telegraf') || content.includes('gramjs') || content.includes('telegram')) {
        return 'telegram';
    }

    // Discord libraries
    if (content.includes('discord.js') || content.includes('discord.py') || 
        content.includes('discord') && content.includes('Client')) {
        return 'discord';
    }

    // Web servers
    if (content.includes('express') || content.includes('fastapi') || 
        content.includes('flask') || content.includes('django') || 
        content.includes('app.listen') || content.includes('app.run') ||
        content.includes('createServer')) {
        return 'web';
    }

    return 'generic';
}

// --- VERCEL DEPLOYMENT ---
async function deployToVercel(projectPath, projectName, userId) {
    try {
        const vercelJson = {
            "version": 2,
            "builds": [
                { "src": "**/*.html", "use": "@vercel/static" },
                { "src": "**/*.js", "use": "@vercel/node" },
                { "src": "**/*.ts", "use": "@vercel/node" }
            ],
            "routes": [{ "src": "/(.*)", "dest": "/$1" }]
        };
        
        const vercelJsonPath = path.join(projectPath, 'vercel.json');
        if (!fs.existsSync(vercelJsonPath)) {
            fs.writeFileSync(vercelJsonPath, JSON.stringify(vercelJson, null, 2));
        }

        const form = new FormData();
        const zipPath = path.join(WEBSITES_DIR, `${projectName}.zip`);
        const zip = new AdmZip();
        const files = fs.readdirSync(projectPath);
        
        for (const file of files) {
            const filePath = path.join(projectPath, file);
            if (fs.lstatSync(filePath).isDirectory()) {
                zip.addLocalFolder(filePath, file);
            } else {
                zip.addLocalFile(filePath);
            }
        }
        zip.writeZip(zipPath);

        form.append('file', fs.createReadStream(zipPath));
        form.append('projectName', projectName);
        form.append('target', 'production');
        
        if (settings.vercel_team_id) {
            form.append('teamId', settings.vercel_team_id);
        }

        const response = await axios.post('https://api.vercel.com/v13/deployments', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${settings.vercel_token || VERCEL_TOKEN}`
            }
        });

        fs.unlinkSync(zipPath);

        const deployUrl = response.data.url;
        const projectUrl = `https://${deployUrl}`;

        if (!users_db[userId].websites) users_db[userId].websites = [];
        users_db[userId].websites.push({
            name: projectName,
            url: projectUrl,
            deployId: response.data.id,
            created: Date.now()
        });
        saveDB();

        return { success: true, url: projectUrl, projectName: projectName };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// --- BOT EXECUTION ---
function runBotFile(filePath, userId, fileName, botType = 'telegram') {
    const ext = path.extname(fileName).toLowerCase();
    let cmd, args;

    if (ext === '.py') { cmd = 'python3'; args = [filePath]; }
    else if (ext === '.js') { cmd = 'node'; args = [filePath]; }
    else if (ext === '.sh') { cmd = 'bash'; args = [filePath]; }
    else if (ext === '.rb') { cmd = 'ruby'; args = [filePath]; }
    else { return false; }

    try {
        const process = spawn(cmd, args, { 
            shell: true,
            env: { ...process.env, NODE_ENV: 'production' }
        });
        running_processes[filePath] = process;

        process.stdout.on('data', (data) => {
            const log = data.toString();
            const logFile = path.join(LOGS_DIR, `bot_${userId}_${Date.now()}.log`);
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${log}`);
        });

        process.stderr.on('data', (data) => {
            const log = data.toString();
            const logFile = path.join(LOGS_DIR, `bot_${userId}_error_${Date.now()}.log`);
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] ERROR: ${log}`);
        });

        process.on('error', (err) => {
            bot.sendMessage(userId, 
                `❌ <blockquote>Process Error</blockquote>\n<code>${err.message}</code>`, 
                { parse_mode: 'HTML' }
            );
            delete running_processes[filePath];
        });

        process.on('close', () => {
            delete running_processes[filePath];
        });

        return true;
    } catch (e) {
        bot.sendMessage(userId, 
            `❌ <blockquote>Server Error</blockquote>\n<code>${e.message}</code>`, 
            { parse_mode: 'HTML' }
        );
        return false;
    }
}

// --- KEYBOARDS ---
function getMainKeyboard(userId) {
    const isAdminUser = isAdmin(userId);
    const keyboard = [
        [{ text: "📢 Updates" }, { text: "🤖 Deploy Bot" }],
        [{ text: "🌐 Deploy Website" }, { text: "📱 Deploy WhatsApp" }],
        [{ text: "📂 My Files" }, { text: "🌍 My Websites" }],
        [{ text: "💰 Points" }, { text: "⭐ Buy Plan" }],
        [{ text: "🔗 Referral" }, { text: "📊 Stats" }],
        [{ text: "📞 Support" }, { text: "🎫 Tickets" }],
        [{ text: "💡 Free Trial" }, { text: "⚡ Quick Deploy" }],
        [{ text: "📦 Install Package" }, { text: "🔍 Bot Status" }],
        [{ text: "📁 Logs" }, { text: "🔄 Restart All" }],
        [{ text: "📱 Info" }, { text: "⚙️ Settings" }],
        [{ text: "🎯 Goals" }, { text: "🏆 Leaderboard" }],
        [{ text: "📋 Templates" }, { text: "🤖 AI Debugger" }],
        [{ text: "🛠 Tools" }, { text: "📈 Monitor" }]
    ];
    
    if (isAdminUser) {
        keyboard.push([{ text: "👑 Admin Panel" }]);
    }
    
    return { keyboard, resize_keyboard: true };
}


function getAdminKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "👤 Users", callback_data: "adm_users", style: "primary" }, 
             { text: "📊 Stats", callback_data: "adm_stats", style: "success" }],
            [{ text: "📢 Broadcast", callback_data: "adm_broadcast", style: "primary" }, 
             { text: "💰 Give Points", callback_data: "adm_give_points", style: "primary" }],
            [{ text: "🎫 Coupons", callback_data: "adm_coupons", style: "primary" }, 
             { text: "👥 Admins", callback_data: "adm_admins", style: "success" }],
            [{ text: "💾 Backup", callback_data: "adm_backup", style: "primary" }, 
             { text: "🔧 Maintenance", callback_data: "adm_maintenance", style: "success" }],
            [{ text: "🖼 Photos", callback_data: "adm_photos", style: "primary" }, 
             { text: "📈 Analytics", callback_data: "adm_analytics", style: "success" }],
            [{ text: "🤖 Bot Manager", callback_data: "adm_bot_manager", style: "primary" }, 
             { text: "🔔 Notifications", callback_data: "adm_notifications", style: "success" }],
            [{ text: "🚫 Ban", callback_data: "adm_ban", style: "danger" }, 
             { text: "✅ Unban", callback_data: "adm_unban", style: "danger" }],
            [{ text: "💰 Payments", callback_data: "adm_payments", style: "primary" }, 
             { text: "✅ Approve Pay", callback_data: "adm_approve_pay", style: "success" }],
            [{ text: "🎫 Tickets", callback_data: "adm_tickets", style: "primary" }, 
             { text: "📋 Audit", callback_data: "adm_audit", style: "success" }],
            [{ text: "🔒 Security", callback_data: "adm_security", style: "primary" }, 
             { text: "⚙️ Settings", callback_data: "adm_settings", style: "success" }],
            [{ text: "⏳ Pending", callback_data: "adm_pending", style: "primary" }, 
             { text: "💾 Force Backup", callback_data: "adm_force_backup", style: "success" }],
            [{ text: "🛠 User Tools", callback_data: "adm_user_tools", style: "primary" }, 
             { text: "🔐 Sec Center", callback_data: "adm_sec_center", style: "success" }],
            [{ text: "🔧 Sys Tools", callback_data: "adm_sys_tools", style: "primary" }, 
             { text: "📊 Day Capita", callback_data: "adm_day_capita", style: "success" }],
            [{ text: "🎨 Appearance", callback_data: "adm_appearance", style: "primary" }, 
             { text: "📝 Templates", callback_data: "adm_templates", style: "success" }],
            [{ text: "📤 Import/Export", callback_data: "adm_import_export", style: "primary" }, 
             { text: "🌐 Webhooks", callback_data: "adm_webhooks", style: "success" }],
            [{ text: "🚦 Rate Limits", callback_data: "adm_rate_limits", style: "primary" }, 
             { text: "📈 Live Monitor", callback_data: "adm_live_monitor", style: "success" }],
            [{ text: "🎯 Rev Goals", callback_data: "adm_rev_goals", style: "primary" }, 
             { text: "⏰ Scheduler", callback_data: "adm_scheduler", style: "success" }],
            [{ text: "🏆 Leaderboard", callback_data: "adm_leaderboard", style: "primary" }, 
             { text: "🌍 Languages", callback_data: "adm_languages", style: "success" }],
            [{ text: "🎮 Bot Controls", callback_data: "adm_bot_controls", style: "primary" }, 
             { text: "📦 Subscriptions", callback_data: "adm_subscriptions", style: "success" }],
            [{ text: "🔐 Admin 2FA", callback_data: "adm_2fa", style: "primary" }, 
             { text: "🌐 Vercel Settings", callback_data: "adm_vercel", style: "success" }],
            [{ text: "⭐ Manage Plans", callback_data: "adm_plans", style: "primary" }, 
             { text: "📊 Global Points", callback_data: "adm_global_points", style: "primary" }],
            [{ text: "🔧 Bot Types", callback_data: "adm_bot_types", style: "primary" }, 
             { text: "📢 Force Join", callback_data: "adm_force_join", style: "primary" }],
            [{ text: "📢 New User Notify", callback_data: "adm_notify_join", style: "primary" }, 
             { text: "📊 Server Stats", callback_data: "adm_server_stats", style: "success" }],
            [{ text: "🔄 Reset All", callback_data: "adm_reset_all", style: "danger" }]
        ]
    };
}

function getPlanKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "⭐ Basic Plan - 15 Stars", callback_data: "plan_basic" },
            { text: "⭐ Premium Plan - 30 Stars", callback_data: "plan_premium" }],
            [{ text: "⭐ Pro Plan - 50 Stars", callback_data: "plan_pro" }],
            [{ text: "💰 Buy with Points", callback_data: "plan_points" }]
        ]
    };
}

// --- FORCE JOIN KEYBOARD (MULTIPLE CHANNELS) ---
function getForceJoinKeyboard() {
    const channels = Array.isArray(FORCE_JOIN_CHANNEL) ? FORCE_JOIN_CHANNEL : [FORCE_JOIN_CHANNEL];
    const inline_keyboard = [];
    
    // Add each channel as a button
    for (const channel of channels) {
        inline_keyboard.push([
            { 
                text: `📢 Join ${channel}`, 
                url: `https://t.me/${channel.replace('@', '')}` 
            }
        ]);
    }
    
    // Add Check Again button
    inline_keyboard.push([
        { text: "✅ Check Again", callback_data: "check_force_join" }
    ]);
    
    return { inline_keyboard };
}

// --- AI DEBUGGER ---
async function aiDebugger(code, language) {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: `You are an expert code debugger. Analyze the ${language} code, find errors, and provide fixes. Return response in HTML format with clear sections: Issues, Fixes, Improved Code.`
                },
                {
                    role: "user",
                    content: `Debug this ${language} code:\n\n${code}`
                }
            ],
            temperature: 0.7,
            max_tokens: 2000
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY || 'YOUR_API_KEY'}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        return `<blockquote>⚠️ AI Debugger Error</blockquote>\n<code>${error.message}</code>`;
    }
}

// --- MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id;
    const text = msg.text;

    // Rate limiting
    if (!messageCounters[userId]) messageCounters[userId] = { count: 0, reset: Date.now() };
    const now = Date.now();
    if (now - messageCounters[userId].reset > 60000) {
        messageCounters[userId] = { count: 0, reset: now };
    }
    messageCounters[userId].count++;
    if (messageCounters[userId].count > settings.rate_limit) {
        return bot.sendMessage(chatId, 
            "⏳ <blockquote>Rate limit exceeded</blockquote>\nPlease wait a moment.", 
            { parse_mode: 'HTML' }
        );
    }

    if (userSessions[userId]) {
        await handleSessionInput(msg);
        return;
    }

    if (!text) return;

    // Force join check
    if (settings.force_join && !isAdmin(userId) && text !== '/start') {
        const isMember = await checkForceJoin(userId);
        if (!isMember) {
            return bot.sendMessage(chatId,
                `🔒 <blockquote>You must join our channel to use this bot!</blockquote>\n\nPlease join and then click "Check Again".`,
                { parse_mode: 'HTML', reply_markup: getForceJoinKeyboard() }
            );
        }
    }

    // Initialize user
    if (!users_db[userId]) {
        users_db[userId] = {
            uid: userId,
            points: 10,
            files: [],
            websites: [],
            plan: 'free',
            join_date: new Date().toISOString(),
            trial_used: false,
            banned: false,
            referrals: 0,
            plan_expiry: null,
            last_activity: Date.now()
        };
        saveDB();
        logAction(userId, 'REGISTER', 'New user registered');
        
        // Notify admins about new user
        if (settings.notify_admins_on_join) {
            const userInfo = msg.from;
            const notifyMsg = `🆕 <blockquote>NEW USER JOINED!</blockquote>\n\n👤 Name: ${userInfo.first_name} ${userInfo.last_name || ''}\n🆔 ID: <code>${userId}</code>\n📅 Date: ${new Date().toLocaleString()}\n🔗 Username: @${userInfo.username || 'N/A'}\n\n📊 Total Users: ${Object.keys(users_db).length}`;
            notifyAdmins(notifyMsg);
        }
    }

    const user = users_db[userId];
    if (user.banned) {
        return bot.sendMessage(chatId, 
            "🚫 <blockquote>You are banned</blockquote>\nContact support for assistance.", 
            { parse_mode: 'HTML' }
        );
    }

    user.last_activity = Date.now();
    saveDB();

    // --- START COMMAND ---
    if (text === '/start') {
        if (settings.maintenance && !isAdmin(userId)) {
            return bot.sendMessage(chatId, 
                "⚠️ <bloqckquote>System under maintenance</blockquote>\nPlease try again later. or contact support", 
                { parse_mode: 'HTML' }
            );
        }

if (settings.force_join && !isAdmin(userId)) {
    const isMember = await checkForceJoin(userId);
    if (!isMember) {
        const channels = Array.isArray(FORCE_JOIN_CHANNEL) ? FORCE_JOIN_CHANNEL : [FORCE_JOIN_CHANNEL];
        const channelList = channels.map(c => `• ${c}`).join('\n');
        
        return bot.sendMessage(chatId,
            `🔒 <blockquote>ᴊᴏɪɴ ᴀʟʟ ᴏᴜʀ ᴄʜᴀɴɴᴇʟs ᴛᴏ ᴜsᴇ ᴛʜɪs ʙᴏᴛ!</blockquote>\n\n<b>Required Channels:</b>\n${channelList}\n\n⚠️ ʏᴏᴜ ᴍᴜsᴛ ᴊᴏɪɴ ᴀʟʟ ᴄʜᴀɴɴᴇʟ ᴛᴏ ᴜsᴇ ᴛʜɪs ʙᴏᴛ!\n\nᴄʟɪᴄᴋ ᴛʜᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ ᴛᴏ ᴊᴏɪɴ, ᴛʜᴇɴ ᴛᴀᴘ "ᴄʜᴇᴄᴋ ᴀɢᴀɪɴ".`,
            { parse_mode: 'HTML', reply_markup: getForceJoinKeyboard() }
        );
    }
}

        // Check for referral
        const params = text.split(' ');
        if (params.length > 1) {
            const refId = params[1];
            if (users_db[refId] && refId !== userId && !users_db[refId].banned) {
                users_db[refId].points += settings.points_per_referral;
                users_db[refId].referrals = (users_db[refId].referrals || 0) + 1;
                users_db[userId].referred_by = refId;
                saveDB();
                bot.sendMessage(parseInt(refId), 
                    `🎁 <blockquote>Referral Bonus!</blockquote>\nUser <code>${userId}</code> joined!\n+${settings.points_per_referral} points`, 
                    { parse_mode: 'HTML' }
                ).catch(() => {});
                
                // Notify admins about referral
                if (settings.notify_admins_on_join) {
                    const notifyMsg = `🎁 <blockquote>REFERRAL!</blockquote>\n\n👤 User: <code>${refId}</code>\n🔗 Referred: <code>${userId}</code>\n💰 Bonus: +${settings.points_per_referral} points\n📅 Date: ${new Date().toLocaleString()}`;
                    notifyAdmins(notifyMsg);
                }
            }
        }

        const welcome = getWelcomeText(msg);
        if (settings.welcome_video) {
            await bot.sendVideo(chatId, settings.welcome_video, {
                caption: welcome,
                parse_mode: 'HTML',
                reply_markup: getMainKeyboard(userId)
            });
        } else {
            await bot.sendMessage(chatId, welcome, {
                parse_mode: 'HTML',
                reply_markup: getMainKeyboard(userId)
            });
        }
        return;
    }

    // --- USER COMMANDS ---
    switch(text) {
        case "📢 Updates":
            bot.sendMessage(chatId, 
                "📢 <blockquote>Updates Channel</blockquote>\n\nJoin for latest news and updates!\n🔗 <a href='https://t.me/PREMIUM_BOT_HOSTING_UPDATE'>Click here to join</a>", {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                }
            );
            break;

        case "🤖 Deploy Bot":
            if (user.points < settings.bot_cost) {
                return bot.sendMessage(chatId, 
                    `❌ <blockquote>Insufficient points!</blockquote>\nNeed: ${settings.bot_cost}\nHave: ${user.points}`, 
                    { parse_mode: 'HTML' }
                );
            }
            if (user.files.length >= settings.max_bots_per_user) {
                return bot.sendMessage(chatId,
                    `❌ <b>Max bots reached!</b>\nLimit: ${settings.max_bots_per_user}`,
                    { parse_mode: 'HTML' }
                );
            }
            userSessions[userId] = { step: 'AWAITING_BOT_DEPLOY' };
            bot.sendMessage(chatId,
                `🤖 <blockquote>ᴅᴇᴘʟᴏʏ ʙᴏᴛ </blockquote>\n\nsᴇɴᴅ .ᴘʏ, .ᴊs, .sʜ, .ʀʙ, ᴏʀ .ᴢɪᴘ\nᴄᴏsᴛ: ${settings.bot_cost} ᴘᴏɪɴᴛs\n\n<blockquote>sᴜᴘᴘᴏʀᴛᴇᴅ ᴛʏᴘᴇs:</blockquote>\n• ᴛᴇʟᴇɢʀᴀᴍ (ᴛᴇʟᴇɢʀᴀғ, ᴀɪᴏɢʀᴀᴍ, ᴘʏᴛʜᴏɴ-ᴛᴇʟᴇɢʀᴀᴍ-ʙᴏᴛ)\n• ᴡʜᴀᴛsᴀᴘᴘ (ʙᴀɪʟᴇʏs, ᴡʜᴀᴛsᴀᴘᴘ-ᴡᴇʙ.ᴊs)\n• ᴅɪsᴄᴏʀᴅ (ᴅɪsᴄᴏʀᴅ.ᴊs, ᴅɪsᴄᴏʀᴅ.ᴘʏ)\n• ᴀɴʏ ʙᴏᴛ ғʀᴀᴍᴇᴡᴏʀᴋ!\n\n✅ ᴀᴜᴛᴏ-ᴅᴇᴛᴇᴄᴛs ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs!\n✅ ᴀᴜᴛᴏ-ᴅᴇᴛᴇᴄᴛs ʙᴏᴛ ᴛʏᴘᴇ!`,
                { parse_mode: 'HTML' }
            );
            break;

        case "📱 Deploy WhatsApp":
            if (user.points < settings.whatsapp_cost) {
                return bot.sendMessage(chatId, 
                    `<blockquote>❌ ɪɴsᴜғғɪᴄɪᴇɴᴛ ᴘᴏɪɴᴛs!</blockquote>\nɴᴇᴇᴅ: ${settings.whatsapp_cost}\nʜᴀᴠᴇ: ${user.points}`, 
                    { parse_mode: 'HTML' }
                );
            }
            if (user.files.length >= settings.max_bots_per_user) {
                return bot.sendMessage(chatId,
                    `❌ <b>ᴍᴀx ʙᴏᴛs ʀᴇᴀᴄʜᴇᴅ!</b>\nʟɪᴍɪᴛ: ${settings.max_bots_per_user}`,
                    { parse_mode: 'HTML' }
                );
            }
            userSessions[userId] = { step: 'AWAITING_WHATSAPP_DEPLOY' };
            bot.sendMessage(chatId,
                `<blockquote>📱 <b>ᴅᴇᴘʟᴏʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ</b>\n\nsᴇɴᴅ .ᴊs ᴏʀ .ᴘʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ ᴄᴏᴅᴇ\nᴄᴏsᴛ: ${settings.whatsapp_cost} ᴘᴏɪɴᴛs\n\n<b>sᴜᴘᴘᴏʀᴛᴇᴅ:</b>\n• ʙᴀɪʟᴇʏs (ᴡʜɪsᴋᴇʏsᴏᴄᴋᴇᴛs)\n• ᴡʜᴀᴛsᴀᴘᴘ-ᴡᴇʙ.ᴊs\n• ᴠᴇɴᴏᴍ-ʙᴏᴛ\n• ʏᴏᴡsᴜᴘ\n\n✅ ᴀᴜᴛᴏ-ᴅᴇᴛᴇᴄᴛs ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs!</blockquote>`,
                { parse_mode: 'HTML' }
            );
            break;

        case "🌐 Deploy Website":
            if (user.points < settings.website_cost) {
                return bot.sendMessage(chatId, 
                    `<blockquote>❌ ɪɴsᴜғғɪᴄɪᴇɴᴛ ᴘᴏɪɴᴛs!\nɴᴇᴇᴅ: ${settings.website_cost}\nʜᴀᴠᴇ: ${user.points}</blockquote>`, 
                    { parse_mode: 'HTML' }
                );
            }
            if ((user.websites || []).length >= settings.max_websites_per_user) {
                return bot.sendMessage(chatId,
                    `❌ <blockquote>ʟɪᴍɪᴛ ᴏғ ᴡᴇʙsɪᴛᴇs ʀᴇᴀᴄʜᴇᴅ!</b>\nʟɪᴍɪᴛ: ${settings.max_websites_per_user}`,
                    { parse_mode: 'HTML' }
                );
            }
            userSessions[userId] = { step: 'AWAITING_WEBSITE_DEPLOY' };
            bot.sendMessage(chatId,
                `<blockquote>🌐ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ</b>\n\nsᴇɴᴅ ʜᴛᴍʟ ғɪʟᴇ, ᴢɪᴘ, ᴏʀ ғᴏʟᴅᴇʀ\nᴄᴏsᴛ: ${settings.website_cost} ᴘᴏɪɴᴛs\n\nʏᴏᴜʀ ᴡᴇʙsɪᴛᴇ ᴡɪʟʟ ʙᴇ ᴅᴇᴘʟᴏʏᴇᴅ ᴛᴏ ᴠᴇʀᴄᴇʟ ᴡɪᴛʜ ᴀ ʀᴇᴀʟ ᴜʀʟ!\n🔗 ᴇxᴀᴍᴘʟᴇ: https://your-site.vercel.app</blockquote>`,
                { parse_mode: 'HTML' }
            );
            break;

        case "⭐ Buy Plan":
            const planMsg = `<blockquote>⭐ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴs</b>\n\n<b>ʙᴀsɪᴄ ᴘʟᴀɴ  - 15 sᴛᴀʀs</b>\n• 5 ʙᴏᴛs\n• 2 ᴡᴇʙsɪᴛᴇs\n• 50 ᴘᴏɪɴᴛs\n• ʙᴀsɪᴄ sᴜᴘᴘᴏʀᴛ.\n\n<b>ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴ - 30 sᴛᴀʀs</b>\n• 15 ʙᴏᴛs\n• 5 ᴡᴇʙsɪᴛᴇs\n• 150 ᴘᴏɪɴᴛs\n• ᴘʀɪᴏʀɪᴛʏ sᴜᴘᴘᴏʀᴛ\n• ᴀɪ ᴅᴇʙᴜɢɢᴇʀ\n\n<b>ᴘʀᴏ ᴘʟᴀɴ - 50 sᴛᴀʀs</b>\n• 30 ʙᴏᴛs\n• 10 ᴡᴇʙsɪᴛᴇs\n• 400 ᴘᴏɪɴᴛs\n• 24/7 sᴜᴘᴘᴏʀᴛ\n• ᴀɪ ᴅᴇʙᴜɢɢᴇʀ\n• ᴄᴜsᴛᴏᴍ ᴅᴏᴍᴀɪɴ\n\n💳 ᴘᴀʏ ᴡɪᴛʜ ᴛᴇʟᴇɢʀᴀᴍ sᴛᴀʀs ᴏʀ ᴘᴏɪɴᴛs!</blockquote>`;
            bot.sendMessage(chatId, planMsg, {
                parse_mode: 'HTML',
                reply_markup: getPlanKeyboard()
            });
            break;

        case "🤖 AI Debugger":
            if (user.points < 5) {
                return bot.sendMessage(chatId, 
                    `<blockquote>❌ ᴀɪ ᴅᴇʙᴜɢɢᴇʀ ʀᴇǫᴜɪʀᴇs 5 ᴘᴏɪɴᴛs\nʏᴏᴜ ʜᴀᴠᴇ ${user.points} ᴘᴏɪɴᴛs</blockquote>`, 
                    { parse_mode: 'HTML' }
                );
            }
            userSessions[userId] = { step: 'AWAITING_AI_DEBUG' };
            bot.sendMessage(chatId,
                `🤖 <b>ᴀɪ ᴄᴏᴅᴇ ᴅᴇʙᴜɢɢᴇʀ</b>\n\nsᴇɴᴅ ʏᴏᴜʀ ᴄᴏᴅᴇ ᴛᴏ ᴅᴇʙᴜɢ\nᴄᴏsᴛ: 5 ᴘᴏɪɴᴛs\n\nsᴜᴘᴘᴏʀᴛᴇᴅ: ᴘʏᴛʜᴏɴ, ᴊᴀᴠᴀsᴄʀɪᴘᴛ, ʜᴛᴍʟ, ᴄss`,
                { parse_mode: 'HTML' }
            );
            break;

        case "📂 My Files":
            if (user.files.length === 0) {
                return bot.sendMessage(chatId, 
                    "<blockquote>📂ɴᴏ ғɪʟᴇs ᴅᴇᴘʟᴏʏᴇᴅ\nᴅᴇᴘʟᴏʏ ʏᴏᴜʀ ғɪʀsᴛ ʙᴏᴛ ᴜsɪɴɢ 'ᴅᴇᴘʟᴏʏ ʙᴏᴛ</blockquote>'", 
                    { parse_mode: 'HTML' }
                );
            }
            for (const fileName of user.files) {
                const filePath = path.join(DEPLOY_DIR, `${userId}_${fileName}`);
                const isRunning = running_processes[filePath] && running_processes[filePath].exitCode === null;
                const status = isRunning ? '🟢 Running' : '🔴 Stopped';
                const botType = detectBotType(filePath, fileName);
                
                const markup = {
                    inline_keyboard: [
                        [{ text: "▶️ Run", callback_data: `run_${fileName}_${userId}`, style: "sucess" }, 
                         { text: "⏹ Stop", callback_data: `stop_${fileName}_${userId}`, style: "danger" }],
                        [{ text: "📥 Download", callback_data: `down_${fileName}_${userId}`, style: "primary" },
                         { text: "📋 Logs", callback_data: `logs_${fileName}_${userId}`, style: "primary" }],
                        [{ text: "🔄 Restart", callback_data: `restart_${fileName}_${userId}`, style: "sucess" },
                         { text: "❌ Delete", callback_data: `del_${fileName}_${userId}`, style: "danger" }]
                    ]
                };
                await bot.sendMessage(chatId,
                    `📄 <blockquote>${fileName}</blockquote>\nStatus: ${status}\n📱 Type: ${botType}`,
                    { parse_mode: 'HTML', reply_markup: markup }
                );
            }
            break;

        case "🌍 My Websites":
            if (!user.websites || user.websites.length === 0) {
                return bot.sendMessage(chatId, 
                    "🌍 <b>ɴᴏ ᴡᴇʙsɪᴛᴇs ᴅᴇᴘʟᴏʏᴇᴅ</b>\nᴅᴇᴘʟᴏʏ ʏᴏᴜʀ ғɪʀsᴛ ᴡᴇʙsɪᴛᴇ ᴜsɪɴɢ ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ", 
                    { parse_mode: 'HTML' }
                );
            }
            
            let websiteMsg = "🌍 <b>ʏᴏᴜʀ ᴡᴇʙsɪᴛᴇs</b>\n\n";
            for (const site of user.websites) {
                websiteMsg += `<b>${site.name}</b>\n`;
                websiteMsg += `🔗 URL: <a href="${site.url}">${site.url}</a>\n`;
                websiteMsg += `📅 Created: ${new Date(site.created).toLocaleDateString()}\n\n`;
            }
            
            const websiteMarkup = {
                inline_keyboard: [
                    [{ text: "🗑 Delete Website", callback_data: "delete_website", style: "danger" }]
                ]
            };
            
            bot.sendMessage(chatId, websiteMsg, {
                parse_mode: 'HTML',
                disable_web_page_preview: false,
                reply_markup: websiteMarkup
            });
            break;

        case "💰 Points":
            const canDeployBot = user.points >= settings.bot_cost ? '✅ Yes' : '❌ No';
            const canDeployWebsite = user.points >= settings.website_cost ? '✅ Yes' : '❌ No';
            const canDeployWhatsApp = user.points >= settings.whatsapp_cost ? '✅ Yes' : '❌ No';
            bot.sendMessage(chatId,
                `<blockquote>💰ʏᴏᴜʀ ʙᴀʟᴀɴᴄᴇ\n\nᴘᴏɪɴᴛs: ${user.points}\nᴘʟᴀɴ: ${user.plan || 'Free'}\n\n<b>ᴄᴏsᴛs:</b>\n🤖 ʙᴏᴛ ᴅᴇᴘʟᴏʏ: ${settings.bot_cost} ᴘᴛs\n🌐 ᴡᴇʙsɪᴛᴇ ᴅᴇᴘʟᴏʏ: ${settings.website_cost} ᴘᴛs\n📱 ᴡʜᴀᴛsᴀᴘᴘ ᴅᴇᴘʟᴏʏ: ${settings.whatsapp_cost} ᴘᴛs\n🤖 ᴀɪ ᴅᴇʙᴜɢɢᴇʀ: 5 ᴘᴛs\n\n<b>sᴛᴀᴛᴜs:</b>\nᴄᴀɴ ᴅᴇᴘʟᴏʏ ʙᴏᴛ: ${canDeployBot}\nᴄᴀɴ ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ: ${canDeployWebsite}\nᴄᴀɴ ᴅᴇᴘʟᴏʏ ᴡʜᴀᴛsᴀᴘᴘ: ${canDeployWhatsApp}\nʀᴇғᴇʀᴀʟs: ${user.referrals || 0}</blockquote>`,
                { parse_mode: 'HTML' }
            );
            break;

        case "🔗 Referral":
            bot.getMe().then(botInfo => {
                const refLink = `https://t.me/${botInfo.username}?start=${userId}`;
                bot.sendMessage(chatId,
                    `🔗 <b>Referral Link</b>\n\n<code>${refLink}</code>\n\nShare this link!\n+${settings.points_per_referral} points per referral`,
                    { parse_mode: 'HTML' }
                );
            });
            break;

        case "📊 Stats":
            const totalUsers = Object.keys(users_db).length;
            const activeBots = Object.values(running_processes).filter(p => p.exitCode === null).length;
            const totalFiles = Object.values(users_db).reduce((acc, u) => acc + (u.files || []).length, 0);
            const totalWebsites = Object.values(users_db).reduce((acc, u) => acc + (u.websites || []).length, 0);
            const bannedUsers = Object.values(users_db).filter(u => u.banned).length;
            const usersWithPlans = Object.values(users_db).filter(u => u.plan && u.plan !== 'free').length;
            
            bot.sendMessage(chatId,
                `📊 <b>ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs</b>\n\n👥 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}\n📄 ᴛᴏᴛᴀʟ ʙᴏᴛs: ${totalFiles}\n🌐 ᴛᴏᴛᴀʟ ᴡᴇʙsɪᴛᴇs: ${totalWebsites}\n🤖 ʀᴜɴɴɪɴɢ ʙᴏᴛs: ${activeBots}\n⭐ ᴜsᴇʀs ᴡɪᴛʜ ᴘʟᴀɴs: ${usersWithPlans}\n🚫 ʙᴀɴɴᴇᴅ: ${bannedUsers}\n\n💾 ʀᴀᴍ: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)}GB\n🔄 ʟᴏᴀᴅ: ${os.loadavg()[0].toFixed(2)}`,
                { parse_mode: 'HTML' }
            );
            break;

        case "📞 support":
            bot.sendMessage(chatId,
                `📞 <b>sᴜᴘᴘᴏʀᴛ ᴄᴇɴᴛᴇʀ</b>\n\n👤 sᴜᴘᴘᴏʀᴛ: @Danielisfatedyh\n📢 ᴄʜᴀɴɴᴇʟ: ${CHANNEL_ID}\n\nCreate ᴀ ᴛɪᴄᴋᴇᴛ ғᴏʀ ʜᴇʟᴘ.\nʙᴜʏ ᴀ ᴘʟᴀɴ ғᴏʀ ᴘʀɪᴏʀɪᴛʏ sᴜᴘᴘᴏʀᴛ!`,
                { parse_mode: 'HTML' }
            );
            break;

        case "🎫 Tickets":
            const tickets = settings.tickets?.filter(t => t.userId === userId) || [];
            if (tickets.length === 0) {
                userSessions[userId] = { step: 'AWAITING_TICKET_SUBJECT' };
                bot.sendMessage(chatId, 
                    "<blockquote>📫ᴄʀᴇᴀᴛᴇ ᴛɪᴄᴋᴇᴛ\nsᴇɴᴅ ʏᴏᴜʀ ᴛɪᴄᴋᴇᴛ sᴜʙᴊᴇᴄᴛ:</blockquote>", 
                    { parse_mode: 'HTML' }
                );
            } else {
                let ticketMsg = "🎫 <b>ʏᴏᴜʀ ᴛɪᴄᴋᴇᴛs</b>\n\n";
                tickets.forEach((t, i) => {
                    ticketMsg += `${i+1}. ${t.subject}\nStatus: ${t.status || 'Open'}\n\n`;
                });
                bot.sendMessage(chatId, ticketMsg, { parse_mode: 'HTML' });
            }
            break;

        case "💡 Free Trial":
            if (user.trial_used) {
                bot.sendMessage(chatId, 
                    "❌ <b>ᴛʀɪᴀʟ ᴀʟʀᴇᴀᴅʏ ᴜsᴇᴅ</b>\nᴇᴀʀɴ ᴘᴏɪɴᴛs ᴛʜʀᴏᴜɢʜ ʀᴇғᴇʀʀᴀʟs ᴏʀ ʙᴜʏ ᴀ ᴘʟᴀɴ.", 
                    { parse_mode: 'HTML' }
                );
            } else if (!user.trial_started) {
                user.trial_started = Date.now();
                user.trial_used = false;
                user.points += 30;
                saveDB();
                bot.sendMessage(chatId,
                    `🎉 <b>ғʀᴇᴇ ᴛʀɪᴀʟ ᴀᴄᴛɪᴠᴀᴛᴇᴅ!</b>\n\n${settings.free_trial_days} ᴅᴀʏs ғʀᴇᴇ\n+30 ʙᴏɴᴜs ᴘᴏɪɴᴛs.!\nᴇɴᴊᴏʏ ᴘʀᴇᴍɪᴜᴍ ғᴇᴀᴛᴜʀᴇs!`,
                    { parse_mode: 'HTML' }
                );
            } else {
                const daysLeft = settings.free_trial_days - Math.floor((Date.now() - user.trial_started) / (1000 * 60 * 60 * 24));
                if (daysLeft <= 0) {
                    user.trial_used = true;
                    saveDB();
                    bot.sendMessage(chatId, 
                        "❌ <b>ᴛʀɪᴀʟ ᴇxᴘɪʀᴇᴅ</b>\nᴇᴀʀɴ ᴘᴏɪɴᴛs ᴛʜʀᴏᴜɢʜ ʀᴇғᴇʀʀᴀʟs ᴏʀ ʙᴜʏ ᴀ  ᴘʟᴀɴ.", 
                        { parse_mode: 'HTML' }
                    );
                } else {
                    bot.sendMessage(chatId,
                        `💡 <b>ғʀᴇᴇ ᴛʀɪᴀʟ ᴀᴄᴛɪᴠᴇ</b>\n\n${daysLeft} ᴅᴀʏs ʀᴇᴍᴀɪɴɪɴɢ\nᴘᴏɪɴᴛs: ${user.points}`,
                        { parse_mode: 'HTML' }
                    );
                }
            }
            break;

        case "⚡ Quick Deploy":
            userSessions[userId] = { step: 'AWAITING_QUICK_DEPLOY' };
            bot.sendMessage(chatId, 
                "⚡ <b>ǫᴜɪᴄᴋ ᴅᴇᴘʟᴏʏ</b>\n\nsᴇɴᴅ ʏᴏᴜʀ ᴄᴏᴅᴇ ᴏʀ ғɪʟᴇ ᴛᴏ ᴅᴇᴘʟᴏʏ ɪɴsᴛᴀɴᴛʟʏ.\nᴄᴏsᴛ: 5 ᴘᴏɪɴᴛs", 
                { parse_mode: 'HTML' }
            );
            break;

        case "📦 Install Package":
            userSessions[userId] = { step: 'AWAITING_PACKAGE' };
            bot.sendMessage(chatId, 
                "📦 <b>ᴘᴀᴄᴋᴀɢᴇ ɪɴsᴛᴀʟʟᴇʀ</b>\n\nsᴇɴᴅ ᴘᴀᴄᴋᴀɢᴇ ɴᴀᴍᴇ (ᴘɪᴘ ᴏʀ ɴᴘᴍ).\nᴇxᴀᴍᴘʟᴇ: ʀᴇǫᴜᴇsᴛs, ᴇxᴘʀᴇss.", 
                { parse_mode: 'HTML' }
            );
            break;

        case "🔍 Bot Status":
            if (user.files.length === 0 && (user.websites || []).length === 0) {
                return bot.sendMessage(chatId, 
                    "🔍 <b>ɴᴏ ᴅᴇᴘʟᴏʏᴍᴇɴᴛs ғᴏᴜɴᴅ</b>", 
                    { parse_mode: 'HTML' }
                );
            }
            let statusMsg = "🤖 <b>ʙᴏᴛ sᴛᴀᴛᴜs</b>\n\n";
            for (const f of user.files) {
                const fPath = path.join(DEPLOY_DIR, `${userId}_${f}`);
                const isRunning = running_processes[fPath] && running_processes[fPath].exitCode === null;
                const botType = detectBotType(fPath, f);
                statusMsg += `${isRunning ? '🟢' : '🔴'} ${f} [${botType}]\n`;
            }
            statusMsg += "\n🌐 <b>ᴡᴇʙsɪᴛᴇ sᴛᴀᴛᴜs</b>\n";
            for (const site of (user.websites || [])) {
                statusMsg += `🟢 ${site.name}: ${site.url}\n`;
            }
            bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
            break;

        case "📁 Logs":
            const logFile = path.join(LOGS_DIR, `actions_${new Date().toISOString().split('T')[0]}.log`);
            if (fs.existsSync(logFile)) {
                const logs = fs.readFileSync(logFile, 'utf-8')
                    .split('\n')
                    .filter(l => l.includes(userId))
                    .slice(-30);
                if (logs.length === 0) {
                    bot.sendMessage(chatId, 
                        "📁 <b>ɴᴏ ʟᴏɢs ғᴏᴜɴᴅ</b>", 
                        { parse_mode: 'HTML' }
                    );
                } else {
                    bot.sendMessage(chatId,
                        `📁 <b>ʀᴇᴄᴇɴᴛ ʟᴏɢs</b>\n<code>${logs.join('\n').substring(0, 4000)}</code>`,
                        { parse_mode: 'HTML' }
                    );
                }
            } else {
                bot.sendMessage(chatId, 
                    "📁 <b>ɴᴏ ʟᴏɢs ᴀᴠᴀɪʟᴀʙʟᴇ</b>", 
                    { parse_mode: 'HTML' }
                );
            }
            break;

        case "🔄 Restart All":
            if (user.files.length === 0) {
                return bot.sendMessage(chatId, 
                    "🔄 <b>ɴᴏ ʙᴏᴛs ᴛᴏ ʀᴇsᴛᴀʀᴛ</b>", 
                    { parse_mode: 'HTML' }
                );
            }
            let restarted = 0;
            for (const f of user.files) {
                const fPath = path.join(DEPLOY_DIR, `${userId}_${f}`);
                if (running_processes[fPath]) {
                    running_processes[fPath].kill('SIGTERM');
                    setTimeout(() => {
                        if (runBotFile(fPath, parseInt(userId), f)) restarted++;
                    }, 1000);
                }
            }
            bot.sendMessage(chatId, 
                `🔄 <b>ʀᴇsᴛᴀʀᴛɪɴɢ ʙᴏᴛs...</b>\n${restarted} bots restarted`, 
                { parse_mode: 'HTML' }
            );
            break;

        case "📱 Info":
            const uptime = os.uptime();
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const mins = Math.floor((uptime % 3600) / 60);
            
            bot.sendMessage(chatId,
                `🖥 <b>ᴠᴘs ɪɴғᴏʀᴍᴀᴛɪᴏɴ.</b>\n\n💻 OS: ${os.type()} ${os.release()}\n🖥 ᴀʀᴄʜ: ${os.arch()}\n🔄 ᴜᴘᴛɪᴍᴇ: ${days}d ${hours}h ${mins}m\n💾 ʀᴀᴍ: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)}GB\n🔄 ʟᴏᴀᴅ: ${os.loadavg()[0].toFixed(2)}`,
                { parse_mode: 'HTML' }
            );
            break;

        case "⚙️ Settings":
            bot.sendMessage(chatId,
                `⚙️ <b>Settings</b>\n\nMaintenance: ${settings.maintenance ? '🔴 ON' : '🟢 OFF'}\nBot Cost: ${settings.bot_cost} pts\nWebsite Cost: ${settings.website_cost} pts\nWhatsApp Cost: ${settings.whatsapp_cost} pts\nMax Bots: ${settings.max_bots_per_user}\nMax Websites: ${settings.max_websites_per_user}\nTrial: ${settings.free_trial_days} days\nForce Join: ${settings.force_join ? '✅ ON' : '❌ OFF'}\nYour Plan: ${user.plan || 'Free'}`,
                { parse_mode: 'HTML' }
            );
            break;

        case "🎯 Goals":
            const totalDeploy = user.files?.length || 0;
            const totalWebs = user.websites?.length || 0;
            const nextGoal = Math.ceil((totalDeploy + totalWebs + 1) / 5) * 5;
            const ptsNeeded = (settings.bot_cost + settings.website_cost) * (nextGoal - totalDeploy - totalWebs);
            bot.sendMessage(chatId,
                `🎯 <b>ʏᴏᴜʀ Goals</b>\n\n🤖 Deployed Bots: ${totalDeploy}\n🌐 ᴅᴇᴘʟᴏʏᴇᴅ ᴡᴇʙsɪᴛᴇs: ${totalWebs}\n🎯 ɴᴇxᴛ ɢᴏᴀʟ: ${nextGoal} ᴅᴇᴘʟᴏʏᴍᴇɴᴛs\n💰 ᴘᴏɪɴᴛs ɴᴇᴇᴅᴇᴅ: ${ptsNeeded}`,
                { parse_mode: 'HTML' }
            );
            break;

        case "🏆 Leaderboard":
            const sorted = Object.entries(users_db)
                .filter(([_, data]) => !data.banned)
                .sort((a, b) => (b[1].points || 0) - (a[1].points || 0))
                .slice(0, 10);
            
            let leaderboard = "🏆 <b>ᴛᴏᴘ ᴜsᴇʀs</b>\n\n";
            sorted.forEach(([id, data], index) => {
                const botCount = data.files?.length || 0;
                const webCount = data.websites?.length || 0;
                const plan = data.plan || 'Free';
                leaderboard += `${index+1}. User ${id.slice(-4)}: ${data.points} pts (${botCount} bots, ${webCount} websites) [${plan}]\n`;
            });
            bot.sendMessage(chatId, leaderboard, { parse_mode: 'HTML' });
            break;

        case "📋 Templates":
            const templateList = [
                "Telegram Bot (Python)",
                "Telegram Bot (Node.js)",
                "WhatsApp Bot (Baileys)",
                "WhatsApp Bot (whatsapp-web.js)",
                "Discord Bot (Node.js)",
                "Simple HTML Website",
                "React App",
                "Express API",
                "Portfolio Website"
            ];
            const templateMarkup = {
                inline_keyboard: templateList.map(t => [{ text: t, callback_data: `template_${t}` }])
            };
            bot.sendMessage(chatId, "📋 <b>Available Templates</b>\nChoose one to deploy:", {
                parse_mode: 'HTML',
                reply_markup: templateMarkup
            });
            break;

        case "🛠 Tools":
            bot.sendMessage(chatId,
                `🛠 <b>Tools</b>\n\n📊 Analytics\n🔔 Notifications\n📤 Import/Export\n🌐 Webhooks\n⏰ Scheduler\n📈 Live Monitor\n🌍 Vercel Manager\n🤖 AI Debugger\n📦 Package Manager`,
                { parse_mode: 'HTML' }
            );
            break;

        case "📈 Monitor":
            const active = Object.values(running_processes).filter(p => p.exitCode === null).length;
            bot.sendMessage(chatId,
                `📈 <b>ʟɪᴠᴇ ᴍᴏɴɪᴛᴏʀ</b>\n\nᴀᴄᴛɪᴠᴇ ʙᴏᴛs.: ${active}\nYour ʙᴏᴛs: ${user.files.length}\nʏᴏᴜʀ ᴡᴇʙsɪᴛᴇs.: ${user.websites?.length || 0}\nᴍᴇᴍᴏʀʏ: ${((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1)}%`,
                { parse_mode: 'HTML' }
            );
            break;

        case "👑 Admin Panel":
            if (isAdmin(userId)) {
                bot.sendMessage(chatId, "🎛 <blockquote> ᴀᴅᴍɪɴ ᴄᴏɴᴛʀᴏʟ ᴄᴇɴᴛᴇʀ</blockquote>", {
                    parse_mode: 'HTML',
                    reply_markup: getAdminKeyboard()
                });
            } else {
                bot.sendMessage(chatId, "⛔ <blockquote>ᴀᴅᴍɪɴ ᴀᴄᴄᴇss ʀᴇǫᴜɪʀᴇᴅ</blockquote>", { parse_mode: 'HTML' });
            }
            break;

        default:
            if (!text.startsWith('/')) {
                bot.sendMessage(chatId, "❓ <blockquote>ᴜɴᴋɴᴏᴡɴ ᴄᴏᴍᴍᴀɴᴅ</b>\nᴜsᴇ ᴛʜᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ.", {
                    parse_mode: 'HTML',
                    reply_markup: getMainKeyboard(userId)
                });
            }
    }
});

// --- SESSION INPUT HANDLER ---
async function handleSessionInput(msg) {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id;
    const session = userSessions[userId];
    const user = users_db[userId];

    if (session.step === 'AWAITING_BOT_DEPLOY') {
        delete userSessions[userId];
        if (!msg.document) {
            return bot.sendMessage(chatId, "❌ <blockquote>ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴀ ғɪʟᴇ.</blockquote>", { parse_mode: 'HTML' });
        }
        await processDeploy(msg);
    }

    else if (session.step === 'AWAITING_WHATSAPP_DEPLOY') {
        delete userSessions[userId];
        if (!msg.document) {
            return bot.sendMessage(chatId, "❌ <b>Please send a file</b>", { parse_mode: 'HTML' });
        }
        await processDeploy(msg, 'whatsapp');
    }

    else if (session.step === 'AWAITING_WEBSITE_DEPLOY') {
        delete userSessions[userId];
        if (!msg.document) {
            return bot.sendMessage(chatId, "❌ <blockquote>ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴀ ғɪʟᴇ</blockquote>", { parse_mode: 'HTML' });
        }
        await processWebsiteDeploy(msg);
    }

    else if (session.step === 'AWAITING_AI_DEBUG') {
        delete userSessions[userId];
        const code = msg.text;
        if (!code) return bot.sendMessage(chatId, "❌ <b>ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴄᴏᴅᴇ ᴛᴏ ᴅᴇʙᴜɢ</b>", { parse_mode: 'HTML' });
        
        user.points -= 5;
        saveDB();
        
        bot.sendMessage(chatId, "🤖 <b>ᴀɪ ɪs ᴀɴᴀʟʏᴢɪɴɢ ʏᴏᴜʀ ᴄᴏᴅᴇ...</b>", { parse_mode: 'HTML' });
        
        const language = code.includes('import') ? 'Python' : 
                        code.includes('require') ? 'JavaScript' :
                        code.includes('html') ? 'HTML' : 'Unknown';
        
        const result = await aiDebugger(code, language);
        bot.sendMessage(chatId, 
            `🤖 <b>ᴀɪ ᴅᴇʙᴜɢɢᴇʀ ʀᴇsᴜʟᴛs</b>\n\n<pre>${result}<pre>`,
            { parse_mode: 'HTML' }
        );
        logAction(userId, 'AI_DEBUG', `Language: ${language}`);
    }

    else if (session.step === 'AWAITING_QUICK_DEPLOY') {
        delete userSessions[userId];
        if (msg.text) {
            const fileName = `quick_${Date.now()}.js`;
            const filePath = path.join(DEPLOY_DIR, `${userId}_${fileName}`);
            fs.writeFileSync(filePath, msg.text);
            if (user.points >= 5 && user.files.length < settings.max_bots_per_user) {
                user.points -= 5;
                user.files.push(fileName);
                saveDB();
                await detectAndInstallDependencies(filePath, fileName, userId);
                const botType = detectBotType(filePath, fileName);
                runBotFile(filePath, parseInt(userId), fileName, botType);
                bot.sendMessage(chatId, 
                    `🚀 <b>ǫᴜɪᴄᴋ  ᴅᴇᴘʟᴏʏ sᴜᴄᴄᴇss</b>\n<code>${fileName}</code>\n📱 ᴛʏᴘᴇ: ${botType}`, 
                    { parse_mode: 'HTML' }
                );
                logAction(userId, 'QUICK_DEPLOY', `File: ${fileName}`);
            } else {
                fs.unlinkSync(filePath);
                bot.sendMessage(chatId, "❌ <b>ɪɴsᴜғғɪᴄɪᴇɴᴛ ᴘᴏɪɴᴛs ᴏʀ ᴍᴀx ʙᴏᴛs ʀᴇᴀᴄʜᴇᴅ</b>", { parse_mode: 'HTML' });
            }
        } else if (msg.document) {
            await processDeploy(msg);
        } else {
            bot.sendMessage(chatId, "❌ <b>sᴇɴᴅ ᴄᴏᴅᴇ ᴏʀ ғɪʟᴇ</b>", { parse_mode: 'HTML' });
        }
    }

    else if (session.step === 'AWAITING_PACKAGE') {
        delete userSessions[userId];
        const pkg = msg.text;
        if (!pkg) return bot.sendMessage(chatId, "❌ <b>Invalid package</b>", { parse_mode: 'HTML' });
        
        bot.sendMessage(chatId, `📦 <b>Installing ${pkg}...</b>`, { parse_mode: 'HTML' });
        exec(`npm install -g ${pkg} || pip install ${pkg}`, (err, stdout, stderr) => {
            if (err) {
                bot.sendMessage(chatId, `❌ <b>Install Failed</b>\n<code>${stderr || err.message}</code>`, { parse_mode: 'HTML' });
            } else {
                bot.sendMessage(chatId, `✅ <b>Package Installed</b>\n<code>${pkg}</code>`, { parse_mode: 'HTML' });
                logAction(userId, 'INSTALL_PACKAGE', `Package: ${pkg}`);
            }
        });
    }

    else if (session.step === 'AWAITING_BROADCAST' && isAdmin(userId)) {
        delete userSessions[userId];
        let count = 0;
        const msgText = msg.text;
        for (const uid of Object.keys(users_db)) {
            if (!users_db[uid].banned) {
                await bot.sendMessage(parseInt(uid), 
                    `📢 <blockquote>📢Announcement\n\n${msgText}</blockquote>`, 
                    { parse_mode: 'HTML' }
                ).then(() => count++).catch(() => {});
            }
        }
        bot.sendMessage(chatId, `✅ <b>Broadcast sent</b>\nDelivered to ${count} users`, { parse_mode: 'HTML' });
        logAction(userId, 'BROADCAST', `Message: ${msgText.substring(0, 50)}...`);
    }

    else if (session.step === 'AWAITING_GLOBAL_POINTS' && isAdmin(userId)) {
        delete userSessions[userId];
        const points = parseInt(msg.text);
        if (isNaN(points)) return bot.sendMessage(chatId, "❌ <b>invalid ᴀᴍᴏᴜɴᴛ</b>", { parse_mode: 'HTML' });
        
        let count = 0;
        for (const uid of Object.keys(users_db)) {
            if (!users_db[uid].banned) {
                users_db[uid].points += points;
                count++;
            }
        }
        saveDB();
        bot.sendMessage(chatId, `✅ <b>ɢʟᴏʙᴀʟ ᴘᴏɪɴᴛs ᴀᴅᴅᴇᴅ</b>\n+${points} ᴘᴏɪɴᴛs ᴛᴏ ${count} ᴜsᴇʀs`, { parse_mode: 'HTML' });
        logAction(userId, 'GLOBAL_POINTS', `Points: ${points}`);
    }

    else if (session.step === 'AWAITING_COUPON' && isAdmin(userId)) {
        delete userSessions[userId];
        const code = msg.text.toUpperCase();
        if (!settings.coupons) settings.coupons = [];
        settings.coupons.push({
            code,
            points: session.points || 10,
            used: false,
            created: Date.now()
        });
        saveSettings();
        bot.sendMessage(chatId, `✅ <b>ᴄᴏᴜᴘᴏɴ ᴄʀᴇᴀᴛᴇᴅ</b>\nᴄᴏᴅᴇ: <code>${code}</code>\nᴠᴀʟᴜᴇ: ${session.points || 10} points`, { parse_mode: 'HTML' });
        logAction(userId, 'CREATE_COUPON', `Code: ${code}`);
    }

    else if (session.step === 'AWAITING_BAN_USER' && isAdmin(userId)) {
        delete userSessions[userId];
        const target = msg.text;
        if (users_db[target]) {
            users_db[target].banned = true;
            saveDB();
            bot.sendMessage(chatId, `🚫 <b>User Banned</b>\n<code>${target}</code>`, { parse_mode: 'HTML' });
            logAction(userId, 'BAN_USER', `Target: ${target}`);
        } else {
            bot.sendMessage(chatId, "❌ <b>User not found</b>", { parse_mode: 'HTML' });
        }
    }

    else if (session.step === 'AWAITING_UNBAN_USER' && isAdmin(userId)) {
        delete userSessions[userId];
        const target = msg.text;
        if (users_db[target]) {
            users_db[target].banned = false;
            saveDB();
            bot.sendMessage(chatId, `✅ <b>User ᴜɴʙᴀɴɴᴇᴅ</b>\n<code>${target}</code>`, { parse_mode: 'HTML' });
            logAction(userId, 'UNBAN_USER', `Target: ${target}`);
        } else {
            bot.sendMessage(chatId, "❌ <b>User not found</b>", { parse_mode: 'HTML' });
        }
    }

    else if (session.step === 'AWAITING_GIVE_POINTS' && isAdmin(userId)) {
        delete userSessions[userId];
        const target = session.targetUser;
        const points = parseInt(msg.text);
        if (users_db[target]) {
            users_db[target].points += points;
            saveDB();
            bot.sendMessage(chatId, `✅ <b>Points Added</b>\nUser: <code>${target}</code>\n+${points} points`, { parse_mode: 'HTML' });
            logAction(userId, 'GIVE_POINTS', `Target: ${target}, Points: ${points}`);
        } else {
            bot.sendMessage(chatId, "❌ <b>User not found</b>", { parse_mode: 'HTML' });
        }
    }

    else if (session.step === 'AWAITING_TICKET_SUBJECT') {
        session.subject = msg.text;
        session.step = 'AWAITING_TICKET_DESC';
        bot.sendMessage(chatId, "📝 <b>ᴛɪᴄᴋᴇᴛ ᴅᴇsᴄʀɪᴘᴛɪᴏɴ</b>\nᴅᴇsᴄʀɪʙᴇ ʏᴏᴜʀ ɪssᴜᴇ:", { parse_mode: 'HTML' });
    }

    else if (session.step === 'AWAITING_TICKET_DESC') {
        delete userSessions[userId];
        if (!settings.tickets) settings.tickets = [];
        settings.tickets.push({
            userId: userId,
            subject: session.subject,
            description: msg.text,
            status: 'Open',
            created: Date.now()
        });
        saveSettings();
        bot.sendMessage(chatId, "✅ <b>ᴛɪᴄᴋᴇᴛ ᴄʀᴇᴀᴛᴇᴅ</b>\nsᴜᴘᴘᴏʀᴛ ᴡɪʟʟ ʀᴇsᴘᴏɴᴅ sʜᴏʀᴛʟʏ.", { parse_mode: 'HTML' });
        logAction(userId, 'CREATE_TICKET', `Subject: ${session.subject}`);
    }

    else if (session.step === 'AWAITING_APPROVE_PAYMENT' && isAdmin(userId)) {
        delete userSessions[userId];
        const txId = msg.text;
        bot.sendMessage(chatId, `✅ <b>Payment Approved</b>\nTransaction: <code>${txId}</code>`, { parse_mode: 'HTML' });
        logAction(userId, 'APPROVE_PAYMENT', `TX: ${txId}`);
    }

    else if (session.step === 'AWAITING_MENU_PHOTO' && isAdmin(userId)) {
        delete userSessions[userId];
        if (msg.photo) {
            settings.menu_photo = msg.photo[msg.photo.length - 1].file_id;
            saveSettings();
            bot.sendMessage(chatId, "✅ <b>Menu Photo Set</b>", { parse_mode: 'HTML' });
            logAction(userId, 'SET_MENU_PHOTO', 'Menu photo updated');
        } else {
            bot.sendMessage(chatId, "❌ <b>Please send a photo</b>", { parse_mode: 'HTML' });
        }
    }
}

// --- DEPLOY PROCESS ---
async function processDeploy(msg, botType = 'telegram') {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id;
    const user = users_db[userId];
    const fileName = msg.document.file_name;
    const filePath = path.join(DEPLOY_DIR, `${userId}_${fileName}`);

    let cost = botType === 'telegram' ? settings.bot_cost : 
               botType === 'whatsapp' ? settings.whatsapp_cost : 
               settings.bot_cost;

    if (user.points < cost) {
        return bot.sendMessage(chatId, `❌ <b>Insufficient points!</b>\nNeed: ${cost}\nHave: ${user.points}`, { parse_mode: 'HTML' });
    }

    if (user.files.length >= settings.max_bots_per_user) {
        return bot.sendMessage(chatId, `❌ <b>Max bots reached!</b>\nLimit: ${settings.max_bots_per_user}`, { parse_mode: 'HTML' });
    }

    const statusMsg = await bot.sendMessage(chatId, "⏳ <b>Deploying...</b>", { parse_mode: 'HTML' });

    try {
        await bot.downloadFile(msg.document.file_id, DEPLOY_DIR);
        fs.renameSync(path.join(DEPLOY_DIR, msg.document.file_id), filePath);

        if (fileName.endsWith('.zip')) {
            const extractDir = path.join(DEPLOY_DIR, `${userId}_${fileName.replace('.zip', '')}`);
            const zip = new AdmZip(filePath);
            zip.extractAllTo(extractDir, true);
            fs.unlinkSync(filePath);
            
            const files = fs.readdirSync(extractDir);
            const mainFile = files.find(f => f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.sh'));
            if (mainFile) {
                const newPath = path.join(extractDir, mainFile);
                await detectAndInstallDependencies(newPath, mainFile, userId);
                const detectedType = detectBotType(newPath, mainFile);
                
                if (runBotFile(newPath, parseInt(userId), mainFile, detectedType)) {
                    user.points -= cost;
                    user.files.push(mainFile);
                    saveDB();
                    logAction(userId, 'DEPLOY', `File: ${mainFile}, Type: ${detectedType}`);
                    await bot.editMessageText(
                        `🚀 <b>Deploy Success</b>\n<code>${mainFile}</code>\n📱 Type: ${detectedType}\n💰 Remaining: ${user.points} points`,
                        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
                    );
                    
                    const announceMsg = `<blockquote>🚀 <b>NEW ${detectedType.toUpperCase()} ʙᴏᴛ ᴅᴇᴘʟᴏʏᴇᴅ</b>\n\n👤 User: <code>${userId}</code>\n🤖 ʙᴏᴛ: <code>${mainFile}</code>\n📱 ᴛʏᴘᴇ: ${detectedType}\n⏰ ᴛɪᴍᴇ: ${new Date().toLocaleString()}</blockquote>`;
                    bot.sendMessage(ANNOUNCE_CHANNEL, announceMsg, { parse_mode: 'HTML' }).catch(() => {});
                    notifyAdmins(`<blockquote🤖 <b>ʙᴏᴛ ᴅᴇᴘʟᴏʏᴇᴅ</b>\n\n👤 ᴜsᴇʀ: <code>${userId}</code>\n📄 ғɪʟᴇ: ${mainFile}\n📱 ᴛʏᴘᴇ: ${detectedType}`);
                }
            }
            return;
        }

        await detectAndInstallDependencies(filePath, fileName, userId);
        const detectedType = detectBotType(filePath, fileName);

        if (runBotFile(filePath, parseInt(userId), fileName, detectedType)) {
            user.points -= cost;
            user.files.push(fileName);
            saveDB();
            logAction(userId, 'DEPLOY', `File: ${fileName}, Type: ${detectedType}`);
            await bot.editMessageText(
                `🚀 <b>ᴅᴇᴘʟᴏʏ sᴜᴄᴄᴇss</b>\n<code>${fileName}</code>\n📱 ᴛʏᴘᴇ: ${detectedType}\n💰 ʀᴇᴍᴀɪɴɪɴɢ: ${user.points} points`,
                { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
            );
            
            const announceMsg = `🚀 <b>NEW ${detectedType.toUpperCase()} BOT DEPLOYED</b>\n\n👤 User: <code>${userId}</code>\n🤖 Bot: <code>${fileName}</code>\n📱 Type: ${detectedType}\n⏰ Time: ${new Date().toLocaleString()}`;
            bot.sendMessage(ANNOUNCE_CHANNEL, announceMsg, { parse_mode: 'HTML' }).catch(() => {});
            notifyAdmins(`🤖 <b>Bot Deployed</b>\n\n👤 User: <code>${userId}</code>\n📄 File: ${fileName}\n📱 Type: ${detectedType}`);
        } else {
            await bot.editMessageText(
                "❌ <b>Deploy Failed</b>\nCheck file and try again.",
                { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
            );
        }
    } catch (err) {
        await bot.editMessageText(
            `❌ <b>Error</b>\n<code>${err.message}</code>`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
        );
    }
}

// --- WEBSITE DEPLOY ---
async function processWebsiteDeploy(msg) {
    const userId = msg.from.id.toString();
    const chatId = msg.chat.id;
    const user = users_db[userId];
    const fileName = msg.document.file_name;
    const projectName = `site_${userId}_${Date.now()}`;
    const projectPath = path.join(WEBSITES_DIR, projectName);

    if (user.points < settings.website_cost) {
        return bot.sendMessage(chatId, `❌ <b>Insufficient points!</b>\nNeed: ${settings.website_cost}\nHave: ${user.points}`, { parse_mode: 'HTML' });
    }

    const statusMsg = await bot.sendMessage(chatId, "🌐 <b>Deploying website to Vercel...</b>", { parse_mode: 'HTML' });

    try {
        fs.mkdirSync(projectPath, { recursive: true });
        
        if (fileName.endsWith('.zip')) {
            const zipPath = path.join(DEPLOY_DIR, `${userId}_${fileName}`);
            await bot.downloadFile(msg.document.file_id, DEPLOY_DIR);
            fs.renameSync(path.join(DEPLOY_DIR, msg.document.file_id), zipPath);
            
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(projectPath, true);
            fs.unlinkSync(zipPath);
        } else {
            const filePath = path.join(projectPath, 'index.html');
            await bot.downloadFile(msg.document.file_id, projectPath);
            fs.renameSync(path.join(projectPath, msg.document.file_id), filePath);
        }

        const result = await deployToVercel(projectPath, projectName, userId);
        
        if (result.success) {
            user.points -= settings.website_cost;
            saveDB();
            await bot.editMessageText(
                `🌐 <b>Website Deployed!</b>\n\n🔗 URL: <a href="${result.url}">${result.url}</a>\n📁 Project: ${projectName}\n💰 Remaining: ${user.points} points`,
                { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML', disable_web_page_preview: false }
            );
            
            const announceMsg = `🌐 <b>NEW WEBSITE DEPLOYED</b>\n\n👤 User: <code>${userId}</code>\n🔗 URL: ${result.url}\n⏰ Time: ${new Date().toLocaleString()}`;
            bot.sendMessage(ANNOUNCE_CHANNEL, announceMsg, { parse_mode: 'HTML' }).catch(() => {});
            notifyAdmins(`🌐 <b>Website Deployed</b>\n\n👤 User: <code>${userId}</code>\n🔗 URL: ${result.url}`);
            
            logAction(userId, 'WEBSITE_DEPLOY', `URL: ${result.url}`);
        } else {
            await bot.editMessageText(
                `❌ <b>Deploy Failed</b>\n<code>${result.error}</code>`,
                { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
            );
        }
    } catch (err) {
        await bot.editMessageText(
            `❌ <b>Error</b>\n<code>${err.message}</code>`,
            { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' }
        );
    }
}

// --- CALLBACK HANDLER ---
bot.on('callback_query', async (call) => {
    const userId = call.from.id.toString();
    const chatId = call.message.chat.id;
    const data = call.data;
    const user = users_db[userId];

    // --- PLAN CALLBACKS ---
    if (data.startsWith('plan_')) {
        const plan = data.replace('plan_', '');
        const prices = settings.star_prices;
        const planDetails = settings.plans[plan];
        
        if (!planDetails) {
            return bot.answerCallbackQuery(call.id, { text: 'Invalid plan' });
        }

        if (data === 'plan_points') {
            const cost = plan === 'basic' ? 50 : plan === 'premium' ? 150 : 400;
            if (user.points < cost) {
                return bot.answerCallbackQuery(call.id, { text: `❌ Need ${cost} points!` });
            }
            user.points -= cost;
            user.plan = plan;
            user.plan_expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
            user.points += planDetails.points;
            saveDB();
            bot.sendMessage(chatId, 
                `✅ <b>Plan Activated!</b>\n\nPlan: ${plan}\nBots: ${planDetails.bots}\nWebsites: ${planDetails.websites}\nBonus Points: ${planDetails.points}`,
                { parse_mode: 'HTML' }
            );
            logAction(userId, 'BUY_PLAN', `Plan: ${plan} (Points)`);
            notifyAdmins(`⭐ <b>Plan Purchase</b>\n\n👤 User: <code>${userId}</code>\n📋 Plan: ${plan}\n💳 Method: Points`);
            return bot.answerCallbackQuery(call.id, { text: '✅ Plan activated!' });
        }

        const starAmount = prices[plan];
        bot.sendMessage(chatId,
            `⭐ <b>Pay with Stars</b>\n\nPlan: ${plan}\nPrice: ${starAmount} Stars\n\nContact owner to complete payment.`,
            { parse_mode: 'HTML' }
        );
        bot.answerCallbackQuery(call.id);
    }

    // --- FILE OPERATIONS ---
    else if (data.includes('_') && !data.startsWith('adm_') && !data.startsWith('template_') && !data.startsWith('plan_') && !data.startsWith('check_')) {
        const parts = data.split('_');
        const action = parts[0];
        const targetUserId = parts[parts.length - 1];
        const fileName = parts.slice(1, -1).join('_');
        const filePath = path.join(DEPLOY_DIR, `${targetUserId}_${fileName}`);

        if (targetUserId !== userId && !isAdmin(userId)) {
            return bot.answerCallbackQuery(call.id, { text: '⛔ Not your file!' });
        }

        if (action === 'run') {
            const botType = detectBotType(filePath, fileName);
            if (runBotFile(filePath, parseInt(targetUserId), fileName, botType)) {
                await bot.answerCallbackQuery(call.id, { text: '✅ Bot started' });
            }
        }
        else if (action === 'stop') {
            if (running_processes[filePath]) {
                running_processes[filePath].kill('SIGTERM');
                delete running_processes[filePath];
                await bot.answerCallbackQuery(call.id, { text: '⏹ Bot stopped' });
            }
        }
        else if (action === 'restart') {
            if (running_processes[filePath]) {
                running_processes[filePath].kill('SIGTERM');
                setTimeout(() => {
                    const botType = detectBotType(filePath, fileName);
                    runBotFile(filePath, parseInt(targetUserId), fileName, botType);
                }, 1000);
                await bot.answerCallbackQuery(call.id, { text: '🔄 Restarting' });
            } else {
                const botType = detectBotType(filePath, fileName);
                runBotFile(filePath, parseInt(targetUserId), fileName, botType);
                await bot.answerCallbackQuery(call.id, { text: '✅ Started' });
            }
        }
        else if (action === 'down') {
            if (fs.existsSync(filePath)) {
                await bot.sendDocument(chatId, filePath);
                await bot.answerCallbackQuery(call.id);
            } else {
                await bot.answerCallbackQuery(call.id, { text: '❌ File not found' });
            }
        }
        else if (action === 'logs') {
            const logFiles = fs.readdirSync(LOGS_DIR).filter(f => f.includes(targetUserId));
            if (logFiles.length > 0) {
                const logs = logFiles.slice(-3).map(f => {
                    return fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8').split('\n').slice(-20).join('\n');
                }).join('\n');
                await bot.sendMessage(chatId,
                    `📋 <b>Logs for ${fileName}</b>\n<code>${logs.substring(0, 4000)}</code>`,
                    { parse_mode: 'HTML' }
                );
            } else {
                await bot.answerCallbackQuery(call.id, { text: 'No logs found' });
            }
        }
        else if (action === 'del') {
            if (running_processes[filePath]) {
                running_processes[filePath].kill('SIGTERM');
                delete running_processes[filePath];
            }
            if (fs.existsSync(filePath)) {
                if (fs.lstatSync(filePath).isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
            }
            if (users_db[targetUserId]?.files?.includes(fileName)) {
                users_db[targetUserId].files = users_db[targetUserId].files.filter(f => f !== fileName);
                saveDB();
            }
            await bot.deleteMessage(chatId, call.message.message_id);
            await bot.answerCallbackQuery(call.id, { text: '🗑 Deleted' });
            logAction(userId, 'DELETE_FILE', `File: ${fileName}`);
        }
    }

    // --- TEMPLATES ---
    else if (data.startsWith('template_')) {
        const template = data.replace('template_', '');
        const fileName = `template_${template.replace(/\s/g, '_')}_${Date.now()}`;
        const filePath = path.join(DEPLOY_DIR, `${userId}_${fileName}`);
        let code = '';
        let botType = 'telegram';

        if (template === 'Telegram Bot (Python)') {
            code = `import telebot\n\nTOKEN = 'YOUR_BOT_TOKEN'\nbot = telebot.TeleBot(TOKEN)\n\n@bot.message_handler(commands=['start'])\ndef start(msg):\n    bot.reply_to(msg, 'Hello! I\\'m a Telegram bot!')\n\n@bot.message_handler(func=lambda m: True)\ndef echo(msg):\n    bot.reply_to(msg, msg.text)\n\nprint('Bot is running...')\nbot.polling()`;
        } else if (template === 'Telegram Bot (Node.js)') {
            code = `const TelegramBot = require('node-telegram-bot-api');\n\nconst TOKEN = 'YOUR_BOT_TOKEN';\nconst bot = new TelegramBot(TOKEN, { polling: true });\n\nbot.onText(/\\/start/, (msg) => {\n    bot.sendMessage(msg.chat.id, 'Hello! I\\'m a Telegram bot!');\n});\n\nbot.on('message', (msg) => {\n    bot.sendMessage(msg.chat.id, 'You said: ' + msg.text);\n});\n\nconsole.log('Bot is running...');`;
        } else if (template === 'WhatsApp Bot (Baileys)') {
            botType = 'whatsapp';
            code = `const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');\n\nasync function startBot() {\n    const { state, saveCreds } = await useMultiFileAuthState('auth');\n    const sock = makeWASocket({ auth: state });\n\n    sock.ev.on('creds.update', saveCreds);\n\n    sock.ev.on('messages.upsert', async (m) => {\n        const msg = m.messages[0];\n        if (!msg.key.fromMe && msg.message?.conversation === '!ping') {\n            await sock.sendMessage(msg.key.remoteJid, { text: 'pong!' });\n        }\n    });\n\n    console.log('WhatsApp Bot is running!');\n}\n\nstartBot();`;
        } else if (template === 'WhatsApp Bot (whatsapp-web.js)') {
            botType = 'whatsapp';
            code = `const { Client, LocalAuth } = require('whatsapp-web.js');\n\nconst client = new Client({\n    authStrategy: new LocalAuth()\n});\n\nclient.on('ready', () => {\n    console.log('WhatsApp Bot is ready!');\n});\n\nclient.on('message', message => {\n    if (message.body === '!ping') {\n        message.reply('pong');\n    }\n});\n\nclient.initialize();`;
        } else if (template === 'Discord Bot (Node.js)') {
            botType = 'discord';
            code = `const Discord = require('discord.js');\nconst client = new Discord.Client();\n\nclient.on('ready', () => {\n    console.log('Discord bot is ready!');\n});\n\nclient.on('message', msg => {\n    if (msg.content === '!ping') {\n        msg.reply('pong');\n    }\n});\n\nclient.login('YOUR_TOKEN');`;
        } else if (template === 'Simple HTML Website') {
            code = `<!DOCTYPE html>\n<html>\n<head><title>My Website</title>\n<style>\nbody { font-family: Arial; text-align: center; padding: 50px; background: linear-gradient(45deg, #667eea, #764ba2); color: white; }\nh1 { font-size: 48px; }\n.card { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; }\n</style>\n</head>\n<body>\n<div class="card">\n<h1>🚀 My Website</h1>\n<p>Deployed with Premium Hosting Bot!</p>\n</div>\n</body>\n</html>`;
        } else if (template === 'React App') {
            code = `import React from 'react';\nimport ReactDOM from 'react-dom';\n\nfunction App() {\n    return <div style={{ textAlign: 'center', padding: '50px' }}>\n        <h1>🚀 React App</h1>\n        <p>Deployed with Premium Hosting Bot!</p>\n    </div>;\n}\n\nReactDOM.render(<App />, document.getElementById('root'));`;
        } else if (template === 'Express API') {
            code = `const express = require('express');\nconst app = express();\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n    res.json({ message: 'API is running!' });\n});\n\napp.get('/status', (req, res) => {\n    res.json({ status: 'online', uptime: process.uptime() });\n});\n\napp.listen(3000, () => console.log('Server running on port 3000'));`;
        } else if (template === 'Portfolio Website') {
            code = `<!DOCTYPE html>\n<html>\n<head><title>Portfolio</title>\n<style>\n* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: white; }\n.hero { height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; }\nh1 { font-size: 64px; background: linear-gradient(45deg, #f093fb, #f5576c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }\np { font-size: 24px; margin-top: 20px; color: #888; }\n.btn { padding: 15px 40px; background: linear-gradient(45deg, #f093fb, #f5576c); border: none; border-radius: 30px; color: white; font-size: 18px; margin-top: 30px; cursor: pointer; }\n</style>\n</head>\n<body>\n<div class="hero">\n<h1>My Portfolio</h1>\n<p>Full Stack Developer</p>\n<button class="btn">Contact Me</button>\n</div>\n</body>\n</html>`;
        }

        fs.writeFileSync(filePath, code);

        if (template.includes('Website') || template.includes('HTML') || template.includes('React') || template.includes('Portfolio')) {
            const projectName = `template_${Date.now()}`;
            const projectPath = path.join(WEBSITES_DIR, projectName);
            fs.mkdirSync(projectPath, { recursive: true });
            fs.writeFileSync(path.join(projectPath, 'index.html'), code);
            
            if (user.points >= settings.website_cost && (user.websites || []).length < settings.max_websites_per_user) {
                const result = await deployToVercel(projectPath, projectName, userId);
                if (result.success) {
                    user.points -= settings.website_cost;
                    saveDB();
                    await bot.sendMessage(chatId,
                        `🚀 <b>Template Deployed</b>\n📋 ${template}\n🔗 URL: <a href="${result.url}">${result.url}</a>\n💰 Remaining: ${user.points} points`,
                        { parse_mode: 'HTML', disable_web_page_preview: false }
                    );
                    logAction(userId, 'TEMPLATE_DEPLOY', `Template: ${template}`);
                    await bot.answerCallbackQuery(call.id, { text: '✅ Deployed' });
                }
            } else {
                await bot.answerCallbackQuery(call.id, { text: '❌ Insufficient points or max websites' });
            }
            return;
        }

        if (user.points >= settings.bot_cost && user.files.length < settings.max_bots_per_user) {
            user.points -= settings.bot_cost;
            user.files.push(fileName);
            saveDB();
            await detectAndInstallDependencies(filePath, fileName, userId);
            const detectedType = detectBotType(filePath, fileName);
            runBotFile(filePath, parseInt(userId), fileName, detectedType);
            await bot.sendMessage(chatId,
                `🚀 <b>Template Deployed</b>\n📋 ${template}\n📱 Type: ${detectedType}\n💰 Remaining: ${user.points} points`,
                { parse_mode: 'HTML' }
            );
            logAction(userId, 'TEMPLATE_DEPLOY', `Template: ${template}`);
            await bot.answerCallbackQuery(call.id, { text: '✅ Deployed' });
        } else {
            fs.unlinkSync(filePath);
            await bot.answerCallbackQuery(call.id, { text: '❌ Insufficient points or max bots' });
        }
    }

    // --- FORCE JOIN CHECK ---
    else if (data === 'check_force_join') {
        const isMember = await checkForceJoin(userId);
        if (isMember) {
            await bot.deleteMessage(chatId, call.message.message_id);
            bot.sendMessage(chatId, 
                "✅ <b>You're already a member!</b>\n\nWelcome to the bot! Use /start to begin.", 
                { parse_mode: 'HTML' }
            );
            await bot.answerCallbackQuery(call.id, { text: '✅ Verified!' });
        } else {
            await bot.answerCallbackQuery(call.id, { text: '❌ Please join the channel first!' });
        }
    }

    // --- WEBSITE MANAGEMENT ---
    else if (data === 'delete_website') {
        if (user.websites && user.websites.length > 0) {
            const lastSite = user.websites.pop();
            saveDB();
            bot.sendMessage(chatId, `🗑 <b>Website Deleted</b>\n${lastSite.name}`, { parse_mode: 'HTML' });
            logAction(userId, 'DELETE_WEBSITE', `Site: ${lastSite.name}`);
        }
        bot.answerCallbackQuery(call.id);
    }

    // --- ADMIN COMMANDS ---
    else if (isAdmin(userId) && data.startsWith('adm_')) {
        const adminAction = data.replace('adm_', '');

        switch(adminAction) {
            case 'users':
                let userList = '👥 <b>Users List</b>\n\n';
                const entries = Object.entries(users_db).slice(0, 20);
                entries.forEach(([id, data]) => {
                    userList += `<code>${id}</code>: ${data.points} pts, ${data.files?.length || 0} bots, ${data.websites?.length || 0} websites${data.banned ? ' 🚫' : ''}\n`;
                });
                if (Object.keys(users_db).length > 20) {
                    userList += `\n... and ${Object.keys(users_db).length - 20} more`;
                }
                await bot.sendMessage(chatId, userList, { parse_mode: 'HTML' });
                break;

            case 'stats':
                const total = Object.keys(users_db).length;
                const activeBots = Object.values(running_processes).filter(p => p.exitCode === null).length;
                const totalFiles = Object.values(users_db).reduce((acc, u) => acc + (u.files || []).length, 0);
                const totalWebsites = Object.values(users_db).reduce((acc, u) => acc + (u.websites || []).length, 0);
                const banned = Object.values(users_db).filter(u => u.banned).length;
                const withPlans = Object.values(users_db).filter(u => u.plan && u.plan !== 'free').length;
                const ram = (1 - os.freemem() / os.totalmem()) * 100;
                
                await bot.answerCallbackQuery(call.id, {
                    text: `👥 ${total} users | 🤖 ${activeBots} bots | 📄 ${totalFiles} files | 🌐 ${totalWebsites} websites | ⭐ ${withPlans} plans | 💾 ${ram.toFixed(1)}% RAM`,
                    show_alert: true
                });
                break;

            case 'global_points':
                userSessions[userId] = { step: 'AWAITING_GLOBAL_POINTS' };
                await bot.sendMessage(chatId, "🌍 <b>Give Global Points</b>\nSend amount to give to ALL users:", { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id);
                break;

            case 'plans':
                await bot.sendMessage(chatId,
                    `⭐ <b>Plan Management</b>\n\nBasic: ${settings.star_prices.basic} Stars\nPremium: ${settings.star_prices.premium} Stars\nPro: ${settings.star_prices.pro} Stars\n\nTotal Users with Plans: ${Object.values(users_db).filter(u => u.plan && u.plan !== 'free').length}`,
                    { parse_mode: 'HTML' }
                );
                break;

            case 'broadcast':
                userSessions[userId] = { step: 'AWAITING_BROADCAST' };
                await bot.sendMessage(chatId, "📢 <b>Send Broadcast</b>\nType the message to send to all users:", { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id);
                break;

            case 'give_points':
                userSessions[userId] = { step: 'AWAITING_GIVE_POINTS', targetUser: null };
                await bot.sendMessage(chatId, "💰 <b>Give Points</b>\nSend the user ID:", { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id);
                break;

            case 'coupons':
                userSessions[userId] = { step: 'AWAITING_COUPON', points: 10 };
                await bot.sendMessage(chatId, "🎫 <b>Create Coupon</b>\nEnter coupon code:", { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id);
                break;

            case 'admins':
                await bot.sendMessage(chatId, 
                    `👥 <b>Admins</b>\n\n<code>${ADMIN_ID}</code> (Admin)\n<code>${OWNER_ID}</code> (Owner)\n<code>${ASSISTANT_ID}</code> (Assistant)`, 
                    { parse_mode: 'HTML' }
                );
                break;

            case 'backup':
                const backupFile = path.join(BACKUP_DIR, `backup_${Date.now()}.json`);
                fs.writeFileSync(backupFile, JSON.stringify(users_db, null, 2));
                await bot.sendDocument(chatId, backupFile);
                await bot.answerCallbackQuery(call.id, { text: '💾 Backup created' });
                break;

            case 'maintenance':
                settings.maintenance = !settings.maintenance;
                saveSettings();
                await bot.answerCallbackQuery(call.id, { 
                    text: settings.maintenance ? '🔴 Maintenance ON' : '🟢 Maintenance OFF' 
                });
                await bot.editMessageReplyMarkup(getAdminKeyboard(), { 
                    chat_id: chatId, 
                    message_id: call.message.message_id 
                });
                notifyAdmins(`🔧 <b>Maintenance ${settings.maintenance ? 'Enabled' : 'Disabled'}</b>`);
                break;

            case 'ban':
                userSessions[userId] = { step: 'AWAITING_BAN_USER' };
                await bot.sendMessage(chatId, "🚫 <b>Ban User</b>\nSend user ID:", { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id);
                break;

            case 'unban':
                userSessions[userId] = { step: 'AWAITING_UNBAN_USER' };
                await bot.sendMessage(chatId, "✅ <b>Unban User</b>\nSend user ID:", { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id);
                break;

            case 'notify_join':
                settings.notify_admins_on_join = !settings.notify_admins_on_join;
                saveSettings();
                await bot.answerCallbackQuery(call.id, { 
                    text: settings.notify_admins_on_join ? '✅ Notifications ON' : '❌ Notifications OFF' 
                });
                break;

            case 'force_join':
                settings.force_join = !settings.force_join;
                saveSettings();
                await bot.answerCallbackQuery(call.id, { 
                    text: settings.force_join ? '✅ Force Join ON' : '❌ Force Join OFF' 
                });
                break;

            case 'tickets':
                const tickets = settings.tickets || [];
                if (tickets.length === 0) {
                    await bot.sendMessage(chatId, "🎫 <b>No tickets</b>", { parse_mode: 'HTML' });
                } else {
                    let ticketMsg = "🎫 <b>All Tickets</b>\n\n";
                    tickets.forEach((t, i) => {
                        ticketMsg += `${i+1}. ${t.subject}\nUser: <code>${t.userId}</code>\nStatus: ${t.status || 'Open'}\n\n`;
                    });
                    await bot.sendMessage(chatId, ticketMsg, { parse_mode: 'HTML' });
                }
                break;

            case 'audit':
                const auditFile = path.join(LOGS_DIR, `actions_${new Date().toISOString().split('T')[0]}.log`);
                if (fs.existsSync(auditFile)) {
                    const logs = fs.readFileSync(auditFile, 'utf-8').split('\n').slice(-50);
                    await bot.sendMessage(chatId,
                        `📋 <b>Audit Log</b>\n<code>${logs.join('\n').substring(0, 4000)}</code>`,
                        { parse_mode: 'HTML' }
                    );
                } else {
                    await bot.sendMessage(chatId, "📋 <b>No audit logs</b>", { parse_mode: 'HTML' });
                }
                break;

            case 'settings':
                await bot.sendMessage(chatId,
                    `⚙️ <b>Current Settings</b>\n\nMaintenance: ${settings.maintenance ? '🔴 ON' : '🟢 OFF'}\nBot Cost: ${settings.bot_cost} pts\nWebsite Cost: ${settings.website_cost} pts\nWhatsApp Cost: ${settings.whatsapp_cost} pts\nMax Bots: ${settings.max_bots_per_user}\nMax Websites: ${settings.max_websites_per_user}\nTrial: ${settings.free_trial_days} days\nRate Limit: ${settings.rate_limit}/min\nForce Join: ${settings.force_join ? '✅ ON' : '❌ OFF'}\nNotify Admins: ${settings.notify_admins_on_join ? '✅ ON' : '❌ OFF'}`,
                    { parse_mode: 'HTML' }
                );
                break;

            case 'force_backup':
                const fBackup = path.join(BACKUP_DIR, `backup_${Date.now()}.json`);
                fs.writeFileSync(fBackup, JSON.stringify(users_db, null, 2));
                await bot.sendMessage(chatId, `✅ <b>Force Backup Created</b>\n<code>${fBackup}</code>`, { parse_mode: 'HTML' });
                await bot.answerCallbackQuery(call.id, { text: '💾 Backup created' });
                break;

            case 'server_stats':
                const uptime2 = os.uptime();
                const days2 = Math.floor(uptime2 / 86400);
                const hours2 = Math.floor((uptime2 % 86400) / 3600);
                const mins2 = Math.floor((uptime2 % 3600) / 60);
                
                await bot.sendMessage(chatId,
                    `🖥 <b>Server Stats</b>\n\n💻 OS: ${os.type()} ${os.release()}\n🔄 Uptime: ${days2}d ${hours2}h ${mins2}m\n💾 RAM: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)}GB\n🔄 Load: ${os.loadavg()[0].toFixed(2)}`,
                    { parse_mode: 'HTML' }
                );
                break;

            case 'reset_all':
                await bot.sendMessage(chatId,
                    `⚠️ <b>Reset All Data</b>\n\nThis will DELETE all user data!\nType <code>CONFIRM_RESET</code> to proceed.`,
                    { parse_mode: 'HTML' }
                );
                userSessions[userId] = { step: 'AWAITING_RESET_CONFIRM' };
                break;

            default:
                await bot.sendMessage(chatId, `✅ <b>${adminAction}</b>\nAction executed.`, { parse_mode: 'HTML' });
        }
    }
});

// --- WELCOME TEXT ---
function getWelcomeText(msg) {
    const user = msg.from;
    const userId = user.id.toString();
    const points = users_db[userId]?.points || 0;
    const status = settings.maintenance ? '🔴 MAINTENANCE' : '🟢 ONLINE';
    const plan = users_db[userId]?.plan || 'Free';
    const isAdminUser = isAdmin(userId);
    
    let adminBadge = isAdminUser ? ' 👑 ADMIN' : '';
    
    return `<blockquote>Pʀᴇᴍɪᴜᴍ Hᴏsᴛɪɴɢ Bᴏᴛ
━━━━━━━━━━━━━━━━
👋 ᴡᴇʟᴄᴏᴍᴇ <b>${user.first_name}</b>${adminBadge}!

🤖 ᴅᴇᴘʟᴏʏ ᴛᴇʟᴇɢʀᴀᴍ & ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs 
🌐 ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇs
🚀 ᴀᴜᴛᴏ ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs
🔍 ʀᴇᴀʟ-ᴛɪᴍᴇ ʟᴏɢs
⭐ ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴs ᴀᴠᴀɪʟᴀʙʟᴇ

━━━━━━━━━━━━━━━━
🆔 ᴜɪᴅ: <code>${userId}</code>
💰 ᴘᴏɪɴᴛs: <b>${points}</b>
📋 ᴘʟᴀɴ: <b>${plan}</b>
⚡ sᴛᴀᴛᴜs: ${status}

<b>Costs:</b>
🤖 ᴛᴇʟᴇɢʀᴀᴍ ʙᴏᴛ: ${settings.bot_cost} pts
📱 ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ: ${settings.whatsapp_cost} pts
🌐 ᴡᴇʙsɪᴛᴇ: ${settings.website_cost} pts

👇 ᴜsᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ ᴛᴏ ᴍᴀɴᴀɢᴇ.!</blockquote>`;
}

// --- AUTO BACKUP ---
function autoBackup() {
    const backupFile = path.join(BACKUP_DIR, `backup_auto_${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(users_db, null, 2));
    
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_auto_'));
    if (backups.length > 10) {
        const sorted = backups.sort();
        sorted.slice(0, sorted.length - 10).forEach(f => {
            fs.unlinkSync(path.join(BACKUP_DIR, f));
        });
    }
}

// --- START BOT ---
console.log('🤖 Premium Hosting Bot Online');
console.log(`👥 Users: ${Object.keys(users_db).length}`);
console.log(`🖥 Platform: ${os.type()}`);
console.log('⚡ Ready!');

setInterval(autoBackup, settings.backup_interval * 1000 || 86400000);

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
