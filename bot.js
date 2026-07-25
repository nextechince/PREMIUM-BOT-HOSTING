#!/usr/bin/env node

/**
 * PREMIUM VPS HOSTING ROBOT v2.1
 * Complete Telegram Bot - JSON Database
 */

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { exec, spawn } = require('child_process');
const crypto = require('crypto');
require('dotenv').config();

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  token: process.env.BOT_TOKEN || '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4',
  ownerId: parseInt(process.env.OWNER_ID || '7158115683'),
  announceChannel: process.env.ANNOUNCE_CHANNEL || '@PREMIUM_BOT_UPDATES',
  port: parseInt(process.env.PORT || '10460'),
  brand: 'Pʀᴇᴍɪᴜᴍ Vᴘs Hᴏsᴛɪɴɢ Rᴏʙᴏᴛ',
  version: 'v2.1',
  supportUser: '@NEX_CONTACT_AGENT_BOT',
  updateChannel: 'https://t.me/PREMIUM_BOT_UPDATES',
  maxUploadSize: 75 * 1024 * 1024,
};

// ============================================================
// FORCE JOIN - REQUIRED GROUPS
// ============================================================

const REQUIRED_GROUPS = [
  {
    id: -1003947109538,
    link: 'https://t.me/PREMIUM_BOT_HOSTING_UPDATE',
    name: 'Pʀᴇᴍɪᴜᴍ Bᴏᴛs Uᴘᴅᴀᴛᴇ'
  },
  {
    id: -1004340815768,
    link: 'https://t.me/Premium_Bot_Otp',
    name: 'Pʀᴇᴍɪᴜᴍ Bᴏᴛ Oᴛᴘ'
  }
];

// ============================================================
// PLANS
// ============================================================

const PLANS = {
  free: { name: 'Free', maxBots: 2, ram: 128, price: 0, days: 0, autoRestart: false },
  starter: { name: 'Starter', maxBots: 4, ram: 256, price: 1000, days: 30, autoRestart: true },
  basic: { name: 'Basic', maxBots: 6, ram: 512, price: 1500, days: 30, autoRestart: true },
  pro: { name: 'Pro', maxBots: 8, ram: 2048, price: 2000, days: 30, autoRestart: true },
  enterprise: { name: 'Enterprise', maxBots: 10, ram: 4096, price: 999, days: 30, autoRestart: true },
  lifetime: { name: 'Lifetime', maxBots: 15, ram: 8192, price: 4000, days: 36500, autoRestart: true }
};

// ============================================================
// JSON DATABASE
// ============================================================

const DB_FILE = path.join(__dirname, 'storage', 'data', 'db.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    users: {},
    bots: {},
    payments: [],
    tickets: {},
    coupons: {},
    settings: {
      maintenance: false,
      owner_id: CONFIG.ownerId
    },
    admins: {},
    audit: []
  };
}

function saveDB(db) {
  fs.ensureDirSync(path.dirname(DB_FILE));
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function now() {
  return new Date().toISOString();
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return bytes.toFixed(1) + ' ' + units[i];
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

function generateId(length = 8) {
  return crypto.randomBytes(length).toString('hex');
}

function userPlan(user) {
  return PLANS[user?.plan || 'free'] || PLANS.free;
}

function userMaxBots(user) {
  const plan = userPlan(user);
  return plan.maxBots + (user?.bonus_slots || 0);
}

function isAdmin(uid) {
  return parseInt(uid) === CONFIG.ownerId;
}

function isOwner(uid) {
  return parseInt(uid) === CONFIG.ownerId;
}

function auditLog(userId, action, detail = '') {
  const db = loadDB();
  db.audit.push({ userId, action, detail, timestamp: now() });
  if (db.audit.length > 500) db.audit.shift();
  saveDB(db);
}

function notifyOwner(message) {
  try {
    bot.sendMessage(CONFIG.ownerId, message, { parse_mode: 'HTML' });
  } catch (e) {}
}

// ============================================================
// FORCE JOIN FUNCTIONS
// ============================================================

function checkGroupMembership(uid) {
  return new Promise((resolve) => {
    const notJoined = [];
    let checked = 0;
    
    REQUIRED_GROUPS.forEach(group => {
      bot.getChatMember(group.id, uid)
        .then(member => {
          if (['left', 'kicked', 'banned'].includes(member.status)) {
            notJoined.push(group);
          }
          checked++;
          if (checked === REQUIRED_GROUPS.length) {
            resolve(notJoined);
          }
        })
        .catch(() => {
          notJoined.push(group);
          checked++;
          if (checked === REQUIRED_GROUPS.length) {
            resolve(notJoined);
          }
        });
    });
  });
}

function requireGroupMembership(chatId, uid) {
  return new Promise((resolve) => {
    if (isOwner(uid) || isAdmin(uid)) {
      return resolve(true);
    }

    checkGroupMembership(uid).then(notJoined => {
      if (notJoined.length === 0) {
        resolve(true);
      } else {
        const kb = {
          inline_keyboard: []
        };
        notJoined.forEach(g => {
          kb.inline_keyboard.push([{ text: `📢 Join ${g.name}`, url: g.link }]);
        });
        kb.inline_keyboard.push([{ text: '✅ Verified', callback_data: 'group_verify_check' }]);

        bot.sendMessage(chatId, `
🛡️ <b>Group Join Required</b>

You must join the following groups to use this bot:

${notJoined.map(g => `• <a href="${g.link}">${g.name}</a>`).join('\n')}

After joining, tap <b>Verified</b> below.
        `, {
          parse_mode: 'HTML',
          reply_markup: kb,
          disable_web_page_preview: true
        });
        resolve(false);
      }
    });
  });
}

// ============================================================
// BOT INSTANCE
// ============================================================

const bot = new TelegramBot(CONFIG.token, { 
  polling: true,
  onlyFirstMatch: true
});

const runningBots = {};

// ============================================================
// KEYBOARDS - WITH YOUR CUSTOM STYLES
// ============================================================

function mainMenu(admin = false) {
  const kb = {
    inline_keyboard: [
      [{ text: '🤖 Mʏ Bᴏᴛꜱ', callback_data: 'menu_bots', style: 'primary' }, { text: '📤 Uᴘʟᴏᴀᴅ Bᴏᴛ', callback_data: 'menu_upload', style: 'danger' }],
      [{ text: '⭐ Pʟᴀɴꜱ', callback_data: 'menu_plans', style: 'primary' }, { text: '💰 Bᴜʏ Pʟᴀɴ', callback_data: 'menu_buy', style: 'danger' }],
      [{ text: '🔗 Rᴇꜰᴇʀʀᴀʟ', callback_data: 'menu_referral', style: 'primary' }, { text: '👤 Pʀᴏꜰɪʟᴇ', callback_data: 'menu_profile', style: 'danger' }],
      [{ text: '💳 Wᴀʟʟᴇᴛ', callback_data: 'menu_wallet', style: 'primary' }, { text: '🎫 Tɪᴄᴋᴇᴛꜱ', callback_data: 'menu_tickets', style: 'danger' }],
      [{ text: '🎁 Fʀᴇᴇ Tʀɪᴀʟ', callback_data: 'menu_trial', style: 'primary' }, { text: '🏷️ Cᴏᴜᴘᴏɴ', callback_data: 'menu_coupon', style: 'danger' }],
      [{ text: '❓ Hᴇʟᴘ', callback_data: 'menu_help', style: 'success' }, { text: '📞 Sᴜᴘᴘᴏʀᴛ', callback_data: 'menu_support', style: 'success' }],
      [{ text: '📊 Mʏ Sᴛᴀᴛꜱ', callback_data: 'menu_stats', style: 'danger' }]
    ]
  };
  if (admin) {
    kb.inline_keyboard.push([{ text: '🛡️ Aᴅᴍɪɴ Pᴀɴᴇʟ', callback_data: 'menu_admin', style: 'primary' }]);
  }
  return kb;
}

function backMain() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'success' }]
    ]
  };
}

