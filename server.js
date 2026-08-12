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
// BUTTON HELPER WITH STYLES
// ============================================
function btn(text, callback, style = 'primary') {
    return { text, callback_data: callback, style: style };
}

function urlBtn(text, url, style = 'primary') {
    return { text, url, style: style };
}

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
// FORCE JOIN MIDDLEWARE - FIXED
// ============================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Skip for admins
    if (config.adminIds.includes(userId)) return;
    
    // Check if user is banned
    if (db.isBanned(userId)) {
        return bot.sendMessage(chatId, 
            `<blockquote>❌ <b>${toSmallCaps('you are banned from using this bot')}</b></blockquote>`,
            { parse_mode: 'HTML' }
        );
    }
    
    // Check force join channels
    const channels = db.getForceChannels();
    if (channels.length > 0) {
        let needToJoin = false;
        let channelToJoin = '';
        
        for (const channel of channels) {
            try {
                const member = await bot.getChatMember(channel, userId);
                if (member.status === 'left' || member.status === 'kicked') {
                    needToJoin = true;
                    channelToJoin = channel;
                    break;
                }
            } catch (error) {
                // If can't get member, assume they need to join
                needToJoin = true;
                channelToJoin = channel;
                break;
            }
        }
        
        if (needToJoin) {
            return bot.sendMessage(chatId,
                `<blockquote>⚠️ <b>${toSmallCaps('please join our channel first')}</b>\n\n` +
                `${toSmallCaps('you must join')} <b>${channelToJoin}</b> ${toSmallCaps('to use this bot')}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📢 ${toSmallCaps('join channel')}`, url: `https://t.me/${channelToJoin.replace('@', '')}`, style: 'primary' }],
                            [{ text: `✅ ${toSmallCaps('check again')}`, callback_data: 'check_join', style: 'success' }]
                        ]
                    }
                }
            );
        }
    }
});

// ============================================
// START COMMAND
// ============================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    
    // Check force join first
    const channels = db.getForceChannels();
    if (channels.length > 0 && !config.adminIds.includes(userId)) {
        let needToJoin = false;
        let channelToJoin = '';
        for (const channel of channels) {
            try {
                const member = await bot.getChatMember(channel, userId);
                if (member.status === 'left' || member.status === 'kicked') {
                    needToJoin = true;
                    channelToJoin = channel;
                    break;
                }
            } catch { needToJoin = true; channelToJoin = channel; break; }
        }
        if (needToJoin) {
            return bot.sendMessage(chatId,
                `<blockquote>⚠️ <b>${toSmallCaps('please join our channel first')}</b>\n\n` +
                `${toSmallCaps('you must join')} <b>${channelToJoin}</b> ${toSmallCaps('to use this bot')}</blockquote>`,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📢 ${toSmallCaps('join channel')}`, url: `https://t.me/${channelToJoin.replace('@', '')}`, style: 'primary' }],
                            [{ text: `✅ ${toSmallCaps('check again')}`, callback_data: 'check_join', style: 'success' }]
                        ]
                    }
                }
            );
        }
    }
    
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
    
    // Show admin panel if admin
    if (config.adminIds.includes(userId)) {
        return showAdminPanel(chatId);
    }
    
    // USER MENU - All buttons with proper styles
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
                     { text: `🔙 ${toSmallCaps('back to user menu')}`, callback_data: 'back_to_main', style: 'danger' }]
                ]
            }
        }
    );
}

// ============================================
// ADMIN SUB-MENUS
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

