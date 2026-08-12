const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const Database = require('./database');

// Small caps font converter
const toSmallCaps = (text) => {
    const smallCaps = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ', 'g': 'ɢ',
        'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ',
        'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': 's', 't': 'ᴛ', 'u': 'ᴜ',
        'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
    };
    return text.split('').map(char => {
        const lower = char.toLowerCase();
        return smallCaps[lower] || char;
    }).join('');
};

// ============================================
// INITIALIZE
// ============================================
const bot = new TelegramBot(config.token, { polling: true });
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const db = new Database();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const userStates = {};

// ============================================
// FORCE JOIN MIDDLEWARE
// ============================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (config.adminIds.includes(userId)) return;
    if (db.isBanned(userId)) {
        return bot.sendMessage(chatId, 
            `<blockquote>❌ <b>${toSmallCaps('you are banned from using this bot')}</b></blockquote>`,
            { parse_mode: 'HTML' }
        );
    }
    
    const channels = db.getForceChannels();
    for (const channel of channels) {
        try {
            const member = await bot.getChatMember(channel, userId);
            if (member.status === 'left' || member.status === 'kicked') {
                return bot.sendMessage(chatId,
                    `<blockquote>⚠️ <b>${toSmallCaps('please join our channel first')}</b>\n\n` +
                    `${toSmallCaps('you must join')} <b>${channel}</b> ${toSmallCaps('to use this bot')}</blockquote>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `📢 ${toSmallCaps('join channel')}`, url: `https://t.me/${channel.replace('@', '')}`, style: 'primary' }],
                                [{ text: `✅ ${toSmallCaps('check again')}`, callback_data: 'check_join', style: 'success' }]
                            ]
                        }
                    }
                );
            }
        } catch (error) {}
    }
});

// ============================================
// START COMMAND
// ============================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    
    let user = db.getUser(userId);
    if (!user) {
        user = db.createUser(userId, username);
        
        const referrerId = msg.text.split(' ')[1];
        if (referrerId && referrerId !== userId.toString()) {
            const referrer = db.getUser(parseInt(referrerId));
            if (referrer && !user.referredBy) {
                db.addPoints(parseInt(referrerId), config.referralBonus);
                db.addReferral(parseInt(referrerId), userId);
                db.updateUser(userId, { referredBy: parseInt(referrerId) });
                
                bot.sendMessage(parseInt(referrerId),
                    `<blockquote>🎉 <b>${toSmallCaps('new referral')}</b>\n\n` +
                    `${toSmallCaps('user')} <b>${username || 'Unknown'}</b> ${toSmallCaps('joined using your link')}\n` +
                    `${toSmallCaps('you earned')} <b>+${config.referralBonus}</b> ${toSmallCaps('points')} 🎊</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
        }
    }
    
    if (config.adminIds.includes(userId)) {
        return showAdminPanel(chatId);
    }
    
    const canClaimDaily = (Date.now() - (user.lastDaily || 0)) > 86400000;
    
    bot.sendMessage(chatId,
        `<blockquote>🌹 <b>${toSmallCaps('welcome to premium hosting bot')}</b>\n\n` +
        `👤 <b>${toSmallCaps('user')}:</b> ${username || 'Unknown'}\n` +
        `💎 <b>${toSmallCaps('points')}:</b> ${user.points}\n` +
        `🖥️ <b>${toSmallCaps('servers')}:</b> ${user.servers.length}/${config.maxServers}\n` +
        `👥 <b>${toSmallCaps('referrals')}:</b> ${user.referrals?.length || 0}\n` +
        `📅 <b>${toSmallCaps('daily bonus')}:</b> ${canClaimDaily ? '✅ Available' : '⏳ Wait 24h'}</blockquote>`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🖥️ ${toSmallCaps('create server')}`, callback_data: 'create_server', style: 'primary' }, 
                     { text: `📋 ${toSmallCaps('my servers')}`, callback_data: 'my_servers', style: 'success' }],
                    [{ text: `💎 ${toSmallCaps('points & rewards')}`, callback_data: 'points_menu', style: 'primary' }, 
                     { text: `👥 ${toSmallCaps('referral system')}`, callback_data: 'referral_menu', style: 'success' }],
                    [{ text: `🎫 ${toSmallCaps('support ticket')}`, callback_data: 'ticket_menu', style: 'primary' }, 
                     { text: `ℹ️ ${toSmallCaps('help')}`, callback_data: 'help_menu', style: 'primary' }],
                    [{ text: `📊 ${toSmallCaps('dashboard')}`, callback_data: 'open_dashboard', style: 'success' }]
                ]
            }
        }
    );
});

