const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');
const moment = require('moment');

// --- Configuration ---
const TOKEN = process.env.BOTTOKEN || 'YOUR_JS_BOT_TOKEN';
const ADMIN_ID = 7158115683;
const CHANNEL_ID = '@MRANONIMOUS01';

const bot = new TelegramBot(TOKEN, { polling: true });

// FIXED: Use absolute paths
const BASE_DIR = __dirname;
const DB_FILE = path.join(BASE_DIR, 'users_data.json');
const SETTINGS_FILE = path.join(BASE_DIR, 'bot_settings.json');
const DEPLOY_DIR = path.join(BASE_DIR, 'deployed_bots');
const LOGS_DIR = path.join(BASE_DIR, 'bot_logs');

// Create directories
[DEPLOY_DIR, LOGS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- Persistence Functions ---
function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 4));
    } catch (e) {}
}

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        points_per_referral: 2,
        hosting_cost: 4,
        maintenance: false,
        welcome_video: null,
        bot_username: null,
        new_user_notify: true
    };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
    } catch (e) {}
}

let usersDB = loadDB();
let settings = loadSettings();
let runningProcesses = {};

// --- Premium UI Functions ---
function premiumText(title, content, icon = '✦', footer = null) {
    const divider = '▰▰▰▰▰▰▰▰▰▰▰▰▰▰';
    let html = `
<b>╔════════════════════╗</b>
<b>║  ${icon} ${title}</b>
<b>╚════════════════════╝</b>

<blockquote>${content}</blockquote>`;
    
    if (footer) {
        html += `\n<blockquote>${footer}</blockquote>`;
    }
    html += `\n<blockquote>━ ${divider} ━</blockquote>`;
    return html;
}

function successText(title, content) {
    return premiumText(`✅ ${title}`, content, '✨', 'ᴛʜᴀɴᴋ ʏᴏᴜ ғᴏʀ ᴄʜᴏᴏsɪɴɢ ᴊs 𝕻ʀᴇᴍɪᴜᴍ 𝕮ʟᴏᴜᴅ 𝕳ᴏsᴛɪɴɢ');
}

function errorText(title, content) {
    return premiumText(`❌ ${title}`, content, '⚠️', 'ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ᴏʀ ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ');
}

function infoText(title, content) {
    return premiumText(`ℹ️ ${title}`, content, '📌', 'ɴᴇᴇᴅ ʜᴇʟᴘ? ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ');
}

// --- Admin Notification ---
function notifyAdminNewUser(userId, userName, username = null, referrer = null) {
    const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
    const totalUsers = Object.keys(usersDB).length;
    
    let notification = `
<b>╔═══════════════════╗</b>
<b>║  🆕 ɴᴇᴡ ᴜsᴇʀ ᴊᴏɪɴᴇᴅ</b>
<b>╚═══════════════════╝</b>

<blockquote>👤 <b>ᴜsᴇʀ ɪᴅ:</b> ${userId}
📛 <b>ɴᴀᴍᴇ:</b> ${userName}
${username ? `🔖 <b>ᴜsᴇʀɴᴀᴍᴇ:</b> @${username}` : ''}
🕐 <b>ᴊᴏɪɴᴇᴅ:</b> ${timestamp}</blockquote>

<blockquote>📊 <b>sᴛᴀᴛɪsᴛɪᴄs:</b>
• ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${totalUsers}
• ʀᴜɴɴɪɴɢ ʙᴏᴛs: ${Object.keys(runningProcesses).length}</blockquote>`;
    
    if (referrer) {
        notification += `
<blockquote>🔗 <b>ʀᴇғᴇʀʀᴇʀ:</b> ${referrer}
💰 <b>ʙᴏɴᴜs:</b> +${settings.points_per_referral} points</blockquote>`;
    }
    
    try {
        bot.sendMessage(ADMIN_ID, notification, { parse_mode: 'HTML' });
        return true;
    } catch (e) {
        return false;
    }
}

// --- JS ONLY Hosting Logic ---
function installNodeDependencies(dirPath, userId, fileName) {
    return new Promise((resolve) => {
        const packageJson = path.join(dirPath, 'package.json');
        if (fs.existsSync(packageJson)) {
            exec('npm install --production --silent', { cwd: dirPath }, (error) => {
                if (error) {
                    resolve({ success: false, msg: 'Failed to install Node dependencies' });
                } else {
                    resolve({ success: true, msg: 'Node dependencies installed' });
                }
            });
        } else {
            resolve({ success: true, msg: 'No package.json found' });
        }
    });
}

