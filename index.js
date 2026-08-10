const { Telegraf, session, Markup, Scenes } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const cron = require('node-cron');
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================
const BOT_TOKEN = '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4';
const ADMIN_IDS = ['7158115683'];
const SUPPORT_LINK = 'https://t.me/PREMIUM_BOTS_SUPPORT_GC';
const DONATE_LINK = 'https://t.me/PREMIUM_VPS_BOT_HOSTING_ROBOT?start=donate';
const WEB_BASE_URL = 'https://your-domain.com';
const CHANNEL_ID = '-1003842777722';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Database
const db = {
  users: new Map(),
  projects: new Map(),
  files: new Map(),
  assistants: new Set(),
  settings: {
    menuImage: null,
    menuVideo: null,
    forceJoin: null,
    maintenance: false,
    dailyReward: 10,
    spinRewards: [0, 5, 10, 25, 50, 100],
    referralBonus: 2,
    referralJoinBonus: 1
  },
  wallet: new Map(),
  plans: [
    { name: 'Free', price: 0, limits: { bots: 1, websites: 1, storage: 100 }, features: ['1 Bot', '1 Website', '100MB Storage', 'Basic Support'] },
    { name: 'Premium', price: 10, limits: { bots: 5, websites: 3, storage: 500 }, features: ['5 Bots', '3 Websites', '500MB Storage', 'Priority Support'] },
    { name: 'Pro', price: 25, limits: { bots: 10, websites: 5, storage: 1000 }, features: ['10 Bots', '5 Websites', '1GB Storage', '24/7 Support'] },
    { name: 'Enterprise', price: 50, limits: { bots: 25, websites: 15, storage: 5000 }, features: ['25 Bots', '15 Websites', '5GB Storage', '24/7 Priority Support'] }
  ],
  coupons: new Map(),
  tickets: new Map(),
  transactions: new Map(),
  dailyClaims: new Map(),
  spins: new Map(),
  referrals: new Map(),
  referralCodes: new Map()
};