function backAdmin() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Aᴅᴍɪɴ', callback_data: 'menu_admin', style: 'primary' }]
    ]
  };
}

function plansKb() {
  const kb = { inline_keyboard: [] };
  for (const [key, plan] of Object.entries(PLANS)) {
    const price = plan.price === 0 ? 'FREE' : `$${plan.price}`;
    kb.inline_keyboard.push([
      { text: `⭐ ${plan.name} — ${price}`, callback_data: `plan_view_${key}`, style: 'primary' }
    ]);
  }
  kb.inline_keyboard.push([{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'danger' }]);
  return kb;
}

function adminKb() {
  return {
    inline_keyboard: [
      [{ text: '📊 Sᴛᴀᴛꜱ', callback_data: 'adm_stats', style: 'primary' }, { text: '👥 Uꜱᴇʀꜱ', callback_data: 'adm_users', style: 'primary' }],
      [{ text: '🤖 Aʟʟ Bᴏᴛꜱ', callback_data: 'adm_allbots', style: 'primary' }, { text: '💰 Pᴀʏᴍᴇɴᴛꜱ', callback_data: 'adm_payments', style: 'primary' }],
      [{ text: '📢 Bʀᴏᴀᴅᴄᴀꜱᴛ', callback_data: 'adm_broadcast', style: 'primary' }, { text: '🚫 Bᴀɴ/Uɴʙᴀɴ', callback_data: 'adm_ban', style: 'primary' }],
      [{ text: '⭐ Gɪᴠᴇ Pʟᴀɴ', callback_data: 'adm_giveplan', style: 'primary' }, { text: '✅ Aᴘᴘʀᴏᴠᴇ', callback_data: 'adm_approve', style: 'primary' }],
      [{ text: '🛠️ Mᴀɪɴᴛᴇɴᴀɴᴄᴇ', callback_data: 'adm_maint', style: 'danger' }, { text: '⚙️ Sᴇᴛᴛɪɴɢꜱ', callback_data: 'adm_settings', style: 'danger' }],
      [{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'success' }]
    ]
  };
}

function botActionsKb(botId, running) {
  const kb = { inline_keyboard: [] };
  if (running) {
    kb.inline_keyboard.push([
      { text: '⏹️ Sᴛᴏᴘ', callback_data: `bot_stop_${botId}`, style: 'primary' },
      { text: '🔄 Rᴇꜱᴛᴀʀᴛ', callback_data: `bot_restart_${botId}`, style: 'danger' }
    ]);
  } else {
    kb.inline_keyboard.push([
      { text: '▶️ Sᴛᴀʀᴛ', callback_data: `bot_start_${botId}`, style: 'primary' }
    ]);
  }
  kb.inline_keyboard.push([
    { text: '📋 Lɪᴠᴇ Lᴏɢꜱ', callback_data: `bot_logs_${botId}`, style: 'primary' },
    { text: 'ℹ️ Iɴꜰᴏ', callback_data: `bot_info_${botId}`, style: 'danger' }
  ]);
  kb.inline_keyboard.push([
    { text: '🔐 Eɴᴠ Vᴀʀꜱ', callback_data: `bot_env_${botId}`, style: 'primary' },
    { text: '🗑️ Dᴇʟᴇᴛᴇ', callback_data: `bot_delete_${botId}`, style: 'danger' }
  ]);
  kb.inline_keyboard.push([
    { text: '🔙 Mʏ Bᴏᴛꜱ', callback_data: 'menu_bots', style: 'primary' }
  ]);
  return kb;
}

function confirmKb(action, label = 'Cᴏɴꜰɪʀᴍ') {
  return {
    inline_keyboard: [
      [{ text: `✅ ${label}`, callback_data: `confirm_${action}`, style: 'success' }],
      [{ text: '❌ Cᴀɴᴄᴇʟ', callback_data: 'menu_main', style: 'danger' }]
    ]
  };
}