function runUserFile(filePath, userId, fileName) {
    return new Promise((resolve) => {
        // FIXED: Use absolute path
        const absPath = path.resolve(filePath);
        
        if (!fs.existsSync(absPath)) {
            bot.sendMessage(userId, errorText('File Error', `<code>File not found: ${absPath}</code>`), { parse_mode: 'HTML' });
            resolve({ success: false, status: 'File not found' });
            return;
        }
        
        const ext = path.extname(fileName).toLowerCase();
        
        // JS ONLY - Only accept .js files
        if (ext !== '.js') {
            bot.sendMessage(userId, errorText('Wrong Bot', 
                'This bot only deploys <b>JavaScript (.js)</b> files.\nUse the Python bot for Python files.'), { parse_mode: 'HTML' });
            resolve({ success: false, status: 'Wrong bot - Use Python bot' });
            return;
        }
        
        const logFile = path.join(LOGS_DIR, `${userId}_${fileName.replace(/\./g, '_')}.log`);
        fs.writeFileSync(logFile, `=== Bot Started: ${moment().format('YYYY-MM-DD HH:mm:ss')} ===\nUser ID: ${userId}\nFile: ${fileName}\nPath: ${absPath}\n${'='.repeat(50)}\n\n`);
        
        // FIXED: Use absolute path
        const process = spawn('node', [absPath], {
            cwd: path.dirname(absPath),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        runningProcesses[absPath] = {
            process: process,
            userId: userId,
            fileName: fileName,
            startTime: moment(),
            logFile: logFile,
            pid: process.pid
        };
        
        process.stdout.on('data', (data) => {
            fs.appendFileSync(logFile, data.toString());
        });
        process.stderr.on('data', (data) => {
            fs.appendFileSync(logFile, data.toString());
        });
        
        setTimeout(() => {
            if (process.exitCode !== null) {
                const errorMsg = fs.readFileSync(logFile, 'utf8').slice(-2000);
                bot.sendMessage(userId, errorText('Deployment Failed', 
                    `<b>Runtime Error</b>\n\n<pre>${errorMsg.slice(0, 1500)}</pre>`), { parse_mode: 'HTML' });
                delete runningProcesses[absPath];
                resolve({ success: false, status: 'Runtime error' });
            } else {
                bot.sendMessage(userId, successText('Bot Deployed', 
                    `📄 <b>File:</b> ${fileName}\n🟢 <b>Status:</b> Running\n📊 <b>PID:</b> ${process.pid}\n🟢 <b>Type:</b> JavaScript`), { parse_mode: 'HTML' });
                resolve({ success: true, status: 'Running' });
            }
        }, 3000);
    });
}

function stopBot(filePath) {
    const absPath = path.resolve(filePath);
    if (runningProcesses[absPath]) {
        try {
            runningProcesses[absPath].process.kill();
            delete runningProcesses[absPath];
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

// --- Channel Announcement ---
async function announceDeployment(userId, fileName) {
    try {
        const user = await bot.getChat(userId);
        const userName = user.first_name || 'User';
        const userMention = `<a href="tg://user?id=${userId}">${userName}</a>`;
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        
        const announcement = `
<b>╔══════════════════╗</b>
<b>║✦🄽🄴🅆 🄱🄾🅃 🄳🄴🄿🄻🄾🅈🄴🄳✦</b>
<b>╚══════════════════╝</b>

<blockquote>👤 <b>ᴅᴇᴘʟᴏʏᴇᴅ ʙʏ:</b> ${userMention}
📄 <b>ғɪʟᴇ:</b> ${fileName}
🕐 <b>ᴛɪᴍᴇ:</b> ${timestamp}
⚡ <b>sᴛᴀᴛᴜs:</b> 🟢 ʀᴜɴɴɪɴɢ
📂 <b>ᴛʏᴘᴇ:</b> 🟢 ᴊᴀᴠᴀsᴄʀɪᴘᴛ</blockquote>

<blockquote>━━━━━━━━━━━━━━━━━━━━━━━
🎯 <b>🄳🄴🄿🄻🄾🅈 🅄🅁🅂 🄽🄾🅆</b>
💡 ᴘʀᴇᴍɪᴜᴍ 24/7 ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ
⚡ ғᴀsᴛ & ʀᴇʟɪᴀʙʟᴇ sᴇʀᴠɪᴄᴇ
🛡️ sᴇᴄᴜʀᴇ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ
━━━━━━━━━━━━━━━━━━━━━━━</blockquote>

<blockquote>💰 <b>ᴄᴏsᴛ:</b> ᴏɴʟʏ ${settings.hosting_cost} points
✨ <b>Features:</b> ᴀᴜᴛᴏ-ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs, ʀᴇᴀʟ-ᴛɪᴍᴇ ʟᴏɢs, 24/7 ᴜᴘᴛɪᴍᴇ</blockquote>`;
        
        await bot.sendMessage(CHANNEL_ID, announcement, { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 ᴅᴇᴘʟᴏʏ ɴᴏᴡ', url: `https://t.me/${settings.bot_username || 'your_bot'}` }]
                ]
            }
        });
        return true;
    } catch (e) {
        return false;
    }
}

// --- Main Keyboard ---
function mainKeyboard(userId) {
    return {
        keyboard: [
            ['✦ Deploy JS', '✦ My Files'],
            ['✦ Points', '✦ Stats'],
            ['✦ Referral', '✦ Logs'],
            ['✦ Channel', '✦ Support'],
            ['✦ More Bots', '✦ Daily']
        ],
        resize_keyboard: true
    };
}

function adminKeyboard() {
    const maintText = settings.maintenance ? '🔴 Maintenance ON' : '🟢 Maintenance OFF';
    const notifyText = settings.new_user_notify ? '🔔 Notify ON' : '🔕 Notify OFF';
    
    return {
        inline_keyboard: [
            [{ text: '➕ Add Points', callback_data: 'adm_add_pts' }],
            [{ text: '🌍 Global Add Points', callback_data: 'adm_global_add_pts' }],
            [{ text: '📢 Broadcast', callback_data: 'adm_broadcast' }],
            [{ text: '🎥 Set Video', callback_data: 'adm_set_video' }],
            [{ text: '💾 Backup', callback_data: 'adm_backup' }],
            [{ text: maintText, callback_data: 'adm_toggle_maint' }],
            [{ text: notifyText, callback_data: 'adm_toggle_notify' }],
            [{ text: '🖥 Server Stats', callback_data: 'adm_stats' }],
            [{ text: '🧹 Clean Bots', callback_data: 'adm_clean' }],
            [{ text: '📊 System Info', callback_data: 'adm_system' }]
        ]
    };
}

// --- Handlers ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    
    if (settings.maintenance && uid !== String(ADMIN_ID)) {
        return bot.sendMessage(chatId, premiumText('🔧 Maintenance', 'Bot is under maintenance.', '🔄'), { parse_mode: 'HTML' });
    }
    
    const isNew = !usersDB[uid];
    
    if (isNew) {
        usersDB[uid] = {
            points: 10,
            files: [],
            joined: moment().format(),
            total_deployments: 0
        };
        
        let referrer = null;
        const params = msg.text.split(' ');
        if (params.length > 1) {
            const refId = params[1];
            if (usersDB[refId] && refId !== uid) {
                usersDB[refId].points += settings.points_per_referral;
                referrer = refId;
                try {
                    bot.sendMessage(parseInt(refId), premiumText('🎁 Referral Bonus!', 
                        `User ${uid} joined!\n💰 +${settings.points_per_referral} points`), { parse_mode: 'HTML' });
                } catch (e) {}
            }
        }
        saveDB(usersDB);
        
        if (settings.new_user_notify) {
            notifyAdminNewUser(uid, msg.from.first_name, msg.from.username, referrer);
        }
    }
    
    if (!settings.bot_username) {
        const botInfo = await bot.getMe();
        settings.bot_username = botInfo.username;
        saveSettings(settings);
    }
    
    const points = usersDB[uid]?.points || 0;
    
    const welcomeText = `
<b>🟢 ᴊᴀᴠᴀsᴄʀɪᴘᴛ ᴘʀᴇᴍɪᴜᴍ ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ ✦</b>
<b>🌐 24/7 ᴊs ᴄʟᴏᴜᴅ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ</b>

━━━━━━━━━━━━━━━━━━━━

<b>👋 ᴡᴇʟᴄᴏᴍᴇ${isNew ? '' : ' back'}, ${msg.from.first_name}!</b>

<b>📊 ʏᴏᴜʀ ᴅᴀsʜʙᴏᴀʀᴅ:</b>
• 💰 ᴘᴏɪɴᴛs: ${points}
• 🤖 ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${Object.keys(runningProcesses).length}

━━━━━━━━━━━━━━━━━━━━━

<b>✨ ғᴇᴀᴛᴜʀᴇs:</b>
• 📤 ᴅᴇᴘʟᴏʏ ᴊᴀᴠᴀsᴄʀɪᴘᴛ (.js) ᴏɴʟʏ
• 🚀 ᴀᴜᴛᴏ ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs
• 🔍 ʀᴇᴀʟ-ᴛɪᴍᴇ ʟᴏɢs
• ⚡ 24/7 ᴜᴘᴛɪᴍᴇ

💡 ᴜsᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ!`;
    
    bot.sendMessage(chatId, premiumText('ᴡᴇʟᴄᴏᴍᴇ', welcomeText, '🟢'), {
        parse_mode: 'HTML',
        reply_markup: mainKeyboard(uid)
    });
});

bot.onText(/✦ Deploy JS/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const points = usersDB[uid]?.points || 0;
    const cost = settings.hosting_cost;
    
    if (points < cost) {
        return bot.sendMessage(chatId, premiumText('💎 Insufficient Points',
            `💰 Balance: ${points} pts\n💎 Required: ${cost} pts\n\n💡 Invite friends to earn more!`), { parse_mode: 'HTML' });
    }
    
    bot.sendMessage(chatId, premiumText('📤 Deploy JS Bot',
        `📂 Supported: .js, .zip\n💰 Cost: ${cost} pts\n💎 Balance: ${points} pts\n\n📌 <b>JavaScript only!</b>`, '🟢'), { 
        parse_mode: 'HTML' 
    }).then(() => {
        bot.once('document', async (docMsg) => {
            await processUpload(docMsg);
        });
    });
});

