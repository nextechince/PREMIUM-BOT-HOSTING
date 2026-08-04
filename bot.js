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

if (!fs.existsSync(DEPLOY_DIR)) fs.mkdirSync(DEPLOY_DIR, { recursive: true });

const bot = new TelegramBot(API_TOKEN, { polling: true });

// --- Data Persistence ---
let users_db = load_db();
let settings = load_settings();
let tickets = load_tickets();
let logs = load_logs();
let gameState = loadGameState();
const running_processes = {};
const userSessions = {};

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
        "ratings": {},
        "reviews": {},
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
        catch (e) { return { spins: {}, slots: {}, quiz: {}, riddles: {} }; }
    }
    return { spins: {}, slots: {}, quiz: {}, riddles: {} };
}

function saveGameState() {
    fs.writeFileSync(GAME_STATE_FILE, JSON.stringify(gameState, null, 4));
}

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

🔧 <b>Click below for AI Fix</b>
                `), { 
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔧 AI Fix Error", callback_data: `aifix_${f_name}_${user_id}` }]
                        ]
                    }
                }).catch(() => {});
                logAction('CRASH', user_id, `Bot ${f_name} crashed with code ${code}`);
            }
            delete running_processes[procId];
        });

        logAction('RUN', user_id, `Started ${f_name}`);
        return true;
    } catch (e) {
        return false;
    }
}

// --- HELPER FUNCTIONS ---
function findFileRecursive(dir, fileName = null, extension = null) {
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const result = findFileRecursive(fullPath, fileName, extension);
                if (result) return result;
            } else if (fileName && file === fileName) {
                return fullPath;
            } else if (extension && file.endsWith(extension)) {
                return fullPath;
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

function getMainFromPackageJson(dir) {
    try {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.main) {
                const mainPath = path.join(dir, pkg.main);
                if (fs.existsSync(mainPath)) return mainPath;
                const extensions = ['.js', '.mjs', '.cjs', '.ts'];
                for (const ext of extensions) {
                    const tryPath = path.join(dir, pkg.main + ext);
                    if (fs.existsSync(tryPath)) return tryPath;
                }
            }
            if (pkg.scripts && pkg.scripts.start) {
                const match = pkg.scripts.start.match(/(?:node|ts-node)\s+([^\s]+)/);
                if (match) {
                    const mainPath = path.join(dir, match[1]);
                    if (fs.existsSync(mainPath)) return mainPath;
                }
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

async function updateProgress(chatId, messageId, percent, status, fileName, userId) {
    const barLength = 22;
    const filled = Math.round((percent / 100) * barLength);
    const empty = barLength - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    
    const emoji = percent < 25 ? '⏳' : percent < 50 ? '📥' : percent < 75 ? '📦' : percent < 95 ? '🚀' : '✅';
    const statusEmoji = percent < 20 ? '🔄' : percent < 40 ? '📥' : percent < 60 ? '📦' : percent < 80 ? '⚙️' : percent < 95 ? '🚀' : '✅';
    const time = new Date().toLocaleTimeString();
    
    const progressText = formatText(`
${emoji} <b>DEPLOYING BOT...</b>

<blockquote>📄 File: ${fileName}
👤 User: <code>${userId}</code>
📊 Progress: ${percent}%
📌 Status: ${statusEmoji} ${status}
⏰ Time: ${time}</blockquote>

<code>[${bar}] ${percent}%</code>

${percent < 30 ? '🔹 Downloading files...' :
 percent < 50 ? '🔹 Extracting archive...' :
 percent < 70 ? '🔹 Installing dependencies...' :
 percent < 90 ? '🔹 Starting bot...' :
 '🔹 Deployment complete!'}
    `);
    
    try {
        await bot.editMessageText(progressText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
    } catch (err) {}
}

async function process_upload(message) {
    const f_name = message.document.file_name;
    const uid = message.from.id.toString();
    const f_path = path.normalize(path.join(DEPLOY_DIR, `${uid}_${f_name}`));

    const progressMsg = await bot.sendMessage(message.chat.id, formatText(`
⏳ <b>INITIALIZING DEPLOYMENT...</b>

<blockquote>📄 File: ${f_name}
👤 User: <code>${uid}</code>
📊 Status: 🔄 Starting...</blockquote>

<code>[░░░░░░░░░░░░░░░░░░░░] 0%</code>

🔹 Preparing for deployment...
    `), { parse_mode: 'HTML' });

    try {
        await updateProgress(message.chat.id, progressMsg.message_id, 5, '📥 Downloading file...', f_name, uid);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
        const tempFileName = path.basename(tempPath);
        const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
        fs.renameSync(tempFilePath, f_path);
        
        await updateProgress(message.chat.id, progressMsg.message_id, 20, '✅ File downloaded successfully', f_name, uid);
        await new Promise(resolve => setTimeout(resolve, 300));

        if (f_name.endsWith('.zip')) {
            await updateProgress(message.chat.id, progressMsg.message_id, 25, '📦 Extracting ZIP archive...', f_name, uid);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const baseName = f_name.replace('.zip', '');
            const extractDir = path.join(DEPLOY_DIR, `${uid}_${baseName}`);
            
            if (fs.existsSync(extractDir)) {
                fs.rmSync(extractDir, { recursive: true, force: true });
            }
            fs.mkdirSync(extractDir, { recursive: true });
            
            const zip = new AdmZip(f_path);
            zip.extractAllTo(extractDir, true);
            fs.unlinkSync(f_path);
            
            await updateProgress(message.chat.id, progressMsg.message_id, 40, '✅ ZIP extracted successfully', f_name, uid);
            await new Promise(resolve => setTimeout(resolve, 300));
            
            await updateProgress(message.chat.id, progressMsg.message_id, 43, '🔍 Detecting project type...', f_name, uid);
            await new Promise(resolve => setTimeout(resolve, 300));
            
            const pkgPath = path.join(extractDir, 'package.json');
            const isNode = fs.existsSync(pkgPath);
            const reqPath = path.join(extractDir, 'requirements.txt');
            const isPython = fs.existsSync(reqPath) || fs.existsSync(path.join(extractDir, 'setup.py'));
            
            let mainFile = null;
            let mainPath = null;
            let language = 'unknown';
            
            if (isNode) {
                language = 'nodejs';
                await updateProgress(message.chat.id, progressMsg.message_id, 45, '📦 Node.js project detected!', f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                mainPath = getMainFromPackageJson(extractDir);
                if (mainPath) {
                    mainFile = path.basename(mainPath);
                    await updateProgress(message.chat.id, progressMsg.message_id, 48, `✅ Main file found: ${mainFile}`, f_name, uid);
                } else {
                    await updateProgress(message.chat.id, progressMsg.message_id, 45, '❓ Please specify main file', f_name, uid);
                    userSessions[uid] = { 
                        step: 'AWAITING_MAIN_FILE_NAME', 
                        extractDir: extractDir,
                        f_name: f_name,
                        progressMsgId: progressMsg.message_id,
                        language: 'nodejs'
                    };
                    await bot.editMessageText(formatText(`
❓ <b>Main File Not Found in package.json</b>

<blockquote>Please send the name of your main file</blockquote>

📁 <b>Files found:</b>
${fs.readdirSync(extractDir).filter(f => !f.startsWith('.')).map(f => `• ${f}`).join('\n')}

💡 Examples: index.js, app.js, server.js, main.js

Type the file name or /cancel to cancel
                    `), {
                        chat_id: message.chat.id,
                        message_id: progressMsg.message_id,
                        parse_mode: 'HTML'
                    });
                    return;
                }
            } else if (isPython) {
                language = 'python';
                await updateProgress(message.chat.id, progressMsg.message_id, 45, '🐍 Python project detected!', f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const pythonMainFiles = ['main.py', 'app.py', 'bot.py', 'run.py', 'server.py', 'application.py', 'manage.py'];
                for (const file of pythonMainFiles) {
                    const found = findFileRecursive(extractDir, file);
                    if (found) {
                        mainPath = found;
                        mainFile = file;
                        break;
                    }
                }
                
                if (mainPath) {
                    await updateProgress(message.chat.id, progressMsg.message_id, 48, `✅ Main file found: ${mainFile}`, f_name, uid);
                } else {
                    await updateProgress(message.chat.id, progressMsg.message_id, 45, '❓ Please specify main file', f_name, uid);
                    userSessions[uid] = { 
                        step: 'AWAITING_MAIN_FILE_NAME', 
                        extractDir: extractDir,
                        f_name: f_name,
                        progressMsgId: progressMsg.message_id,
                        language: 'python'
                    };
                    await bot.editMessageText(formatText(`
❓ <b>Main File Not Found</b>

<blockquote>Please send the name of your main Python file</blockquote>

📁 <b>Files found:</b>
${fs.readdirSync(extractDir).filter(f => !f.startsWith('.')).map(f => `• ${f}`).join('\n')}