// ============================================================
// BOT HANDLERS - START
// ============================================================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text || '';
  const db = loadDB();

  if (!db.users[userId]) {
    const ref = text.split(' ')[1] || null;
    db.users[userId] = {
      id: userId,
      username: msg.from.username || '',
      first_name: msg.from.first_name || '',
      plan: 'free',
      plan_expires: null,
      wallet: 0,
      joined: now(),
      banned: false,
      ban_reason: '',
      verified: false,
      referral_code: generateId(6),
      referred_by: ref || null,
      ref_count: 0,
      bonus_slots: 0,
      trial_used: false,
      last_seen: now()
    };
    
    if (ref && ref !== userId && db.users[ref]) {
      db.users[ref].ref_count += 1;
      db.users[ref].bonus_slots += 1;
      bot.sendMessage(ref, `🎉 You earned a referral bonus! +1 bot slot`);
    }
    saveDB(db);
  } else {
    db.users[userId].last_seen = now();
    saveDB(db);
  }

  const user = db.users[userId];
  const plan = PLANS[user.plan] || PLANS.free;
  const planExpires = user.plan_expires ? fmtDate(user.plan_expires) : 'Forever';
  const botCount = Object.values(db.bots).filter(b => b.owner_id === userId).length;
  const wallet = user.wallet || 0;
  const maxBots = userMaxBots(user);

  requireGroupMembership(chatId, parseInt(userId)).then(joined => {
    if (joined) {
      bot.sendPhoto(chatId, 'https://files.catbox.moe/cua7du.png', {
        caption: `
<blockquote>Pʀᴇᴍɪᴜᴍ Vᴘs Hᴏsᴛɪɴɢ Rᴏʙᴏᴛ v2.1
════════════════
ᴡᴇʟᴄᴏᴍᴇ ʙᴀᴄᴋ, ${msg.from.first_name || 'User'} ℅
━━━━━━━━━━━━━━━━
ʜᴏsᴛ ʏᴏᴜʀ ʙᴏᴛs ғᴏʀ ғʀᴇᴇ ᴜsᴇ ᴛʜᴇ ʙᴏᴛᴛᴏɴs ʙᴇʟᴏᴡ ᴛᴏ ᴍᴀɴᴀɢᴇ

•  Plan: ${plan.name}
•  Until: ${planExpires}
•  Bots: ${botCount} / ${maxBots}
•  Wallet: $${wallet}
━━━━━━━━━━━━━━━━
Choose an option below.

Pʀᴇᴍɪᴜᴍ Vᴘs Hᴏsᴛɪɴɢ Rᴏʙᴏᴛ v2.1</blockquote>`,
        parse_mode: 'HTML',
        reply_markup: mainMenu(isAdmin(parseInt(userId)))
      });
    }
  });
});

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = String(query.from.id);
  const data = query.data;
  const db = loadDB();

  bot.answerCallbackQuery(query.id);

  if (data === 'group_verify_check') {
    checkGroupMembership(parseInt(userId)).then(notJoined => {
      if (notJoined.length === 0) {
        bot.sendMessage(chatId, '✅ Verified! You have joined all required groups.', {
          reply_markup: mainMenu(isAdmin(parseInt(userId)))
        });
      } else {
        const kb = {
          inline_keyboard: []
        };
        notJoined.forEach(g => {
          kb.inline_keyboard.push([{ text: `📢 Join ${g.name}`, url: g.link }]);
        });
        kb.inline_keyboard.push([{ text: '✅ Verified', callback_data: 'group_verify_check' }]);
        bot.sendMessage(chatId, `
⚠️ You must join all our groups below before accessing the bot

${notJoined.map(g => `• <a href="${g.link}">${g.name}</a>`).join('\n')}

After joining, tap <b>Verified</b> below.
        `, {
          parse_mode: 'HTML',
          reply_markup: kb,
          disable_web_page_preview: true
        });
      }
    });
    return;
  }

  if (data === 'menu_main') {
    return bot.sendMessage(chatId, '🏠 Mᴀɪɴ Mᴇɴᴜ', {
      reply_markup: mainMenu(isAdmin(parseInt(userId)))
    });
  }

  if (data === 'menu_bots') {
    return showMyBots(chatId, userId);
  }

  if (data === 'menu_upload') {
    return bot.sendMessage(chatId, '📤 Sᴇɴᴅ ʏᴏᴜʀ ʙᴏᴛ ꜰɪʟᴇ (.py, .js, ᴏʀ .zip)', {
      reply_markup: backMain()
    });
  }

  if (data === 'menu_plans') {
    return showPlans(chatId);
  }

  if (data === 'menu_buy') {
    return showPlans(chatId);
  }

  if (data === 'menu_profile') {
    return showProfile(chatId, userId);
  }

  if (data === 'menu_referral') {
    return showReferral(chatId, userId);
  }

  if (data === 'menu_wallet') {
    return showWallet(chatId, userId);
  }

  if (data === 'menu_tickets') {
    return showTickets(chatId, userId);
  }

  if (data === 'menu_trial') {
    return showTrial(chatId, userId);
  }

  if (data === 'menu_coupon') {
    return bot.sendMessage(chatId, '🏷️ Sᴇɴᴅ ʏᴏᴜʀ ᴄᴏᴜᴘᴏɴ ᴄᴏᴅᴇ ᴛᴏ ʀᴇᴅᴇᴇᴍ.', {
      reply_markup: backMain()
    });
  }

  if (data === 'menu_help') {
    return showHelp(chatId);
  }

  if (data === 'menu_support') {
    return bot.sendMessage(chatId, `📞 Sᴜᴘᴘᴏʀᴛ: ${CONFIG.supportUser}\n📢 Uᴘᴅᴀᴛᴇꜱ: ${CONFIG.updateChannel}`, {
      reply_markup: backMain()
    });
  }

  if (data === 'menu_stats') {
    return showStats(chatId, userId);
  }

  if (data === 'menu_admin') {
    if (!isAdmin(parseInt(userId))) {
      return bot.sendMessage(chatId, '❌ Aᴅᴍɪɴ ᴏɴʟʏ!');
    }
    return showAdminPanel(chatId, userId);
  }

  if (data.startsWith('plan_view_')) {
    const planKey = data.replace('plan_view_', '');
    const plan = PLANS[planKey];
    if (!plan) return;
    const price = plan.price === 0 ? 'FREE' : `$${plan.price}`;
    const duration = plan.days === 0 ? 'Forever' : `${plan.days} days`;
    bot.sendMessage(chatId, `
⭐ <b>${plan.name} Pʟᴀɴ</b>

📦 <b>${plan.maxBots}</b> ʙᴏᴛꜱ
💾 <b>${plan.ram}</b> MB RAM ᴘᴇʀ ʙᴏᴛ
🔄 Aᴜᴛᴏ-ʀᴇꜱᴛᴀʀᴛ: ${plan.autoRestart ? '✅' : '❌'}
⏳ Dᴜʀᴀᴛɪᴏɴ: ${duration}
💰 Pʀɪᴄᴇ: ${price}

Tᴀᴘ Bᴜʏ ᴛᴏ ᴘᴜʀᴄʜᴀꜱᴇ ᴛʜɪꜱ ᴘʟᴀɴ.
    `, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: `💰 Bᴜʏ ${plan.name}`, callback_data: `plan_buy_${planKey}`, style: 'primary' }],
          [{ text: '🔙 Pʟᴀɴꜱ', callback_data: 'menu_plans', style: 'primary' }]
        ]
      }
    });
    return;
  }

  if (data.startsWith('plan_buy_')) {
    const planKey = data.replace('plan_buy_', '');
    const plan = PLANS[planKey];
    if (!plan || plan.price === 0) return;
    bot.sendMessage(chatId, `
💳 <b>Pᴀʏᴍᴇɴᴛ ꜰᴏʀ ${plan.name}</b>

Aᴍᴏᴜɴᴛ: $${plan.price}

Sᴇɴᴅ ᴘᴀʏᴍᴇɴᴛ ꜱᴄʀᴇᴇɴꜱʜᴏᴛ ᴛᴏ ᴀᴅᴍɪɴ.
Aᴅᴍɪɴ ᴡɪʟʟ ᴀᴘᴘʀᴏᴠᴇ ᴀɴᴅ ᴀᴄᴛɪᴠᴀᴛᴇ ʏᴏᴜʀ ᴘʟᴀɴ.
    `, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Sᴇɴᴅ Pʀᴏᴏꜰ', callback_data: `pay_proof_${planKey}`, style: 'success' }],
          [{ text: '🔙 Pʟᴀɴꜱ', callback_data: 'menu_plans', style: 'primary' }]
        ]
      }
    });
    return;
  }

  if (data.startsWith('bot_start_')) {
    const botId = data.replace('bot_start_', '');
    return startBot(chatId, userId, botId);
  }

  if (data.startsWith('bot_stop_')) {
    const botId = data.replace('bot_stop_', '');
    return stopBot(chatId, userId, botId);
  }

  if (data.startsWith('bot_restart_')) {
    const botId = data.replace('bot_restart_', '');
    return restartBot(chatId, userId, botId);
  }

  if (data.startsWith('bot_logs_')) {
    const botId = data.replace('bot_logs_', '');
    return showBotLogs(chatId, userId, botId);
  }

  if (data.startsWith('bot_info_')) {
    const botId = data.replace('bot_info_', '');
    return showBotInfo(chatId, userId, botId);
  }

  if (data.startsWith('bot_env_')) {
    const botId = data.replace('bot_env_', '');
    return showBotEnv(chatId, userId, botId);
  }

  if (data.startsWith('bot_delete_')) {
    const botId = data.replace('bot_delete_', '');
    return deleteBot(chatId, userId, botId);
  }

  if (data === 'adm_stats') return showAdminStats(chatId);
  if (data === 'adm_users') return showAdminUsers(chatId);
  if (data === 'adm_allbots') return showAdminAllBots(chatId);
  if (data === 'adm_payments') return showAdminPayments(chatId);
  if (data === 'adm_broadcast') {
    return bot.sendMessage(chatId, '📢 Sᴇɴᴅ ʙʀᴏᴀᴅᴄᴀꜱᴛ ᴍᴇꜱꜱᴀɢᴇ ᴛᴏ ᴀʟʟ ᴜꜱᴇʀꜱ.', {
      reply_markup: backAdmin()
    });
  }
  if (data === 'adm_ban') {
    return bot.sendMessage(chatId, '🚫 Sᴇɴᴅ: ban USER_ID REASON', {
      reply_markup: backAdmin()
    });
  }
  if (data === 'adm_giveplan') {
    return bot.sendMessage(chatId, '⭐ Sᴇɴᴅ: give USER_ID PLAN_NAME', {
      reply_markup: backAdmin()
    });
  }
  if (data === 'adm_approve') {
    return bot.sendMessage(chatId, '✅ Sᴇɴᴅ: approve PAYMENT_ID', {
      reply_markup: backAdmin()
    });
  }

  if (data === 'adm_maint') {
    db.settings.maintenance = !db.settings.maintenance;
    saveDB(db);
    bot.sendMessage(chatId, `🛠️ Mᴀɪɴᴛᴇɴᴀɴᴄᴇ ᴍᴏᴅᴇ: ${db.settings.maintenance ? 'ON' : 'OFF'}`, {
      reply_markup: backAdmin()
    });
    return;
  }

  if (data === 'adm_settings') {
    return bot.sendMessage(chatId, '⚙️ Sᴇᴛᴛɪɴɢꜱ ᴘᴀɴᴇʟ - Usᴇ ᴄᴏᴍᴍᴀɴᴅꜱ ᴛᴏ ᴄᴏɴꜰɪɢᴜʀᴇ.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Rᴇꜱᴛᴀʀᴛ Aʟʟ Bᴏᴛꜱ', callback_data: 'adm_restart_all', style: 'primary' }],
          [{ text: '⏹️ Sᴛᴏᴘ Aʟʟ Bᴏᴛꜱ', callback_data: 'adm_stop_all', style: 'danger' }],
          [{ text: '🛠️ Mᴀɪɴᴛᴇɴᴀɴᴄᴇ', callback_data: 'adm_maint', style: 'danger' }],
          [{ text: '🔙 Aᴅᴍɪɴ', callback_data: 'menu_admin', style: 'success' }]
        ]
      }
    });
  }

  if (data === 'adm_restart_all') {
    const botIds = Object.keys(runningBots);
    if (!botIds.length) {
      return bot.sendMessage(chatId, '❌ Nᴏ ʀᴜɴɴɪɴɢ ʙᴏᴛꜱ ᴛᴏ ʀᴇꜱᴛᴀʀᴛ.');
    }
    botIds.forEach(id => restartBot(chatId, userId, id));
    bot.sendMessage(chatId, `🔄 Rᴇꜱᴛᴀʀᴛɪɴɢ ${botIds.length} ʙᴏᴛꜱ...`);
    return;
  }

  if (data === 'adm_stop_all') {
    const botIds = Object.keys(runningBots);
    if (!botIds.length) {
      return bot.sendMessage(chatId, '❌ Nᴏ ʀᴜɴɴɪɴɢ ʙᴏᴛꜱ ᴛᴏ ꜱᴛᴏᴘ.');
    }
    botIds.forEach(id => stopBot(chatId, userId, id));
    bot.sendMessage(chatId, `⏹️ Sᴛᴏᴘᴘɪɴɢ ${botIds.length} ʙᴏᴛꜱ...`);
    return;
  }

  if (data === 'trial_claim') {
    const user = db.users[userId];
    if (!user) return bot.sendMessage(chatId, '❌ Usᴇʀ ɴᴏᴛ ꜰᴏᴜɴᴅ.');
    if (user.trial_used) {
      return bot.sendMessage(chatId, '❌ Yᴏᴜ ᴀʟʀᴇᴀᴅʏ ᴜꜱᴇᴅ ʏᴏᴜʀ ꜰʀᴇᴇ ᴛʀɪᴀʟ!');
    }
    user.plan = 'pro';
    user.plan_expires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    user.trial_used = true;
    saveDB(db);
    bot.sendMessage(chatId, '🎉 Fʀᴇᴇ Tʀɪᴀʟ ᴀᴄᴛɪᴠᴀᴛᴇᴅ! Yᴏᴜ ʜᴀᴠᴇ Pʀᴏ ᴘʟᴀɴ ꜰᴏʀ 48 ʜᴏᴜʀꜱ.', {
      reply_markup: mainMenu(isAdmin(parseInt(userId)))
    });
    return;
  }

  if (data === 'ticket_open') {
    return bot.sendMessage(chatId, '🎫 Sᴇɴᴅ ʏᴏᴜʀ ᴛɪᴄᴋᴇᴛ ꜱᴜʙᴊᴇᴄᴛ ꜰɪʀꜱᴛ.', {
      reply_markup: backMain()
    });
  }

  if (data === 'wallet_topup') {
    return bot.sendMessage(chatId, '💰 Sᴇɴᴅ ᴘᴀʏᴍᴇɴᴛ ꜱᴄʀᴇᴇɴꜱʜᴏᴛ ᴛᴏ ᴀᴅᴍɪɴ.', {
      reply_markup: backMain()
    });
  }

  if (data.startsWith('pay_proof_')) {
    const planKey = data.replace('pay_proof_', '');
    return bot.sendMessage(chatId, `📸 Sᴇɴᴅ ᴘᴀʏᴍᴇɴᴛ ꜱᴄʀᴇᴇɴꜱʜᴏᴛ ꜰᴏʀ ${PLANS[planKey]?.name || 'plan'}`, {
      reply_markup: backMain()
    });
  }

  bot.sendMessage(chatId, '❓ Uɴᴋɴᴏᴡɴ ᴄᴏᴍᴍᴀɴᴅ.');
});