async function processUpload(msg) {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    
    if (!msg.document) {
        return bot.sendMessage(chatId, errorText('No File', 'Please send a valid file.'), { parse_mode: 'HTML' });
    }
    
    const fileName = msg.document.file_name;
    // FIXED: Use absolute path
    const filePath = path.join(DEPLOY_DIR, `${uid}_${fileName}`);
    const absFilePath = path.resolve(filePath);
    
    console.log(`📥 Upload: ${fileName}`);
    console.log(`📁 Saving to: ${absFilePath}`);
    
    // JS ONLY - Only accept .js and .zip
    const validExtensions = ['.js', '.zip'];
    if (!validExtensions.some(ext => fileName.toLowerCase().endsWith(ext))) {
        return bot.sendMessage(chatId, errorText('Wrong Format', 
            `❌ This bot only deploys <b>JavaScript (.js)</b> files!\nSupported: ${validExtensions.join(', ')}`), { parse_mode: 'HTML' });
    }
    
    const progMsg = await bot.sendMessage(chatId, premiumText('⏳ Processing...', 
        `📦 File: ${fileName}\n⏳ Status: Uploading...`, '⚙️'), { parse_mode: 'HTML' });
    
    try {
        const file = await bot.getFile(msg.document.file_id);
        const fileContent = await bot.downloadFile(file.file_path);
        fs.writeFileSync(absFilePath, fileContent);
        
        let finalPath = absFilePath;
        let finalName = fileName;
        
        if (fileName.endsWith('.zip')) {
            const extractDir = path.join(DEPLOY_DIR, `${uid}_${fileName.replace('.zip', '')}`);
            const absExtractDir = path.resolve(extractDir);
            const zip = new AdmZip(absFilePath);
            zip.extractAllTo(absExtractDir, true);
            fs.unlinkSync(absFilePath);
            
            let mainFile = null;
            let hasPy = false;
            const walkDir = (dir) => {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        walkDir(fullPath);
                    } else if (file.endsWith('.py')) {
                        hasPy = true;
                    } else if (file.endsWith('.js')) {
                        if (!mainFile) mainFile = fullPath;
                    }
                }
            };
            walkDir(absExtractDir);
            
            if (hasPy && !mainFile) {
                return bot.sendMessage(chatId, errorText('Wrong Format', 
                    '❌ This archive contains only Python files!\nThis bot only deploys <b>JavaScript</b> bots.'), { parse_mode: 'HTML' });
            }
            
            if (!mainFile) {
                return bot.sendMessage(chatId, errorText('Invalid ZIP', 'No JavaScript (.js) file found.'), { parse_mode: 'HTML' });
            }
            
            finalPath = path.resolve(mainFile);
            finalName = path.basename(mainFile);
            console.log(`📦 Extracted: ${finalPath}`);
        }
        
        // Ensure it's a JavaScript file
        if (!finalName.endsWith('.js')) {
            return bot.sendMessage(chatId, errorText('Wrong Format', 
                '❌ This bot only deploys <b>JavaScript (.js)</b> files!'), { parse_mode: 'HTML' });
        }
        
        // Verify file exists
        if (!fs.existsSync(finalPath)) {
            return bot.sendMessage(chatId, errorText('File Error', 
                `File not found: ${finalPath}`), { parse_mode: 'HTML' });
        }
        
        // Install Node dependencies
        await bot.editMessageText(premiumText('⏳ Processing...', 
            `📦 Installing Node.js dependencies...`, '⚙️'), {
            chat_id: chatId,
            message_id: progMsg.message_id,
            parse_mode: 'HTML'
        });
        
        const dirPath = path.dirname(finalPath);
        const result = await installNodeDependencies(dirPath, uid, finalName);
        if (!result.success) {
            bot.sendMessage(chatId, infoText('⚠️ Warning', `Node dependencies: ${result.msg}`), { parse_mode: 'HTML' });
        }
        
        // Run the bot
        const runResult = await runUserFile(finalPath, parseInt(uid), finalName);
        
        if (runResult.success) {
            if (!usersDB[uid].files.includes(finalName)) {
                usersDB[uid].files.push(finalName);
            }
            usersDB[uid].points -= settings.hosting_cost;
            usersDB[uid].total_deployments = (usersDB[uid].total_deployments || 0) + 1;
            saveDB(usersDB);
            
            await bot.editMessageText(successText('Deployment Successful!',
                `📄 File: ${finalName}\n🟢 Status: Running\n💰 Remaining: ${usersDB[uid].points} pts`), {
                chat_id: chatId,
                message_id: progMsg.message_id,
                parse_mode: 'HTML'
            });
            
            announceDeployment(parseInt(uid), finalName);
        } else {
            await bot.editMessageText(errorText('Deployment Failed', 
                `📄 File: ${finalName}\n❌ Status: ${runResult.status}`), {
                chat_id: chatId,
                message_id: progMsg.message_id,
                parse_mode: 'HTML'
            });
        }
        
    } catch (e) {
        console.error(e);
        await bot.editMessageText(errorText('Deployment Error', `❌ ${e.message}`), {
            chat_id: chatId,
            message_id: progMsg.message_id,
            parse_mode: 'HTML'
        });
    }
}