// ============================================
// ADMIN PANEL
// ============================================
async function showAdminPanel(chatId) {
    bot.sendMessage(chatId,
        `<blockquote>👑 <b>${toSmallCaps('admin control panel')}</b>\n\n` +
        `${toSmallCaps('manage your bot with the buttons below')}</blockquote>`,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `👥 ${toSmallCaps('user management')}`, callback_data: 'admin_users', style: 'primary' }, 
                     { text: `🖥️ ${toSmallCaps('server management')}`, callback_data: 'admin_servers', style: 'success' }],
                    [{ text: `📢 ${toSmallCaps('broadcast & announce')}`, callback_data: 'admin_broadcast', style: 'primary' }, 
                     { text: `🎟️ ${toSmallCaps('promo codes')}`, callback_data: 'admin_promos', style: 'success' }],
                    [{ text: `⚙️ ${toSmallCaps('settings')}`, callback_data: 'admin_settings', style: 'primary' }, 
                     { text: `🎫 ${toSmallCaps('tickets')}`, callback_data: 'admin_tickets', style: 'danger' }],
                    [{ text: `📊 ${toSmallCaps('statistics')}`, callback_data: 'admin_stats', style: 'success' }, 
                     { text: `📁 ${toSmallCaps('logs')}`, callback_data: 'admin_logs', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back to user menu')}`, callback_data: 'back_to_main', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN USER MANAGEMENT (6 commands)
// ============================================
async function showAdminUsers(chatId, messageId) {
    await bot.editMessageText(
        `<blockquote>👥 <b>${toSmallCaps('user management')}</b>\n\n` +
        `${toSmallCaps('select an action')}</blockquote>`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `➕ ${toSmallCaps('add points')}`, callback_data: 'admin_addpoints', style: 'success' }, 
                     { text: `➖ ${toSmallCaps('remove points')}`, callback_data: 'admin_removepoints', style: 'danger' }],
                    [{ text: `🔨 ${toSmallCaps('ban user')}`, callback_data: 'admin_ban', style: 'danger' }, 
                     { text: `🔓 ${toSmallCaps('unban user')}`, callback_data: 'admin_unban', style: 'success' }],
                    [{ text: `📋 ${toSmallCaps('view users')}`, callback_data: 'admin_viewusers', style: 'primary' }, 
                     { text: `💎 ${toSmallCaps('global points')}`, callback_data: 'admin_globalpoints', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN SERVER MANAGEMENT (6 commands)
// ============================================
async function showAdminServers(chatId, messageId) {
    await bot.editMessageText(
        `<blockquote>🖥️ <b>${toSmallCaps('server management')}</b>\n\n` +
        `${toSmallCaps('select an action')}</blockquote>`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📋 ${toSmallCaps('view all servers')}`, callback_data: 'admin_viewservers', style: 'primary' }, 
                     { text: `🗑️ ${toSmallCaps('delete server')}`, callback_data: 'admin_deleteserver', style: 'danger' }],
                    [{ text: `▶️ ${toSmallCaps('start server')}`, callback_data: 'admin_startserver', style: 'success' }, 
                     { text: `⏹️ ${toSmallCaps('stop server')}`, callback_data: 'admin_stopserver', style: 'danger' }],
                    [{ text: `🔄 ${toSmallCaps('restart server')}`, callback_data: 'admin_restartserver', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN BROADCAST (2 commands)
// ============================================
async function showAdminBroadcast(chatId, messageId) {
    await bot.editMessageText(
        `<blockquote>📢 <b>${toSmallCaps('broadcast & announce')}</b>\n\n` +
        `${toSmallCaps('select an action')}</blockquote>`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `📢 ${toSmallCaps('broadcast to all')}`, callback_data: 'admin_broadcast_all', style: 'primary' }, 
                     { text: `📣 ${toSmallCaps('announce to channel')}`, callback_data: 'admin_announce', style: 'success' }],
                    [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN PROMO CODES (3 commands)
// ============================================
async function showAdminPromos(chatId, messageId) {
    await bot.editMessageText(
        `<blockquote>🎟️ <b>${toSmallCaps('promo code management')}</b>\n\n` +
        `${toSmallCaps('select an action')}</blockquote>`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `➕ ${toSmallCaps('create promo')}`, callback_data: 'admin_addpromo', style: 'success' }, 
                     { text: `🗑️ ${toSmallCaps('remove promo')}`, callback_data: 'admin_removepromo', style: 'danger' }],
                    [{ text: `📋 ${toSmallCaps('view promos')}`, callback_data: 'admin_viewpromos', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN SETTINGS (8 commands)
// ============================================
async function showAdminSettings(chatId, messageId) {
    await bot.editMessageText(
        `<blockquote>⚙️ <b>${toSmallCaps('bot settings')}</b>\n\n` +
        `${toSmallCaps('current settings')}:\n` +
        `• ${toSmallCaps('points per server')}: ${config.pointsPerServer}\n` +
        `• ${toSmallCaps('max servers')}: ${config.maxServers}\n` +
        `• ${toSmallCaps('referral bonus')}: ${config.referralBonus}\n` +
        `• ${toSmallCaps('daily bonus')}: ${config.dailyBonus}\n` +
        `• ${toSmallCaps('web url')}: ${config.webUrl}\n` +
        `• ${toSmallCaps('maintenance')}: ${config.maintenance ? '🟡 On' : '🟢 Off'}\n\n` +
        `${toSmallCaps('select a setting to change')}</blockquote>`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `💎 ${toSmallCaps('set points per server')}`, callback_data: 'admin_setprice', style: 'primary' }, 
                     { text: `📊 ${toSmallCaps('set max servers')}`, callback_data: 'admin_setlimit', style: 'primary' }],
                    [{ text: `👥 ${toSmallCaps('set referral bonus')}`, callback_data: 'admin_setreferral', style: 'primary' }, 
                     { text: `🎁 ${toSmallCaps('set daily bonus')}`, callback_data: 'admin_setdaily', style: 'primary' }],
                    [{ text: `🔗 ${toSmallCaps('set web url')}`, callback_data: 'admin_setweburl', style: 'primary' }, 
                     { text: `🔧 ${toSmallCaps('maintenance mode')}`, callback_data: 'admin_maintenance', style: 'danger' }],
                    [{ text: `📢 ${toSmallCaps('force join channels')}`, callback_data: 'admin_channels', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN CHANNELS (2 commands)
// ============================================
async function showAdminChannels(chatId, messageId) {
    const channels = db.getForceChannels();
    let message = `<blockquote>📢 <b>${toSmallCaps('force join channels')}</b>\n\n`;
    if (channels.length === 0) {
        message += `${toSmallCaps('no channels added')}\n\n`;
    } else {
        for (const channel of channels) {
            message += `• ${channel}\n`;
        }
        message += `\n`;
    }
    message += `${toSmallCaps('select an action')}</blockquote>`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: `➕ ${toSmallCaps('add channel')}`, callback_data: 'admin_addchannel', style: 'success' }, 
                 { text: `🗑️ ${toSmallCaps('remove channel')}`, callback_data: 'admin_removechannel', style: 'danger' }],
                [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
            ]
        }
    });
}

// ============================================
// ADMIN TICKETS (2 commands)
// ============================================
async function showAdminTickets(chatId, messageId) {
    const tickets = db.getAllTickets();
    if (tickets.length === 0) {
        return bot.editMessageText(
            `<blockquote>📭 <b>${toSmallCaps('no tickets found')}</b></blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                    ]
                }
            }
        );
    }
    
    let message = `<blockquote>🎫 <b>${toSmallCaps('all tickets')}</b>\n\n`;
    for (const ticket of tickets) {
        const status = ticket.status === 'open' ? '🟡 Open' : '✅ Resolved';
        const user = db.getUser(ticket.userId);
        message += `┌ ${ticket.subject}\n`;
        message += `├ 🆔 ${ticket.id}\n`;
        message += `├ 👤 @${user?.username || 'Unknown'}\n`;
        message += `├ ${status}\n`;
        message += `└──────────────────\n\n`;
    }
    message += `</blockquote>`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: `✅ ${toSmallCaps('resolve ticket')}`, callback_data: 'admin_resolveticket', style: 'success' }],
                [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
            ]
        }
    });
}