// ============================================================
// FILE UPLOAD HANDLER
// ============================================================

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const doc = msg.document;
  const db = loadDB();

  if (!doc) return;

  if (doc.file_size > CONFIG.maxUploadSize) {
    return bot.sendMessage(chatId, `❌ Fɪʟᴇ ᴛᴏᴏ ʟᴀʀɢᴇ! Mᴀx ${CONFIG.maxUploadSize / 1024 / 1024}MB`);
  }

  const allowed = ['.py', '.js', '.zip'];
  const ext = path.extname(doc.file_name || '').toLowerCase();
  if (!allowed.includes(ext)) {
    return bot.sendMessage(chatId, '❌ Oɴʟʏ .py, .js, ᴏʀ .zip ꜰɪʟᴇꜱ ᴀʟʟᴏᴡᴇᴅ.');
  }

  const user = db.users[userId];
  if (!user) return bot.sendMessage(chatId, '❌ /start ꜰɪʀꜱᴛ!');

  const maxBots = userMaxBots(user);
  const botCount = Object.values(db.bots).filter(b => b.owner_id === userId).length;

  if (botCount >= maxBots) {
    return bot.sendMessage(chatId, `❌ Bᴏᴛ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ! Mᴀx ${maxBots} ʙᴏᴛꜱ.`);
  }

  const file = await bot.getFile(doc.file_id);
  const filePath = path.join(__dirname, 'storage', 'uploads', `${Date.now()}_${doc.file_name}`);
  fs.ensureDirSync(path.dirname(filePath));

  const fileStream = require('https').get(
    `https://api.telegram.org/file/bot${CONFIG.token}/${file.file_path}`,
    async (res) => {
      const writeStream = fs.createWriteStream(filePath);
      res.pipe(writeStream);
      writeStream.on('finish', async () => {
        const botId = generateId(8);
        const botDir = path.join(__dirname, 'sandbox', `${userId}_${botId}`);
        fs.ensureDirSync(botDir);

        if (ext === '.zip') {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(filePath);
          zip.extractAllTo(botDir, true);
        } else {
          fs.copySync(filePath, path.join(botDir, doc.file_name));
        }

        let entry = null;
        const entries = ['bot.py', 'main.py', 'app.py', 'index.js', 'bot.js', 'main.js'];
        for (const e of entries) {
          if (fs.existsSync(path.join(botDir, e))) {
            entry = e;
            break;
          }
        }

        if (!entry) {
          fs.removeSync(botDir);
          return bot.sendMessage(chatId, '❌ Nᴏ ᴇɴᴛʀʏ ꜰɪʟᴇ ꜰᴏᴜɴᴅ (bot.py, main.py, index.js, ᴇᴛᴄ)');
        }

        const kind = entry.endsWith('.js') ? 'node' : 'python';

        let installLog = '';
        
        if (kind === 'python') {
          const reqFile = path.join(botDir, 'requirements.txt');
          if (fs.existsSync(reqFile)) {
            installLog += '📦 Installing Python dependencies...\n';
            try {
              await execPromise(`pip3 install -r requirements.txt`, { cwd: botDir });
              installLog += '✅ Requirements installed!\n';
            } catch (e) {
              installLog += `⚠️ Install error: ${e.message}\n`;
            }
          }
          
          installLog += '📦 Auto-installing common packages...\n';
          try {
            await execPromise(`pip3 install pyTelegramBotAPI requests flask python-telegram-bot`, { cwd: botDir });
            installLog += '✅ Common packages installed!\n';
          } catch (e) {
            installLog += `⚠️ Auto-install error: ${e.message}\n`;
          }
        }

        if (kind === 'node') {
          const pkgFile = path.join(botDir, 'package.json');
          if (fs.existsSync(pkgFile)) {
            installLog += '📦 Installing Node.js dependencies...\n';
            try {
              await execPromise(`npm install --production`, { cwd: botDir });
              installLog += '✅ npm install completed!\n';
            } catch (e) {
              installLog += `⚠️ npm install error: ${e.message}\n`;
            }
          } else {
            const pkg = {
              name: 'bot',
              version: '1.0.0',
              main: entry,
              dependencies: {
                'node-telegram-bot-api': '^0.61.0',
                'axios': '^1.6.0',
                'dotenv': '^16.3.0'
              }
            };
            fs.writeFileSync(path.join(botDir, 'package.json'), JSON.stringify(pkg, null, 2));
            installLog += '📦 Installing Node.js dependencies...\n';
            try {
              await execPromise(`npm install`, { cwd: botDir });
              installLog += '✅ npm install completed!\n';
            } catch (e) {
              installLog += `⚠️ npm install error: ${e.message}\n`;
            }
          }
        }

        db.bots[botId] = {
          id: botId,
          name: path.basename(doc.file_name, ext),
          owner_id: userId,
          status: 'stopped',
          kind: kind,
          dir: botDir,
          entry_file: entry,
          created: now(),
          last_started: null,
          last_error: null,
          last_exit_code: null,
          approval_status: 'approved',
          env: {}
        };
        saveDB(db);

        fs.removeSync(filePath);
        auditLog(userId, 'upload_bot', `Bot ${doc.file_name} uploaded`);
        notifyOwner(`📤 Nᴇᴡ ʙᴏᴛ ᴜᴘʟᴏᴀᴅ\n\n👤 User: ${msg.from.first_name}\n🤖 Bot: ${doc.file_name}\n📂 Type: ${kind}\n🆔 ID: ${botId}`);
        
        bot.sendMessage(chatId, `
✅ Bᴏᴛ ᴜᴘʟᴏᴀᴅᴇᴅ!

📌 Nᴀᴍᴇ: ${doc.file_name}
🆔 ID: ${botId}
📂 Tʏᴘᴇ: ${kind}
📁 Eɴᴛʀʏ: ${entry}

${installLog}

Tᴀᴘ Sᴛᴀʀᴛ ᴛᴏ ʀᴜɴ ʏᴏᴜʀ ʙᴏᴛ.
        `, {
          parse_mode: 'HTML',
          reply_markup: mainMenu(isAdmin(parseInt(userId)))
        });
      });
    }
  );
});