// --- Rest of handlers ---
bot.onText(/✦ My Files/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const files = usersDB[uid]?.files || [];
    
    if (files.length === 0) {
        return bot.sendMessage(chatId, infoText('📂 No Files', 'Use <b>✦ Deploy JS</b> to get started!'), { parse_mode: 'HTML' });
    }
    
    files.forEach(fName => {
        const fPath = path.join(DEPLOY_DIR, `${uid}_${fName}`);
        const absPath = path.resolve(fPath);
        const isRunning = runningProcesses[absPath] && runningProcesses[absPath].process.exitCode === null;
        const status = isRunning ? '🟢 Running' : '🔴 Stopped';
        const pid = isRunning ? runningProcesses[absPath].pid : 'N/A';
        
        let runtime = '';
        if (isRunning) {
            const minutes = moment().diff(runningProcesses[absPath].startTime, 'minutes');
            runtime = `⏱️ ${minutes}m`;
        }
        
        const markup = {
            inline_keyboard: [
                [{ text: '▶️ Start', callback_data: `run_${fName}_${uid}` }, 
                 { text: '⏹ Stop', callback_data: `stop_${fName}_${uid}` }],
                [{ text: '📥 Download', callback_data: `down_${fName}_${uid}` },
                 { text: '📋 Logs', callback_data: `logs_${fName}_${uid}` }],
                [{ text: '🗑️ Delete', callback_data: `del_${fName}_${uid}` }]
            ]
        };
        
        bot.sendMessage(chatId, premiumText(`📄 ${fName}`, 
            `Status: ${status}\nPID: ${pid}\n🟢 JavaScript\n${runtime}`, '🤖'), {
            parse_mode: 'HTML',
            reply_markup: markup
        });
    });
});