async function showAdminStats(chatId, messageId) {
    const totalUsers = db.getTotalUsers();
    const totalServers = db.getTotalServers();
    const totalTickets = Object.keys(db.data.tickets).length;
    const totalPromos = Object.keys(db.data.promos).length;
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    await bot.editMessageText(
        `<blockquote>📊 <b>${toSmallCaps('bot statistics')}</b>\n\n` +
        `🟢 ${toSmallCaps('status')}: Online\n` +
        `👥 ${toSmallCaps('users')}: ${totalUsers}\n` +
        `🖥️ ${toSmallCaps('servers')}: ${totalServers}\n` +
        `🎫 ${toSmallCaps('tickets')}: ${totalTickets}\n` +
        `🎟️ ${toSmallCaps('promo codes')}: ${totalPromos}\n` +
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
// CALLBACK QUERY HANDLER - ALL BUTTONS WORKING
// ============================================
bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const userId = callbackQuery.from.id;
    const isAdmin = config.adminIds.includes(userId);
    const username = callbackQuery.from.username;
    
    await bot.answerCallbackQuery(callbackQuery.id);
    
    console.log(`📌 Action: ${action} | User: ${userId}`);
    
    const user = db.getUser(userId);
    if (!user && action !== 'check_join' && action !== 'back_to_main') {
        return bot.editMessageText(
            `<blockquote>❌ <b>${toSmallCaps('please use /start first')}</b></blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('start bot')}`, url: `https://t.me/${config.botUsername.replace('@', '')}`, style: 'primary' }]
                    ]
                }
            }
        );
    }
    
    // ============================================
    // CHECK JOIN ACTION
    // ============================================
    if (action === 'check_join') {
        const channels = db.getForceChannels();
        let allJoined = true;
        let channelToJoin = '';
        
        for (const channel of channels) {
            try {
                const member = await bot.getChatMember(channel, userId);
                if (member.status === 'left' || member.status === 'kicked') {
                    allJoined = false;
                    channelToJoin = channel;
                    break;
                }
            } catch { allJoined = false; channelToJoin = channel; break; }
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
                `${toSmallCaps('please join')} ${channelToJoin} ${toSmallCaps('first')}`, true);
        }
        return;
    }
    
    // ============================================
    // BACK TO MAIN
    // ============================================
    if (action === 'back_to_main') {
        const userData = db.getUser(userId);
        const canClaimDaily = (Date.now() - (userData?.lastDaily || 0)) > 86400000;
        
        if (isAdmin) {
            await showAdminPanel(chatId);
            return;
        }
        
        await bot.editMessageText(
            `<blockquote>🌹 <b>${toSmallCaps('premium hosting bot')}</b>\n\n` +
            `👤 <b>${toSmallCaps('user')}:</b> ${username || 'Unknown'}\n` +
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
        return;
    }
    
    // ============================================
    // CREATE SERVER
    // ============================================
    if (action === 'create_server') {
        if (!user) return;
        
        if (user.servers.length >= config.maxServers) {
            return bot.editMessageText(
                `<blockquote>❌ <b>${toSmallCaps('server limit reached')}</b>\n\n` +
                `${toSmallCaps('you can only create up to')} <b>${config.maxServers}</b> ${toSmallCaps('servers')}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📋 ${toSmallCaps('my servers')}`, callback_data: 'my_servers', style: 'primary' }],
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                        ]
                    }
                }
            );
        }
        
        if (user.points < config.pointsPerServer) {
            return bot.editMessageText(
                `<blockquote>❌ <b>${toSmallCaps('insufficient points')}</b>\n\n` +
                `${toSmallCaps('you need')} <b>${config.pointsPerServer}</b> ${toSmallCaps('points to create a server')}\n` +
                `${toSmallCaps('you have')} <b>${user.points}</b> ${toSmallCaps('points')}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `💎 ${toSmallCaps('get points')}`, callback_data: 'points_menu', style: 'primary' }],
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                        ]
                    }
                }
            );
        }
        
        userStates[userId] = { ...userStates[userId], serverType: null };
        
        await bot.editMessageText(
            `<blockquote>🖥️ <b>${toSmallCaps('create new server')}</b>\n\n` +
            `${toSmallCaps('cost')}: <b>${config.pointsPerServer}</b> ${toSmallCaps('points')}\n` +
            `${toSmallCaps('your balance')}: <b>${user.points}</b> ${toSmallCaps('points')}\n\n` +
            `${toSmallCaps('select server type')}:</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🐍 ${toSmallCaps('python')}`, callback_data: 'create_python', style: 'primary' }, 
                         { text: `🟢 ${toSmallCaps('node.js')}`, callback_data: 'create_node', style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('cancel')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // CREATE PYTHON
    // ============================================
    if (action === 'create_python') {
        userStates[userId] = { ...userStates[userId], serverType: 'python' };
        await bot.editMessageText(
            `<blockquote>🐍 <b>${toSmallCaps('python server setup')}</b>\n\n` +
            `${toSmallCaps('please enter a name for your server')}\n` +
            `${toSmallCaps('example')}: "MyBot" ${toSmallCaps('or')} "API-Server"\n\n` +
            `${toSmallCaps('type the name in the chat')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('cancel')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // CREATE NODE
    // ============================================
    if (action === 'create_node') {
        userStates[userId] = { ...userStates[userId], serverType: 'nodejs' };
        await bot.editMessageText(
            `<blockquote>🟢 <b>${toSmallCaps('node.js server setup')}</b>\n\n` +
            `${toSmallCaps('please enter a name for your server')}\n` +
            `${toSmallCaps('example')}: "MyAPI" ${toSmallCaps('or')} "WebApp"\n\n` +
            `${toSmallCaps('type the name in the chat')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('cancel')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // MY SERVERS
    // ============================================
    if (action === 'my_servers') {
        if (!user) return;
        
        if (user.servers.length === 0) {
            return bot.editMessageText(
                `<blockquote>📭 <b>${toSmallCaps('no servers found')}</b>\n\n` +
                `${toSmallCaps('you havent created any servers yet')}</blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🖥️ ${toSmallCaps('create server')}`, callback_data: 'create_server', style: 'primary' }],
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                        ]
                    }
                }
            );
        }
        
        let message = `<blockquote>📋 <b>${toSmallCaps('your servers')}</b> (${user.servers.length}/${config.maxServers})\n\n`;
        for (const server of user.servers) {
            const status = server.status === 'running' ? '🟢 Running' : '🔴 Stopped';
            message += `┌ <b>${server.name}</b>\n`;
            message += `├ 🆔 <code>${server.id}</code>\n`;
            message += `├ ${status}\n`;
            message += `├ 📦 ${server.type.toUpperCase()}\n`;
            message += `├ 📅 ${new Date(server.created).toLocaleDateString()}\n`;
            message += `└──────────────────\n\n`;
        }
        message += `</blockquote>`;
        
        const serverButtons = user.servers.map(server => [
            { text: `🖥️ ${server.name}`, callback_data: `server_${server.id}`, style: 'primary' }
        ]);
        
        const keyboard = [
            ...serverButtons,
            [{ text: `🔄 ${toSmallCaps('refresh')}`, callback_data: 'my_servers', style: 'primary' }],
            [{ text: `🌐 ${toSmallCaps('dashboard')}`, callback_data: 'open_dashboard', style: 'success' }, 
             { text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
        ];
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        });
        return;
    }
    
    // ============================================
    // POINTS MENU
    // ============================================
    if (action === 'points_menu') {
        if (!user) return;
        const canClaimDaily = (Date.now() - (user.lastDaily || 0)) > 86400000;
        
        await bot.editMessageText(
            `<blockquote>💎 <b>${toSmallCaps('points & rewards')}</b>\n\n` +
            `${toSmallCaps('balance')}: <b>${user.points}</b> ${toSmallCaps('points')}\n` +
            `${toSmallCaps('servers')}: ${user.servers.length}/${config.maxServers}\n\n` +
            `📌 <b>${toSmallCaps('earn points')}</b>\n` +
            `• ${toSmallCaps('daily bonus')}: +${config.dailyBonus} ${toSmallCaps('points')}\n` +
            `• ${toSmallCaps('referral')}: +${config.referralBonus} ${toSmallCaps('points')}\n` +
            `• ${toSmallCaps('promo codes')}: ${toSmallCaps('various rewards')}\n\n` +
            `📌 <b>${toSmallCaps('spend points')}</b>\n` +
            `• ${toSmallCaps('create server')}: -${config.pointsPerServer} ${toSmallCaps('points')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🎁 ${toSmallCaps('claim daily')} ${canClaimDaily ? '✅' : '⏳'}`, callback_data: 'claim_daily', style: canClaimDaily ? 'success' : 'primary' }, 
                         { text: `🎟️ ${toSmallCaps('redeem promo')}`, callback_data: 'redeem_promo', style: 'primary' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // CLAIM DAILY
    // ============================================
    if (action === 'claim_daily') {
        if (!user) return;
        const lastDaily = user.lastDaily || 0;
        const now = Date.now();
        
        if ((now - lastDaily) < 86400000) {
            const remaining = 86400000 - (now - lastDaily);
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            await bot.answerCallbackQuery(callbackQuery.id, 
                `${toSmallCaps('wait')} ${hours}h ${minutes}m ${toSmallCaps('for next daily bonus')}`, true);
            return;
        }
        
        db.addPoints(userId, config.dailyBonus);
        db.updateUser(userId, { lastDaily: now });
        
        await bot.editMessageText(
            `<blockquote>🎉 <b>${toSmallCaps('daily bonus claimed')}</b>\n\n` +
            `${toSmallCaps('you received')} <b>+${config.dailyBonus}</b> ${toSmallCaps('points')} 💎\n` +
            `${toSmallCaps('new balance')}: <b>${db.getUser(userId).points}</b> ${toSmallCaps('points')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `💎 ${toSmallCaps('check points')}`, callback_data: 'points_menu', style: 'primary' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // REFERRAL MENU
    // ============================================
    if (action === 'referral_menu') {
        if (!user) return;
        const referralLink = `https://t.me/${config.botUsername.replace('@', '')}?start=${userId}`;
        
        await bot.editMessageText(
            `<blockquote>👥 <b>${toSmallCaps('referral system')}</b>\n\n` +
            `${toSmallCaps('your referral link')}:\n` +
            `<code>${referralLink}</code>\n\n` +
            `📊 <b>${toSmallCaps('your stats')}</b>\n` +
            `• ${toSmallCaps('total referrals')}: ${user.referrals?.length || 0}\n` +
            `• ${toSmallCaps('points earned')}: ${(user.referrals?.length || 0) * config.referralBonus}\n\n` +
            `🎁 <b>${toSmallCaps('rewards')}</b>\n` +
            `• ${toSmallCaps('each referral')}: +${config.referralBonus} ${toSmallCaps('points')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📤 ${toSmallCaps('share link')}`, url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Premium Hosting Bot and get free hosting!')}`, style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // TICKET MENU
    // ============================================
    if (action === 'ticket_menu') {
        await bot.editMessageText(
            `<blockquote>🎫 <b>${toSmallCaps('support ticket system')}</b>\n\n` +
            `${toSmallCaps('please describe your issue below')}\n\n` +
            `📝 <b>${toSmallCaps('examples')}</b>\n` +
            `• ${toSmallCaps('server not working')}\n` +
            `• ${toSmallCaps('billing issues')}\n` +
            `• ${toSmallCaps('technical support')}\n` +
            `• ${toSmallCaps('feature requests')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📝 ${toSmallCaps('create ticket')}`, callback_data: 'create_ticket', style: 'primary' }, 
                         { text: `📋 ${toSmallCaps('my tickets')}`, callback_data: 'my_tickets', style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // CREATE TICKET
    // ============================================
    if (action === 'create_ticket') {
        userStates[userId] = { ...userStates[userId], creatingTicket: true };
        await bot.editMessageText(
            `<blockquote>📝 <b>${toSmallCaps('create support ticket')}</b>\n\n` +
            `${toSmallCaps('please type your message in the chat')}\n\n` +
            `${toSmallCaps('include as much detail as possible')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('cancel')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // MY TICKETS
    // ============================================
    if (action === 'my_tickets') {
        if (!user) return;
        const tickets = db.getTickets(userId);
        
        if (tickets.length === 0) {
            return bot.editMessageText(
                `<blockquote>📭 <b>${toSmallCaps('no tickets found')}</b></blockquote>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `📝 ${toSmallCaps('create ticket')}`, callback_data: 'create_ticket', style: 'primary' }],
                            [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                        ]
                    }
                }
            );
        }
        
        let message = `<blockquote>📋 <b>${toSmallCaps('your tickets')}</b>\n\n`;
        for (const ticket of tickets) {
            const status = ticket.status === 'open' ? '🟡 Open' : '✅ Resolved';
            message += `┌ ${ticket.subject}\n`;
            message += `├ 🆔 ${ticket.id}\n`;
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
                    [{ text: `📝 ${toSmallCaps('create ticket')}`, callback_data: 'create_ticket', style: 'primary' }],
                    [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                ]
            }
        });
        return;
    }
    
    // ============================================
    // HELP MENU
    // ============================================
    if (action === 'help_menu') {
        await bot.editMessageText(
            `<blockquote>📚 <b>${toSmallCaps('help center')}</b>\n\n` +
            `🤖 <b>${toSmallCaps('available commands')}</b>\n` +
            `• /start - ${toSmallCaps('start the bot')}\n` +
            `• ${toSmallCaps('create server via buttons')}\n` +
            `• ${toSmallCaps('manage servers via buttons')}\n` +
            `• ${toSmallCaps('check points via buttons')}\n` +
            `• ${toSmallCaps('referral system via buttons')}\n` +
            `• ${toSmallCaps('support tickets via buttons')}\n\n` +
            `💰 <b>${toSmallCaps('how to earn points')}</b>\n` +
            `• ${toSmallCaps('daily bonus')}: +${config.dailyBonus} ${toSmallCaps('points')}\n` +
            `• ${toSmallCaps('referrals')}: +${config.referralBonus} ${toSmallCaps('points')}\n` +
            `• ${toSmallCaps('promo codes')}: ${toSmallCaps('various rewards')}\n` +
            `• ${toSmallCaps('server creation')}: -${config.pointsPerServer} ${toSmallCaps('points')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌐 ${toSmallCaps('dashboard')}`, callback_data: 'open_dashboard', style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // OPEN DASHBOARD
    // ============================================
    if (action === 'open_dashboard') {
        await bot.editMessageText(
            `<blockquote>🌐 <b>${toSmallCaps('web dashboard')}</b>\n\n` +
            `${toSmallCaps('access your hosting dashboard through the web interface')}\n\n` +
            `🔗 <b>${toSmallCaps('your dashboard')}</b>\n` +
            `<code>${config.webUrl}/dashboard/${userId}</code></blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌐 ${toSmallCaps('open dashboard')}`, url: `${config.webUrl}/dashboard/${userId}`, style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // REDEEM PROMO
    // ============================================
    if (action === 'redeem_promo') {
        userStates[userId] = { ...userStates[userId], redeemingPromo: true };
        await bot.editMessageText(
            `<blockquote>🎟️ <b>${toSmallCaps('redeem promo code')}</b>\n\n` +
            `${toSmallCaps('please enter your promo code in the chat')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('cancel')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // SERVER ACTIONS (server_*, start_*, stop_*, etc)
    // ============================================
    if (action.startsWith('server_')) {
        const serverId = action.replace('server_', '');
        const server = user?.servers.find(s => s.id === serverId);
        if (!server) {
            await bot.answerCallbackQuery(callbackQuery.id, `${toSmallCaps('server not found')}`, true);
            return;
        }
        
        const status = server.status === 'running' ? '🟢 Running' : '🔴 Stopped';
        await bot.editMessageText(
            `<blockquote>🖥️ <b>${server.name}</b>\n\n` +
            `🆔 <code>${server.id}</code>\n` +
            `📦 ${server.type.toUpperCase()}\n` +
            `📅 ${new Date(server.created).toLocaleString()}\n` +
            `📊 ${toSmallCaps('status')}: ${status}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `▶️ ${toSmallCaps('start')}`, callback_data: `start_${serverId}`, style: 'success' }, 
                         { text: `⏹️ ${toSmallCaps('stop')}`, callback_data: `stop_${serverId}`, style: 'danger' }],
                        [{ text: `🔄 ${toSmallCaps('restart')}`, callback_data: `restart_${serverId}`, style: 'primary' }, 
                         { text: `📄 ${toSmallCaps('console')}`, callback_data: `console_${serverId}`, style: 'primary' }],
                        [{ text: `📁 ${toSmallCaps('files')}`, callback_data: `files_${serverId}`, style: 'primary' }, 
                         { text: `🗑️ ${toSmallCaps('delete')}`, callback_data: `delete_${serverId}`, style: 'danger' }],
                        [{ text: `🔙 ${toSmallCaps('back')}`, callback_data: 'my_servers', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('start_')) {
        const serverId = action.replace('start_', '');
        const server = user?.servers.find(s => s.id === serverId);
        if (!server) return;
        
        await bot.answerCallbackQuery(callbackQuery.id, `🔄 ${toSmallCaps('starting server')}...`);
        db.updateServer(userId, serverId, { status: 'running' });
        await bot.editMessageText(
            `<blockquote>✅ <b>${toSmallCaps('server started successfully')}</b>\n\n` +
            `${toSmallCaps('your server is now running')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('back to server')}`, callback_data: `server_${serverId}`, style: 'primary' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('stop_')) {
        const serverId = action.replace('stop_', '');
        const server = user?.servers.find(s => s.id === serverId);
        if (!server) return;
        
        await bot.answerCallbackQuery(callbackQuery.id, `⏹️ ${toSmallCaps('stopping server')}...`);
        db.updateServer(userId, serverId, { status: 'stopped' });
        await bot.editMessageText(
            `<blockquote>⏹️ <b>${toSmallCaps('server stopped successfully')}</b>\n\n` +
            `${toSmallCaps('your server has been stopped')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('back to server')}`, callback_data: `server_${serverId}`, style: 'primary' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('restart_')) {
        const serverId = action.replace('restart_', '');
        const server = user?.servers.find(s => s.id === serverId);
        if (!server) return;
        
        await bot.answerCallbackQuery(callbackQuery.id, `🔄 ${toSmallCaps('restarting server')}...`);
        db.updateServer(userId, serverId, { status: 'running' });
        await bot.editMessageText(
            `<blockquote>🔄 <b>${toSmallCaps('server restarted successfully')}</b></blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🔙 ${toSmallCaps('back to server')}`, callback_data: `server_${serverId}`, style: 'primary' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('delete_')) {
        const serverId = action.replace('delete_', '');
        await bot.editMessageText(
            `<blockquote>⚠️ <b>${toSmallCaps('delete server')}</b>\n\n` +
            `${toSmallCaps('are you sure you want to delete this server')}?\n` +
            `${toSmallCaps('this action cannot be undone')}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `✅ ${toSmallCaps('yes, delete')}`, callback_data: `confirm_delete_${serverId}`, style: 'danger' }, 
                         { text: `❌ ${toSmallCaps('cancel')}`, callback_data: `server_${serverId}`, style: 'primary' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('confirm_delete_')) {
        const serverId = action.replace('confirm_delete_', '');
        db.deleteServer(userId, serverId);
        await bot.answerCallbackQuery(callbackQuery.id, `✅ ${toSmallCaps('server deleted')}`);
        await bot.editMessageText(
            `<blockquote>🗑️ <b>${toSmallCaps('server deleted successfully')}</b></blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📋 ${toSmallCaps('my servers')}`, callback_data: 'my_servers', style: 'primary' }, 
                         { text: `🔙 ${toSmallCaps('back to menu')}`, callback_data: 'back_to_main', style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('console_')) {
        const serverId = action.replace('console_', '');
        await bot.editMessageText(
            `<blockquote>📄 <b>${toSmallCaps('console output')}</b>\n\n` +
            `${toSmallCaps('view real console logs in the web dashboard')}\n\n` +
            `🌐 ${config.webUrl}/dashboard/${userId}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌐 ${toSmallCaps('open dashboard')}`, url: `${config.webUrl}/dashboard/${userId}`, style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('back to server')}`, callback_data: `server_${serverId}`, style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    if (action.startsWith('files_')) {
        const serverId = action.replace('files_', '');
        await bot.editMessageText(
            `<blockquote>📁 <b>${toSmallCaps('file manager')}</b>\n\n` +
            `${toSmallCaps('upload and manage files via web dashboard')}\n\n` +
            `🌐 ${config.webUrl}/dashboard/${userId}</blockquote>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌐 ${toSmallCaps('open dashboard')}`, url: `${config.webUrl}/dashboard/${userId}`, style: 'success' }],
                        [{ text: `🔙 ${toSmallCaps('back to server')}`, callback_data: `server_${serverId}`, style: 'danger' }]
                    ]
                }
            }
        );
        return;
    }
    
    // ============================================
    // ADMIN ACTIONS
    // ============================================
    if (action === 'admin_users') {
        if (!isAdmin) return;
        await showAdminUsers(chatId, messageId);
        return;
    }
    
    if (action === 'admin_servers') {
        if (!isAdmin) return;
        await showAdminServers(chatId, messageId);
        return;
    }
    
    if (action === 'admin_broadcast') {
        if (!isAdmin) return;
        await showAdminBroadcast(chatId, messageId);
        return;
    }
    
    if (action === 'admin_promos') {
        if (!isAdmin) return;
        await showAdminPromos(chatId, messageId);
        return;
    }
    
    if (action === 'admin_settings') {
        if (!isAdmin) return;
        await showAdminSettings(chatId, messageId);
        return;
    }
    
    if (action === 'admin_tickets') {
        if (!isAdmin) return;
        await showAdminTickets(chatId, messageId);
        return;
    }
    
    if (action === 'admin_stats') {
        if (!isAdmin) return;
        await showAdminStats(chatId, messageId);
        return;
    }
    
    if (action === 'admin_channels') {
        if (!isAdmin) return;
        await showAdminChannels(chatId, messageId);
        return;
    }
    
    if (action === 'admin_back') {
        if (!isAdmin) return;
        await showAdminPanel(chatId);
        return;
    }
    
    // ============================================
    // ADMIN USER MANAGEMENT ACTIONS
    // ============================================
    if (action === 'admin_addpoints') {
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
        return;
    }
    
    if (action === 'admin_removepoints') {
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
        return;
    }
    
    if (action === 'admin_ban') {
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
        return;
    }
    
    if (action === 'admin_unban') {
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
        return;
    }
    
    if (action === 'admin_viewusers') {
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
        return;
    }
    
    if (action === 'admin_globalpoints') {
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
        return;
    }
    
    // ============================================
    // ADMIN SERVER MANAGEMENT ACTIONS
    // ============================================
    if (action === 'admin_viewservers') {
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
        return;
    }
    
    if (action === 'admin_deleteserver') {
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
        return;
    }
    
    if (action === 'admin_startserver') {
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
        return;
    }
    
    if (action === 'admin_stopserver') {
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
        return;
    }
    
    if (action === 'admin_restartserver') {
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
        return;
    }
    
    // ============================================
    // ADMIN BROADCAST ACTIONS
    // ============================================
    if (action === 'admin_broadcast_all') {
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
        return;
    }
    
    if (action === 'admin_announce') {
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
        return;
    }
    
    // ============================================
    // ADMIN PROMO ACTIONS
    // ============================================
    if (action === 'admin_addpromo') {
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
        return;
    }
    
    if (action === 'admin_removepromo') {
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
        return;
    }
    
    if (action === 'admin_viewpromos') {
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
        return;
    }
    
    // ============================================
    // ADMIN SETTINGS ACTIONS
    // ============================================
    if (action === 'admin_setprice') {
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
        return;
    }
    
    if (action === 'admin_setlimit') {
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
        return;
    }
    
    if (action === 'admin_setreferral') {
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
        return;
    }
    
    if (action === 'admin_setdaily') {
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
        return;
    }
    
    if (action === 'admin_setweburl') {
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
        return;
    }
    
    if (action === 'admin_maintenance') {
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
        return;
    }
    
    // ============================================
    // ADMIN CHANNEL ACTIONS
    // ============================================
    if (action === 'admin_addchannel') {
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
        return;
    }
    
    if (action === 'admin_removechannel') {
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
        return;
    }
    
    if (action === 'admin_resolveticket') {
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
        return;
    }
});

// ============================================
// TEXT MESSAGE HANDLER
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
// EXPRESS SERVER
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
console.log('1.  Add Points');
console.log('2.  Remove Points');
console.log('3.  Ban User');
console.log('4.  Unban User');
console.log('5.  View Users');
console.log('6.  Global Points');
console.log('7.  View Servers');
console.log('8.  Delete Server');
console.log('9.  Start Server');
console.log('10. Stop Server');
console.log('11. Restart Server');
console.log('12. Broadcast');
console.log('13. Announce');
console.log('14. Create Promo');
console.log('15. Remove Promo');
console.log('16. View Promos');
console.log('17. Set Points Per Server');
console.log('18. Set Max Servers');
console.log('19. Set Referral Bonus');
console.log('20. Set Daily Bonus');
console.log('21. Set Web URL');
console.log('22. Maintenance Mode');
console.log('23. Add Channel');
console.log('24. Remove Channel');
console.log('25. View Channels');
console.log('26. View Tickets');
console.log('27. Resolve Ticket');
console.log('28. View Statistics');
console.log('29. Back to Admin');
console.log('30. Reply Ticket');
console.log('31. View Banned Users');
console.log('32. Clear Logs');
console.log('33. Set Points Limit');
console.log('34. Add Group');
console.log('35. Remove Group');
console.log('36. View Groups');