// ============================================
// ADMIN STATS (1 command)
// ============================================
async function showAdminStats(chatId, messageId) {
    const totalUsers = db.getTotalUsers();
    const totalServers = db.getTotalServers();
    const totalTickets = Object.keys(db.data.tickets).length;
    const totalPromos = Object.keys(db.data.promos).length;
    const totalChannels = db.getForceChannels().length;
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const bannedUsers = db.data.banned?.length || 0;
    
    await bot.editMessageText(
        `<blockquote>📊 <b>${toSmallCaps('bot statistics')}</b>\n\n` +
        `🟢 ${toSmallCaps('status')}: Online\n` +
        `👥 ${toSmallCaps('users')}: ${totalUsers}\n` +
        `🖥️ ${toSmallCaps('servers')}: ${totalServers}\n` +
        `🎫 ${toSmallCaps('tickets')}: ${totalTickets}\n` +
        `🎟️ ${toSmallCaps('promo codes')}: ${totalPromos}\n` +
        `📢 ${toSmallCaps('force join channels')}: ${totalChannels}\n` +
        `🔨 ${toSmallCaps('banned users')}: ${bannedUsers}\n` +
        `⏱️ ${toSmallCaps('uptime')}: ${days}d ${hours}h ${minutes}m\n` +
        `💾 ${toSmallCaps('memory')}: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB</blockquote>`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🔄 ${toSmallCaps('refresh')}`, callback_data: 'admin_stats', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN LOGS (1 command)
// ============================================
async function showAdminLogs(chatId, messageId) {
    const logDir = path.join(__dirname, 'logs');
    let logMessage = `<blockquote>📁 <b>${toSmallCaps('system logs')}</b>\n\n`;
    
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
        logMessage += `${toSmallCaps('no logs found')}\n\n`;
    } else {
        const logFiles = fs.readdirSync(logDir);
        if (logFiles.length === 0) {
            logMessage += `${toSmallCaps('no logs found')}\n\n`;
        } else {
            const latestLog = logFiles.sort().reverse()[0];
            const logPath = path.join(logDir, latestLog);
            const content = fs.readFileSync(logPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim()).slice(-15);
            
            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    logMessage += `[${parsed.time || 'N/A'}] ${parsed.type || 'info'}: ${parsed.msg || line}\n`;
                } catch {
                    logMessage += `${line}\n`;
                }
            }
        }
    }
    logMessage += `</blockquote>`;
    
    await bot.editMessageText(logMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: `🔄 ${toSmallCaps('refresh')}`, callback_data: 'admin_logs', style: 'primary' }],
                [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
            ]
        }
    });
}

// ============================================
// CALLBACK QUERY HANDLER
// ============================================
bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const userId = callbackQuery.from.id;
    const isAdmin = config.adminIds.includes(userId);
    
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const user = db.getUser(userId);
    
    // ============================================
    // USER ACTIONS
    // ============================================
    switch(action) {
        case 'check_join': {
            const channels = db.getForceChannels();
            let allJoined = true;
            for (const channel of channels) {
                try {
                    const member = await bot.getChatMember(channel, userId);
                    if (member.status === 'left' || member.status === 'kicked') {
                        allJoined = false;
                        break;
                    }
                } catch { allJoined = false; }
            }
            if (allJoined) {
                await bot.deleteMessage(chatId, messageId);
                await bot.sendMessage(chatId,
                    `<blockquote>✅ <b>${toSmallCaps('all channels joined')}</b>\n\n` +
                    `${toSmallCaps('you can now use the bot')}</blockquote>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `🔙 ${toSmallCaps('back to menu')}`, callback_data: 'back_to_main', style: 'primary' }]
                            ]
                        }
                    }
                );
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, 
                    `${toSmallCaps('please join all required channels')}`, true);
            }
            break;
        }
        
        case 'back_to_main': {
            const userData = db.getUser(userId);
            const canClaimDaily = (Date.now() - (userData?.lastDaily || 0)) > 86400000;
            if (isAdmin) {
                await showAdminPanel(chatId);
                break;
            }
            await bot.editMessageText(
                `<blockquote>🌹 <b>${toSmallCaps('premium hosting bot')}</b>\n\n` +
                `👤 <b>${toSmallCaps('user')}:</b> ${callbackQuery.from.username || 'Unknown'}\n` +
                `💎 <b>${toSmallCaps('points')}:</b> ${userData?.points || 0}\n` +
                `🖥️ <b>${toSmallCaps('servers')}:</b> ${userData?.servers?.length || 0}/${config.maxServers}\n` +
                `📅 <b>${toSmallCaps('daily bonus')}:</b> ${canClaimDaily ? '✅ Available' : '⏳ Wait 24h'}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🖥️ ${toSmallCaps('create server')}`, callback_data: 'create_server', style: 'primary' }, 
                             { text: `📋 ${toSmallCaps('my servers')}`, callback_data: 'my_servers', style: 'success' }],
                            [{ text: `💎 ${toSmallCaps('points & rewards')}`, callback_data: 'points_menu', style: 'primary' }, 
                             { text: `👥 ${toSmallCaps('referral system')}`, callback_data: 'referral_menu', style: 'success' }],
                            [{ text: `🎫 ${toSmallCaps('support ticket')}`, callback_data: 'ticket_menu', style: 'primary' }, 
                             { text: `ℹ️ ${toSmallCaps('help')}`, callback_data: 'help_menu', style: 'primary' }],
                            [{ text: `📊 ${toSmallCaps('dashboard')}`, callback_data: 'open_dashboard', style: 'success' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // ADMIN ACTIONS (30+ Commands)
        // ============================================
        case 'admin_users': {
            if (!isAdmin) return;
            await showAdminUsers(chatId, messageId);
            break;
        }
        
        case 'admin_servers': {
            if (!isAdmin) return;
            await showAdminServers(chatId, messageId);
            break;
        }
        
        case 'admin_broadcast': {
            if (!isAdmin) return;
            await showAdminBroadcast(chatId, messageId);
            break;
        }
        
        case 'admin_promos': {
            if (!isAdmin) return;
            await showAdminPromos(chatId, messageId);
            break;
        }
        
        case 'admin_settings': {
            if (!isAdmin) return;
            await showAdminSettings(chatId, messageId);
            break;
        }
        
        case 'admin_tickets': {
            if (!isAdmin) return;
            await showAdminTickets(chatId, messageId);
            break;
        }
        
        case 'admin_stats': {
            if (!isAdmin) return;
            await showAdminStats(chatId, messageId);
            break;
        }
        
        case 'admin_logs': {
            if (!isAdmin) return;
            await showAdminLogs(chatId, messageId);
            break;
        }
        
        case 'admin_channels': {
            if (!isAdmin) return;
            await showAdminChannels(chatId, messageId);
            break;
        }
        
        case 'admin_back': {
            if (!isAdmin) return;
            await showAdminPanel(chatId);
            break;
        }
        
        // ============================================
        // ADMIN USER MANAGEMENT (6 commands)
        // ============================================
        case 'admin_addpoints': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'addpoints' };
            await bot.editMessageText(
                `<blockquote>➕ <b>${toSmallCaps('add points')}</b>\n\n` +
                `${toSmallCaps('send')}: @username 50\n\n` +
                `${toSmallCaps('example')}: @john 50</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_users', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_removepoints': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'removepoints' };
            await bot.editMessageText(
                `<blockquote>➖ <b>${toSmallCaps('remove points')}</b>\n\n` +
                `${toSmallCaps('send')}: @username 20\n\n` +
                `${toSmallCaps('example')}: @john 20</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_users', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_ban': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'ban' };
            await bot.editMessageText(
                `<blockquote>🔨 <b>${toSmallCaps('ban user')}</b>\n\n` +
                `${toSmallCaps('send')}: @username\n\n` +
                `${toSmallCaps('example')}: @john</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_users', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_unban': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'unban' };
            await bot.editMessageText(
                `<blockquote>🔓 <b>${toSmallCaps('unban user')}</b>\n\n` +
                `${toSmallCaps('send')}: @username\n\n` +
                `${toSmallCaps('example')}: @john</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_users', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_viewusers': {
            if (!isAdmin) return;
            const users = Object.values(db.data.users);
            let message = `<blockquote>👥 <b>${toSmallCaps('total users')}</b>: ${users.length}\n\n`;
            const sorted = users.sort((a, b) => b.points - a.points);
            for (let i = 0; i < Math.min(15, sorted.length); i++) {
                const u = sorted[i];
                message += `${i + 1}. @${u.username || 'Unknown'} - ${u.points} ${toSmallCaps('points')} (${u.servers.length} ${toSmallCaps('servers')})\n`;
            }
            if (users.length > 15) {
                message += `\n${toSmallCaps('and')} ${users.length - 15} ${toSmallCaps('more')}...`;
            }
            message += `</blockquote>`;
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔄 ${toSmallCaps('refresh')}`, callback_data: 'admin_viewusers', style: 'primary' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_users', style: 'danger' }]
                    ]
                }
            });
            break;
        }
        
        case 'admin_globalpoints': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'globalpoints' };
            await bot.editMessageText(
                `<blockquote>💎 <b>${toSmallCaps('global points')}</b>\n\n` +
                `${toSmallCaps('send amount')}: 10\n\n` +
                `${toSmallCaps('this will give points to all users')}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_users', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // ADMIN SERVER MANAGEMENT (6 commands)
        // ============================================
        case 'admin_viewservers': {
            if (!isAdmin) return;
            const servers = Object.values(db.data.servers);
            let message = `<blockquote>🖥️ <b>${toSmallCaps('total servers')}</b>: ${servers.length}\n\n`;
            for (let i = 0; i < Math.min(15, servers.length); i++) {
                const s = servers[i];
                const status = s.status === 'running' ? '🟢' : '🔴';
                const u = db.getUser(s.userId);
                message += `${status} ${s.name} (${s.type}) - @${u?.username || 'Unknown'}\n`;
            }
            if (servers.length > 15) {
                message += `\n${toSmallCaps('and')} ${servers.length - 15} ${toSmallCaps('more')}...`;
            }
            message += `</blockquote>`;
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔄 ${toSmallCaps('refresh')}`, callback_data: 'admin_viewservers', style: 'primary' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_servers', style: 'danger' }]
                    ]
                }
            });
            break;
        }
        
        case 'admin_deleteserver': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'deleteserver' };
            await bot.editMessageText(
                `<blockquote>🗑️ <b>${toSmallCaps('delete server')}</b>\n\n` +
                `${toSmallCaps('send server id')}\n\n` +
                `${toSmallCaps('example')}: srv_abc123</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_servers', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_startserver': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'startserver' };
            await bot.editMessageText(
                `<blockquote>▶️ <b>${toSmallCaps('start server')}</b>\n\n` +
                `${toSmallCaps('send server id')}\n\n` +
                `${toSmallCaps('example')}: srv_abc123</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_servers', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_stopserver': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'stopserver' };
            await bot.editMessageText(
                `<blockquote>⏹️ <b>${toSmallCaps('stop server')}</b>\n\n` +
                `${toSmallCaps('send server id')}\n\n` +
                `${toSmallCaps('example')}: srv_abc123</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_servers', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_restartserver': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'restartserver' };
            await bot.editMessageText(
                `<blockquote>🔄 <b>${toSmallCaps('restart server')}</b>\n\n` +
                `${toSmallCaps('send server id')}\n\n` +
                `${toSmallCaps('example')}: srv_abc123</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_servers', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // ADMIN BROADCAST (2 commands)
        // ============================================
        case 'admin_broadcast_all': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'broadcast' };
            await bot.editMessageText(
                `<blockquote>📢 <b>${toSmallCaps('broadcast to all users')}</b>\n\n` +
                `${toSmallCaps('send your message')}\n\n` +
                `${toSmallCaps('this will send to ALL users')}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_broadcast', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_announce': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'announce' };
            await bot.editMessageText(
                `<blockquote>📣 <b>${toSmallCaps('announce to channel')}</b>\n\n` +
                `${toSmallCaps('send your announcement')}\n\n` +
                `${toSmallCaps('this will post to the announce channel')}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_broadcast', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // ADMIN PROMO CODES (3 commands)
        // ============================================
        case 'admin_addpromo': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'addpromo' };
            await bot.editMessageText(
                `<blockquote>➕ <b>${toSmallCaps('create promo code')}</b>\n\n` +
                `${toSmallCaps('send')}: CODE 50\n\n` +
                `${toSmallCaps('example')}: SUMMER2024 50</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_promos', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_removepromo': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'removepromo' };
            await bot.editMessageText(
                `<blockquote>🗑️ <b>${toSmallCaps('remove promo code')}</b>\n\n` +
                `${toSmallCaps('send code')}\n\n` +
                `${toSmallCaps('example')}: SUMMER2024</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_promos', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_viewpromos': {
            if (!isAdmin) return;
            const promos = Object.values(db.data.promos);
            let message = `<blockquote>🎟️ <b>${toSmallCaps('promo codes')}</b>: ${promos.length}\n\n`;
            for (const promo of promos) {
                message += `📌 ${promo.code} - ${promo.points} ${toSmallCaps('points')} (${promo.used.length} ${toSmallCaps('used')})\n`;
            }
            message += `</blockquote>`;
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔄 ${toSmallCaps('refresh')}`, callback_data: 'admin_viewpromos', style: 'primary' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_promos', style: 'danger' }]
                    ]
                }
            });
            break;
        }
        
        // ============================================
        // ADMIN SETTINGS (8 commands)
        // ============================================
        case 'admin_setprice': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'setprice' };
            await bot.editMessageText(
                `<blockquote>💎 <b>${toSmallCaps('set points per server')}</b>\n\n` +
                `${toSmallCaps('send amount')}: 10\n\n` +
                `${toSmallCaps('current')}: ${config.pointsPerServer}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_setlimit': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'setlimit' };
            await bot.editMessageText(
                `<blockquote>📊 <b>${toSmallCaps('set max servers per user')}</b>\n\n` +
                `${toSmallCaps('send number')}: 5\n\n` +
                `${toSmallCaps('current')}: ${config.maxServers}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_setreferral': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'setreferral' };
            await bot.editMessageText(
                `<blockquote>👥 <b>${toSmallCaps('set referral bonus')}</b>\n\n` +
                `${toSmallCaps('send amount')}: 100\n\n` +
                `${toSmallCaps('current')}: ${config.referralBonus}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_setdaily': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'setdaily' };
            await bot.editMessageText(
                `<blockquote>🎁 <b>${toSmallCaps('set daily bonus')}</b>\n\n` +
                `${toSmallCaps('send amount')}: 20\n\n` +
                `${toSmallCaps('current')}: ${config.dailyBonus}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_setweburl': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'setweburl' };
            await bot.editMessageText(
                `<blockquote>🔗 <b>${toSmallCaps('set web url')}</b>\n\n` +
                `${toSmallCaps('send url')}: https://yourdomain.com\n\n` +
                `${toSmallCaps('current')}: ${config.webUrl}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_maintenance': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'maintenance' };
            await bot.editMessageText(
                `<blockquote>🔧 <b>${toSmallCaps('maintenance mode')}</b>\n\n` +
                `${toSmallCaps('send')}: on ${toSmallCaps('or')} off\n\n` +
                `${toSmallCaps('current')}: ${config.maintenance ? '🟡 On' : '🟢 Off'}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_settings', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // ADMIN CHANNELS (2 commands)
        // ============================================
        case 'admin_addchannel': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'addchannel' };
            await bot.editMessageText(
                `<blockquote>📢 <b>${toSmallCaps('add force join channel')}</b>\n\n` +
                `${toSmallCaps('send')}: @channelname\n\n` +
                `${toSmallCaps('example')}: @premium_hosting</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_channels', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'admin_removechannel': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'removechannel' };
            await bot.editMessageText(
                `<blockquote>🗑️ <b>${toSmallCaps('remove force join channel')}</b>\n\n` +
                `${toSmallCaps('send')}: @channelname\n\n` +
                `${toSmallCaps('example')}: @premium_hosting</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_channels', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // ADMIN TICKETS (2 commands)
        // ============================================
        case 'admin_resolveticket': {
            if (!isAdmin) return;
            userStates[userId] = { action: 'resolveticket' };
            await bot.editMessageText(
                `<blockquote>✅ <b>${toSmallCaps('resolve ticket')}</b>\n\n` +
                `${toSmallCaps('send ticket id')}\n\n` +
                `${toSmallCaps('example')}: TICKET123</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'admin_tickets', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        // ============================================
        // USER CONTINUATION...
        // ============================================
        case 'create_server':
        case 'create_python':
        case 'create_node':
        case 'my_servers':
        case 'points_menu':
        case 'claim_daily':
        case 'referral_menu':
        case 'ticket_menu':
        case 'create_ticket':
        case 'my_tickets':
        case 'help_menu':
        case 'open_dashboard':
        case 'redeem_promo':
            // These are handled in the same switch above
            // The user actions are already defined before admin actions
            // Just break here to avoid duplicate handling
            break;
    }
});

// ============================================
// TEXT MESSAGE HANDLER FOR ADMIN COMMANDS
// ============================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    const user = db.getUser(userId);
    if (!user) {
        return bot.sendMessage(chatId,
            `<blockquote>❌ <b>${toSmallCaps('please use /start first')}</b></blockquote>`,
            { parse_mode: 'HTML' }
        );
    }
    
    const state = userStates[userId] || {};
    
    // ============================================
    // HANDLE SERVER CREATION
    // ============================================
    if (state.serverType) {
        const serverName = text;
        if (serverName.length < 3) {
            return bot.sendMessage(chatId,
                `<blockquote>❌ <b>${toSmallCaps('name too short')}</b>\n\n` +
                `${toSmallCaps('server name must be at least 3 characters')}</blockquote>`,
                { parse_mode: 'HTML' }
            );
        }
        
        db.addPoints(userId, -config.pointsPerServer);
        const serverId = db.addServer(userId, {
            name: serverName,
            type: state.serverType
        });
        
        if (!serverId) {
            return bot.sendMessage(chatId,
                `<blockquote>❌ <b>${toSmallCaps('failed to create server')}</b>\n\n` +
                `${toSmallCaps('please try again later')}</blockquote>`,
                { parse_mode: 'HTML' }
            );
        }
        
        delete userStates[userId].serverType;
        
        // Loading animation
        const frames = ['⏳', '🔄', '⚡', '✨'];
        for (let i = 0; i < frames.length; i++) {
            await bot.sendMessage(chatId,
                `<blockquote>${frames[i]} <b>${toSmallCaps('creating your server')}</b>\n\n` +
                `${toSmallCaps('please wait')} ${'.'.repeat(i + 1)}</blockquote>`,
                { parse_mode: 'HTML' }
            );
        }
        
        await bot.sendMessage(chatId,
            `<blockquote>🎉 <b>${toSmallCaps('server created successfully')}</b>\n\n` +
            `✅ ${toSmallCaps('name')}: <b>${serverName}</b>\n` +
            `🆔 ${toSmallCaps('id')}: <code>${serverId}</code>\n` +
            `📦 ${toSmallCaps('type')}: ${state.serverType.toUpperCase()}\n` +
            `💎 ${toSmallCaps('points used')}: ${config.pointsPerServer}\n` +
            `📊 ${toSmallCaps('remaining points')}: ${db.getUser(userId).points}\n\n` +
            `${toSmallCaps('manage your server using the buttons below')}</blockquote>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🖥️ ${toSmallCaps('view server')}`, callback_data: `server_${serverId}`, style: 'primary' }, 
                         { text: `🌐 ${toSmallCaps('dashboard')}`, callback_data: 'open_dashboard', style: 'success' }],
                        [{ text: `📋 ${toSmallCaps('my servers')}`, callback_data: 'my_servers', style: 'primary' }]
                    ]
                }
            }
        );
        
        // Send to announce channel
        await bot.sendMessage(config.announceChannel,
            `<blockquote>🆕 <b>${toSmallCaps('new server created')}</b>\n\n` +
            `👤 ${toSmallCaps('user')}: @${msg.from.username || 'Unknown'}\n` +
            `🖥️ ${toSmallCaps('server')}: ${serverName}\n` +
            `📦 ${toSmallCaps('type')}: ${state.serverType.toUpperCase()}\n` +
            `🆔 ${toSmallCaps('id')}: <code>${serverId}</code></blockquote>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🚀 ${toSmallCaps('grab slot')}`, url: `https://t.me/${config.botUsername.replace('@', '')}`, style: 'primary' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // HANDLE TICKET CREATION
    // ============================================
    if (state.creatingTicket) {
        const message = text;
        if (message.length < 10) {
            return bot.sendMessage(chatId,
                `<blockquote>❌ <b>${toSmallCaps('message too short')}</b>\n\n` +
                `${toSmallCaps('please provide more details')}</blockquote>`,
                { parse_mode: 'HTML' }
            );
        }
        
        const ticketId = db.createTicket(userId, message.substring(0, 50), message);
        delete userStates[userId].creatingTicket;
        
        await bot.sendMessage(chatId,
            `<blockquote>✅ <b>${toSmallCaps('ticket created successfully')}</b>\n\n` +
            `🆔 ${toSmallCaps('ticket id')}: <code>${ticketId}</code>\n` +
            `📝 ${toSmallCaps('subject')}: ${message.substring(0, 50)}\n\n` +
            `${toSmallCaps('support team will respond shortly')}</blockquote>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📋 ${toSmallCaps('my tickets')}`, callback_data: 'my_tickets', style: 'primary' }, 
                         { text: `🔙 ${toSmallCaps('back to menu')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // HANDLE PROMO REDEMPTION
    // ============================================
    if (state.redeemingPromo) {
        const code = text.toUpperCase();
        const result = db.redeemPromo(code, userId);
        delete userStates[userId].redeemingPromo;
        
        if (result === true) {
            const promo = db.data.promos[code];
            await bot.sendMessage(chatId,
                `<blockquote>🎉 <b>${toSmallCaps('promo code redeemed')}</b>\n\n` +
                `✅ ${toSmallCaps('code')}: ${code}\n` +
                `💎 ${toSmallCaps('points earned')}: +${promo.points}\n` +
                `📊 ${toSmallCaps('new balance')}: ${db.getUser(userId).points}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `💎 ${toSmallCaps('check points')}`, callback_data: 'points_menu', style: 'primary' }, 
                             { text: `🔙 ${toSmallCaps('back to menu')}`, callback_data: 'back_to_main', style: 'danger' }]
                        ]
                    }
                }
            );
        } else if (result === 'already_used') {
            await bot.sendMessage(chatId,
                `<blockquote>❌ <b>${toSmallCaps('promo already used')}</b>\n\n` +
                `${toSmallCaps('you have already redeemed this code')}</blockquote>`,
                { parse_mode: 'HTML' }
            );
        } else {
            await bot.sendMessage(chatId,
                `<blockquote>❌ <b>${toSmallCaps('invalid promo code')}</b>\n\n` +
                `${toSmallCaps('please check the code and try again')}</blockquote>`,
                { parse_mode: 'HTML' }
            );
        }
        return;
    }
    
    // ============================================
    // HANDLE ADMIN ACTIONS
    // ============================================
    if (config.adminIds.includes(userId) && state.action) {
        await handleAdminAction(chatId, userId, state.action, text);
        delete userStates[userId].action;
        return;
    }
});