💡 Examples: main.py, app.py, bot.py, run.py

Type the file name or /cancel to cancel
                    `), {
                        chat_id: message.chat.id,
                        message_id: progressMsg.message_id,
                        parse_mode: 'HTML'
                    });
                    return;
                }
            } else {
                language = 'unknown';
                await updateProgress(message.chat.id, progressMsg.message_id, 45, '🔍 Scanning for main file...', f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                const priority = ['main.py', 'app.py', 'bot.py', 'index.js', 'server.js', 'app.js', 'main.js', 'main.rb', 'main.go', 'main.sh'];
                for (const pFile of priority) {
                    const found = findFileRecursive(extractDir, pFile);
                    if (found) {
                        mainFile = pFile;
                        mainPath = found;
                        break;
                    }
                }
                
                if (!mainPath) {
                    const extensions = ['.py', '.js', '.rb', '.go', '.sh'];
                    for (const ext of extensions) {
                        const found = findFileRecursive(extractDir, null, ext);
                        if (found) {
                            mainFile = path.basename(found);
                            mainPath = found;
                            break;
                        }
                    }
                }
                
                if (mainPath) {
                    const ext = path.extname(mainFile).toLowerCase();
                    if (ext === '.py') language = 'python';
                    else if (ext === '.js') language = 'nodejs';
                    else if (ext === '.rb') language = 'ruby';
                    else if (ext === '.go') language = 'go';
                    else if (ext === '.sh') language = 'shell';
                    
                    await updateProgress(message.chat.id, progressMsg.message_id, 48, `✅ Main file found: ${mainFile}`, f_name, uid);
                } else {
                    await updateProgress(message.chat.id, progressMsg.message_id, 45, '❓ Please specify main file', f_name, uid);
                    userSessions[uid] = { 
                        step: 'AWAITING_MAIN_FILE_NAME', 
                        extractDir: extractDir,
                        f_name: f_name,
                        progressMsgId: progressMsg.message_id,
                        language: 'unknown'
                    };
                    await bot.editMessageText(formatText(`
❓ <b>No Main File Found</b>

<blockquote>Please send the name of your main file</blockquote>

📁 <b>Files found:</b>
${fs.readdirSync(extractDir).filter(f => !f.startsWith('.')).map(f => `• ${f}`).join('\n')}

💡 Supported extensions: .py, .js, .rb, .go, .sh

Type the file name or /cancel to cancel
                    `), {
                        chat_id: message.chat.id,
                        message_id: progressMsg.message_id,
                        parse_mode: 'HTML'
                    });
                    return;
                }
            }
            
            if (mainPath) {
                await updateProgress(message.chat.id, progressMsg.message_id, 55, '📦 Installing dependencies...', f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                if (language === 'nodejs' || fs.existsSync(path.join(extractDir, 'package.json'))) {
                    await updateProgress(message.chat.id, progressMsg.message_id, 60, '📦 Installing Node.js dependencies...', f_name, uid);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    try {
                        await new Promise((resolve) => {
                            const installProcess = exec('npm install --production', { cwd: extractDir });
                            let progress = 60;
                            installProcess.stdout.on('data', (data) => {
                                progress = Math.min(78, progress + 1);
                                const match = data.match(/added\s+(\d+)\s+packages/);
                                if (match) {
                                    updateProgress(message.chat.id, progressMsg.message_id, progress, `📦 Installed ${match[1]} packages...`, f_name, uid);
                                }
                            });
                            installProcess.on('exit', () => resolve());
                            setTimeout(resolve, 10000);
                        });
                        await updateProgress(message.chat.id, progressMsg.message_id, 78, '✅ Node.js dependencies installed', f_name, uid);
                    } catch (err) {
                        await updateProgress(message.chat.id, progressMsg.message_id, 70, '⚠️ Some dependencies failed', f_name, uid);
                    }
                }
                
                if (language === 'python' || fs.existsSync(path.join(extractDir, 'requirements.txt'))) {
                    const reqPath = path.join(extractDir, 'requirements.txt');
                    if (fs.existsSync(reqPath)) {
                        await updateProgress(message.chat.id, progressMsg.message_id, 62, '🐍 Installing Python dependencies...', f_name, uid);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        try {
                            await new Promise((resolve) => {
                                const installProcess = exec(`pip install -r "${reqPath}"`, { cwd: extractDir });
                                let progress = 62;
                                installProcess.stdout.on('data', (data) => {
                                    progress = Math.min(78, progress + 1);
                                    const match = data.match(/Collecting\s+([\w-]+)/);
                                    if (match) {
                                        updateProgress(message.chat.id, progressMsg.message_id, progress, `🐍 Installing: ${match[1]}...`, f_name, uid);
                                    }
                                });
                                installProcess.on('exit', () => resolve());
                                setTimeout(resolve, 10000);
                            });
                            await updateProgress(message.chat.id, progressMsg.message_id, 78, '✅ Python dependencies installed', f_name, uid);
                        } catch (err) {
                            await updateProgress(message.chat.id, progressMsg.message_id, 70, '⚠️ Some Python dependencies failed', f_name, uid);
                        }
                    }
                }
                
                await updateProgress(message.chat.id, progressMsg.message_id, 80, '✅ Dependencies installed', f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                await updateProgress(message.chat.id, progressMsg.message_id, 85, '🚀 Starting bot...', f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (run_user_file(mainPath, parseInt(uid), mainFile)) {
                    users_db[uid].points -= settings.hosting_cost;
                    if (!users_db[uid].files) users_db[uid].files = [];
                    if (!users_db[uid].files.includes(mainFile)) {
                        users_db[uid].files.push(mainFile);
                    }
                    save_db();
                    
                    await updateProgress(message.chat.id, progressMsg.message_id, 95, '✅ Bot started successfully!', f_name, uid);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    await announceDeployment(uid, mainFile);
                    
                    await bot.editMessageText(formatText(`
✅ <b>DEPLOYMENT COMPLETE!</b> 🎉

<blockquote>📄 File: <code>${mainFile}</code>
👤 User: <code>${uid}</code>
📁 Path: ${path.relative(DEPLOY_DIR, mainPath)}
🟢 Status: 🟢 Running
💰 Cost: ${settings.hosting_cost} points
🐍 Language: ${language.toUpperCase()}</blockquote>

📊 <b>Deployment Details:</b>
<blockquote>• File extracted: ✅
• Dependencies: ✅
• Bot started: ✅
• Status: Active</blockquote>

🔧 <b>Quick Actions:</b>
• /logs - View logs
• /stop - Stop bot
• /autofix - Fix errors
                    `), {
                        chat_id: message.chat.id,
                        message_id: progressMsg.message_id,
                        parse_mode: 'HTML'
                    });
                    logAction('DEPLOY', uid, `Deployed ${mainFile} from ZIP (${language})`);
                } else {
                    await updateProgress(message.chat.id, progressMsg.message_id, 90, '❌ Failed to start bot!', f_name, uid);
                    await bot.editMessageText(formatText(`
❌ <b>DEPLOYMENT FAILED!</b>

<blockquote>Could not start the main file</blockquote>

💡 <b>Try:</b>
• Make sure the file has a main/entry point
• Check for missing dependencies
• Use /autofix to fix common errors
                    `), {
                        chat_id: message.chat.id,
                        message_id: progressMsg.message_id,
                        parse_mode: 'HTML'
                    });
                }
            }
            return;
        }

        // --- SINGLE FILE DEPLOYMENT ---
        const ext = path.extname(f_name).toLowerCase();
        const supported = ['.py', '.js', '.rb', '.go', '.sh'];
        
        if (!supported.includes(ext)) {
            await updateProgress(message.chat.id, progressMsg.message_id, 20, '❌ Unsupported file type!', f_name, uid);
            await bot.editMessageText(formatText(`
❌ <b>Unsupported File Type!</b>

<blockquote>Supported: ${supported.join(', ')}</blockquote>

💡 For projects, use a ZIP file
            `), {
                chat_id: message.chat.id,
                message_id: progressMsg.message_id,
                parse_mode: 'HTML'
            });
            return;
        }

        await updateProgress(message.chat.id, progressMsg.message_id, 50, '📦 Checking dependencies...', f_name, uid);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (ext === '.py') {
            const content = fs.readFileSync(f_path, 'utf-8');
            const imports = content.match(/^(?:import|from)\s+([\w\d_]+)/gm) || [];
            if (imports.length > 0) {
                await updateProgress(message.chat.id, progressMsg.message_id, 60, `🐍 Found ${imports.length} imports`, f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        if (ext === '.js') {
            const content = fs.readFileSync(f_path, 'utf-8');
            const requires = content.match(/require\(['"]([\w\d_-]+)['"]\)/g) || [];
            if (requires.length > 0) {
                await updateProgress(message.chat.id, progressMsg.message_id, 60, `📦 Found ${requires.length} requires`, f_name, uid);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        await updateProgress(message.chat.id, progressMsg.message_id, 75, '✅ Dependencies checked', f_name, uid);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        await updateProgress(message.chat.id, progressMsg.message_id, 85, '🚀 Starting bot...', f_name, uid);
        await new Promise(resolve => setTimeout(resolve, 500));

        if (run_user_file(f_path, parseInt(uid), f_name)) {
            users_db[uid].points -= settings.hosting_cost;
            if (!users_db[uid].files) users_db[uid].files = [];
            if (!users_db[uid].files.includes(f_name)) {
                users_db[uid].files.push(f_name);
            }
            save_db();
            
            await updateProgress(message.chat.id, progressMsg.message_id, 95, '✅ Bot started successfully!', f_name, uid);
            await new Promise(resolve => setTimeout(resolve, 300));
            
            await announceDeployment(uid, f_name);
            
            await bot.editMessageText(formatText(`