bot.onText(/✦ Points/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const userData = usersDB[uid] || {};
    
    bot.sendMessage(chatId, premiumText('💰 Points Dashboard',
        `💎 Balance: ${userData.points || 0} pts\n📤 Deployments: ${userData.total_deployments || 0}\n📂 Active Bots: ${userData.files?.length || 0}\n💸 Cost/Bot: ${settings.hosting_cost} pts\n\n💡 Referral: +${settings.points_per_referral} pts`, '💎'), { parse_mode: 'HTML' });
});

bot.onText(/✦ Stats/, (msg) => {
    const chatId = msg.chat.id;
    const totalUsers = Object.keys(usersDB).length;
    const activeUsers = Object.values(usersDB).filter(u => u.files?.length > 0).length;
    const totalBots = Object.keys(runningProcesses).length;
    const totalFiles = Object.values(usersDB).reduce((sum, u) => sum + (u.files?.length || 0), 0);
    const totalPoints = Object.values(usersDB).reduce((sum, u) => sum + (u.points || 0), 0);
    
    bot.sendMessage(chatId, premiumText('📊 Platform Statistics',
        `👥 Users: ${totalUsers}\n📤 Active: ${activeUsers}\n🤖 Running Bots: ${totalBots}\n📄 Deployed Files: ${totalFiles}\n💰 Total Points: ${totalPoints}`, '📊'), { parse_mode: 'HTML' });
});

bot.onText(/✦ Referral/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const refLink = `https://t.me/${settings.bot_username || 'your_bot'}?start=${uid}`;
    
    bot.sendMessage(chatId, premiumText('🔗 Referral System',
        `💰 Bonus: ${settings.points_per_referral} pts per referral\n\n📎 Your Link:\n<code>${refLink}</code>`, '🎯'), { parse_mode: 'HTML' });
});

bot.onText(/✦ Logs/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const files = usersDB[uid]?.files || [];
    
    if (files.length === 0) {
        return bot.sendMessage(chatId, infoText('No Logs', 'No bots deployed yet.'), { parse_mode: 'HTML' });
    }
    
    const markup = {
        inline_keyboard: files.map(fName => [{ text: `📄 ${fName}`, callback_data: `viewlog_${fName}_${uid}` }])
    };
    
    bot.sendMessage(chatId, premiumText('📋 View Logs', 'Select a bot:', '📜'), {
        parse_mode: 'HTML',
        reply_markup: markup
    });
});

bot.onText(/✦ Channel/, (msg) => {
    const chatId = msg.chat.id;
    const markup = {
        inline_keyboard: [
            [{ text: '📢 Join Channel', url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }]
        ]
    };
    
    bot.sendMessage(chatId, premiumText('📢 Stay Updated', `Channel: ${CHANNEL_ID}`, '📡'), {
        parse_mode: 'HTML',
        reply_markup: markup
    });
});

bot.onText(/✦ Support/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, premiumText('📞 Support Center',
        `👤 Owner: @MRANONIMOUS01\n📢 Channel: ${CHANNEL_ID}\n\n💡 JS bot only!`, '💬'), { parse_mode: 'HTML' });
});