// Utility Functions
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from.id.toString());
const generateId = () => crypto.randomBytes(2).toString('hex').toUpperCase();
const formatDate = () => new Date().toLocaleString();
const generateReferralCode = (userId) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${code}${userId.toString().slice(-3)}`;
};

// Keyboards
const mainKeyboard = (ctx) => {
  const isAdminUser = isAdmin(ctx);
  const buttons = [
    ['🤖 ᴍʏ ʙᴏᴛs', '📱 ᴍʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs'],
    ['🌐 ᴍʏ ᴡᴇʙsɪᴛᴇs'],
    ['🚀 ᴅᴇᴘʟᴏʏ ᴛɢ ʙᴏᴛ', '💬 ᴅᴇᴘʟᴏʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ'],
    ['🌍 ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ'],
    ['🎯 ᴅᴀɪʟʏ ᴄʟᴀɪᴍ', '🎰 sᴘɪɴ'],
    ['⬆️ ᴜᴘɢʀᴀᴅᴇ ᴘʟᴀɴ', '📋 ᴘʟᴀɴs'],
    ['📊 ᴍʏ ᴘʟᴀɴ', '👛 ᴍʏ ᴡᴀʟʟᴇᴛ'],
    ['🔗 ʀᴇғᴇʀʀᴀʟ', '📊 ʀᴇғᴇʀʀᴀʟ sᴛᴀᴛs'],
    ['🏆 ʀᴇғᴇʀʀᴀʟ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ'],
    ['🎫 ᴛɪᴄᴋᴇᴛ', '🎟️ ᴄᴏᴜᴘᴏɴ'],
    ['📢 ᴜᴘᴅᴀᴛᴇ ᴄʜᴀɴɴᴇʟ', '📞 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ'],
    ['💝 ᴅᴏɴᴀᴛᴇ']
  ];
  if (isAdminUser) {
    buttons.push(['⚙️ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ']);
  }
  return Markup.keyboard(buttons).resize().oneTime(false);
};

const adminKeyboard = Markup.keyboard([
  ['👥 ᴀʟʟ ᴜsᴇʀs', '📊 sᴛᴀᴛs', '📈 ᴀɴᴀʟʏᴛɪᴄs'],
  ['💳 ᴘʟᴀɴs', '👛 ᴜsᴇʀs ᴡᴀʟʟᴇᴛ', '📊 ᴛʀᴀɴsᴀᴄᴛɪᴏɴs'],
  ['🎁 ᴀᴅᴅ ᴘᴏɪɴᴛs', '🌍 ɢʟᴏʙᴀʟ ɢɪғᴛ', '🎰 sᴇᴛ sᴘɪɴ ʀᴇᴡᴀʀᴅs'],
  ['🖼️ sᴇᴛ ᴍᴇɴᴜ ɪᴍᴀɢᴇ', '🗑️ ʀᴇᴍᴏᴠᴇ ᴍᴇɴᴜ ɪᴍᴀɢᴇ'],
  ['🎬 sᴇᴛ ᴍᴇɴᴜ ᴠɪᴅᴇᴏ', '🗑️ ʀᴇᴍᴏᴠᴇ ᴍᴇɴᴜ ᴠɪᴅᴇᴏ'],
  ['🤝 ᴀᴅᴅ ᴀssɪsᴛᴀɴᴛ', '❌ ʀᴇᴍᴏᴠᴇ ᴀssɪsᴛ', '📋 ʟɪsᴛ ᴀssɪsᴛᴀɴᴛ'],
  ['📢 ʙʀᴏᴀᴅᴄᴀsᴛ', '🔔 ɴᴏᴛɪғʏ sᴘᴇᴄɪғɪᴄ', '📨 ᴘʀᴏᴍᴏᴛɪᴏɴᴀʟ'],
  ['💰 ᴀᴅᴊᴜsᴛ ᴡᴀʟʟᴇᴛ', '🎟️ ᴄʀᴇᴀᴛᴇ ᴄᴏᴜᴘᴏɴ', '🗑️ ᴅᴇʟᴇᴛᴇ ᴄᴏᴜᴘᴏɴ'],
  ['🎁 ʀᴇғᴇʀʀᴀʟ sᴇᴛᴛɪɴɢs', '📊 ʀᴇғᴇʀʀᴀʟ sᴛᴀᴛs', '🎁 ɢɪᴠᴇ ʀᴇғᴇʀʀᴀʟ ʙᴏɴᴜs'],
  ['🗑️ ʀᴇsᴇᴛ ʀᴇғᴇʀʀᴀʟs'],
  ['🧹 ᴄʟᴇᴀʀ ᴀʟʟ ғɪʟᴇs', '💾 ғᴏʀᴄᴇ ʙᴀᴄᴋᴜᴘ', '🔄 ʀᴇsᴛᴏʀᴇ ʙᴀᴄᴋᴜᴘ'],
  ['🔗 sᴇᴛ ғᴏʀᴄᴇ ᴊᴏɪɴ', '🚫 ʀᴇᴍᴏᴠᴇ ғᴏʀᴄᴇ ᴊᴏɪɴ'],
  ['⏹️ sᴛᴏᴘ ᴀʟʟ', '▶️ ʀᴇsᴛᴀʀᴛ ᴀʟʟ', '🔍 ᴄʜᴇᴄᴋ ᴀʟʟ'],
  ['🔧 ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ ᴍᴏᴅᴇ', '📝 ᴠɪᴇᴡ ʟᴏɢs', '🗑️ ᴄʟᴇᴀʀ ʟᴏɢs'],
  ['📊 ᴘʀᴏᴊᴇᴄᴛ sᴛᴀᴛs', '👤 ᴜsᴇʀ ᴅᴇᴛᴀɪʟs', '⚡ ǫᴜɪᴄᴋ ᴀᴄᴛɪᴏɴs'],
  ['🔙 ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ']
]).resize();

// ============================================
// DEPLOY SCENE
// ============================================
const deployScene = new Scenes.BaseScene('deploy');
deployScene.enter((ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.deploy = {};
  ctx.reply(
    `<blockquote>📦 Welcome to Project Deployment!\n\nEnter a name for your project (max 10 chars):</blockquote>`,
    { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() }
  );
});

deployScene.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text === '🔙 ᴄᴀɴᴄᴇʟ') {
    ctx.scene.leave();
    return ctx.reply('❌ Deployment cancelled.', mainKeyboard(ctx));
  }
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.deploy) ctx.session.deploy = {};
  if (!ctx.session.deploy.name) {
    if (text.length > 10) {
      return ctx.reply(`<blockquote>❌ Name too long! Max 10 characters.</blockquote>`, { parse_mode: 'HTML' });
    }
    ctx.session.deploy.name = text;
    return ctx.reply(
      `<blockquote>📁 Project name: ${text}\n\nSend your project files:\nSupported: .zip, .py, .js, .html, .css, .json</blockquote>`,
      { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() }
    );
  }
});

deployScene.on('document', async (ctx) => {
  const file = ctx.message.document;
  const ext = path.extname(file.file_name).toLowerCase();
  const allowedExts = ['.zip', '.py', '.js', '.html', '.css', '.json'];
  
  if (!allowedExts.includes(ext)) {
    return ctx.reply(`<blockquote>❌ Unsupported format. Send: ${allowedExts.join(', ')}</blockquote>`, { parse_mode: 'HTML' });
  }

  const projectId = generateId();
  const userDir = path.join('./projects', ctx.from.id.toString(), projectId);
  await fs.ensureDir(userDir);

  const filePath = path.join(userDir, file.file_name);
  const link = await ctx.telegram.getFileLink(file.file_id);
  const response = await axios({ url: link.href, responseType: 'stream' });
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);
    zip.extractAllTo(userDir, true);
    await fs.remove(filePath);
  }

  let projectType = 'web';
  if (ext === '.py') projectType = 'python';
  else if (ext === '.js') projectType = 'javascript';
  else if (['.html', '.css', '.json'].includes(ext)) projectType = 'web';

  let projectCategory = 'website';
  if (projectType === 'python' || projectType === 'javascript') {
    const files = await fs.readdir(userDir);
    if (files.some(f => f.includes('bot') || f.includes('telegram') || f.includes('whatsapp'))) {
      projectCategory = files.some(f => f.includes('whatsapp')) ? 'whatsapp' : 'telegram';
    }
  }

  const userPlan = db.users.get(ctx.from.id)?.plan || 'Free';
  const planLimits = db.plans.find(p => p.name === userPlan)?.limits || db.plans[0].limits;
  const userProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id);
  
  if (projectCategory === 'telegram' && userProjects.filter(p => p.type === 'telegram').length >= planLimits.bots) {
    return ctx.reply(`<blockquote>❌ Bot limit reached (${planLimits.bots}) for ${userPlan} plan.</blockquote>`, { parse_mode: 'HTML' });
  }
  
  if (projectCategory === 'website' && userProjects.filter(p => p.type === 'website').length >= planLimits.websites) {
    return ctx.reply(`<blockquote>❌ Website limit reached (${planLimits.websites}) for ${userPlan} plan.</blockquote>`, { parse_mode: 'HTML' });
  }

  const project = {
    id: projectId,
    userId: ctx.from.id,
    name: ctx.session.deploy?.name || file.file_name,
    fileName: file.file_name,
    type: projectCategory,
    subType: projectType,
    path: userDir,
    deployedAt: new Date(),
    status: 'running',
    url: projectCategory === 'website' ? `${WEB_BASE_URL}/${ctx.from.id}/${projectId}` : null,
    port: 3000 + db.projects.size,
    plan: userPlan
  };

  db.projects.set(projectId, project);

  const claimButton = Markup.inlineKeyboard([
    Markup.button.url('🎫 CLAIM SLOT', `https://t.me/PREMIUM_VPS_BOT_HOSTING_ROBOT`)
  ]);

  await ctx.telegram.sendMessage(
    CHANNEL_ID,
    `<blockquote>🚀 New Project Deployed!\n📁 Name: ${project.name}\n👤 User: ${ctx.from.first_name}\n🕐 Time: ${formatDate()}\n📊 Type: ${projectCategory.toUpperCase()}\n🔗 URL: ${project.url || 'N/A'}\n\nClick below to claim!</blockquote>`,
    { parse_mode: 'HTML', ...claimButton }
  );

  await ctx.reply(
    `<blockquote>✅ Project deployed!\n📁 ID: ${projectId}\n📂 Name: ${project.name}\n🔗 URL: ${project.url || 'Internal'}</blockquote>`,
    { parse_mode: 'HTML' }
  );
  await ctx.scene.leave();
});