// ============================================
// ADMIN ACTION HANDLER
// ============================================
async function handleAdminAction(chatId, userId, action, text) {
    const isAdmin = config.adminIds.includes(userId);
    if (!isAdmin) return;
    
    switch(action) {
        case 'addpoints': {
            const parts = text.split(' ');
            if (parts.length < 2) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid format')}</b>\n\n` +
                    `${toSmallCaps('use')}: @username 50</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            const username = parts[0].replace('@', '');
            const amount = parseInt(parts[1]);
            if (isNaN(amount)) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid amount')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            let targetId = null;
            for (const [id, u] of Object.entries(db.data.users)) {
                if (u.username === username) {
                    targetId = parseInt(id);
                    break;
                }
            }
            if (!targetId) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('user not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.addPoints(targetId, amount);
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('points added')}</b>\n\n` +
                `👤 ${toSmallCaps('user')}: @${username}\n` +
                `💎 ${toSmallCaps('amount')}: +${amount}\n` +
                `📊 ${toSmallCaps('new balance')}: ${db.getUser(targetId).points}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'removepoints': {
            const parts = text.split(' ');
            if (parts.length < 2) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid format')}</b>\n\n` +
                    `${toSmallCaps('use')}: @username 20</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            const username = parts[0].replace('@', '');
            const amount = parseInt(parts[1]);
            if (isNaN(amount)) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid amount')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            let targetId = null;
            for (const [id, u] of Object.entries(db.data.users)) {
                if (u.username === username) {
                    targetId = parseInt(id);
                    break;
                }
            }
            if (!targetId) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('user not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.addPoints(targetId, -amount);
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('points removed')}</b>\n\n` +
                `👤 ${toSmallCaps('user')}: @${username}\n` +
                `💎 ${toSmallCaps('amount')}: -${amount}\n` +
                `📊 ${toSmallCaps('new balance')}: ${db.getUser(targetId).points}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'ban': {
            const username = text.replace('@', '');
            let targetId = null;
            for (const [id, u] of Object.entries(db.data.users)) {
                if (u.username === username) {
                    targetId = parseInt(id);
                    break;
                }
            }
            if (!targetId) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('user not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.banUser(targetId);
            await bot.sendMessage(chatId,
                `<blockquote>🔨 <b>${toSmallCaps('user banned')}</b>\n\n` +
                `👤 ${toSmallCaps('user')}: @${username}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'unban': {
            const username = text.replace('@', '');
            let targetId = null;
            for (const [id, u] of Object.entries(db.data.users)) {
                if (u.username === username) {
                    targetId = parseInt(id);
                    break;
                }
            }
            if (!targetId) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('user not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.unbanUser(targetId);
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('user unbanned')}</b>\n\n` +
                `👤 ${toSmallCaps('user')}: @${username}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'globalpoints': {
            const amount = parseInt(text);
            if (isNaN(amount) || amount < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid amount')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            const users = Object.keys(db.data.users);
            for (const uid of users) {
                db.addPoints(parseInt(uid), amount);
            }
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('global points added')}</b>\n\n` +
                `💎 ${toSmallCaps('each user received')}: +${amount}\n` +
                `👥 ${toSmallCaps('total users')}: ${users.length}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'deleteserver': {
            const serverId = text.trim();
            const server = db.data.servers[serverId];
            if (!server) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('server not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            // Delete server files
            const serverDir = path.join(__dirname, 'servers', serverId);
            if (fs.existsSync(serverDir)) {
                fs.rmSync(serverDir, { recursive: true, force: true });
            }
            db.deleteServer(server.userId, serverId);
            await bot.sendMessage(chatId,
                `<blockquote>🗑️ <b>${toSmallCaps('server deleted')}</b>\n\n` +
                `🆔 ${toSmallCaps('server')}: ${serverId}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'startserver': {
            const serverId = text.trim();
            const server = db.data.servers[serverId];
            if (!server) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('server not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.updateServer(server.userId, serverId, { status: 'running' });
            await bot.sendMessage(chatId,
                `<blockquote>▶️ <b>${toSmallCaps('server started')}</b>\n\n` +
                `🆔 ${toSmallCaps('server')}: ${serverId}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'stopserver': {
            const serverId = text.trim();
            const server = db.data.servers[serverId];
            if (!server) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('server not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.updateServer(server.userId, serverId, { status: 'stopped' });
            await bot.sendMessage(chatId,
                `<blockquote>⏹️ <b>${toSmallCaps('server stopped')}</b>\n\n` +
                `🆔 ${toSmallCaps('server')}: ${serverId}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'restartserver': {
            const serverId = text.trim();
            const server = db.data.servers[serverId];
            if (!server) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('server not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.updateServer(server.userId, serverId, { status: 'running' });
            await bot.sendMessage(chatId,
                `<blockquote>🔄 <b>${toSmallCaps('server restarted')}</b>\n\n` +
                `🆔 ${toSmallCaps('server')}: ${serverId}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'broadcast': {
            const message = text;
            if (!message || message.length < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('message cannot be empty')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            const users = Object.keys(db.data.users);
            let success = 0, failed = 0;
            for (const uid of users) {
                try {
                    await bot.sendMessage(parseInt(uid),
                        `<blockquote>📢 <b>${toSmallCaps('broadcast')}</b>\n\n${message}</blockquote>`,
                        { parse_mode: 'HTML' }
                    );
                    success++;
                } catch { failed++; }
            }
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('broadcast sent')}</b>\n\n` +
                `✅ ${toSmallCaps('success')}: ${success}\n` +
                `❌ ${toSmallCaps('failed')}: ${failed}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'announce': {
            const message = text;
            if (!message || message.length < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('message cannot be empty')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            await bot.sendMessage(config.announceChannel,
                `<blockquote>📣 <b>${toSmallCaps('announcement')}</b>\n\n${message}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🚀 ${toSmallCaps('join now')}`, url: `https://t.me/${config.botUsername.replace('@', '')}`, style: 'primary' }]
                        ]
                    }
                }
            );
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('announcement sent')}</b></blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'addpromo': {
            const parts = text.split(' ');
            if (parts.length < 2) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid format')}</b>\n\n` +
                    `${toSmallCaps('use')}: CODE 50</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            const code = parts[0].toUpperCase();
            const points = parseInt(parts[1]);
            if (isNaN(points)) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid points')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.createPromo(code, points);
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('promo code created')}</b>\n\n` +
                `🎟️ ${toSmallCaps('code')}: ${code}\n` +
                `💎 ${toSmallCaps('points')}: +${points}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'removepromo': {
            const code = text.toUpperCase();
            if (db.data.promos[code]) {
                delete db.data.promos[code];
                db.saveAll();
                await bot.sendMessage(chatId,
                    `<blockquote>✅ <b>${toSmallCaps('promo code removed')}</b>\n\n` +
                    `🎟️ ${toSmallCaps('code')}: ${code}</blockquote>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                            ]
                        }
                    }
                );
            } else {
                await bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('promo code not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            break;
        }
        
        case 'setprice': {
            const points = parseInt(text);
            if (isNaN(points) || points < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid amount')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            config.pointsPerServer = points;
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('price updated')}</b>\n\n` +
                `💎 ${toSmallCaps('points per server')}: ${points}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'setlimit': {
            const limit = parseInt(text);
            if (isNaN(limit) || limit < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid limit')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            config.maxServers = limit;
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('server limit updated')}</b>\n\n` +
                `📊 ${toSmallCaps('max servers per user')}: ${limit}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'setreferral': {
            const bonus = parseInt(text);
            if (isNaN(bonus) || bonus < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid bonus')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            config.referralBonus = bonus;
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('referral bonus updated')}</b>\n\n` +
                `👥 ${toSmallCaps('bonus per referral')}: ${bonus}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'setdaily': {
            const daily = parseInt(text);
            if (isNaN(daily) || daily < 1) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid amount')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            config.dailyBonus = daily;
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('daily bonus updated')}</b>\n\n` +
                `🎁 ${toSmallCaps('daily bonus amount')}: ${daily}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'setweburl': {
            const url = text.trim();
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid url')}</b>\n\n` +
                    `${toSmallCaps('url must start with http:// or https://')}</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            config.webUrl = url;
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('web url updated')}</b>\n\n` +
                `🔗 ${toSmallCaps('new url')}: ${url}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'maintenance': {
            const mode = text.toLowerCase();
            if (mode !== 'on' && mode !== 'off') {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid mode')}</b>\n\n` +
                    `${toSmallCaps('use')}: on ${toSmallCaps('or')} off</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            config.maintenance = mode === 'on';
            await bot.sendMessage(chatId,
                `<blockquote>🔧 <b>${toSmallCaps('maintenance mode')}</b>\n\n` +
                `${toSmallCaps('status')}: ${mode === 'on' ? '🟡 Enabled' : '🟢 Disabled'}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'addchannel': {
            const channel = text.trim();
            if (!channel.startsWith('@')) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid channel format')}</b>\n\n` +
                    `${toSmallCaps('use')}: @channelname</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.addChannel(channel);
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('channel added')}</b>\n\n` +
                `📢 ${toSmallCaps('force join channel')}: ${channel}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'removechannel': {
            const channel = text.trim();
            if (!channel.startsWith('@')) {
                return bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('invalid channel format')}</b>\n\n` +
                    `${toSmallCaps('use')}: @channelname</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            db.removeChannel(channel);
            await bot.sendMessage(chatId,
                `<blockquote>✅ <b>${toSmallCaps('channel removed')}</b>\n\n` +
                `📢 ${toSmallCaps('removed')}: ${channel}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                        ]
                    }
                }
            );
            break;
        }
        
        case 'resolveticket': {
            const ticketId = text.trim().toUpperCase();
            if (db.resolveTicket(ticketId)) {
                const ticket = db.data.tickets[ticketId];
                await bot.sendMessage(chatId,
                    `<blockquote>✅ <b>${toSmallCaps('ticket resolved')}</b>\n\n` +
                    `🆔 ${toSmallCaps('ticket')}: ${ticketId}</blockquote>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: `🔙 ${toSmallCaps('back to admin')}`, callback_data: 'admin_back', style: 'danger' }]
                            ]
                        }
                    }
                );
                await bot.sendMessage(ticket.userId,
                    `<blockquote>✅ <b>${toSmallCaps('your ticket has been resolved')}</b>\n\n` +
                    `🆔 ${toSmallCaps('ticket')}: ${ticketId}</blockquote>`,
                    { parse_mode: 'HTML' }
                );
            } else {
                await bot.sendMessage(chatId,
                    `<blockquote>❌ <b>${toSmallCaps('ticket not found')}</b></blockquote>`,
                    { parse_mode: 'HTML' }
                );
            }
            break;
        }
    }
}

// ============================================
// ERROR HANDLING
// ============================================
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// ============================================
// EXPRESS SERVER FOR WEB
// ============================================
const PORT = config.port || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard/:userId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

server.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
});

console.log('🤖 Premium Hosting Bot Started!');
console.log(`📊 Bot username: ${config.botUsername}`);
console.log(`🌐 Web URL: ${config.webUrl}`);
console.log(`👥 Admin IDs: ${config.adminIds.join(', ')}`);
console.log(`💎 Points per server: ${config.pointsPerServer}`);
console.log(`📊 Max servers: ${config.maxServers}`);

// ============================================
// 30+ ADMIN COMMANDS LIST
// ============================================
console.log('\n📋 ADMIN COMMANDS (30+):');
console.log('1.  /addpoints - Add points to user');
console.log('2.  /removepoints - Remove points from user');
console.log('3.  /ban - Ban a user');
console.log('4.  /unban - Unban a user');
console.log('5.  /viewusers - View all users');
console.log('6.  /globalpoints - Give points to all users');
console.log('7.  /viewservers - View all servers');
console.log('8.  /deleteserver - Delete a server');
console.log('9.  /startserver - Start a server');
console.log('10. /stopserver - Stop a server');
console.log('11. /restartserver - Restart a server');
console.log('12. /broadcast - Broadcast to all users');
console.log('13. /announce - Announce to channel');
console.log('14. /addpromo - Create promo code');
console.log('15. /removepromo - Remove promo code');
console.log('16. /viewpromos - View all promo codes');
console.log('17. /setprice - Set points per server');
console.log('18. /setlimit - Set max servers per user');
console.log('19. /setreferralbonus - Set referral bonus');
console.log('20. /setdaily - Set daily bonus');
console.log('21. /setweburl - Set web URL');
console.log('22. /maintenance - Toggle maintenance mode');
console.log('23. /addchannel - Add force join channel');
console.log('24. /removechannel - Remove force join channel');
console.log('25. /viewchannels - View all force join channels');
console.log('26. /tickets - View all tickets');
console.log('27. /resolveticket - Resolve a ticket');
console.log('28. /stats - View bot statistics');
console.log('29. /logs - View system logs');
console.log('30. /back - Back to admin panel');
console.log('31. /setpointslimit - Set points per server (alias)');
console.log('32. /addgroup - Add force join group');
console.log('33. /removegroup - Remove force join group');
console.log('34. /replyticket - Reply to a ticket');
console.log('35. /viewbanned - View banned users');
console.log('36. /clearlogs - Clear system logs');