bot.onText(/✦ More Bots/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, premiumText('ᴍᴏʀᴇ ʙᴏᴛs',
        `
ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛs ɪɴᴄ 

ɴᴇxᴛ ʟᴇᴠᴇʟ ᴏғ ʙᴏᴛ ɪɴᴛᴇʀɢᴀᴛɪᴏɴ 

ᴀᴠᴀɪʟᴀʙʟᴇ ʙᴏᴛs ʙᴇʟᴏᴡ

sᴛᴀᴛᴜs :  ᴏɴʟɪɴᴇ 🟢   ᴏғғʟɪɴᴇ 🔴

═════════════════   
 
╭┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮
 <a href="https://t.me/PREMIUM_COULD_HOSTING_PY_BOT">ᴘʀᴇᴍɪᴜᴍ ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ ┈ᴘʏ┈</a> 🟢
╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯

╭┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮
 <a href="https://t.me/Premiun_Cloud_Hosting_Js_Robot">ᴘʀᴇᴍɪᴜᴍ ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ ┈ᴊs┈</a>  🟢
╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯

╭┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮
 <a href="https://t.me/PREMIUM_VPS_BOT_HOSTING_ROBOT">ᴘʀᴇᴍɪᴜᴍ ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ ʙᴏᴛs</a>  🟢
╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯

═════════════════
• More Bots Coming Soon ⚡️
`, '🔮'), { parse_mode: 'HTML' });
});

bot.onText(/✦ Daily/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    const lastClaim = usersDB[uid]?.last_daily;
    const today = moment().format('YYYY-MM-DD');
    
    if (lastClaim === today) {
        return bot.sendMessage(chatId, premiumText('⏳ Daily Reward', 'Already claimed today!', '⏰'), { parse_mode: 'HTML' });
    }
    
    const reward = 5;
    usersDB[uid].points = (usersDB[uid].points || 0) + reward;
    usersDB[uid].last_daily = today;
    saveDB(usersDB);
    
    bot.sendMessage(chatId, premiumText('🎉 Daily Reward', 
        `💰 +${reward} points\n💎 New Balance: ${usersDB[uid].points} pts`, '⭐'), { parse_mode: 'HTML' });
});

bot.onText(/✦ Admin Panel/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    
    if (uid !== String(ADMIN_ID)) return;
    
    const totalUsers = Object.keys(usersDB).length;
    const activeUsers = Object.values(usersDB).filter(u => u.files?.length > 0).length;
    const totalFiles = Object.values(usersDB).reduce((sum, u) => sum + (u.files?.length || 0), 0);
    
    bot.sendMessage(chatId, premiumText('👑 Admin Panel',
        `Users: ${totalUsers}\nActive: ${activeUsers}\nBots: ${Object.keys(runningProcesses).length}\nFiles: ${totalFiles}`, '🔐'), {
        parse_mode: 'HTML',
        reply_markup: adminKeyboard()
    });
});

bot.onText(/✦ All Files/, (msg) => {
    const chatId = msg.chat.id;
    const uid = String(msg.from.id);
    
    if (uid !== String(ADMIN_ID)) return;
    
    bot.sendMessage(chatId, premiumText('🌍 Global File Control', 'Managing all deployed JS bots', '🔍'), { parse_mode: 'HTML' });
    
    let found = false;
    for (const [targetUid, data] of Object.entries(usersDB)) {
        for (const fName of (data.files || [])) {
            found = true;
            const fPath = path.join(DEPLOY_DIR, `${targetUid}_${fName}`);
            const absPath = path.resolve(fPath);
            const isRunning = runningProcesses[absPath] && runningProcesses[absPath].process.exitCode === null;
            const status = isRunning ? '🟢' : '🔴';
            
            const markup = {
                inline_keyboard: [
                    [{ text: '▶️ RUN', callback_data: `run_${fName}_${targetUid}` },
                     { text: '⏹ STOP', callback_data: `stop_${fName}_${targetUid}` }],
                    [{ text: '📥 DOWNLOAD', callback_data: `down_${fName}_${targetUid}` },
                     { text: '🗑️ DELETE', callback_data: `del_${fName}_${targetUid}` }],
                    [{ text: '📋 LOGS', callback_data: `logs_${fName}_${targetUid}` }]
                ]
            };
            
            bot.sendMessage(chatId, `👤 User: ${targetUid}\n📄 File: ${fName} ${status}`, {
                reply_markup: markup
            });
        }
    }
    
    if (!found) {
        bot.sendMessage(chatId, infoText('No Files', 'No deployed bots found.'), { parse_mode: 'HTML' });
    }
});