// ============================================================
// TEXT MESSAGE HANDLER
// ============================================================

bot.on('text', async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text || '';
  const db = loadDB();

  if (text.startsWith('/')) return;

  // Coupon redemption
  if (text.length > 4 && text.length < 20) {
    const coupon = db.coupons[text.toUpperCase()];
    if (coupon && coupon.uses_left > 0) {
      coupon.uses_left -= 1;
      db.users[userId].wallet += coupon.discount;
      saveDB(db);
      bot.sendMessage(chatId, `✅ Cᴏᴜᴘᴏɴ ʀᴇᴅᴇᴇᴍᴇᴅ! Yᴏᴜ ɢᴏᴛ $${coupon.discount} ᴄʀᴇᴅɪᴛ!`, {
        reply_markup: mainMenu(isAdmin(parseInt(userId)))
      });
    }
    return;
  }

  // Admin commands
  if (isAdmin(parseInt(userId))) {
    if (text.startsWith('ban ')) {
      const parts = text.split(' ');
      const targetId = parts[1];
      const reason = parts.slice(2).join(' ') || 'No reason';
      if (db.users[targetId]) {
        db.users[targetId].banned = true;
        db.users[targetId].ban_reason = reason;
        saveDB(db);
        auditLog(userId, 'ban_user', `User ${targetId} banned. Reason: ${reason}`);
        bot.sendMessage(chatId, `✅ Uꜱᴇʀ ${targetId} ʙᴀɴɴᴇᴅ. Rᴇᴀꜱᴏɴ: ${reason}`);
      }
      return;
    }

    if (text.startsWith('unban ')) {
      const targetId = text.split(' ')[1];
      if (db.users[targetId]) {
        db.users[targetId].banned = false;
        db.users[targetId].ban_reason = '';
        saveDB(db);
        auditLog(userId, 'unban_user', `User ${targetId} unbanned`);
        bot.sendMessage(chatId, `✅ Uꜱᴇʀ ${targetId} ᴜɴʙᴀɴɴᴇᴅ.`);
      }
      return;
    }

    if (text.startsWith('give ')) {
      const parts = text.split(' ');
      const targetId = parts[1];
      const plan = parts[2];
      if (!PLANS[plan]) {
        return bot.sendMessage(chatId, `❌ Iɴᴠᴀʟɪᴅ ᴘʟᴀɴ. Oᴘᴛɪᴏɴꜱ: ${Object.keys(PLANS).join(', ')}`);
      }
      if (db.users[targetId]) {
        db.users[targetId].plan = plan;
        saveDB(db);
        auditLog(userId, 'give_plan', `User ${targetId} got ${plan} plan`);
        bot.sendMessage(chatId, `✅ Uꜱᴇʀ ${targetId} ɢɪᴠᴇɴ ${PLANS[plan].name} ᴘʟᴀɴ.`);
      }
      return;
    }

    if (text.startsWith('broadcast ')) {
      const message = text.replace('broadcast ', '');
      let sent = 0;
      for (const uid in db.users) {
        try {
          bot.sendMessage(uid, `📢 ${message}`);
          sent++;
        } catch {}
      }
      bot.sendMessage(chatId, `✅ Bʀᴏᴀᴅᴄᴀꜱᴛ ꜱᴇɴᴛ ᴛᴏ ${sent} ᴜꜱᴇʀꜱ.`);
      auditLog(userId, 'broadcast', `Broadcast sent`);
      return;
    }
  }
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function execPromise(cmd, options) {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function showMyBots(chatId, userId) {
  const db = loadDB();
  const bots = Object.values(db.bots).filter(b => b.owner_id === userId);
  
  if (!bots.length) {
    return bot.sendMessage(chatId, '🤖 Nᴏ ʙᴏᴛꜱ ᴜᴘʟᴏᴀᴅᴇᴅ ʏᴇᴛ. Usᴇ Uᴘʟᴏᴀᴅ Bᴏᴛ ᴛᴏ ꜱᴛᴀʀᴛ.', {
      reply_markup: mainMenu(isAdmin(parseInt(userId)))
    });
  }

  let message = '🤖 <b>Yᴏᴜʀ Bᴏᴛꜱ</b>\n\n';
  const kb = { inline_keyboard: [] };
  
  bots.forEach((bot, i) => {
    const isRunning = runningBots[bot.id] && runningBots[bot.id].proc;
    const status = isRunning ? '🟢 Rᴜɴɴɪɴɢ' : '⏹️ Sᴛᴏᴘᴘᴇᴅ';
    message += `${i+1}. <b>${bot.name}</b>\n   🆔 ${bot.id}\n   📊 ${status}\n   📂 ${bot.kind || 'python'}\n\n`;
    kb.inline_keyboard.push([{
      text: `${isRunning ? '🟢' : '⏹️'} ${bot.name}`,
      callback_data: `bot_info_${bot.id}`
    }]);
  });
  kb.inline_keyboard.push([{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'success' }]);

  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: kb
  });
}