✅ <b>DEPLOYMENT COMPLETE!</b> 🎉

<blockquote>📄 File: <code>${f_name}</code>
👤 User: <code>${uid}</code>
🟢 Status: 🟢 Running
💰 Cost: ${settings.hosting_cost} points</blockquote>

📊 <b>Deployment Details:</b>
<blockquote>• File uploaded: ✅
• Dependencies: ✅
• Bot started: ✅
• Status: Active</blockquote>
            `), {
                chat_id: message.chat.id,
                message_id: progressMsg.message_id,
                parse_mode: 'HTML'
            });
            logAction('DEPLOY', uid, `Deployed ${f_name}`);
        } else {
            await updateProgress(message.chat.id, progressMsg.message_id, 90, '❌ Failed to start bot!', f_name, uid);
            await bot.editMessageText(formatText(`
❌ <b>DEPLOYMENT FAILED!</b>

<blockquote>Could not start the file</blockquote>

💡 <b>Try:</b>
• Check for syntax errors
• Use /autofix to fix common errors
• Make sure all dependencies are installed
            `), {
                chat_id: message.chat.id,
                message_id: progressMsg.message_id,
                parse_mode: 'HTML'
            });
        }
    } catch (err) {
        console.error('Deployment error:', err);
        await updateProgress(message.chat.id, progressMsg.message_id, 50, `❌ Error: ${err.message}`, f_name, uid);
        await bot.editMessageText(formatText(`
❌ <b>DEPLOYMENT FAILED!</b>

<blockquote>Error: ${err.message}</blockquote>

🔧 <b>Try:</b>
• /autofix - Auto-fix common errors
• /aihelp - Get AI assistance
        `), {
            chat_id: message.chat.id,
            message_id: progressMsg.message_id,
            parse_mode: 'HTML'
        });
        logAction('DEPLOY_ERROR', uid, `Failed to deploy: ${err.message}`);
    }
}

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

// ============================================
// ============= MAIN KEYBOARD ================
// ============================================
function main_keyboard(user_id) {
    const isAdminUser = isAdmin(user_id);
    const isAssistantUser = isAssistant(user_id);
    const userData = users_db[user_id.toString()] || {};
    const points = userData.points || 0;
    
    const keyboard = [
        [{ text: "📢 Updates" }, { text: "ℹ️ Help" }],
        [{ text: "📤 Deploy Bot" }, { text: "🌐 Deploy Website" }],
        [{ text: "📂 My Files" }, { text: "🏠 My Websites" }],
        [{ text: `💰 Points: ${points}` }, { text: "🔗 Referral" }],
        [{ text: "📊 Statistics" }, { text: "📞 Support" }],
        [{ text: "🎫 Ticket" }, { text: "🎁 Daily Reward" }],
        [{ text: "🎮 Games" }, { text: "😂 Meme" }],
        [{ text: "🔄 Convert" }, { text: "🔍 Analyze" }],
        [{ text: "🔧 AutoFix" }, { text: "🤖 AI Help" }],
        [{ text: "📋 My Bots" }, { text: "⚡ Smart Deploy" }],
        [{ text: "🔐 Encrypt" }, { text: "🔓 Decrypt" }],
        [{ text: "📤 Share" }, { text: "⭐ Rate" }],
        [{ text: "📝 Review" }, { text: "🏆 Leaderboard" }],
        [{ text: "🧪 Test Bot" }, { text: "📊 Simulate" }],
        [{ text: "❌ Cancel" }, { text: "📋 Commands" }],
        [{ text: "🎲 Spin" }, { text: "🎰 Slot" }],
        ...(isAdminUser || isAssistantUser ? [[{ text: "👑 Admin Panel" }, { text: "🌍 All Files" }]] : [])
    ];
    
    return { keyboard: keyboard, resize_keyboard: true };
}

// --- GAMES KEYBOARD ---
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

// --- ADMIN KEYBOARD ---
function admin_keyboard() {
    const m_text = settings.maintenance ? "🔴 Maintenance: ON" : "🟢 Maintenance: OFF";
    return {
        inline_keyboard: [
            [{ text: "👥 Users", callback_data: "adm_users" },
             { text: "💰 Add Points", callback_data: "adm_add_pts" }],
            [{ text: "👑 Admins", callback_data: "adm_manage_admins" },
             { text: "🛡 Assistants", callback_data: "adm_manage_assistants" }],
            [{ text: "🚫 Ban/Unban", callback_data: "adm_ban_user" },
             { text: "📋 Tickets", callback_data: "adm_view_tickets" }],
            [{ text: "⚙️ Settings", callback_data: "adm_settings" },
             { text: "📊 Stats", callback_data: "adm_stats" }],
            [{ text: "🗑 Clear All", callback_data: "adm_clear_all" },
             { text: "📜 Logs", callback_data: "adm_logs" }],
            [{ text: "🎥 Set Video", callback_data: "adm_set_video" },
             { text: m_text, callback_data: "adm_toggle_maint" }],
            [{ text: "📢 Broadcast", callback_data: "adm_broadcast" },
             { text: "🌟 Add All Points", callback_data: "adm_add_all_pts" }],
            [{ text: "🔙 Back", callback_data: "back_main" }]
        ]
    };
}

// --- SETTINGS KEYBOARD ---
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

// --- QUIZ DATA ---
const quizQuestions = [
    {
        question: "What does API stand for?",
        options: ["Application Programming Interface", "Advanced Programming Interface", "Application Process Integration", "Automated Program Interface"],
        answer: 0
    },
    {
        question: "What is the most popular programming language in 2024?",
        options: ["Python", "JavaScript", "Java", "C++"],
        answer: 0
    },
    {
        question: "What does CPU stand for?",
        options: ["Central Process Unit", "Computer Personal Unit", "Central Processing Unit", "Core Processing Unit"],
        answer: 2
    },
    {
        question: "Which company developed React?",
        options: ["Google", "Facebook", "Microsoft", "Amazon"],
        answer: 1
    },
    {
        question: "What is the main advantage of cloud computing?",
        options: ["Cost reduction", "Scalability", "Accessibility", "All of the above"],
        answer: 3
    },
    {
        question: "What is the full form of HTTP?",
        options: ["HyperText Transfer Protocol", "HyperText Transmission Protocol", "Hyper Transfer Text Protocol", "High Transfer Text Protocol"],
        answer: 0
    },
    {
        question: "Which language is used for styling web pages?",
        options: ["HTML", "CSS", "JavaScript", "PHP"],
        answer: 1
    },
    {
        question: "What does SQL stand for?",
        options: ["Structured Query Language", "Simple Query Language", "Standard Query Language", "Sequential Query Language"],
        answer: 0
    }
];

// --- RIDDLES ---
const riddles = [
    { question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", answer: "echo" },
    { question: "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?", answer: "map" },
    { question: "What has keys but can't open locks?", answer: "piano" },
    { question: "What goes up but never comes down?", answer: "age" },
    { question: "What has a head, a tail, but no body?", answer: "coin" },
    { question: "What has to be broken before you can use it?", answer: "egg" },
    { question: "I'm tall when I'm young, and I'm short when I'm old. What am I?", answer: "candle" },
    { question: "What month of the year has 28 days?", answer: "all" },
    { question: "What is full of holes but still holds water?", answer: "sponge" },
    { question: "What can travel around the world while staying in a corner?", answer: "stamp" }
];

// --- WELCOME MESSAGE ---
function get_welcome_text(msg) {
    const user = msg.from;
    const userData = users_db[user.id.toString()] || { points: 0 };
    const points = userData.points || 0;
    const status = settings.maintenance ? '🔴 MAINTENANCE' : '🟢 ONLINE';
    
    return formatText(`
⚜️<b>Pʀᴇᴍɪᴜᴍ Hᴏsᴛɪɴɢ Bᴏᴛ</b> ⚜️

👋 <b>ᴡᴇʟᴄᴏᴍᴇ:</b> ${user.first_name.toUpperCase()}