// ============================================
// ✅ MAIN TEXT HANDLER WITH SWITCH CASE
// ============================================
bot.on('text', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message.text;
  
  // ============================================
  // ✅ SWITCH CASE FOR ALL COMMANDS
  // ============================================
  switch(text) {
    
    // ==========================================
    // START COMMAND
    // ==========================================
    case '/start':
    case '/Start':
    case '/START': {
      try {
        const userId = ctx.from.id;
        const args = text.split(' ');
        
        // Handle referral
        if (args.length > 1 && args[1].startsWith('ref_')) {
          const referralCode = args[1].replace('ref_', '');
          let referrerId = null;
          for (const [id, code] of db.referralCodes) {
            if (code === referralCode) {
              referrerId = id;
              break;
            }
          }
          const existingReferral = Array.from(db.referrals.values()).find(r => r.userId === userId);
          if (referrerId && !existingReferral && referrerId !== userId) {
            const referralBonus = db.settings.referralBonus || 2;
            const joinBonus = db.settings.referralJoinBonus || 1;
            const referrerBalance = db.wallet.get(referrerId) || 0;
            db.wallet.set(referrerId, referrerBalance + referralBonus);
            const userBalance = db.wallet.get(userId) || 0;
            db.wallet.set(userId, userBalance + joinBonus);
            db.referrals.set(generateId(), {
              id: generateId(),
              userId: userId,
              referrerId: referrerId,
              userName: ctx.from.first_name,
              joinedAt: Date.now(),
              bonusEarned: joinBonus,
              referrerBonusEarned: referralBonus
            });
            try {
              await ctx.telegram.sendMessage(referrerId, `<blockquote>🎉 New referral!\n👤 ${ctx.from.first_name}\n💰 +$${referralBonus}</blockquote>`, { parse_mode: 'HTML' });
            } catch (e) {}
            await ctx.reply(`<blockquote>🎉 Welcome! You got $${joinBonus} bonus!</blockquote>`, { parse_mode: 'HTML' });
          }
        }
        
        // Save user
        if (!db.users.has(userId)) {
          db.users.set(userId, {
            id: userId,
            first_name: ctx.from.first_name,
            username: ctx.from.username,
            joinedAt: new Date(),
            plan: 'Free'
          });
          db.wallet.set(userId, 10);
        }
        
        // Check force join
        if (db.settings.forceJoin) {
          try {
            const member = await ctx.telegram.getChatMember(db.settings.forceJoin, userId);
            if (member.status === 'left') {
              return ctx.reply(`<blockquote>❤️‍🩹 Please join our channel to continue!</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('📢 Join', `https://t.me/${db.settings.forceJoin.replace('@', '')}`)]) });
            }
          } catch (e) {}
        }
        
        // Check maintenance
        if (db.settings.maintenance && !isAdmin(ctx)) {
          return ctx.reply(`<blockquote>🔧 Under maintenance</blockquote>`, { parse_mode: 'HTML' });
        }
        
        const balance = db.wallet.get(userId) || 0;
        const welcome = `<blockquote>❤️‍🔥 Welcome ${ctx.from.first_name} to Premium Hosting Robot!\n\n👤 ID: ${userId}\n💰 Balance: $${balance}\n\nHost your:\n• Telegram Bots\n• WhatsApp Bots\n• Websites\n\nClaim daily bonus, spin slots, refer and earn!\n\n🌹Thanks for being part of the community🌹</blockquote>`;
        
        if (db.settings.menuImage) {
          await ctx.replyWithPhoto(db.settings.menuImage, { caption: welcome, parse_mode: 'HTML' });
        } else if (db.settings.menuVideo) {
          await ctx.replyWithVideo(db.settings.menuVideo, { caption: welcome, parse_mode: 'HTML' });
        } else {
          await ctx.reply(welcome, { parse_mode: 'HTML' });
        }
        
        await ctx.reply('📋 Main Menu:', mainKeyboard(ctx));
        
      } catch (error) {
        console.error('Start command error:', error);
        await ctx.reply(`<blockquote>❌ Error: ${error.message}</blockquote>`, { parse_mode: 'HTML' });
      }
      break;
    }
    
    // ==========================================
    // ADMIN COMMANDS
    // ==========================================
    case '/admin': {
      if (!isAdmin(ctx)) return ctx.reply(`<blockquote>❌ Unauthorized</blockquote>`, { parse_mode: 'HTML' });
      await ctx.reply('⚙️ Admin Panel', adminKeyboard);
      break;
    }
    
    case '/cancel': {
      ctx.scene.leave();
      if (ctx.session) ctx.session.adminAction = null;
      ctx.reply('❌ Cancelled', mainKeyboard(ctx));
      break;
    }
    
    // ==========================================
    // USER COMMANDS - BUTTONS
    // ==========================================
    case '🤖 ᴍʏ ʙᴏᴛs': {
      const userProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id && (p.type === 'telegram' || p.type === 'whatsapp'));
      if (userProjects.length === 0) return ctx.reply(`<blockquote>🤖 No bots found.</blockquote>`, { parse_mode: 'HTML' });
      const list = userProjects.map((p, i) => `${i+1}. 📁 ${p.name}\n   Type: ${p.type}\n   Status: ${p.status}\n   ID: ${p.id}`).join('\n\n');
      await ctx.reply(`<blockquote>🤖 Your Bots\n━━━━━━━━━━━━━━━━━━━\n\n${list}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📱 ᴍʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs': {
      const whatsappBots = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id && p.type === 'whatsapp');
      if (whatsappBots.length === 0) return ctx.reply(`<blockquote>📱 No WhatsApp bots found.</blockquote>`, { parse_mode: 'HTML' });
      const list = whatsappBots.map((p, i) => `${i+1}. 📱 ${p.name}\n   Status: ${p.status}\n   ID: ${p.id}`).join('\n\n');
      await ctx.reply(`<blockquote>📱 Your WhatsApp Bots\n━━━━━━━━━━━━━━━━━━━\n\n${list}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🌐 ᴍʏ ᴡᴇʙsɪᴛᴇs': {
      const webProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id && p.type === 'website');
      if (webProjects.length === 0) return ctx.reply(`<blockquote>🌐 No websites found.</blockquote>`, { parse_mode: 'HTML' });
      const list = webProjects.map((p, i) => `${i+1}. 🌐 ${p.name}\n   🔗 ${p.url || 'N/A'}\n   Status: ${p.status}`).join('\n\n');
      await ctx.reply(`<blockquote>🌐 Your Websites\n━━━━━━━━━━━━━━━━━━━\n\n${list}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🚀 ᴅᴇᴘʟᴏʏ ᴛɢ ʙᴏᴛ':
    case '💬 ᴅᴇᴘʟᴏʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ':
    case '🌍 ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ': {
      ctx.scene.enter('deploy');
      break;
    }
    
    case '🎯 ᴅᴀɪʟʏ ᴄʟᴀɪᴍ': {
      const userId = ctx.from.id;
      const now = Date.now();
      const lastClaim = db.dailyClaims.get(userId) || 0;
      if (now - lastClaim < 86400000) {
        const remaining = Math.ceil((86400000 - (now - lastClaim)) / 3600000);
        return ctx.reply(`<blockquote>⏳ Already claimed today! Next in ${remaining} hours</blockquote>`, { parse_mode: 'HTML' });
      }
      const reward = db.settings.dailyReward || 10;
      const current = db.wallet.get(userId) || 0;
      db.wallet.set(userId, current + reward);
      db.dailyClaims.set(userId, now);
      await ctx.reply(`<blockquote>🎯 Daily Claim!\n💰 +$${reward}\n📊 New Balance: $${current + reward}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎰 sᴘɪɴ': {
      const userId = ctx.from.id;
      const now = Date.now();
      const lastSpin = db.spins.get(userId) || 0;
      if (now - lastSpin < 3600000) {
        const remaining = Math.ceil((3600000 - (now - lastSpin)) / 60000);
        return ctx.reply(`<blockquote>⏳ Wait ${remaining} minutes</blockquote>`, { parse_mode: 'HTML' });
      }
      const rewards = db.settings.spinRewards || [0, 5, 10, 25, 50, 100];
      const reward = rewards[Math.floor(Math.random() * rewards.length)];
      const current = db.wallet.get(userId) || 0;
      db.wallet.set(userId, current + reward);
      db.spins.set(userId, now);
      await ctx.reply(`<blockquote>🎰 Spin!\nYou won $${reward}!\n💰 New Balance: $${current + reward}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '⬆️ ᴜᴘɢʀᴀᴅᴇ ᴘʟᴀɴ': {
      const currentPlan = db.users.get(ctx.from.id)?.plan || 'Free';
      const plans = db.plans.map((p, i) => `${i+1}. ${p.name} - $${p.price}\n   📊 ${p.features.join(', ')}`).join('\n\n');
      await ctx.reply(`<blockquote>⬆️ Upgrade Plan\nCurrent: ${currentPlan}\n━━━━━━━━━━━━━━━━━━━\n\n${plans}\n\nSend /upgrade_plan [number]</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📋 ᴘʟᴀɴs': {
      const plans = db.plans.map((p) => `📋 ${p.name}\n   💰 $${p.price}\n   ✨ ${p.features.join(', ')}`).join('\n\n');
      await ctx.reply(`<blockquote>💰 Available Plans\n━━━━━━━━━━━━━━━━━━━\n\n${plans}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📊 ᴍʏ ᴘʟᴀɴ': {
      const user = db.users.get(ctx.from.id);
      const plan = user?.plan || 'Free';
      const planDetails = db.plans.find(p => p.name === plan) || db.plans[0];
      const userProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id);
      await ctx.reply(`<blockquote>📊 Your Plan\n━━━━━━━━━━━━━━━━━━━\nPlan: ${plan}\nPrice: $${planDetails.price}\nFeatures: ${planDetails.features.join(', ')}\nProjects: ${userProjects.length}\nWallet: $${db.wallet.get(ctx.from.id) || 0}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '👛 ᴍʏ ᴡᴀʟʟᴇᴛ': {
      const balance = db.wallet.get(ctx.from.id) || 0;
      await ctx.reply(`<blockquote>👛 Your Wallet\n━━━━━━━━━━━━━━━━━━━\n💰 Balance: $${balance}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🔗 ʀᴇғᴇʀʀᴀʟ': {
      const userId = ctx.from.id;
      let referralCode = db.referralCodes.get(userId);
      if (!referralCode) {
        referralCode = generateReferralCode(userId);
        db.referralCodes.set(userId, referralCode);
      }
      const referredUsers = Array.from(db.referrals.values()).filter(r => r.referrerId === userId).length;
      const inviteLink = `https://t.me/${ctx.botInfo.username}?start=ref_${referralCode}`;
      await ctx.reply(`<blockquote>🔗 Referral\n━━━━━━━━━━━━━━━━━━━\nCode: <code>${referralCode}</code>\nReferrals: ${referredUsers}\nBonus: $${db.settings.referralBonus}\n\nShare: ${inviteLink}</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('📤 Share', `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=Join%20this%20awesome%20bot!`), Markup.button.copytext('📋 Copy', referralCode)]) });
      break;
    }
    
    case '📊 ʀᴇғᴇʀʀᴀʟ sᴛᴀᴛs': {
      const userId = ctx.from.id;
      const referredUsers = Array.from(db.referrals.values()).filter(r => r.referrerId === userId);
      const totalEarned = referredUsers.reduce((sum, r) => sum + (r.bonusEarned || 0), 0);
      if (referredUsers.length === 0) return ctx.reply(`<blockquote>📊 No referrals yet!</blockquote>`, { parse_mode: 'HTML' });
      const userList = referredUsers.map((r, i) => `${i+1}. 👤 ${r.userName || r.userId}\n   💰 $${r.bonusEarned || 0}`).join('\n\n');
      await ctx.reply(`<blockquote>📊 Referral Stats\n━━━━━━━━━━━━━━━━━━━\nTotal: ${referredUsers.length}\nEarned: $${totalEarned}\n\n${userList}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🏆 ʀᴇғᴇʀʀᴀʟ ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ': {
      const referralStats = new Map();
      for (const [id, referral] of db.referrals) {
        const count = referralStats.get(referral.referrerId) || { count: 0, total: 0 };
        count.count += 1;
        count.total += (referral.bonusEarned || 0);
        referralStats.set(referral.referrerId, count);
      }
      const sorted = Array.from(referralStats.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
      if (sorted.length === 0) return ctx.reply(`<blockquote>🏆 No referrals yet!</blockquote>`, { parse_mode: 'HTML' });
      const leaderboard = sorted.map(([userId, data], i) => {
        const user = db.users.get(userId);
        const name = user ? user.first_name : userId;
        return `${i+1}. 🥇 ${name}\n   👥 ${data.count} referrals\n   💰 $${data.total} earned`;
      }).join('\n\n');
      await ctx.reply(`<blockquote>🏆 Leaderboard\n━━━━━━━━━━━━━━━━━━━\n${leaderboard}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎫 ᴛɪᴄᴋᴇᴛ': {
      ctx.session.adminAction = 'ticket';
      ctx.reply(`<blockquote>🎫 Create Ticket\nDescribe your issue:</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🎟️ ᴄᴏᴜᴘᴏɴ': {
      ctx.session.adminAction = 'redeem_coupon';
      ctx.reply(`<blockquote>🎟️ Send coupon code:</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '📢 ᴜᴘᴅᴀᴛᴇ ᴄʜᴀɴɴᴇʟ': {
      await ctx.reply(`<blockquote>📢 Join Update Channel\n🔗 https://t.me/PREMIUM_BOT_HOSTING_UPDATE</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('📢 Join', 'https://t.me/PREMIUM_BOT_HOSTING_UPDATE')]) });
      break;
    }
    
    case '📞 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ': {
      await ctx.reply(`<blockquote>📞 Contact Support\n💬 ${SUPPORT_LINK}</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('💬 Chat', SUPPORT_LINK)]) });
      break;
    }
    
    case '💝 ᴅᴏɴᴀᴛᴇ': {
      await ctx.reply(`<blockquote>💝 Support Development\n⭐ Donate to support us!\n\nThank you! ❤️</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('⭐ Donate', DONATE_LINK)]) });
      break;
    }
    
    case '⚙️ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ': {
      if (!isAdmin(ctx)) return ctx.reply(`<blockquote>❌ Unauthorized</blockquote>`, { parse_mode: 'HTML' });
      await ctx.reply('⚙️ Admin Panel', adminKeyboard);
      break;
    }
    
    // ==========================================
    // ADMIN BUTTON COMMANDS
    // ==========================================
    case '👥 ᴀʟʟ ᴜsᴇʀs': {
      if (!isAdmin(ctx)) return;
      const users = Array.from(db.users.values());
      const list = users.map((u, i) => `${i+1}. 👤 ${u.first_name}\n   Plan: ${u.plan || 'Free'}\n   Wallet: $${db.wallet.get(u.id) || 0}`).join('\n\n');
      await ctx.reply(`<blockquote>📊 Total Users: ${users.length}\n\n${list || 'No users'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📊 sᴛᴀᴛs': {
      if (!isAdmin(ctx)) return;
      const totalProjects = db.projects.size;
      const runningProjects = Array.from(db.projects.values()).filter(p => p.status === 'running').length;
      const totalUsers = db.users.size;
      const totalWallet = Array.from(db.wallet.values()).reduce((a, b) => a + b, 0);
      const totalReferrals = db.referrals.size;
      await ctx.reply(`<blockquote>📊 Bot Stats\n━━━━━━━━━━━━━━━━━━━\n👥 Users: ${totalUsers}\n📁 Projects: ${totalProjects}\n✅ Running: ${runningProjects}\n💰 Wallet: $${totalWallet}\n🔗 Referrals: ${totalReferrals}\n📅 ${formatDate()}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📈 ᴀɴᴀʟʏᴛɪᴄs': {
      if (!isAdmin(ctx)) return;
      const projectsByType = {};
      for (const [id, project] of db.projects) {
        projectsByType[project.type] = (projectsByType[project.type] || 0) + 1;
      }
      let analytics = `📈 Analytics\n━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const [type, count] of Object.entries(projectsByType)) {
        analytics += `${type}: ${count}\n`;
      }
      await ctx.reply(`<blockquote>${analytics}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '💳 ᴘʟᴀɴs': {
      if (!isAdmin(ctx)) return;
      const plans = db.plans.map(p => `📋 ${p.name}\n   💰 $${p.price}\n   ✨ ${p.features.join(', ')}`).join('\n\n');
      await ctx.reply(`<blockquote>💰 Plans\n━━━━━━━━━━━━━━━━━━━\n\n${plans}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '👛 ᴜsᴇʀs ᴡᴀʟʟᴇᴛ': {
      if (!isAdmin(ctx)) return;
      const wallets = Array.from(db.wallet.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, balance], i) => {
        const user = db.users.get(id);
        return `${i+1}. ${user ? user.first_name : 'Unknown'}: $${balance}`;
      }).join('\n');
      await ctx.reply(`<blockquote>💰 Top Wallets\n━━━━━━━━━━━━━━━━━━━\n\n${wallets || 'No wallets'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📊 ᴛʀᴀɴsᴀᴄᴛɪᴏɴs': {
      if (!isAdmin(ctx)) return;
      const transactions = Array.from(db.transactions.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20).map(t => `${t.type}: $${t.amount} - ${t.user} - ${formatDate(t.timestamp)}`).join('\n');
      await ctx.reply(`<blockquote>📊 Transactions\n━━━━━━━━━━━━━━━━━━━\n\n${transactions || 'No transactions'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎁 ᴀᴅᴅ ᴘᴏɪɴᴛs': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'add_points';
      ctx.reply(`<blockquote>Format: user_id points\nExample: 123456789 100</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🌍 ɢʟᴏʙᴀʟ ɢɪғᴛ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'global_gift';
      ctx.reply(`<blockquote>Enter amount to gift all users:</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🎰 sᴇᴛ sᴘɪɴ ʀᴇᴡᴀʀᴅs': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'set_spin_rewards';
      ctx.reply(`<blockquote>Enter rewards: 0,5,10,25,50,100</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🖼️ sᴇᴛ ᴍᴇɴᴜ ɪᴍᴀɢᴇ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'set_menu_image';
      ctx.reply(`<blockquote>Send me the image</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🗑️ ʀᴇᴍᴏᴠᴇ ᴍᴇɴᴜ ɪᴍᴀɢᴇ': {
      if (!isAdmin(ctx)) return;
      db.settings.menuImage = null;
      await ctx.reply(`<blockquote>✅ Menu image removed</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎬 sᴇᴛ ᴍᴇɴᴜ ᴠɪᴅᴇᴏ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'set_menu_video';
      ctx.reply(`<blockquote>Send me the video</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🗑️ ʀᴇᴍᴏᴠᴇ ᴍᴇɴᴜ ᴠɪᴅᴇᴏ': {
      if (!isAdmin(ctx)) return;
      db.settings.menuVideo = null;
      await ctx.reply(`<blockquote>✅ Menu video removed</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🤝 ᴀᴅᴅ ᴀssɪsᴛᴀɴᴛ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'add_assistant';
      ctx.reply(`<blockquote>Send user ID or username</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '❌ ʀᴇᴍᴏᴠᴇ ᴀssɪsᴛ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'remove_assistant';
      ctx.reply(`<blockquote>Send user ID or username to remove</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '📋 ʟɪsᴛ ᴀssɪsᴛᴀɴᴛ': {
      if (!isAdmin(ctx)) return;
      const assistants = Array.from(db.assistants);
      await ctx.reply(`<blockquote>🤝 Assistants\n━━━━━━━━━━━━━━━━━━━\n\n${assistants.join('\n') || 'None'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📢 ʙʀᴏᴀᴅᴄᴀsᴛ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'broadcast';
      ctx.reply(`<blockquote>Send broadcast message:</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🔔 ɴᴏᴛɪғʏ sᴘᴇᴄɪғɪᴄ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'notify_specific';
      ctx.reply(`<blockquote>Format: user_id|message</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '📨 ᴘʀᴏᴍᴏᴛɪᴏɴᴀʟ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'promotional';
      ctx.reply(`<blockquote>Send promotional message</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '💰 ᴀᴅᴊᴜsᴛ ᴡᴀʟʟᴇᴛ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'adjust_wallet';
      ctx.reply(`<blockquote>Format: user_id amount\nExample: 123456789 50</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🎟️ ᴄʀᴇᴀᴛᴇ ᴄᴏᴜᴘᴏɴ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'create_coupon';
      ctx.reply(`<blockquote>Format: code|discount|limit\nExample: SUMMER50|50|100</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🗑️ ᴅᴇʟᴇᴛᴇ ᴄᴏᴜᴘᴏɴ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'delete_coupon';
      ctx.reply(`<blockquote>Send coupon code to delete</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🎁 ʀᴇғᴇʀʀᴀʟ sᴇᴛᴛɪɴɢs': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'referral_settings';
      ctx.reply(`<blockquote>Referral Settings\nBonus: $${db.settings.referralBonus}\nNew User: $${db.settings.referralJoinBonus}\nSend: bonus|join_bonus\nExample: 100|50</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '📊 ʀᴇғᴇʀʀᴀʟ sᴛᴀᴛs': {
      if (!isAdmin(ctx)) return;
      const totalReferrals = db.referrals.size;
      const uniqueReferrers = new Set(Array.from(db.referrals.values()).map(r => r.referrerId)).size;
      const totalBonus = Array.from(db.referrals.values()).reduce((sum, r) => sum + (r.bonusEarned || 0) + (r.referrerBonusEarned || 0), 0);
      await ctx.reply(`<blockquote>📊 Referral Stats\n━━━━━━━━━━━━━━━━━━━\nTotal: ${totalReferrals}\nReferrers: ${uniqueReferrers}\nBonus Given: $${totalBonus}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎁 ɢɪᴠᴇ ʀᴇғᴇʀʀᴀʟ ʙᴏɴᴜs': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'give_referral_bonus';
      ctx.reply(`<blockquote>Format: user_id|amount\nExample: 123456789|100</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🗑️ ʀᴇsᴇᴛ ʀᴇғᴇʀʀᴀʟs': {
      if (!isAdmin(ctx)) return;
      const confirm = Markup.inlineKeyboard([Markup.button.callback('✅ Yes', 'confirm_reset_referrals'), Markup.button.callback('❌ No', 'cancel_reset_referrals')]);
      await ctx.reply(`<blockquote>⚠️ Reset all referral data?\nTotal: ${db.referrals.size}</blockquote>`, { parse_mode: 'HTML', ...confirm });
      break;
    }
    
    case '🧹 ᴄʟᴇᴀʀ ᴀʟʟ ғɪʟᴇs': {
      if (!isAdmin(ctx)) return;
      await fs.emptyDir('./projects');
      db.projects.clear();
      await ctx.reply(`<blockquote>✅ All files cleared</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '💾 ғᴏʀᴄᴇ ʙᴀᴄᴋᴜᴘ': {
      if (!isAdmin(ctx)) return;
      const backupDir = `./backups/backup_${Date.now()}`;
      await fs.copy('./projects', backupDir);
      await ctx.reply(`<blockquote>✅ Backup created: ${backupDir}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🔄 ʀᴇsᴛᴏʀᴇ ʙᴀᴄᴋᴜᴘ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'restore_backup';
      ctx.reply(`<blockquote>Send backup folder name</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🔗 sᴇᴛ ғᴏʀᴄᴇ ᴊᴏɪɴ': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'set_force_join';
      ctx.reply(`<blockquote>Send channel: @channel or -100123</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🚫 ʀᴇᴍᴏᴠᴇ ғᴏʀᴄᴇ ᴊᴏɪɴ': {
      if (!isAdmin(ctx)) return;
      db.settings.forceJoin = null;
      await ctx.reply(`<blockquote>✅ Force join removed</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '⏹️ sᴛᴏᴘ ᴀʟʟ': {
      if (!isAdmin(ctx)) return;
      let stopped = 0;
      for (const [id, project] of db.projects) {
        if (project.status === 'running') { project.status = 'stopped'; stopped++; }
      }
      await ctx.reply(`<blockquote>⏹️ Stopped ${stopped} projects</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '▶️ ʀᴇsᴛᴀʀᴛ ᴀʟʟ': {
      if (!isAdmin(ctx)) return;
      let restarted = 0;
      for (const [id, project] of db.projects) {
        if (project.status === 'stopped') { project.status = 'running'; restarted++; }
      }
      await ctx.reply(`<blockquote>▶️ Restarted ${restarted} projects</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🔍 ᴄʜᴇᴄᴋ ᴀʟʟ': {
      if (!isAdmin(ctx)) return;
      let running = 0, stopped = 0;
      for (const [id, project] of db.projects) {
        if (project.status === 'running') running++;
        else if (project.status === 'stopped') stopped++;
      }
      await ctx.reply(`<blockquote>🔍 Status\n━━━━━━━━━━━━━━━━━━━\n✅ Running: ${running}\n⏹️ Stopped: ${stopped}\n📊 Total: ${db.projects.size}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🔧 ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ ᴍᴏᴅᴇ': {
      if (!isAdmin(ctx)) return;
      db.settings.maintenance = !db.settings.maintenance;
      await ctx.reply(`<blockquote>${db.settings.maintenance ? '🔧 Maintenance ENABLED' : '✅ Maintenance DISABLED'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📝 ᴠɪᴇᴡ ʟᴏɢs': {
      if (!isAdmin(ctx)) return;
      const logFile = path.join('./logs', 'bot.log');
      if (await fs.pathExists(logFile)) {
        const logs = await fs.readFile(logFile, 'utf-8');
        const lastLines = logs.split('\n').slice(-50).join('\n');
        await ctx.reply(`<blockquote>📝 Logs\n━━━━━━━━━━━━━━━━━━━\n\n${lastLines || 'No logs'}</blockquote>`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`<blockquote>No logs found</blockquote>`, { parse_mode: 'HTML' });
      }
      break;
    }
    
    case '🗑️ ᴄʟᴇᴀʀ ʟᴏɢs': {
      if (!isAdmin(ctx)) return;
      const logFile = path.join('./logs', 'bot.log');
      if (await fs.pathExists(logFile)) {
        await fs.writeFile(logFile, '');
        await ctx.reply(`<blockquote>✅ Logs cleared</blockquote>`, { parse_mode: 'HTML' });
      }
      break;
    }
    
    case '📊 ᴘʀᴏᴊᴇᴄᴛ sᴛᴀᴛs': {
      if (!isAdmin(ctx)) return;
      const stats = { total: db.projects.size, byType: {}, byPlan: {} };
      for (const [id, project] of db.projects) {
        stats.byType[project.type] = (stats.byType[project.type] || 0) + 1;
        stats.byPlan[project.plan] = (stats.byPlan[project.plan] || 0) + 1;
      }
      let projectStats = `📊 Project Stats\n━━━━━━━━━━━━━━━━━━━\n\nTotal: ${stats.total}\n\nBy Type:\n`;
      for (const [type, count] of Object.entries(stats.byType)) {
        projectStats += `${type}: ${count}\n`;
      }
      projectStats += `\nBy Plan:\n`;
      for (const [plan, count] of Object.entries(stats.byPlan)) {
        projectStats += `${plan}: ${count}\n`;
      }
      await ctx.reply(`<blockquote>${projectStats}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '👤 ᴜsᴇʀ ᴅᴇᴛᴀɪʟs': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'user_details';
      ctx.reply(`<blockquote>Send user ID</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '⚡ ǫᴜɪᴄᴋ ᴀᴄᴛɪᴏɴs': {
      if (!isAdmin(ctx)) return;
      await ctx.reply('⚡ Quick Actions', Markup.keyboard([
        ['📊 ᴠɪᴇᴡ ᴀʟʟ ᴘʀᴏᴊᴇᴄᴛs', '🔄 ʀᴇsᴛᴀʀᴛ ᴀʟʟ ʙᴏᴛs'],
        ['📦 ᴠɪᴇᴡ ᴀʟʟ ᴡᴇʙsɪᴛᴇs', '🌐 ᴄʜᴇᴄᴋ ᴡᴇʙsɪᴛᴇs sᴛᴀᴛᴜs'],
        ['🔙 ʙᴀᴄᴋ ᴛᴏ ᴀᴅᴍɪɴ']
      ]).resize());
      break;
    }
    
    case '📊 ᴠɪᴇᴡ ᴀʟʟ ᴘʀᴏᴊᴇᴄᴛs': {
      if (!isAdmin(ctx)) return;
      const projects = Array.from(db.projects.values());
      const list = projects.map((p, i) => `${i+1}. 📁 ${p.name} (${p.type})\n   Status: ${p.status}\n   User: ${db.users.get(p.userId)?.first_name || p.userId}`).join('\n\n');
      await ctx.reply(`<blockquote>All Projects (${projects.length})\n━━━━━━━━━━━━━━━━━━━\n${list || 'None'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🔄 ʀᴇsᴛᴀʀᴛ ᴀʟʟ ʙᴏᴛs': {
      if (!isAdmin(ctx)) return;
      let restarted = 0;
      for (const [id, project] of db.projects) {
        if (project.type === 'telegram' || project.type === 'whatsapp') {
          project.status = 'running';
          restarted++;
        }
      }
      await ctx.reply(`<blockquote>🔄 Restarted ${restarted} bots</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📦 ᴠɪᴇᴡ ᴀʟʟ ᴡᴇʙsɪᴛᴇs': {
      if (!isAdmin(ctx)) return;
      const websites = Array.from(db.projects.values()).filter(p => p.type === 'website');
      const list = websites.map((w, i) => `${i+1}. 🌐 ${w.name}\n   🔗 ${w.url || 'N/A'}\n   Status: ${w.status}`).join('\n\n');
      await ctx.reply(`<blockquote>Websites (${websites.length})\n━━━━━━━━━━━━━━━━━━━\n\n${list || 'None'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🌐 ᴄʜᴇᴄᴋ ᴡᴇʙsɪᴛᴇs sᴛᴀᴛᴜs': {
      if (!isAdmin(ctx)) return;
      const websites = Array.from(db.projects.values()).filter(p => p.type === 'website');
      let status = `🌐 Website Status\n━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const w of websites) {
        status += `📁 ${w.name}\n   Status: ${w.status}\n   URL: ${w.url || 'N/A'}\n\n`;
      }
      await ctx.reply(`<blockquote>${status}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🔙 ʙᴀᴄᴋ ᴛᴏ ᴀᴅᴍɪɴ': {
      if (!isAdmin(ctx)) return;
      await ctx.reply('🔙 Admin Panel', adminKeyboard);
      break;
    }
    
    case '🔙 ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ': {
      ctx.reply('🔙 Main Menu', mainKeyboard(ctx));
      break;
    }
    
    // ==========================================
    // ADMIN ACTION HANDLING - Text Input
    // ==========================================
    default: {
      // Handle admin actions (text input after button click)
      if (ctx.session.adminAction) {
        const action = ctx.session.adminAction;
        
        switch(action) {
          case 'add_points': {
            const [targetId, points] = text.split(' ');
            if (!targetId || !points || isNaN(points)) return ctx.reply(`<blockquote>❌ Invalid format</blockquote>`, { parse_mode: 'HTML' });
            const current = db.wallet.get(targetId) || 0;
            db.wallet.set(targetId, current + parseInt(points));
            await ctx.reply(`<blockquote>✅ Added ${points} points to ${targetId}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'global_gift': {
            const amount = parseInt(text);
            if (isNaN(amount) || amount <= 0) return ctx.reply(`<blockquote>❌ Invalid amount</blockquote>`, { parse_mode: 'HTML' });
            let gifted = 0;
            for (const [id, balance] of db.wallet) {
              db.wallet.set(id, balance + amount);
              gifted++;
            }
            await ctx.reply(`<blockquote>✅ Gifted ${amount} to ${gifted} users</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'set_spin_rewards': {
            const rewards = text.split(',').map(Number).filter(n => !isNaN(n) && n >= 0);
            if (rewards.length < 2) return ctx.reply(`<blockquote>❌ Need at least 2 rewards</blockquote>`, { parse_mode: 'HTML' });
            db.settings.spinRewards = rewards;
            await ctx.reply(`<blockquote>✅ Spin rewards: ${rewards.join(', ')}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'add_assistant': {
            db.assistants.add(text);
            await ctx.reply(`<blockquote>✅ Assistant ${text} added</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'remove_assistant': {
            if (db.assistants.delete(text)) {
              await ctx.reply(`<blockquote>✅ Assistant ${text} removed</blockquote>`, { parse_mode: 'HTML' });
            } else {
              await ctx.reply(`<blockquote>❌ Assistant ${text} not found</blockquote>`, { parse_mode: 'HTML' });
            }
            ctx.session.adminAction = null;
            break;
          }
          case 'broadcast': {
            let sent = 0, failed = 0;
            for (const [id] of db.users) {
              try {
                await ctx.telegram.sendMessage(id, `<blockquote>📢 ${text}</blockquote>`, { parse_mode: 'HTML' });
                sent++;
              } catch (e) { failed++; }
            }
            await ctx.reply(`<blockquote>✅ Sent to ${sent} users\n❌ Failed: ${failed}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'notify_specific': {
            const [targetId, ...msgParts] = text.split('|');
            const message = msgParts.join('|');
            if (!targetId || !message) return ctx.reply(`<blockquote>❌ Invalid format</blockquote>`, { parse_mode: 'HTML' });
            try {
              await ctx.telegram.sendMessage(targetId, `<blockquote>🔔 ${message}</blockquote>`, { parse_mode: 'HTML' });
              await ctx.reply(`<blockquote>✅ Sent to ${targetId}</blockquote>`, { parse_mode: 'HTML' });
            } catch (e) {
              await ctx.reply(`<blockquote>❌ Failed: ${e.message}</blockquote>`, { parse_mode: 'HTML' });
            }
            ctx.session.adminAction = null;
            break;
          }
          case 'adjust_wallet': {
            const [targetId, amount] = text.split(' ');
            if (!targetId || !amount || isNaN(amount)) return ctx.reply(`<blockquote>❌ Invalid format</blockquote>`, { parse_mode: 'HTML' });
            const current = db.wallet.get(targetId) || 0;
            db.wallet.set(targetId, current + parseInt(amount));
            await ctx.reply(`<blockquote>✅ Wallet adjusted: $${db.wallet.get(targetId)}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'create_coupon': {
            const [code, discount, limit] = text.split('|');
            if (!code || !discount || !limit || isNaN(discount) || isNaN(limit)) return ctx.reply(`<blockquote>❌ Invalid format</blockquote>`, { parse_mode: 'HTML' });
            db.coupons.set(code, { code, discount: parseInt(discount), limit: parseInt(limit), used: 0, createdAt: Date.now() });
            await ctx.reply(`<blockquote>✅ Coupon ${code} created!</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'delete_coupon': {
            if (db.coupons.delete(text)) {
              await ctx.reply(`<blockquote>✅ Coupon ${text} deleted</blockquote>`, { parse_mode: 'HTML' });
            } else {
              await ctx.reply(`<blockquote>❌ Coupon not found</blockquote>`, { parse_mode: 'HTML' });
            }
            ctx.session.adminAction = null;
            break;
          }
          case 'referral_settings': {
            const [bonus, joinBonus] = text.split('|');
            if (!bonus || !joinBonus || isNaN(bonus) || isNaN(joinBonus)) return ctx.reply(`<blockquote>❌ Format: bonus|join_bonus</blockquote>`, { parse_mode: 'HTML' });
            db.settings.referralBonus = parseInt(bonus);
            db.settings.referralJoinBonus = parseInt(joinBonus);
            await ctx.reply(`<blockquote>✅ Referral: $${bonus}, Join: $${joinBonus}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'give_referral_bonus': {
            const [userId, amount] = text.split('|');
            if (!userId || !amount || isNaN(amount)) return ctx.reply(`<blockquote>❌ Format: user_id|amount</blockquote>`, { parse_mode: 'HTML' });
            const current = db.wallet.get(userId) || 0;
            db.wallet.set(userId, current + parseInt(amount));
            await ctx.reply(`<blockquote>✅ Added $${amount} referral bonus to ${userId}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'restore_backup': {
            const backupPath = path.join('./backups', text);
            if (await fs.pathExists(backupPath)) {
              await fs.copy(backupPath, './projects');
              await ctx.reply(`<blockquote>✅ Restored: ${text}</blockquote>`, { parse_mode: 'HTML' });
            } else {
              await ctx.reply(`<blockquote>❌ Backup not found</blockquote>`, { parse_mode: 'HTML' });
            }
            ctx.session.adminAction = null;
            break;
          }
          case 'set_force_join': {
            db.settings.forceJoin = text;
            await ctx.reply(`<blockquote>✅ Force join: ${text}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'user_details': {
            const user = db.users.get(text);
            if (!user) return ctx.reply(`<blockquote>❌ User not found</blockquote>`, { parse_mode: 'HTML' });
            const userProjects = Array.from(db.projects.values()).filter(p => p.userId === text);
            await ctx.reply(`<blockquote>👤 User Details\n━━━━━━━━━━━━━━━━━━━\nID: ${user.id}\nName: ${user.first_name}\nUsername: ${user.username || 'N/A'}\nPlan: ${user.plan || 'Free'}\nWallet: $${db.wallet.get(text) || 0}\nProjects: ${userProjects.length}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'ticket': {
            const ticketId = generateId();
            db.tickets.set(ticketId, { id: ticketId, userId: ctx.from.id, message: text, createdAt: Date.now(), status: 'open' });
            await ctx.reply(`<blockquote>✅ Ticket #${ticketId} created!</blockquote>`, { parse_mode: 'HTML' });
            for (const adminId of ADMIN_IDS) {
              await ctx.telegram.sendMessage(adminId, `<blockquote>🎫 New Ticket #${ticketId}\nFrom: ${ctx.from.first_name}\n${text}</blockquote>`, { parse_mode: 'HTML' });
            }
            ctx.session.adminAction = null;
            break;
          }
          case 'redeem_coupon': {
            const coupon = db.coupons.get(text);
            if (!coupon) return ctx.reply(`<blockquote>❌ Invalid coupon</blockquote>`, { parse_mode: 'HTML' });
            if (coupon.used >= coupon.limit) return ctx.reply(`<blockquote>❌ Coupon used up</blockquote>`, { parse_mode: 'HTML' });
            const userId = ctx.from.id;
            const current = db.wallet.get(userId) || 0;
            const bonus = Math.floor(current * (coupon.discount / 100));
            db.wallet.set(userId, current + bonus);
            coupon.used++;
            db.coupons.set(text, coupon);
            await ctx.reply(`<blockquote>✅ Coupon redeemed! +$${bonus}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'promotional': {
            // Handle promotional message
            let sent = 0, failed = 0;
            for (const [id] of db.users) {
              try {
                await ctx.telegram.sendMessage(id, `<blockquote>📨 ${text}</blockquote>`, { parse_mode: 'HTML' });
                sent++;
              } catch (e) { failed++; }
            }
            await ctx.reply(`<blockquote>✅ Promo sent to ${sent} users\n❌ Failed: ${failed}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          default: {
            ctx.session.adminAction = null;
            break;
          }
        }
        return;
      }
      
      // If no command matches, ignore
      break;
    }
  }
});

// ============================================
// MEDIA HANDLERS
// ============================================
bot.on(['photo', 'video'], async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!ctx.session) ctx.session = {};
  
  const action = ctx.session.adminAction;
  if (action === 'set_menu_image' && ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    db.settings.menuImage = photo.file_id;
    await ctx.reply(`<blockquote>✅ Menu image set</blockquote>`, { parse_mode: 'HTML' });
    ctx.session.adminAction = null;
  } else if (action === 'set_menu_video' && ctx.message.video) {
    db.settings.menuVideo = ctx.message.video.file_id;
    await ctx.reply(`<blockquote>✅ Menu video set</blockquote>`, { parse_mode: 'HTML' });
    ctx.session.adminAction = null;
  }
});

// ============================================
// ACTION HANDLERS
// ============================================
bot.action('confirm_reset_referrals', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Unauthorized');
  db.referrals.clear();
  db.referralCodes.clear();
  await ctx.answerCbQuery('✅ Reset all referrals!');
  await ctx.editMessageText(`<blockquote>✅ All referrals reset!</blockquote>`, { parse_mode: 'HTML' });
});

bot.action('cancel_reset_referrals', async (ctx) => {
  await ctx.answerCbQuery('❌ Cancelled');
  await ctx.editMessageText(`<blockquote>❌ Reset cancelled</blockquote>`, { parse_mode: 'HTML' });
});

// ============================================
// COMMANDS
// ============================================
bot.command('upgrade_plan', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply(`<blockquote>❌ Usage: /upgrade_plan [1-${db.plans.length}]</blockquote>`, { parse_mode: 'HTML' });
  const planIndex = parseInt(args[1]) - 1;
  if (isNaN(planIndex) || planIndex < 0 || planIndex >= db.plans.length) return ctx.reply(`<blockquote>❌ Invalid plan</blockquote>`, { parse_mode: 'HTML' });
  const plan = db.plans[planIndex];
  const userId = ctx.from.id;
  const balance = db.wallet.get(userId) || 0;
  if (balance < plan.price) return ctx.reply(`<blockquote>❌ Need $${plan.price - balance} more</blockquote>`, { parse_mode: 'HTML' });
  db.wallet.set(userId, balance - plan.price);
  const user = db.users.get(userId);
  user.plan = plan.name;
  db.users.set(userId, user);
  await ctx.reply(`<blockquote>✅ Upgraded to ${plan.name}!\n💰 Remaining: $${db.wallet.get(userId)}</blockquote>`, { parse_mode: 'HTML' });
});

// ============================================
// SCENE REGISTRATION
// ============================================
const stage = new Scenes.Stage([deployScene]);
bot.use(stage.middleware());

// ============================================
// CRON JOBS
// ============================================
cron.schedule('0 0 * * *', () => {
  console.log('🔄 Daily reset executed');
});

cron.schedule('0 */6 * * *', async () => {
  const backupDir = `./backups/auto_backup_${Date.now()}`;
  await fs.copy('./projects', backupDir);
  console.log('💾 Auto backup created');
});

// ============================================
// ERROR HANDLING
// ============================================
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply(`<blockquote>❌ Error: ${err.message}</blockquote>`, { parse_mode: 'HTML' });
});

// ============================================
// START BOT
// ============================================
console.log('🚀 Starting Premium Hosting Bot...');

bot.launch()
  .then(() => {
    console.log('✅ PREMIUM HOSTING ROBOT IS ONLINE!');
    console.log(`👤 Admins: ${ADMIN_IDS.join(', ')}`);
    console.log(`📢 Channel: ${CHANNEL_ID}`);
    console.log(`👥 Users: ${db.users.size}`);
    console.log(`📁 Projects: ${db.projects.size}`);
    console.log(`🔗 Referrals: ${db.referrals.size}`);
    console.log('\n🎯 Bot is ready! Send /start to test\n');
  })
  .catch((err) => {
    console.error('❌ Failed to launch:', err.message);
    process.exit(1);
  });

// ✅ KEEP PROCESS ALIVE
setInterval(() => {}, 60000);

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Stopping bot...');
  bot.stop('SIGINT');
  setTimeout(() => process.exit(0), 2000);
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Stopping bot...');
  bot.stop('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

module.exports = bot;