function showPlans(chatId) {
  let message = '⭐ <b>Pʟᴀɴꜱ</b>\n\n';
  for (const [key, plan] of Object.entries(PLANS)) {
    const price = plan.price === 0 ? 'FREE' : `$${plan.price}`;
    message += `<b>${plan.name}</b>\n`;
    message += `  📦 ${plan.maxBots} ʙᴏᴛꜱ\n`;
    message += `  💾 ${plan.ram} MB RAM\n`;
    message += `  ⏳ ${plan.days === 0 ? 'Forever' : plan.days + ' days'}\n`;
    message += `  💰 ${price}\n\n`;
  }
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: plansKb()
  });
}

function showProfile(chatId, userId) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) return;
  const plan = PLANS[user.plan] || PLANS.free;
  const botCount = Object.values(db.bots).filter(b => b.owner_id === userId).length;
  
  bot.sendMessage(chatId, `
👤 <b>Pʀᴏꜰɪʟᴇ</b>

🆔 ID: ${user.id}
👤 Nᴀᴍᴇ: ${user.first_name || '—'}
📛 Usᴇʀɴᴀᴍᴇ: @${user.username || '—'}
⭐ Pʟᴀɴ: ${plan.name}
⏳ Exᴘɪʀᴇꜱ: ${fmtDate(user.plan_expires)}
💰 Wᴀʟʟᴇᴛ: $${user.wallet || 0}
📦 Bᴏᴛꜱ: ${botCount} / ${plan.maxBots}
🔗 Rᴇꜰᴇʀʀᴀʟꜱ: ${user.ref_count || 0}
  `, {
    parse_mode: 'HTML',
    reply_markup: backMain()
  });
}

function showReferral(chatId, userId) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) return;
  const botInfo = bot.getMe();
  const link = `https://t.me/${botInfo.username}?start=${userId}`;
  
  bot.sendMessage(chatId, `
🔗 <b>Rᴇꜰᴇʀʀᴀʟ Pʀᴏɢʀᴀᴍ</b>

Yᴏᴜʀ ʀᴇꜰᴇʀʀᴀʟ ʟɪɴᴋ:
<code>${link}</code>

🎁 Rᴇᴡᴀʀᴅꜱ:
- ${user.ref_count || 0} ʀᴇꜰᴇʀʀᴀʟꜱ
- +1 ʙᴏᴛ ꜱʟᴏᴛ ᴘᴇʀ ʀᴇꜰᴇʀʀᴀʟ
- Wᴀʟʟᴇᴛ ʙᴏɴᴜꜱ

Sʜᴀʀᴇ ʏᴏᴜʀ ʟɪɴᴋ ᴀɴᴅ ᴇᴀʀɴ ʀᴇᴡᴀʀᴅꜱ!
  `, {
    parse_mode: 'HTML',
    reply_markup: backMain()
  });
}

function showWallet(chatId, userId) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) return;
  
  bot.sendMessage(chatId, `
💳 <b>Wᴀʟʟᴇᴛ</b>

💰 Bᴀʟᴀɴᴄᴇ: $${user.wallet || 0}

Usᴇ ᴡᴀʟʟᴇᴛ ʙᴀʟᴀɴᴄᴇ ᴛᴏ ʙᴜʏ ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴꜱ.
  `, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Tᴏᴘ Uᴘ', callback_data: 'wallet_topup', style: 'primary' }],
        [{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'success' }]
      ]
    }
  });
}

function showTickets(chatId, userId) {
  const db = loadDB();
  const tickets = Object.values(db.tickets).filter(t => t.user_id === userId);
  let message = '🎫 <b>Yᴏᴜʀ Tɪᴄᴋᴇᴛꜱ</b>\n\n';
  
  if (!tickets.length) {
    message += 'Nᴏ ᴛɪᴄᴋᴇᴛꜱ ꜰᴏᴜɴᴅ.';
  } else {
    tickets.forEach(t => {
      message += `📌 #${t.id}\n`;
      message += `   Sᴜʙᴊᴇᴄᴛ: ${t.subject}\n`;
      message += `   Sᴛᴀᴛᴜꜱ: ${t.status === 'open' ? '🟢 Oᴘᴇɴ' : '🔴 Cʟᴏꜱᴇᴅ'}\n\n`;
    });
  }
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎫 Oᴘᴇɴ Tɪᴄᴋᴇᴛ', callback_data: 'ticket_open', style: 'primary' }],
        [{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'success' }]
      ]
    }
  });
}

function showTrial(chatId, userId) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) return;
  const used = user.trial_used || false;
  
  bot.sendMessage(chatId, `
🎁 <b>Fʀᴇᴇ Tʀɪᴀʟ</b>

Gᴇᴛ <b>Pʀᴏ</b> ᴘʟᴀɴ ꜰᴏʀ <b>48 ʜᴏᴜʀꜱ</b> FREE!

Sᴛᴀᴛᴜꜱ: ${used ? '❌ Aʟʀᴇᴀᴅʏ ᴜꜱᴇᴅ' : '✅ Aᴠᴀɪʟᴀʙʟᴇ'}

Oɴᴇ ᴛʀɪᴀʟ ᴘᴇʀ ᴜꜱᴇʀ.
  `, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: used ? '❌ Usᴇᴅ' : '🎁 Cʟᴀɪᴍ Tʀɪᴀʟ', callback_data: 'trial_claim', style: 'primary' }],
        [{ text: '🔙 Mᴀɪɴ Mᴇɴᴜ', callback_data: 'menu_main', style: 'success' }]
      ]
    }
  });
}

function showHelp(chatId) {
  bot.sendMessage(chatId, `
❓ <b>Hᴇʟᴘ Cᴇɴᴛᴇʀ</b>

📤 <b>Uᴘʟᴏᴀᴅ Bᴏᴛ</b>
Sᴇɴᴅ .py, .js, ᴏʀ .zip ꜰɪʟᴇ

🤖 <b>Mʏ Bᴏᴛꜱ</b>
Vɪᴇᴡ, ꜱᴛᴀʀᴛ, ꜱᴛᴏᴘ, ᴍᴀɴᴀɢᴇ ʙᴏᴛꜱ

⭐ <b>Pʟᴀɴꜱ</b>
Vɪᴇᴡ ᴀᴠᴀɪʟᴀʙʟᴇ ʜᴏꜱᴛɪɴɢ ᴘʟᴀɴꜱ

💰 <b>Bᴜʏ Pʟᴀɴ</b>
Pᴜʀᴄʜᴀꜱᴇ ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴꜱ

🎁 <b>Fʀᴇᴇ Tʀɪᴀʟ</b>
Gᴇᴛ 48ʜ Pʀᴏ ᴘʟᴀɴ ꜰʀᴇᴇ

📞 <b>Sᴜᴘᴘᴏʀᴛ</b>
Cᴏɴᴛᴀᴄᴛ: ${CONFIG.supportUser}
  `, {
    parse_mode: 'HTML',
    reply_markup: backMain()
  });
}

function showStats(chatId, userId) {
  const db = loadDB();
  const user = db.users[userId];
  if (!user) return;
  const plan = PLANS[user.plan] || PLANS.free;
  const botCount = Object.values(db.bots).filter(b => b.owner_id === userId).length;
  
  bot.sendMessage(chatId, `
📊 <b>Mʏ Sᴛᴀᴛꜱ</b>

👤 Nᴀᴍᴇ: ${user.first_name || '—'}
⭐ Pʟᴀɴ: ${plan.name}
💰 Wᴀʟʟᴇᴛ: $${user.wallet || 0}
🤖 Bᴏᴛꜱ: ${botCount} / ${plan.maxBots}
🔗 Rᴇꜰᴇʀʀᴀʟꜱ: ${user.ref_count || 0}
📅 Jᴏɪɴᴇᴅ: ${fmtDate(user.joined)}
  `, {
    parse_mode: 'HTML',
    reply_markup: backMain()
  });
}