📤 <b>ᴅᴇᴘʟᴏʏ ᴀɴʏᴛʜɪɴɢ:</b>
• ʙᴏᴛs (ᴘʏᴛʜᴏɴ/ɴᴏᴅᴇ.ᴊs/ʀᴜʙʏ)
• ᴡᴇʙsɪᴛᴇs (ʜᴛᴍʟ/ʀᴇᴀᴄᴛ/ᴠᴜᴇ)

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

// ============================================
// ============= MAIN MESSAGE HANDLER =========
// ============================================
bot.on('message', async (msg) => {
    const uid = msg.from.id;
    const uidStr = uid.toString();
    const text = msg.text;

    if (isBanned(uid)) {
        return bot.sendMessage(msg.chat.id, formatText('🚫 <b>ʏᴏᴜ ᴀʀᴇ ʙᴀɴɴᴇᴅ!</b>'), { parse_mode: 'HTML' });
    }

    if (isFrozen(uid) && !isAdmin(uid)) {
        return bot.sendMessage(msg.chat.id, formatText('❄️ <b>ʏᴏᴜʀ ᴀᴄᴄᴏᴜɴᴛ ɪs ғʀᴏᴢᴇɴ!</b>'), { parse_mode: 'HTML' });
    }

    // Handle sessions FIRST
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
            notifyAdmins(`👤 New user joined: ${msg.from.first_name} (${uid})`);
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

    // --- COMMANDS HANDLER ---
    switch(text) {
        // === MAIN COMMANDS ===
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
            showHelp(msg);
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

💡 Type /cancel to cancel
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

💡 Type /cancel to cancel
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

                const fileMarkup = {
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
                `), { reply_markup: fileMarkup, parse_mode: "HTML" });
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
                const siteMarkup = {
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
                `), { reply_markup: siteMarkup, parse_mode: "HTML" });
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

💡 Type /cancel to cancel
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
            generateMeme(msg);
            break;

        case "🔄 Convert":
            userSessions[uidStr] = { step: 'AWAITING_CONVERT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔄 <b>Code Converter</b>

<blockquote>Send the file to convert
Supported: Python ↔ JavaScript</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "🔍 Analyze":
            analyzeCode(msg);
            break;

        case "🔧 AutoFix":
            userSessions[uidStr] = { step: 'AWAITING_FIX_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔧 <b>Auto-Fix</b>

<blockquote>Send the file to fix common errors</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "🤖 AI Help":
            userSessions[uidStr] = { step: 'AWAITING_AI_QUERY' };
            bot.sendMessage(msg.chat.id, formatText(`
🤖 <b>AI Assistant</b>

<blockquote>Send your question or describe your issue</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "📋 My Bots":
            const botFilesList = users_db[uidStr]?.files || [];
            if (botFilesList.length === 0) {
                return bot.sendMessage(msg.chat.id, formatText('❌ No bots deployed'), { parse_mode: 'HTML' });
            }
            let botList = '🤖 <b>Your Bots</b>\n\n';
            botFilesList.forEach((file, index) => {
                const f_path = path.join(DEPLOY_DIR, `${uid}_${file}`);
                let isRunning = false;
                for (const [pid, proc] of Object.entries(running_processes)) {
                    if (proc.spawnfile === f_path || proc.fileName === file) {
                        isRunning = true;
                        break;
                    }
                }
                const status = isRunning ? '🟢' : '🔴';
                botList += `${index + 1}. ${status} ${file}\n`;
            });
            bot.sendMessage(msg.chat.id, formatText(botList), { parse_mode: 'HTML' });
            break;

        case "⚡ Smart Deploy":
            userSessions[uidStr] = { step: 'AWAITING_SMART_DEPLOY' };
            bot.sendMessage(msg.chat.id, formatText(`
⚡ <b>Smart Deploy</b>

<blockquote>Send your bot file for AI-optimized deployment</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "🔐 Encrypt":
            userSessions[uidStr] = { step: 'AWAITING_ENCRYPT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔐 <b>Encrypt File</b>

<blockquote>Send the file to encrypt</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "🔓 Decrypt":
            userSessions[uidStr] = { step: 'AWAITING_DECRYPT_FILE' };
            bot.sendMessage(msg.chat.id, formatText(`
🔓 <b>Decrypt File</b>

<blockquote>Send the .encrypted file</blockquote>

💡 Type /cancel to cancel
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
            userSessions[uidStr] = { step: 'AWAITING_RATE' };
            bot.sendMessage(msg.chat.id, formatText(`
⭐ <b>Rate a Bot</b>

<blockquote>Send: bot_name rating (1-5)
Example: mybot 5</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "📝 Review":
            userSessions[uidStr] = { step: 'AWAITING_REVIEW' };
            bot.sendMessage(msg.chat.id, formatText(`
📝 <b>Write a Review</b>

<blockquote>Send your review</blockquote>

💡 Type /cancel to cancel
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

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "📊 Simulate":
            userSessions[uidStr] = { step: 'AWAITING_SIMULATE' };
            bot.sendMessage(msg.chat.id, formatText(`
📊 <b>Simulate Traffic</b>

<blockquote>Send: bot_name requests
Example: mybot 100</blockquote>

💡 Type /cancel to cancel
            `), { parse_mode: 'HTML' });
            break;

        case "🎲 Spin":
            handleSpin(msg);
            break;

        case "🎰 Slot":
            handleSlot(msg);
            break;

        case "❌ Cancel":
            if (userSessions[uidStr]) {
                delete userSessions[uidStr];
                bot.sendMessage(msg.chat.id, formatText('✅ <b>Ongoing operation cancelled!</b>'), { 
                    parse_mode: 'HTML',
                    reply_markup: main_keyboard(uid)
                });
            } else {
                bot.sendMessage(msg.chat.id, formatText('ℹ️ <b>No ongoing operation to cancel.</b>'), { parse_mode: 'HTML' });
            }
            break;

        case "📋 Commands":
            showCommands(msg);
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
                showAllFiles(msg);
            }
            break;

        // --- Handle /commands via text too ---
        default:
            // Check if it's a command
            if (text.startsWith('/')) {
                // Handle common commands
                if (text === '/help' || text === '/start') {
                    // Already handled above
                } else if (text === '/commands') {
                    showCommands(msg);
                } else if (text === '/cancel') {
                    if (userSessions[uidStr]) {
                        delete userSessions[uidStr];
                        bot.sendMessage(msg.chat.id, formatText('✅ <b>Ongoing operation cancelled!</b>'), { 
                            parse_mode: 'HTML',
                            reply_markup: main_keyboard(uid)
                        });
                    } else {
                        bot.sendMessage(msg.chat.id, formatText('ℹ️ <b>No ongoing operation to cancel.</b>'), { parse_mode: 'HTML' });
                    }
                } else if (text === '/daily') {
                    // Handle daily command
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
                } else if (text === '/points') {
                    const userPoints = users_db[uidStr] || { points: 0 };
                    bot.sendMessage(msg.chat.id, formatText(`💰 <b>Balance:</b> ${userPoints.points || 0} points`), { parse_mode: 'HTML' });
                } else {
                    bot.sendMessage(msg.chat.id, formatText('❌ <b>Unknown command. Use /start or /commands</b>'), { parse_mode: 'HTML' });
                }
            }
            break;
    }
});

// ============================================
// ============= HANDLE SPIN ==================
// ============================================
function handleSpin(msg) {
    const uid = msg.from.id.toString();
    const userData = users_db[uid] || { points: 0 };
    const spinCost = 5;
    
    if (userData.points < spinCost) {
        return bot.sendMessage(msg.chat.id, formatText(`
❌ <b>Not enough points!</b>

<blockquote>💰 Need: ${spinCost} points
💎 You have: ${userData.points} points</blockquote>
        `), { parse_mode: 'HTML' });
    }
    
    const prizes = [
        { name: '💎 Jackpot!', multiplier: 10 },
        { name: '🌟 Big Win!', multiplier: 5 },
        { name: '⭐ Great!', multiplier: 2 },
        { name: '👍 Good', multiplier: 1.5 },
        { name: '😅 Not Bad', multiplier: 1 },
        { name: '😢 Oops', multiplier: 0.5 },
        { name: '💔 Bad Luck', multiplier: 0.2 }
    ];
    
    const random = Math.random() * 12;
    const prize = prizes[Math.floor(Math.random() * prizes.length)];
    const winnings = Math.floor(spinCost * prize.multiplier);
    
    users_db[uid].points = (users_db[uid].points || 0) + winnings - spinCost;
    if (!gameState.spins[uid]) gameState.spins[uid] = { total: 0, wins: 0, losses: 0 };
    gameState.spins[uid].total++;
    if (winnings > spinCost) {
        gameState.spins[uid].wins++;
    } else {
        gameState.spins[uid].losses++;
    }
    save_db();
    saveGameState();
    
    const winLoss = winnings > spinCost ? '🎉 WIN!' : '😢 LOSS';
    bot.sendMessage(msg.chat.id, formatText(`
🎰 <b>SPIN RESULT</b>

<blockquote>🎯 ${prize.name}
💰 Bet: ${spinCost} pts
🏆 Won: ${winnings} pts
${winLoss}</blockquote>

📊 <b>Your Stats:</b>
<blockquote>Total Spins: ${gameState.spins[uid].total}
Wins: ${gameState.spins[uid].wins}
Losses: ${gameState.spins[uid].losses}
Win Rate: ${(gameState.spins[uid].wins / gameState.spins[uid].total * 100).toFixed(1)}%</blockquote>
    `), { parse_mode: 'HTML' });
    logAction('SPIN', uid, `Spin result: ${winnings} pts`);
}

// ============================================
// ============= HANDLE SLOT ==================
// ============================================
function handleSlot(msg) {
    const uid = msg.from.id.toString();
    const userData = users_db[uid] || { points: 0 };
    const slotCost = 10;
    
    if (userData.points < slotCost) {
        return bot.sendMessage(msg.chat.id, formatText(`❌ Need ${slotCost} points!`), { parse_mode: 'HTML' });
    }
    
    const symbols = ['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣', '⭐'];
    const reel1 = symbols[Math.floor(Math.random() * symbols.length)];
    const reel2 = symbols[Math.floor(Math.random() * symbols.length)];
    const reel3 = symbols[Math.floor(Math.random() * symbols.length)];
    
    let multiplier = 0;
    if (reel1 === reel2 && reel2 === reel3) {
        const multipliers = {
            '🍒': 2, '🍋': 3, '🍊': 4, '🍇': 5,
            '🔔': 8, '💎': 12, '7️⃣': 15, '⭐': 20
        };
        multiplier = multipliers[reel1] || 1;
    } else if (reel1 === reel2 || reel1 === reel3 || reel2 === reel3) {
        multiplier = 1.5;
    } else {
        multiplier = 0.2;
    }
    
    const winnings = Math.floor(slotCost * multiplier);
    users_db[uid].points = (users_db[uid].points || 0) + winnings - slotCost;
    if (!gameState.slots[uid]) gameState.slots[uid] = { total: 0, wins: 0, losses: 0 };
    gameState.slots[uid].total++;
    if (winnings > slotCost) {
        gameState.slots[uid].wins++;
    } else {
        gameState.slots[uid].losses++;
    }
    save_db();
    saveGameState();
    
    const resultEmoji = winnings > slotCost ? '🎉' : winnings === slotCost ? '😐' : '😢';
    const slotDisplay = `
┌─────┬─────┬─────┐
│  ${reel1}  │  ${reel2}  │  ${reel3}  │
└─────┴─────┴─────┘
`;
    
    bot.sendMessage(msg.chat.id, formatText(`
🎰 <b>SLOT MACHINE</b>
<pre>${slotDisplay}</pre>

<blockquote>💰 Bet: ${slotCost} pts
🏆 Won: ${winnings} pts
${resultEmoji} ${winnings > slotCost ? 'JACKPOT!' : winnings === slotCost ? 'Even!' : 'Try Again!'}</blockquote>

📊 <b>Your Stats:</b>
<blockquote>Total Games: ${gameState.slots[uid].total}
Wins: ${gameState.slots[uid].wins}
Losses: ${gameState.slots[uid].losses}
Win Rate: ${(gameState.slots[uid].wins / gameState.slots[uid].total * 100).toFixed(1)}%</blockquote>
    `), { parse_mode: 'HTML' });
    logAction('SLOT', uid, `Slot result: ${winnings} pts`);
}

// ============================================
// ============= SHOW COMMANDS ================
// ============================================
function showCommands(msg) {
    const commands = `
📋 <b>AVAILABLE COMMANDS</b>

<blockquote>📢 Updates - Join channel
ℹ️ Help - Show help
📤 Deploy Bot - Deploy bot file
🌐 Deploy Website - Deploy website
📂 My Files - View your bots
🏠 My Websites - View websites
💰 Points - Check balance
🔗 Referral - Get referral link
📊 Statistics - Global stats
📞 Support - Contact support
🎫 Ticket - Create ticket
🎁 Daily Reward - Claim daily
🎮 Games - Play games
😂 Meme - Generate meme
🔄 Convert - Convert code
🔍 Analyze - Analyze code
🔧 AutoFix - Fix errors
🤖 AI Help - AI assistant
📋 My Bots - List bots
⚡ Smart Deploy - AI deploy
🔐 Encrypt - Encrypt files
🔓 Decrypt - Decrypt files
📤 Share - Share bot
⭐ Rate - Rate bot
📝 Review - Write review
🏆 Leaderboard - Top users
🧪 Test Bot - Test bot
📊 Simulate - Simulate traffic
🎲 Spin - Spin wheel
🎰 Slot - Slot machine
❌ Cancel - Cancel operation
📋 Commands - Show this menu</blockquote>

💡 Use buttons below or type /command
    `;
    bot.sendMessage(msg.chat.id, formatText(commands), { parse_mode: 'HTML' });
}

// ============================================
// ============= SHOW HELP ====================
// ============================================
function showHelp(msg) {
    const help = `
❓ <b>HOW TO USE THIS BOT</b>

<blockquote>1. 📤 <b>Deploy Bot</b>
   Send a .py, .js, .rb, .go, .sh, or .zip file

2. 🌐 <b>Deploy Website</b>
   Send a ZIP file or HTML file

3. 🎮 <b>Play Games</b>
   Earn points while having fun

4. 🤖 <b>AI Help</b>
   Get help with coding issues

5. 🔧 <b>AutoFix</b>
   Automatically fix common errors

6. ⭐ <b>Rate & Review</b>
   Share your feedback</blockquote>

💡 Type /cancel to cancel any operation
📋 Type /commands to see all commands
    `;
    bot.sendMessage(msg.chat.id, formatText(help), { parse_mode: 'HTML' });
}

// ============================================
// ============= SHOW ALL FILES ===============
// ============================================
function showAllFiles(msg) {
    const uid = msg.from.id;
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

// ============================================
// ============= GENERATE MEME ================
// ============================================
async function generateMeme(msg) {
    const memeTypes = [
        "doge", "drake", "disastergirl", "troll", "successkid", 
        "grumpycat", "pepe", "spiderman", "distractedboyfriend"
    ];
    const randomMeme = memeTypes[Math.floor(Math.random() * memeTypes.length)];
    const topText = encodeURIComponent("Me deploying bots");
    const bottomText = encodeURIComponent("It works perfectly!");
    const memeUrl = `https://api.memegen.link/images/${randomMeme}/${topText}/${bottomText}.jpg`;
    
    try {
        const response = await axios.get(memeUrl, { responseType: 'stream' });
        bot.sendPhoto(msg.chat.id, response.data, {
            caption: formatText(`😂 <b>Meme</b>\n\nType: ${randomMeme}`),
            parse_mode: 'HTML'
        });
    } catch (error) {
        bot.sendMessage(msg.chat.id, formatText(`😂 <b>Meme</b>\n\n${decodeURIComponent(topText)}\n${decodeURIComponent(bottomText)}`), { parse_mode: 'HTML' });
    }
}

// ============================================
// ============= ANALYZE CODE =================
// ============================================
function analyzeCode(msg) {
    const uid = msg.from.id.toString();
    const analyzeFiles = users_db[uid]?.files || [];
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
            const comments = (content.match(/\/\/|#|\/\*/g) || []).length;
            const classes = (content.match(/class/g) || []).length;
            analysis += `<blockquote>📄 ${file}\n📏 Lines: ${lines}\n📝 Functions: ${functions}\n📚 Classes: ${classes}\n💬 Comments: ${comments}</blockquote>\n`;
        }
    });
    bot.sendMessage(msg.chat.id, formatText(analysis), { parse_mode: 'HTML' });
}

// ============================================
// ============= SESSION INPUT HANDLER =========
// ============================================
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

💡 Type /cancel to cancel
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

        case 'AWAITING_MAIN_FILE_NAME':
            if (message.text && !message.text.startsWith('/')) {
                const mainFileName = message.text.trim();
                const extractDir = session.extractDir;
                const f_name = session.f_name;
                const progressMsgId = session.progressMsgId;
                
                let mainPath = findFileRecursive(extractDir, mainFileName);
                if (!mainPath) {
                    const extensions = ['.py', '.js', '.rb', '.go', '.sh'];
                    for (const ext of extensions) {
                        const tryPath = findFileRecursive(extractDir, mainFileName + ext);
                        if (tryPath) {
                            mainPath = tryPath;
                            break;
                        }
                    }
                }
                
                if (mainPath) {
                    const mainFile = path.basename(mainPath);
                    delete userSessions[uid];
                    
                    await updateProgress(message.chat.id, progressMsgId, 50, `✅ Main file found: ${mainFile}`, f_name, uid);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    await updateProgress(message.chat.id, progressMsgId, 55, '📦 Installing dependencies...', f_name, uid);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    if (fs.existsSync(path.join(extractDir, 'package.json'))) {
                        await updateProgress(message.chat.id, progressMsgId, 60, '📦 Installing Node.js dependencies...', f_name, uid);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        try {
                            await new Promise((resolve) => {
                                const installProcess = exec('npm install --production', { cwd: extractDir });
                                installProcess.on('exit', () => resolve());
                                setTimeout(resolve, 8000);
                            });
                            await updateProgress(message.chat.id, progressMsgId, 78, '✅ Node.js dependencies installed', f_name, uid);
                        } catch (err) {}
                    }
                    
                    if (fs.existsSync(path.join(extractDir, 'requirements.txt'))) {
                        await updateProgress(message.chat.id, progressMsgId, 62, '🐍 Installing Python dependencies...', f_name, uid);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        try {
                            await new Promise((resolve) => {
                                const installProcess = exec(`pip install -r "${path.join(extractDir, 'requirements.txt')}"`, { cwd: extractDir });
                                installProcess.on('exit', () => resolve());
                                setTimeout(resolve, 8000);
                            });
                            await updateProgress(message.chat.id, progressMsgId, 78, '✅ Python dependencies installed', f_name, uid);
                        } catch (err) {}
                    }
                    
                    await updateProgress(message.chat.id, progressMsgId, 80, '✅ Dependencies installed', f_name, uid);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    await updateProgress(message.chat.id, progressMsgId, 85, '🚀 Starting bot...', f_name, uid);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    if (run_user_file(mainPath, parseInt(uid), mainFile)) {
                        users_db[uid].points -= settings.hosting_cost;
                        if (!users_db[uid].files) users_db[uid].files = [];
                        if (!users_db[uid].files.includes(mainFile)) {
                            users_db[uid].files.push(mainFile);
                        }
                        save_db();
                        
                        await updateProgress(message.chat.id, progressMsgId, 95, '✅ Bot started successfully!', f_name, uid);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        
                        await announceDeployment(uid, mainFile);
                        
                        await bot.editMessageText(formatText(`
✅ <b>DEPLOYMENT COMPLETE!</b> 🎉

<blockquote>📄 File: <code>${mainFile}</code>
👤 User: <code>${uid}</code>
📁 Path: ${path.relative(DEPLOY_DIR, mainPath)}
🟢 Status: 🟢 Running
💰 Cost: ${settings.hosting_cost} points</blockquote>

📊 <b>Deployment Details:</b>
<blockquote>• File extracted: ✅
• Dependencies: ✅
• Bot started: ✅
• Status: Active</blockquote>
                        `), {
                            chat_id: message.chat.id,
                            message_id: progressMsgId,
                            parse_mode: 'HTML'
                        });
                        logAction('DEPLOY', uid, `Deployed ${mainFile} from ZIP (manual)`);
                    } else {
                        await updateProgress(message.chat.id, progressMsgId, 90, '❌ Failed to start bot!', f_name, uid);
                        await bot.editMessageText(formatText(`
❌ <b>DEPLOYMENT FAILED!</b>

<blockquote>Could not start the main file</blockquote>

💡 <b>Try:</b>
• Make sure the file has a main/entry point
• Check for missing dependencies
• Use /autofix to fix common errors
                        `), {
                            chat_id: message.chat.id,
                            message_id: progressMsgId,
                            parse_mode: 'HTML'
                        });
                    }
                } else {
                    bot.sendMessage(message.chat.id, formatText(`
❌ <b>File not found!</b>

<blockquote>Could not find: ${mainFileName}</blockquote>

📁 <b>Files found:</b>
${fs.readdirSync(extractDir).filter(f => !f.startsWith('.')).map(f => `• ${f}`).join('\n')}

💡 Please check the spelling and try again
                    `), { parse_mode: 'HTML' });
                }
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
                const ticketMarkup = {
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
                `), { parse_mode: 'HTML', reply_markup: ticketMarkup });
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
                fs.unlinkSync(file_path);
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
                    if (!content.includes('try:')) {
                        fixed = 'try:\n' + fixed + '\nexcept Exception as e:\n    print(f"Error: {e}")';
                        fixes.push('Added error handling');
                    }
                } else if (file_name.endsWith('.js')) {
                    if (!content.includes('const express')) {
                        fixed = 'const express = require("express");\n' + fixed;
                        fixes.push('Added express import');
                    }
                    if (!content.includes('try {')) {
                        fixed = 'try {\n' + fixed + '\n} catch (error) {\n    console.error(error);\n}';
                        fixes.push('Added error handling');
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
            await handleAIQuery(message);
            break;

        case 'AWAITING_SMART_DEPLOY':
            if (message.document) {
                delete userSessions[uid];
                await smartDeploy(message);
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
                const password = 'default123';
                const encrypted = encryptText(content, password);
                const encryptedPath = file_path + '.encrypted';
                fs.writeFileSync(encryptedPath, encrypted);
                
                bot.sendMessage(message.chat.id, formatText(`
🔐 <b>File Encrypted!</b>

<blockquote>📄 File: ${file_name}
🔐 Output: ${file_name}.encrypted</blockquote>
                `), { parse_mode: 'HTML' });
                logAction('ENCRYPT', uid, `Encrypted ${file_name}`);
                fs.unlinkSync(file_path);
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
                    fs.unlinkSync(file_path);
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
                
                let simulated = 0;
                let errors = 0;
                const startTime = Date.now();
                
                for (let i = 0; i < Math.min(requests, 100); i++) {
                    try {
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
            if (!settings.reviews) settings.reviews = {};
            const reviewId = `review_${Date.now()}`;
            settings.reviews[reviewId] = {
                user_id: parseInt(uid),
                username: message.from.username || 'N/A',
                review: message.text,
                timestamp: new Date().toISOString()
            };
            save_settings();
            
            bot.sendMessage(message.chat.id, formatText(`
✅ <b>Review Submitted!</b>

<blockquote>📝 ${message.text}</blockquote>
            `), { parse_mode: 'HTML' });
            logAction('REVIEW', uid, `Submitted review`);
            break;

        case 'AWAITING_RATE':
            delete userSessions[uid];
            const rateParts = message.text.split(' ');
            if (rateParts.length < 2) {
                return bot.sendMessage(message.chat.id, formatText('❌ Format: bot_name rating (1-5)'), { parse_mode: 'HTML' });
            }
            const botName = rateParts[0];
            const rating = parseInt(rateParts[1]);
            
            if (isNaN(rating) || rating < 1 || rating > 5) {
                return bot.sendMessage(message.chat.id, formatText('❌ Rating must be 1-5'), { parse_mode: 'HTML' });
            }
            
            if (!settings.ratings) settings.ratings = {};
            const ratingId = `rating_${Date.now()}`;
            settings.ratings[ratingId] = {
                user_id: parseInt(uid),
                bot_name: botName,
                rating: rating,
                timestamp: new Date().toISOString()
            };
            save_settings();
            
            bot.sendMessage(message.chat.id, formatText(`
⭐ <b>Rating Submitted!</b>

<blockquote>🤖 Bot: ${botName}
⭐ Rating: ${'⭐'.repeat(rating)}</blockquote>
            `), { parse_mode: 'HTML' });
            logAction('RATE', uid, `Rated ${botName} with ${rating} stars`);
            break;

        default:
            delete userSessions[uid];
            bot.sendMessage(message.chat.id, formatText('❌ Session expired. Please try again.'), { parse_mode: 'HTML' });
            break;
    }
}

// ============================================
// ============= AI QUERY HANDLER =============
// ============================================
async function handleAIQuery(message) {
    const uid = message.from.id.toString();
    const query = message.text.toLowerCase();
    
    let response = "🤖 <b>AI Assistant Response</b>\n\n";
    
    if (query.includes('error') || query.includes('bug') || query.includes('fix')) {
        response += "🔍 <b>Debugging Help:</b>\n\n";
        if (query.includes('syntax')) {
            response += "• Check for missing brackets, parentheses, or quotes\n";
            response += "• Make sure all statements are properly terminated\n";
            response += "• Check indentation (Python is indentation-sensitive)\n";
        }
        if (query.includes('import') || query.includes('module')) {
            response += "• Make sure the module is installed: pip install module_name\n";
            response += "• Check for typos in import statements\n";
            response += "• Verify the module exists in your environment\n";
        }
        if (query.includes('file') || query.includes('not found')) {
            response += "• Check if the file path is correct\n";
            response += "• Use absolute paths or correct relative paths\n";
            response += "• Verify file permissions\n";
        }
        if (query.includes('api') || query.includes('key')) {
            response += "• Make sure your API key is valid\n";
            response += "• Check if the API key has required permissions\n";
            response += "• Verify you're using the correct endpoint\n";
        }
        if (query.includes('timeout') || query.includes('slow')) {
            response += "• Increase timeout values in your code\n";
            response += "• Use async/await to prevent blocking\n";
            response += "• Consider using connection pooling\n";
        }
        response += "\n💡 <b>Quick Fix Steps:</b>\n";
        response += "1. Check error logs for details\n";
        response += "2. Use /autofix to auto-correct common issues\n";
        response += "3. Test with /test to isolate the problem\n";
        response += "4. Create a ticket if you need help\n";
        
    } else if (query.includes('deploy') || query.includes('hosting')) {
        response += "📤 <b>Deployment Tips:</b>\n\n";
        response += "• Use /deploy to deploy bot files\n";
        response += "• Supported: Python, Node.js, Ruby, Go, Shell\n";
        response += "• ZIP files with projects are supported\n";
        response += "• Ensure your bot has a main/entry point\n";
        response += "• Check logs for deployment errors\n";
        response += "• Use /test before final deployment\n";
        
    } else if (query.includes('points') || query.includes('points')) {
        response += "💰 <b>Points System:</b>\n\n";
        response += `• Daily reward: /daily (${settings.daily_reward} pts)\n`;
        response += `• Referral bonus: ${settings.points_per_referral} pts\n`;
        response += `• Deploy cost: ${settings.hosting_cost} pts\n`;
        response += `• Website cost: ${settings.website_cost} pts\n`;
        response += "• Play games to earn more points!\n";
        response += "• Check leaderboard with /leaderboard\n";
        
    } else if (query.includes('game') || query.includes('games')) {
        response += "🎮 <b>Games:</b>\n\n";
        response += "• Spin Wheel - Test your luck\n";
        response += "• Slot Machine - Classic casino game\n";
        response += "• Quiz - Test your knowledge\n";
        response += "• Daily Riddle - Solve puzzles\n";
        response += "• Each game earns you points!\n";
        
    } else if (query.includes('website') || query.includes('web')) {
        response += "🌐 <b>Website Deployment:</b>\n\n";
        response += "• Use /deploy_website to deploy\n";
        response += "• Supports HTML, CSS, JavaScript\n";
        response += "• React and Vue projects supported\n";
        response += "• ZIP files of entire projects\n";
        response += "• Get your URL after deployment\n";
        
    } else if (query.includes('help') || query.includes('how')) {
        response += "📋 <b>Quick Help:</b>\n\n";
        response += "• Type /commands for all commands\n";
        response += "• Type /cancel to cancel operations\n";
        response += "• Contact support for help\n";
        response += "• Check channel for updates\n";
        response += "• Rate the bot with /rate\n";
        
    } else {
        response += "📚 <b>General Information:</b>\n\n";
        response += "I can help you with:\n";
        response += "• Deploying bots and websites\n";
        response += "• Debugging errors\n";
        response += "• Understanding commands\n";
        response += "• Earning points\n";
        response += "• Playing games\n\n";
        response += "What would you like to know?\n";
        response += "Try: deploy, points, games, help, error";
    }
    
    const inlineKeyboard = {
        inline_keyboard: [
            [{ text: "🔧 AutoFix", callback_data: "quick_fix" },
             { text: "📤 Deploy", callback_data: "quick_deploy" }],
            [{ text: "🎮 Games", callback_data: "quick_games" },
             { text: "📞 Support", callback_data: "quick_support" }]
        ]
    };
    
    bot.sendMessage(message.chat.id, formatText(response), { 
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
    });
    
    logAction('AI_HELP', uid, `AI Query: ${query.substring(0, 50)}`);
}

// ============================================
// ============= SMART DEPLOY =================
// ============================================
async function smartDeploy(message) {
    const uid = message.from.id.toString();
    const file_name = message.document.file_name;
    const file_path = path.join(DEPLOY_DIR, `${uid}_${file_name}`);
    const tempPath = await bot.downloadFile(message.document.file_id, DEPLOY_DIR);
    const tempFileName = path.basename(tempPath);
    const tempFilePath = path.join(DEPLOY_DIR, tempFileName);
    fs.renameSync(tempFilePath, file_path);
    
    const content = fs.readFileSync(file_path, 'utf-8');
    let suggestions = [];
    let hasMain = false;
    
    if (file_name.endsWith('.py')) {
        hasMain = content.includes('if __name__ == "__main__"');
        if (!hasMain) {
            suggestions.push("Add 'if __name__ == \"__main__\"' as entry point");
        }
        if (!content.includes('import os')) {
            suggestions.push("Import 'os' for better compatibility");
        }
        if (!content.includes('try:')) {
            suggestions.push("Add try-except for error handling");
        }
    } else if (file_name.endsWith('.js')) {
        hasMain = content.includes('app.listen') || content.includes('module.exports');
        if (!hasMain) {
            suggestions.push("Add 'app.listen()' or 'module.exports'");
        }
        if (!content.includes('try {')) {
            suggestions.push("Add try-catch for error handling");
        }
    }
    
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

// ============================================
// ============= CALLBACK QUERY HANDLER =======
// ============================================
bot.on('callback_query', async (call) => {
    const uid = call.from.id;
    const data = call.data;
    const uidStr = uid.toString();

    // --- AI Fix Callback ---
    if (data.startsWith('aifix_')) {
        const parts = data.split('_');
        const fileName = parts[1];
        const userId = parts[2];
        const filePath = path.join(DEPLOY_DIR, `${userId}_${fileName}`);
        
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            let fixed = content;
            let fixes = [];
            
            if (fileName.endsWith('.py')) {
                if (!content.includes('try:')) {
                    fixed = 'try:\n' + fixed + '\nexcept Exception as e:\n    print(f"Error: {e}")';
                    fixes.push('Added try-except block');
                }
                if (!content.includes('import sys')) {
                    fixed = 'import sys\n' + fixed;
                    fixes.push('Added sys import');
                }
            } else if (fileName.endsWith('.js')) {
                if (!content.includes('try {')) {
                    fixed = 'try {\n' + fixed + '\n} catch (error) {\n    console.error(error);\n}';
                    fixes.push('Added try-catch block');
                }
            }
            
            fs.writeFileSync(filePath, fixed);
            
            for (const [procId, proc] of Object.entries(running_processes)) {
                if (proc.spawnfile === filePath || proc.fileName === fileName) {
                    if (proc.process && proc.process.kill) {
                        proc.process.kill('SIGTERM');
                    }
                    delete running_processes[procId];
                    break;
                }
            }
            
            if (run_user_file(filePath, parseInt(userId), fileName)) {
                bot.answerCallbackQuery(call.id, { text: "✅ Fixed and restarted!" });
                bot.editMessageText(formatText(`
✅ <b>AI Fix Applied!</b>

<blockquote>📄 File: ${fileName}
🔧 Fixes: ${fixes.length}
🟢 Status: Restarted</blockquote>
${fixes.map(f => `• ${f}`).join('\n')}
                `), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML'
                });
                logAction('AI_FIX', uid, `AI fixed ${fileName}`);
            }
        }
        return;
    }

    // --- Quick Actions ---
    if (data.startsWith('quick_')) {
        const action = data.replace('quick_', '');
        if (action === 'fix') {
            bot.sendMessage(call.message.chat.id, formatText('🔧 Send the file you want to fix'), { parse_mode: 'HTML' });
            userSessions[uidStr] = { step: 'AWAITING_FIX_FILE' };
        } else if (action === 'deploy') {
            bot.sendMessage(call.message.chat.id, formatText('📤 Send your bot file to deploy'), { parse_mode: 'HTML' });
            userSessions[uidStr] = { step: 'AWAITING_DEPLOYMENT_FILE' };
        } else if (action === 'games') {
            bot.sendMessage(call.message.chat.id, formatText('🎮 Choose a game:'), { 
                parse_mode: 'HTML', 
                reply_markup: games_keyboard() 
            });
        } else if (action === 'support') {
            const supportMarkup = {
                inline_keyboard: [
                    [{ text: "📱 Contact Owner", url: "https://t.me/NEX_CONTACT_AGENT_BOT" }]
                ]
            };
            bot.sendMessage(call.message.chat.id, formatText(`
📞 <b>Support</b>

<blockquote>Create a ticket with /ticket or contact owner</blockquote>
            `), { parse_mode: 'HTML', reply_markup: supportMarkup });
        }
        bot.answerCallbackQuery(call.id);
        return;
    }

    // --- Share Bot ---
    if (data.startsWith('share_')) {
        const fileName = data.replace('share_', '');
        const filePath = path.join(DEPLOY_DIR, `${uid}_${fileName}`);
        if (fs.existsSync(filePath)) {
            const botInfo = await bot.getMe();
            const shareLink = `https://t.me/${botInfo.username}?start=share_${fileName}`;
            bot.sendMessage(call.message.chat.id, formatText(`
📤 <b>Share Bot</b>

<blockquote>🤖 Bot: ${fileName}
🔗 Share link: ${shareLink}</blockquote>

Send this link to anyone to share your bot!
            `), { parse_mode: 'HTML' });
            logAction('SHARE', uid, `Shared bot ${fileName}`);
        }
        bot.answerCallbackQuery(call.id);
        return;
    }

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
        startQuiz(call);
    } else if (data === "game_riddle") {
        startRiddle(call);
    } else if (data === "game_stats") {
        const stats = gameState[uidStr] || { spins: 0, slots: 0, quiz: 0, riddles: 0 };
        bot.sendMessage(call.message.chat.id, formatText(`
📊 <b>Game Stats</b>

<blockquote>🎰 Spins: ${stats.spins || 0}
🎲 Slots: ${stats.slots || 0}
📝 Quiz: ${stats.quiz || 0}
🧩 Riddles: ${stats.riddles || 0}</blockquote>
        `), { parse_mode: 'HTML' });
        bot.answerCallbackQuery(call.id);
    }

    // --- File Management Callbacks ---
    if (data.includes("_") && !data.startsWith("adm_") && !data.startsWith("ticket_") && !data.startsWith("del_site") && !data.startsWith("game_") && !data.startsWith("quick_") && !data.startsWith("aifix_") && !data.startsWith("share_") && !data.startsWith("quiz_")) {
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
            for (const [procId, proc] of Object.entries(running_processes)) {
                if (proc.spawnfile === f_path || proc.fileName === f_name) {
                    if (proc.process && proc.process.kill) {
                        proc.process.kill('SIGTERM');
                    }
                    delete running_processes[procId];
                    break;
                }
            }
            
            if (fs.existsSync(f_path)) {
                try {
                    if (fs.lstatSync(f_path).isDirectory()) {
                        fs.rmSync(f_path, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(f_path);
                    }
                } catch (err) {}
            }
            
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

    // --- Quiz Answer ---
    if (data.startsWith('quiz_')) {
        const answerIndex = parseInt(data.split('_')[1]);
        const session = userSessions[uidStr];
        
        if (!session || session.step !== 'AWAITING_QUIZ_ANSWER') {
            return bot.answerCallbackQuery(call.id, { text: "❌ Quiz expired!" });
        }
        
        const isCorrect = answerIndex === session.answer;
        const points = isCorrect ? 10 : 0;
        
        if (isCorrect) {
            if (!gameState.quiz) gameState.quiz = {};
            if (!gameState.quiz[uidStr]) gameState.quiz[uidStr] = { total: 0, correct: 0 };
            gameState.quiz[uidStr].total++;
            gameState.quiz[uidStr].correct++;
            saveGameState();
            
            users_db[uidStr].points = (users_db[uidStr].points || 0) + points;
            users_db[uidStr].last_quiz = new Date().toISOString();
            save_db();
            
            bot.editMessageText(formatText(`
🎉 <b>Correct!</b>

<blockquote>✅ ${session.question}
💰 +${points} points!</blockquote>
            `), {
                chat_id: call.message.chat.id,
                message_id: call.message.message_id,
                parse_mode: 'HTML'
            });
            logAction('QUIZ', uidStr, `Quiz answered correctly (+${points} pts)`);
        } else {
            bot.editMessageText(formatText(`
❌ <b>Wrong answer!</b>

<blockquote>😅 The correct answer was option ${session.answer + 1}</blockquote>
            `), {
                chat_id: call.message.chat.id,
                message_id: call.message.message_id,
                parse_mode: 'HTML'
            });
        }
        
        delete userSessions[uidStr];
        bot.answerCallbackQuery(call.id, { text: isCorrect ? "✅ Correct!" : "❌ Wrong!" });
        return;
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
                bot.editMessageText(formatText('👥 <b>User Management</b>\n\nSelect an action:'), {
                    chat_id: call.message.chat.id,
                    message_id: call.message.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "👤 User Info", callback_data: "adm_user_info" },
                             { text: "❄️ Freeze/Unfreeze", callback_data: "adm_freeze" }],
                            [{ text: "👑 Demote Admin", callback_data: "adm_demote" },
                             { text: "📊 User Stats", callback_data: "adm_user_stats" }],
                            [{ text: "🔙 Back", callback_data: "adm_back" }]
                        ]
                    }
                });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_freeze":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'freeze_user' };
                bot.sendMessage(call.message.chat.id, formatText('❄️ Send user ID to freeze:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            case "adm_demote":
                userSessions[uidStr] = { step: 'AWAITING_ADMIN_MANAGE', action: 'demote_admin' };
                bot.sendMessage(call.message.chat.id, formatText('👑 Send user ID to demote from admin:'), { parse_mode: 'HTML' });
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

            case "adm_set_video":
                userSessions[uidStr] = { step: 'AWAITING_WELCOME_VIDEO' };
                bot.sendMessage(call.message.chat.id, formatText('📹 Send welcome video:'), { parse_mode: 'HTML' });
                bot.answerCallbackQuery(call.id);
                break;

            default:
                bot.answerCallbackQuery(call.id);
                break;
        }
    }
});

// ============================================
// ============= START QUIZ ===================
// ============================================
function startQuiz(call) {
    const uid = call.from.id.toString();
    const userData = users_db[uid] || {};
    
    const lastQuiz = userData.last_quiz ? new Date(userData.last_quiz) : null;
    if (lastQuiz && (new Date() - lastQuiz) < 60000) {
        const secondsLeft = Math.ceil(60 - (new Date() - lastQuiz) / 1000);
        return bot.answerCallbackQuery(call.id, { text: `⏰ Wait ${secondsLeft}s` });
    }
    
    const quizIndex = Math.floor(Math.random() * quizQuestions.length);
    const quiz = quizQuestions[quizIndex];
    
    userSessions[uid] = { 
        step: 'AWAITING_QUIZ_ANSWER', 
        quizIndex: quizIndex,
        question: quiz.question,
        answer: quiz.answer
    };
    
    const optionsKeyboard = {
        inline_keyboard: quiz.options.map((opt, i) => [
            { text: `${String.fromCharCode(65 + i)}. ${opt}`, callback_data: `quiz_${i}` }
        ])
    };
    
    bot.editMessageText(formatText(`
📝 <b>Quiz Time!</b>

<blockquote>${quiz.question}</blockquote>

💰 Prize: 10 points for correct answer!
    `), {
        chat_id: call.message.chat.id,
        message_id: call.message.message_id,
        parse_mode: 'HTML',
        reply_markup: optionsKeyboard
    });
    bot.answerCallbackQuery(call.id);
}

// ============================================
// ============= START RIDDLE =================
// ============================================
function startRiddle(call) {
    const uid = call.from.id.toString();
    const userData = users_db[uid] || {};
    const today = new Date().toISOString().split('T')[0];
    
    if (userData.last_riddle === today) {
        return bot.answerCallbackQuery(call.id, { text: "🧩 Already solved today!" });
    }
    
    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
    const riddleIndex = dayOfYear % riddles.length;
    const riddle = riddles[riddleIndex];
    
    userSessions[uid] = { 
        step: 'AWAITING_RIDDLE_ANSWER', 
        riddleAnswer: riddle.answer,
        riddleQuestion: riddle.question
    };
    
    bot.editMessageText(formatText(`
🧩 <b>Daily Riddle</b>

<blockquote>${riddle.question}</blockquote>

💡 Send your answer (one word) to win 5 points!
    `), {
        chat_id: call.message.chat.id,
        message_id: call.message.message_id,
        parse_mode: 'HTML'
    });
    bot.answerCallbackQuery(call.id);
}

// ============================================
// ============= RIDDLE ANSWER HANDLER ========
// ============================================
// Handle riddle answers in session handler
// Already handled in the session handler

// ============================================
// ============= EXPRESS SERVER ===============
// ============================================
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

app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web server running on port ${port}`);
});

// ============================================
// ============= ERROR HANDLERS ===============
// ============================================
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    logAction('ERROR', 'SYSTEM', `Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    logAction('ERROR', 'SYSTEM', `Unhandled Rejection: ${reason}`);
});

// ============================================
// ============= STARTUP ======================
// ============================================
console.log("🤖 ⚡ ULTIMATE HOSTING BOT ONLINE!");
console.log(`👑 Owner: ${settings.owner}`);
console.log(`👥 Admins: ${settings.admins.length}`);
console.log(`📊 Total Users: ${Object.keys(users_db).length}`);
console.log(`💰 Host Cost: ${settings.hosting_cost}`);
console.log(`🎁 Daily Reward: ${settings.daily_reward}`);
console.log(`🌐 Railway URL: ${RAILWAY_URL}`);
console.log(`📡 Port: ${port}`);
console.log(`✅ All commands loaded successfully!`);
console.log(`📦 Smart ZIP deployment enabled!`);
console.log(`🐍 Python & 📦 Node.js auto-detection active!`);