// --- Callback Handler ---
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const msgId = callbackQuery.message.message_id;
    const uid = String(callbackQuery.from.id);
    const data = callbackQuery.data;
    
    if (data.startsWith('viewlog_')) {
        const parts = data.split('_');
        const fName = parts.slice(1, -1).join('_');
        const targetUid = parts[parts.length - 1];
        const logFile = path.join(LOGS_DIR, `${targetUid}_${fName.replace(/\./g, '_')}.log`);
        
        if (fs.existsSync(logFile)) {
            const content = fs.readFileSync(logFile, 'utf8').slice(-2000);
            bot.sendMessage(chatId, premiumText(`📋 Logs: ${fName}`, `<code>${content}</code>`, '📜'), { parse_mode: 'HTML' });
        } else {
            bot.answerCallbackQuery(callbackQuery.id, 'No log file found.');
        }
        return;
    }
    
    if (data.startsWith('run_') || data.startsWith('stop_') || data.startsWith('down_') || data.startsWith('del_') || data.startsWith('logs_')) {
        const parts = data.split('_');
        const action = parts[0];
        const fName = parts.slice(1, -1).join('_');
        const targetUid = parts[parts.length - 1];
        const fPath = path.join(DEPLOY_DIR, `${targetUid}_${fName}`);
        const absPath = path.resolve(fPath);
        
        if (action === 'stop') {
            if (stopBot(absPath)) {
                bot.answerCallbackQuery(callbackQuery.id, '⏹ Bot stopped!');
                bot.editMessageReplyMarkup(null, { chat_id: chatId, message_id: msgId });
            } else {
                bot.answerCallbackQuery(callbackQuery.id, 'Failed to stop bot.');
            }
        } else if (action === 'run') {
            const result = await runUserFile(absPath, parseInt(targetUid), fName);
            if (result.success) {
                bot.answerCallbackQuery(callbackQuery.id, '▶️ Bot started!');
                bot.editMessageReplyMarkup(null, { chat_id: chatId, message_id: msgId });
            } else {
                bot.answerCallbackQuery(callbackQuery.id, `Failed: ${result.status.slice(0, 50)}`);
            }
        } else if (action === 'down') {
            if (fs.existsSync(absPath)) {
                bot.sendDocument(chatId, absPath, { caption: `📥 ${fName}` });
            } else {
                bot.answerCallbackQuery(callbackQuery.id, 'File not found!');
            }
        } else if (action === 'del') {
            try {
                if (runningProcesses[absPath]) stopBot(absPath);
                if (fs.existsSync(absPath)) {
                    const stat = fs.statSync(absPath);
                    if (stat.isDirectory()) {
                        fs.rmSync(absPath, { recursive: true });
                    } else {
                        fs.unlinkSync(absPath);
                    }
                }
                if (usersDB[targetUid] && usersDB[targetUid].files) {
                    usersDB[targetUid].files = usersDB[targetUid].files.filter(f => f !== fName);
                    saveDB(usersDB);
                }
                const logFile = path.join(LOGS_DIR, `${targetUid}_${fName.replace(/\./g, '_')}.log`);
                if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
                bot.deleteMessage(chatId, msgId);
                bot.answerCallbackQuery(callbackQuery.id, '🗑️ Deleted!');
            } catch (e) {
                bot.answerCallbackQuery(callbackQuery.id, `Error: ${e.message.slice(0, 50)}`);
            }
        } else if (action === 'logs') {
            const logFile = path.join(LOGS_DIR, `${targetUid}_${fName.replace(/\./g, '_')}.log`);
            if (fs.existsSync(logFile)) {
                const content = fs.readFileSync(logFile, 'utf8').slice(-2000);
                bot.sendMessage(chatId, premiumText(`📋 Logs: ${fName}`, `<code>${content}</code>`, '📜'), { parse_mode: 'HTML' });
            } else {
                bot.answerCallbackQuery(callbackQuery.id, 'No log file found.');
            }
        }
        return;
    }
    
    // Admin functions
    if (uid === String(ADMIN_ID)) {
        if (data === 'adm_toggle_maint') {
            settings.maintenance = !settings.maintenance;
            saveSettings(settings);
            bot.answerCallbackQuery(callbackQuery.id, `Maintenance: ${settings.maintenance ? 'ON' : 'OFF'}`);
            bot.editMessageReplyMarkup(adminKeyboard(), { chat_id: chatId, message_id: msgId });
        } else if (data === 'adm_toggle_notify') {
            settings.new_user_notify = !settings.new_user_notify;
            saveSettings(settings);
            bot.answerCallbackQuery(callbackQuery.id, `Notifications: ${settings.new_user_notify ? 'ON' : 'OFF'}`);
            bot.editMessageReplyMarkup(adminKeyboard(), { chat_id: chatId, message_id: msgId });
        } else if (data === 'adm_broadcast') {
            bot.sendMessage(chatId, premiumText('📢 Broadcast', 'Send your message below:', '📨'), { parse_mode: 'HTML' });
            bot.once('text', (msg) => {
                const text = msg.text;
                let count = 0;
                for (const uid of Object.keys(usersDB)) {
                    try {
                        bot.sendMessage(parseInt(uid), premiumText('📢 Announcement', text, '📨'), { parse_mode: 'HTML' });
                        count++;
                    } catch (e) {}
                }
                bot.sendMessage(chatId, premiumText('✅ Broadcast Complete', `Sent to ${count} users`, '📨'), { parse_mode: 'HTML' });
            });
        } else if (data === 'adm_set_video') {
            bot.sendMessage(chatId, premiumText('🎥 Set Video', 'Send the video file:', '📹'), { parse_mode: 'HTML' });
            bot.once('video', (msg) => {
                settings.welcome_video = msg.video.file_id;
                saveSettings(settings);
                bot.sendMessage(chatId, successText('✅ Video Set', 'Welcome video updated!'), { parse_mode: 'HTML' });
            });
        } else if (data === 'adm_del_video') {
            settings.welcome_video = null;
            saveSettings(settings);
            bot.answerCallbackQuery(callbackQuery.id, '✅ Video removed!');
            bot.editMessageReplyMarkup(adminKeyboard(), { chat_id: chatId, message_id: msgId });
        } else if (data === 'adm_add_pts') {
            bot.sendMessage(chatId, premiumText('➕ Add Points', 'Send User ID:', '👤'), { parse_mode: 'HTML' });
            bot.once('text', (msg) => {
                const target = msg.text;
                bot.sendMessage(chatId, premiumText('💰 Amount', 'Enter points:', '💎'), { parse_mode: 'HTML' });
                bot.once('text', (msg2) => {
                    try {
                        const points = parseInt(msg2.text);
                        if (usersDB[target]) {
                            usersDB[target].points += points;
                            saveDB(usersDB);
                            bot.sendMessage(chatId, successText('✅ Points Added', 
                                `User: ${target}\nAdded: +${points}\nNew Balance: ${usersDB[target].points}`), { parse_mode: 'HTML' });
                        } else {
                            bot.sendMessage(chatId, errorText('User Not Found', 'Invalid User ID'), { parse_mode: 'HTML' });
                        }
                    } catch (e) {
                        bot.sendMessage(chatId, errorText('Error', 'Invalid input'), { parse_mode: 'HTML' });
                    }
                });
            });
        } else if (data === 'adm_global_add_pts') {
            bot.sendMessage(chatId, premiumText('🌍 Global Add Points', 'Enter points to add to ALL users:', '💎'), { parse_mode: 'HTML' });
            bot.once('text', (msg) => {
                try {
                    const points = parseInt(msg.text);
                    if (points <= 0) {
                        return bot.sendMessage(chatId, errorText('Invalid', 'Enter positive number'), { parse_mode: 'HTML' });
                    }
                    let count = 0;
                    for (const uid of Object.keys(usersDB)) {
                        usersDB[uid].points += points;
                        count++;
                    }
                    saveDB(usersDB);
                    bot.sendMessage(chatId, successText('🌍 Global Points Added',
                        `Added: +${points} to ${count} users\nTotal Distributed: ${points * count}`), { parse_mode: 'HTML' });
                } catch (e) {
                    bot.sendMessage(chatId, errorText('Error', 'Invalid input'), { parse_mode: 'HTML' });
                }
            });
        } else if (data === 'adm_stats') {
            const cpu = os.loadavg()[0];
            const mem = os.freemem() / os.totalmem() * 100;
            bot.sendMessage(chatId, premiumText('🖥 Server Stats',
                `CPU: ${cpu.toFixed(2)}%\nRAM: ${(100 - mem).toFixed(2)}%\nBots: ${Object.keys(runningProcesses).length}\nUsers: ${Object.keys(usersDB).length}`, '📊'), { parse_mode: 'HTML' });
        } else if (data === 'adm_backup') {
            const backupFile = `backup_${moment().format('YYYYMMDD_HHmmss')}.json`;
            fs.copyFileSync(DB_FILE, backupFile);
            bot.sendDocument(chatId, backupFile, { caption: '💾 Database Backup' });
            fs.unlinkSync(backupFile);
            bot.answerCallbackQuery(callbackQuery.id, '✅ Backup created!');
        } else if (data === 'adm_clean') {
            let cleaned = 0;
            for (const [fPath, info] of Object.entries(runningProcesses)) {
                if (info.process.exitCode !== null) {
                    delete runningProcesses[fPath];
                    cleaned++;
                }
            }
            bot.answerCallbackQuery(callbackQuery.id, `🧹 Cleaned ${cleaned} dead processes!`);
        } else if (data === 'adm_system') {
            bot.sendMessage(chatId, premiumText('🔧 System Info',
                `Node: ${process.version}\nPlatform: ${os.platform()}\nDB Size: ${fs.statSync(DB_FILE).size / 1024}KB`, '⚙️'), { parse_mode: 'HTML' });
        }
    }
});

console.log('🟢 JS PREMIUM HOSTING BOT v2.0');
console.log('🕐 Started:', moment().format('YYYY-MM-DD HH:mm:ss'));
console.log('👥 Users:', Object.keys(usersDB).length);
console.log(`📁 Base Dir: ${BASE_DIR}`);
console.log(`📁 Deploy Dir: ${DEPLOY_DIR}`);
console.log('✅ JS bot is running...');