// ============================================================
// ADMIN FUNCTIONS
// ============================================================

function showAdminPanel(chatId, userId) {
  if (!isAdmin(parseInt(userId))) {
    return bot.sendMessage(chatId, '❌ Aᴅᴍɪɴ ᴏɴʟʏ!');
  }
  
  const db = loadDB();
  const userCount = Object.keys(db.users).length;
  const botCount = Object.keys(db.bots).length;
  const runningCount = Object.keys(runningBots).length;
  
  bot.sendMessage(chatId, `
🛡️ <b>Aᴅᴍɪɴ Pᴀɴᴇʟ</b>

👥 Usᴇʀꜱ: ${userCount}
🤖 Bᴏᴛꜱ: ${botCount}
🟢 Rᴜɴɴɪɴɢ: ${runningCount}

Sᴇʟᴇᴄᴛ ᴀɴ ᴏᴘᴛɪᴏɴ ʙᴇʟᴏᴡ.
  `, {
    parse_mode: 'HTML',
    reply_markup: adminKb()
  });
}

function showAdminStats(chatId) {
  const db = loadDB();
  const userCount = Object.keys(db.users).length;
  const botCount = Object.keys(db.bots).length;
  const runningCount = Object.keys(runningBots).length;
  const pending = db.payments.filter(p => p.status === 'pending').length;
  
  bot.sendMessage(chatId, `
📊 <b>Aᴅᴍɪɴ Sᴛᴀᴛꜱ</b>

👥 Tᴏᴛᴀʟ Usᴇʀꜱ: ${userCount}
🤖 Tᴏᴛᴀʟ Bᴏᴛꜱ: ${botCount}
🟢 Rᴜɴɴɪɴɢ: ${runningCount}
⏳ Pᴇɴᴅɪɴɢ Pᴀʏᴍᴇɴᴛꜱ: ${pending}
  `, {
    parse_mode: 'HTML',
    reply_markup: backAdmin()
  });
}

function showAdminUsers(chatId) {
  const db = loadDB();
  const users = Object.values(db.users).slice(0, 20);
  let message = '👥 <b>Usᴇʀꜱ</b>\n\n';
  
  users.forEach(u => {
    message += `🆔 ${u.id}\n`;
    message += `   Nᴀᴍᴇ: ${u.first_name || '—'}\n`;
    message += `   Pʟᴀɴ: ${u.plan}\n`;
    message += `   Wᴀʟʟᴇᴛ: $${u.wallet || 0}\n`;
    message += `   Sᴛᴀᴛᴜꜱ: ${u.banned ? '🚫 Bᴀɴɴᴇᴅ' : '✅ Aᴄᴛɪᴠᴇ'}\n\n`;
  });
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: backAdmin()
  });
}

function showAdminAllBots(chatId) {
  const db = loadDB();
  const bots = Object.values(db.bots).slice(0, 20);
  let message = '🤖 <b>Aʟʟ Bᴏᴛꜱ</b>\n\n';
  
  bots.forEach(b => {
    const isRunning = runningBots[b.id] && runningBots[b.id].proc;
    message += `📌 ${b.name}\n`;
    message += `   🆔 ${b.id}\n`;
    message += `   👤 Oᴡɴᴇʀ: ${b.owner_id}\n`;
    message += `   📊 Sᴛᴀᴛᴜꜱ: ${isRunning ? '🟢 Rᴜɴɴɪɴɢ' : '⏹️ Sᴛᴏᴘᴘᴇᴅ'}\n`;
    message += `   📂 Kɪɴᴅ: ${b.kind || 'python'}\n\n`;
  });
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: backAdmin()
  });
}

function showAdminPayments(chatId) {
  const db = loadDB();
  const payments = db.payments.filter(p => p.status === 'pending').slice(0, 15);
  let message = '💰 <b>Pᴇɴᴅɪɴɢ Pᴀʏᴍᴇɴᴛꜱ</b>\n\n';
  
  if (!payments.length) {
    message += 'Nᴏ ᴘᴇɴᴅɪɴɢ ᴘᴀʏᴍᴇɴᴛꜱ.';
  } else {
    payments.forEach(p => {
      message += `📌 #${p.id}\n`;
      message += `   👤 Usᴇʀ: ${p.user_id}\n`;
      message += `   💰 Aᴍᴏᴜɴᴛ: $${p.amount}\n`;
      message += `   ⭐ Pʟᴀɴ: ${p.plan}\n`;
      message += `   📅 Dᴀᴛᴇ: ${fmtDate(p.created)}\n\n`;
    });
  }
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    reply_markup: backAdmin()
  });
}

// ============================================================
// BOT CONTROL FUNCTIONS
// ============================================================

function startBot(chatId, userId, botId) {
  const db = loadDB();
  const botData = db.bots[botId];
  
  if (!botData) {
    return bot.sendMessage(chatId, '❌ Bᴏᴛ ɴᴏᴛ ꜰᴏᴜɴᴅ.');
  }

  if (botData.owner_id !== userId && !isAdmin(parseInt(userId))) {
    return bot.sendMessage(chatId, '❌ Nᴏᴛ ʏᴏᴜʀ ʙᴏᴛ.');
  }

  if (runningBots[botId] && runningBots[botId].proc) {
    return bot.sendMessage(chatId, '⚠️ Bᴏᴛ ɪꜱ ᴀʟʀᴇᴀᴅʏ ʀᴜɴɴɪɴɢ.');
  }

  const botDir = botData.dir;
  const entry = botData.entry_file || 'bot.py';
  const kind = botData.kind || 'python';

  const cmd = kind === 'node' ? `node ${entry}` : `python3 ${entry}`;
  
  const proc = spawn(cmd, {
    cwd: botDir,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.unref();

  runningBots[botId] = { 
    proc, 
    started: Date.now(),
    log: []
  };

  proc.stdout.on('data', (data) => {
    const logLine = data.toString().trim();
    runningBots[botId].log.push(logLine);
    if (runningBots[botId].log.length > 200) {
      runningBots[botId].log.shift();
    }
  });

  proc.stderr.on('data', (data) => {
    const logLine = data.toString().trim();
    runningBots[botId].log.push(`[ERROR] ${logLine}`);
    if (runningBots[botId].log.length > 200) {
      runningBots[botId].log.shift();
    }
  });

  proc.on('close', (code) => {
    runningBots[botId].log.push(`Process exited with code ${code}`);
    const db2 = loadDB();
    if (db2.bots[botId]) {
      db2.bots[botId].status = 'stopped';
      db2.bots[botId].last_exit_code = code;
      saveDB(db2);
    }
    delete runningBots[botId];
  });

  botData.status = 'running';
  botData.last_started = now();
  saveDB(db);

  bot.sendMessage(chatId, `
✅ Bᴏᴛ ꜱᴛᴀʀᴛᴇᴅ!

📌 Nᴀᴍᴇ: ${botData.name}
🆔 PID: ${proc.pid}
📂 Tʏᴘᴇ: ${kind}

Usᴇ Lɪᴠᴇ Lᴏɢꜱ ᴛᴏ ᴠɪᴇᴡ ᴏᴜᴛᴘᴜᴛ.
  `, {
    parse_mode: 'HTML',
    reply_markup: mainMenu(isAdmin(parseInt(userId)))
  });

  auditLog(userId, 'start_bot', `Bot ${botId} started`);
  notifyOwner(`▶️ Bᴏᴛ ꜱᴛᴀʀᴛᴇᴅ\n🤖 ${botData.name}\n🆔 ${botId}`);
}

function stopBot(chatId, userId, botId) {
  const db = loadDB();
  const botData = db.bots[botId];
  
  if (!botData) {
    return bot.sendMessage(chatId, '❌ Bᴏᴛ ɴᴏᴛ ꜰᴏᴜɴᴅ.');
  }

  if (botData.owner_id !== userId && !isAdmin(parseInt(userId))) {
    return bot.sendMessage(chatId, '❌ Nᴏᴛ ʏᴏᴜʀ ʙᴏᴛ.');
  }

  if (runningBots[botId] && runningBots[botId].proc) {
    try {
      process.kill(-runningBots[botId].proc.pid);
    } catch {}
    delete runningBots[botId];
  }

  botData.status = 'stopped';
  saveDB(db);

  bot.sendMessage(chatId, `⏹️ Bᴏᴛ ꜱᴛᴏᴘᴘᴇᴅ.`, {
    reply_markup: mainMenu(isAdmin(parseInt(userId)))
  });

  auditLog(userId, 'stop_bot', `Bot ${botId} stopped`);
}

function restartBot(chatId, userId, botId) {
  stopBot(chatId, userId, botId);
  setTimeout(() => startBot(chatId, userId, botId), 2000);
}

function showBotLogs(chatId, userId, botId) {
  const db = loadDB();
  const botData = db.bots[botId];
  
  if (!botData) return bot.sendMessage(chatId, '❌ Bᴏᴛ ɴᴏᴛ ꜰᴏᴜɴᴅ.');
  if (botData.owner_id !== userId && !isAdmin(parseInt(userId))) {
    return bot.sendMessage(chatId, '❌ Nᴏᴛ ʏᴏᴜʀ ʙᴏᴛ.');
  }

  const logs = runningBots[botId]?.log || ['Nᴏ ʟᴏɢꜱ ᴀᴠᴀɪʟᴀʙʟᴇ.'];
  const recentLogs = logs.slice(-30).join('\n');

  bot.sendMessage(chatId, `
📋 <b>Lɪᴠᴇ Lᴏɢꜱ</b>

<code>${esc(recentLogs.slice(0, 3500))}</code>
  `, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Rᴇꜰʀᴇꜱʜ', callback_data: `bot_logs_${botId}`, style: 'primary' }],
        [{ text: '🔙 Bᴀᴄᴋ', callback_data: `bot_info_${botId}`, style: 'danger' }]
      ]
    }
  });
}

function showBotInfo(chatId, userId, botId) {
  const db = loadDB();
  const botData = db.bots[botId];
  
  if (!botData) return bot.sendMessage(chatId, '❌ Bᴏᴛ ɴᴏᴛ ꜰᴏᴜɴᴅ.');
  if (botData.owner_id !== userId && !isAdmin(parseInt(userId))) {
    return bot.sendMessage(chatId, '❌ Nᴏᴛ ʏᴏᴜʀ ʙᴏᴛ.');
  }

  const isRunning = runningBots[botId] && runningBots[botId].proc;
  const uptime = isRunning ? Math.floor((Date.now() - runningBots[botId].started) / 1000) : 0;

  bot.sendMessage(chatId, `
ℹ️ <b>Bᴏᴛ Iɴꜰᴏ</b>

📌 Nᴀᴍᴇ: ${botData.name}
🆔 ID: ${botData.id}
📂 Tʏᴘᴇ: ${botData.kind || 'python'}
📁 Pᴀᴛʜ: ${botData.dir}
📄 Eɴᴛʀʏ: ${botData.entry_file || 'bot.py'}
🟢 Sᴛᴀᴛᴜꜱ: ${isRunning ? '✅ Rᴜɴɴɪɴɢ' : '⏹️ Sᴛᴏᴘᴘᴇᴅ'}
⏱️ Uᴘᴛɪᴍᴇ: ${uptime}s
📅 Cʀᴇᴀᴛᴇᴅ: ${fmtDate(botData.created)}
  `, {
    parse_mode: 'HTML',
    reply_markup: botActionsKb(botId, isRunning)
  });
}

function showBotEnv(chatId, userId, botId) {
  bot.sendMessage(chatId, `
🔐 <b>Eɴᴠɪʀᴏɴᴍᴇɴᴛ Vᴀʀɪᴀʙʟᴇꜱ</b>

Sᴇɴᴅ ᴇɴᴠ ᴠᴀʀꜱ ᴀꜱ:
<code>KEY=VALUE</code>

Exᴀᴍᴘʟᴇ:
<code>BOT_TOKEN=123456:ABC</code>
  `, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Bᴀᴄᴋ', callback_data: `bot_info_${botId}`, style: 'danger' }]
      ]
    }
  });
}

function deleteBot(chatId, userId, botId) {
  const db = loadDB();
  const botData = db.bots[botId];
  
  if (!botData) return bot.sendMessage(chatId, '❌ Bᴏᴛ ɴᴏᴛ ꜰᴏᴜɴᴅ.');
  if (botData.owner_id !== userId && !isAdmin(parseInt(userId))) {
    return bot.sendMessage(chatId, '❌ Nᴏᴛ ʏᴏᴜʀ ʙᴏᴛ.');
  }

  if (runningBots[botId] && runningBots[botId].proc) {
    try {
      process.kill(-runningBots[botId].proc.pid);
    } catch {}
    delete runningBots[botId];
  }

  fs.removeSync(botData.dir);
  delete db.bots[botId];
  saveDB(db);
  auditLog(userId, 'delete_bot', `Deleted bot ${botId}`);

  bot.sendMessage(chatId, `🗑️ Bᴏᴛ ${botData.name} ᴅᴇʟᴇᴛᴇᴅ.`, {
    reply_markup: mainMenu(isAdmin(parseInt(userId)))
  });
}

// ============================================================
// EXPRESS SERVER
// ============================================================

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  const runningCount = Object.keys(runningBots).length;
  res.json({
    ok: true,
    brand: CONFIG.brand,
    version: CONFIG.version,
    uptime_ms: process.uptime() * 1000,
    running_bots: runningCount
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`🌐 Wᴇʙ ꜱᴇʀᴠᴇʀ ʀᴜɴɴɪɴɢ ᴏɴ ᴘᴏʀᴛ ${CONFIG.port}`);
});

// ============================================================
// CREATE DIRECTORIES
// ============================================================

fs.ensureDirSync('storage/data');
fs.ensureDirSync('storage/uploads');
fs.ensureDirSync('sandbox');
fs.ensureDirSync('logs');

// ============================================================
// START BOT
// ============================================================

bot.getMe().then(botInfo => {
  console.log(`✅ ${CONFIG.brand} ${CONFIG.version} ɪꜱ ʀᴜɴɴɪɴɢ!`);
  console.log(`📡 Bᴏᴛ: @${botInfo.username}`);
  console.log(`👤 Oᴡɴᴇʀ ID: ${CONFIG.ownerId}`);
  console.log(`🌐 Wᴇʙ: http://localhost:${CONFIG.port}`);
  console.log(`🔗 Fᴏʀᴄᴇ Jᴏɪɴ: ${REQUIRED_GROUPS.length} ɢʀᴏᴜᴘꜱ`);
}).catch(err => {
  console.error(`Fᴀᴛᴀʟ ᴇʀʀᴏʀ: ${err.message}`);
  process.exit(1);
});

// Error handling
bot.on('error', (err) => {
  console.error(`Bᴏᴛ ᴇʀʀᴏʀ: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  console.error(`Uɴʜᴀɴᴅʟᴇᴅ ʀᴇᴊᴇᴄᴛɪᴏɴ: ${err}`);
});

console.log('✅ Aʟʟ ꜱʏꜱᴛᴇᴍꜱ ʀᴇᴀᴅʏ!');
