const { Telegraf, session, Markup, Scenes } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const cron = require('node-cron');
const crypto = require('crypto');

// ============================================
// ᴄᴏɴғɪɢᴜʀᴀᴛɪᴏɴ
// ============================================
const BOT_TOKEN = '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4';
const ADMIN_IDS = ['7158115683'];
const SUPPORT_LINK = 'https://t.me/PREMIUM_BOTS_SUPPORT_GC';
const DONATE_LINK = 'https://t.me/PREMIUM_VPS_BOT_HOSTING_ROBOT?start=donate';
const WEB_BASE_URL = 'https://your-domain.com';
const CHANNEL_ID = '-1003842777722';

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ============================================
// ᴅᴀᴛᴀʙᴀsᴇ
// ============================================
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
    { name: 'Free', price: 0, limits: { bots: 1, websites: 1, storage: 100 }, features: ['1 Bᴏᴛ', '1 Wᴇʙsɪᴛᴇ', '100MB Sᴛᴏʀᴀɢᴇ', 'Bᴀsɪᴄ Sᴜᴘᴘᴏʀᴛ'] },
    { name: 'Premium', price: 10, limits: { bots: 5, websites: 3, storage: 500 }, features: ['5 Bᴏᴛs', '3 Wᴇʙsɪᴛᴇs', '500MB Sᴛᴏʀᴀɢᴇ', 'Pʀɪᴏʀɪᴛʏ Sᴜᴘᴘᴏʀᴛ'] },
    { name: 'Pro', price: 25, limits: { bots: 10, websites: 5, storage: 1000 }, features: ['10 Bᴏᴛs', '5 Wᴇʙsɪᴛᴇs', '1GB Sᴛᴏʀᴀɢᴇ', '24/7 Sᴜᴘᴘᴏʀᴛ'] },
    { name: 'Enterprise', price: 50, limits: { bots: 25, websites: 15, storage: 5000 }, features: ['25 Bᴏᴛs', '15 Wᴇʙsɪᴛᴇs', '5GB Sᴛᴏʀᴀɢᴇ', '24/7 Pʀɪᴏʀɪᴛʏ Sᴜᴘᴘᴏʀᴛ'] }
  ],
  coupons: new Map(),
  tickets: new Map(),
  transactions: new Map(),
  dailyClaims: new Map(),
  spins: new Map(),
  referrals: new Map(),
  referralCodes: new Map()
};

// ============================================
// ᴜᴛɪʟɪᴛʏ ғᴜɴᴄᴛɪᴏɴs
// ============================================
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

// ============================================
// ᴋᴇʏʙᴏᴀʀᴅs
// ============================================
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
// ✅ ᴅᴇᴘʟᴏʏ sᴄᴇɴᴇ - FIXED
// ============================================
const deployScene = new Scenes.BaseScene('deploy');

deployScene.enter((ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.deploy = {};
  ctx.reply(
    `<blockquote>📦 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴘʀᴏᴊᴇᴄᴛ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ!\n\nᴇɴᴛᴇʀ ᴀ ɴᴀᴍᴇ ғᴏʀ ʏᴏᴜʀ ᴘʀᴏᴊᴇᴄᴛ (ᴍᴀx 𝟷𝟶 ᴄʜᴀʀs):</blockquote>`,
    { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() }
  );
});

deployScene.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text === '🔙 ᴄᴀɴᴄᴇʟ') {
    await ctx.scene.leave();
    return ctx.reply('❌ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ ᴄᴀɴᴄᴇʟʟᴇᴅ.', mainKeyboard(ctx));
  }
  if (!ctx.session) ctx.session = {};
  if (!ctx.session.deploy) ctx.session.deploy = {};
  if (!ctx.session.deploy.name) {
    if (text.length > 10) {
      return ctx.reply(`<blockquote>❌ ɴᴀᴍᴇ ᴛᴏᴏ ʟᴏɴɢ! ᴍᴀx 𝟷𝟶 ᴄʜᴀʀᴀᴄᴛᴇʀs.</blockquote>`, { parse_mode: 'HTML' });
    }
    ctx.session.deploy.name = text;
    return ctx.reply(
      `<blockquote>📁 ᴘʀᴏᴊᴇᴄᴛ ɴᴀᴍᴇ: ${text}\n\nsᴇɴᴅ ʏᴏᴜʀ ᴘʀᴏᴊᴇᴄᴛ ғɪʟᴇs:\nsᴜᴘᴘᴏʀᴛᴇᴅ: .ᴢɪᴘ, .ᴘʏ, .ᴊs, .ʜᴛᴍʟ, .ᴄss, .ᴊsᴏɴ</blockquote>`,
      { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() }
    );
  }
});

deployScene.on('document', async (ctx) => {
  const file = ctx.message.document;
  const ext = path.extname(file.file_name).toLowerCase();
  const allowedExts = ['.zip', '.py', '.js', '.html', '.css', '.json'];
  
  if (!allowedExts.includes(ext)) {
    return ctx.reply(`<blockquote>❌ ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ғᴏʀᴍᴀᴛ. sᴇɴᴅ: ${allowedExts.join(', ')}</blockquote>`, { parse_mode: 'HTML' });
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
    return ctx.reply(`<blockquote>❌ ʙᴏᴛ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ (${planLimits.bots}) ғᴏʀ ${userPlan} ᴘʟᴀɴ.</blockquote>`, { parse_mode: 'HTML' });
  }
  
  if (projectCategory === 'website' && userProjects.filter(p => p.type === 'website').length >= planLimits.websites) {
    return ctx.reply(`<blockquote>❌ ᴡᴇʙsɪᴛᴇ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ (${planLimits.websites}) ғᴏʀ ${userPlan} ᴘʟᴀɴ.</blockquote>`, { parse_mode: 'HTML' });
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
    Markup.button.url('🎫 ᴄʟᴀɪᴍ sʟᴏᴛ', `https://t.me/PREMIUM_VPS_BOT_HOSTING_ROBOT`)
  ]);

  await ctx.telegram.sendMessage(
    CHANNEL_ID,
    `<blockquote>🚀 ɴᴇᴡ ᴘʀᴏᴊᴇᴄᴛ ᴅᴇᴘʟᴏʏᴇᴅ!\n📁 ɴᴀᴍᴇ: ${project.name}\n👤 ᴜsᴇʀ: ${ctx.from.first_name}\n🕐 ᴛɪᴍᴇ: ${formatDate()}\n📊 ᴛʏᴘᴇ: ${projectCategory.toUpperCase()}\n🔗 ᴜʀʟ: ${project.url || 'N/A'}\n\nᴄʟɪᴄᴋ ʙᴇʟᴏᴡ ᴛᴏ ᴄʟᴀɪᴍ!</blockquote>`,
    { parse_mode: 'HTML', ...claimButton }
  );

  await ctx.reply(
    `<blockquote>✅ ᴘʀᴏᴊᴇᴄᴛ ᴅᴇᴘʟᴏʏᴇᴅ!\n📁 ɪᴅ: ${projectId}\n📂 ɴᴀᴍᴇ: ${project.name}\n🔗 ᴜʀʟ: ${project.url || 'Internal'}</blockquote>`,
    { parse_mode: 'HTML' }
  );
  await ctx.scene.leave();
});

// ============================================
// ✅ ʀᴇɢɪsᴛᴇʀ sᴄᴇɴᴇ - MUST BE HERE
// ============================================
const stage = new Scenes.Stage([deployScene]);
bot.use(stage.middleware());

// ============================================
// ✅ ᴍᴀɪɴ ᴛᴇxᴛ ʜᴀɴᴅʟᴇʀ ᴡɪᴛʜ sᴡɪᴛᴄʜ ᴄᴀsᴇ
// ============================================
bot.on('text', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message.text;
  
  switch(text) {
    
    // ==========================================
    // sᴛᴀʀᴛ ᴄᴏᴍᴍᴀɴᴅ
    // ==========================================
    case '/start':
    case '/Start':
    case '/START': {
      try {
        const userId = ctx.from.id;
        const args = text.split(' ');
        
        // ʜᴀɴᴅʟᴇ ʀᴇғᴇʀʀᴀʟ
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
              await ctx.telegram.sendMessage(referrerId, `<blockquote>🎉 ɴᴇᴡ ʀᴇғᴇʀʀᴀʟ!\n👤 ${ctx.from.first_name}\n💰 +$${referralBonus}</blockquote>`, { parse_mode: 'HTML' });
            } catch (e) {}
            await ctx.reply(`<blockquote>🎉 ᴡᴇʟᴄᴏᴍᴇ! ʏᴏᴜ ɢᴏᴛ $${joinBonus} ʙᴏɴᴜs!</blockquote>`, { parse_mode: 'HTML' });
          }
        }
        
        // sᴀᴠᴇ ᴜsᴇʀ
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
        
        // ᴄʜᴇᴄᴋ ғᴏʀᴄᴇ ᴊᴏɪɴ
        if (db.settings.forceJoin) {
          try {
            const member = await ctx.telegram.getChatMember(db.settings.forceJoin, userId);
            if (member.status === 'left') {
              return ctx.reply(`<blockquote>❤️‍🩹 ᴘʟᴇᴀsᴇ ᴊᴏɪɴ ᴏᴜʀ ᴄʜᴀɴɴᴇʟ ᴛᴏ ᴄᴏɴᴛɪɴᴜᴇ!</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('📢 ᴊᴏɪɴ', `https://t.me/${db.settings.forceJoin.replace('@', '')}`)]) });
            }
          } catch (e) {}
        }
        
        // ᴄʜᴇᴄᴋ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ
        if (db.settings.maintenance && !isAdmin(ctx)) {
          return ctx.reply(`<blockquote>🔧 ᴜɴᴅᴇʀ ᴍᴀɪɴᴛᴇɴᴀɴᴄᴇ</blockquote>`, { parse_mode: 'HTML' });
        }
        
        const balance = db.wallet.get(userId) || 0;
        const welcome = `<blockquote>❤️‍🔥 ᴡᴇʟᴄᴏᴍᴇ ${ctx.from.first_name} ᴛᴏ ᴘʀᴇᴍɪᴜᴍ ʜᴏsᴛɪɴɢ ʀᴏʙᴏᴛ!\n\n👤 ɪᴅ: ${userId}\n💰 ʙᴀʟᴀɴᴄᴇ: $${balance}\n\nʜᴏsᴛ ʏᴏᴜʀ:\n• ᴛᴇʟᴇɢʀᴀᴍ ʙᴏᴛs\n• ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs\n• ᴡᴇʙsɪᴛᴇs\n\nᴄʟᴀɪᴍ ᴅᴀɪʟʏ ʙᴏɴᴜs, sᴘɪɴ sʟᴏᴛs, ʀᴇғᴇʀ ᴀɴᴅ ᴇᴀʀɴ!\n\n🌹ᴛʜᴀɴᴋs ғᴏʀ ʙᴇɪɴɢ ᴘᴀʀᴛ ᴏғ ᴛʜᴇ ᴄᴏᴍᴍᴜɴɪᴛʏ🌹</blockquote>`;
        
        if (db.settings.menuImage) {
          await ctx.replyWithPhoto(db.settings.menuImage, { caption: welcome, parse_mode: 'HTML' });
        } else if (db.settings.menuVideo) {
          await ctx.replyWithVideo(db.settings.menuVideo, { caption: welcome, parse_mode: 'HTML' });
        } else {
          await ctx.reply(welcome, { parse_mode: 'HTML' });
        }
        
        await ctx.reply('📋 ᴍᴀɪɴ ᴍᴇɴᴜ:', mainKeyboard(ctx));
        
      } catch (error) {
        console.error('sᴛᴀʀᴛ ᴄᴏᴍᴍᴀɴᴅ ᴇʀʀᴏʀ:', error);
        await ctx.reply(`<blockquote>❌ ᴇʀʀᴏʀ: ${error.message}</blockquote>`, { parse_mode: 'HTML' });
      }
      break;
    }
    
    // ==========================================
    // ᴜsᴇʀ ʙᴜᴛᴛᴏɴs
    // ==========================================
    case '🤖 ᴍʏ ʙᴏᴛs': {
      const userProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id && (p.type === 'telegram' || p.type === 'whatsapp'));
      if (userProjects.length === 0) return ctx.reply(`<blockquote>🤖 ɴᴏ ʙᴏᴛs ғᴏᴜɴᴅ.</blockquote>`, { parse_mode: 'HTML' });
      const list = userProjects.map((p, i) => `${i+1}. 📁 ${p.name}\n   ᴛʏᴘᴇ: ${p.type}\n   sᴛᴀᴛᴜs: ${p.status}\n   ɪᴅ: ${p.id}`).join('\n\n');
      await ctx.reply(`<blockquote>🤖 ʏᴏᴜʀ ʙᴏᴛs\n━━━━━━━━━━━━━━━━━━━\n\n${list}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📱 ᴍʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs': {
      const whatsappBots = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id && p.type === 'whatsapp');
      if (whatsappBots.length === 0) return ctx.reply(`<blockquote>📱 ɴᴏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs ғᴏᴜɴᴅ.</blockquote>`, { parse_mode: 'HTML' });
      const list = whatsappBots.map((p, i) => `${i+1}. 📱 ${p.name}\n   sᴛᴀᴛᴜs: ${p.status}\n   ɪᴅ: ${p.id}`).join('\n\n');
      await ctx.reply(`<blockquote>📱 ʏᴏᴜʀ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛs\n━━━━━━━━━━━━━━━━━━━\n\n${list}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🌐 ᴍʏ ᴡᴇʙsɪᴛᴇs': {
      const webProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id && p.type === 'website');
      if (webProjects.length === 0) return ctx.reply(`<blockquote>🌐 ɴᴏ ᴡᴇʙsɪᴛᴇs ғᴏᴜɴᴅ.</blockquote>`, { parse_mode: 'HTML' });
      const list = webProjects.map((p, i) => `${i+1}. 🌐 ${p.name}\n   🔗 ${p.url || 'N/A'}\n   sᴛᴀᴛᴜs: ${p.status}`).join('\n\n');
      await ctx.reply(`<blockquote>🌐 ʏᴏᴜʀ ᴡᴇʙsɪᴛᴇs\n━━━━━━━━━━━━━━━━━━━\n\n${list}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🚀 ᴅᴇᴘʟᴏʏ ᴛɢ ʙᴏᴛ':
    case '💬 ᴅᴇᴘʟᴏʏ ᴡʜᴀᴛsᴀᴘᴘ ʙᴏᴛ':
    case '🌍 ᴅᴇᴘʟᴏʏ ᴡᴇʙsɪᴛᴇ': {
      try {
        await ctx.scene.enter('deploy');
      } catch (error) {
        console.error('sᴄᴇɴᴇ ᴇʀʀᴏʀ:', error);
        await ctx.reply(`<blockquote>❌ ᴇʀʀᴏʀ ᴇɴᴛᴇʀɪɴɢ ᴅᴇᴘʟᴏʏ sᴄᴇɴᴇ. ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ.</blockquote>`, { parse_mode: 'HTML' });
      }
      break;
    }
    
    case '🎯 ᴅᴀɪʟʏ ᴄʟᴀɪᴍ': {
      const userId = ctx.from.id;
      const now = Date.now();
      const lastClaim = db.dailyClaims.get(userId) || 0;
      if (now - lastClaim < 86400000) {
        const remaining = Math.ceil((86400000 - (now - lastClaim)) / 3600000);
        return ctx.reply(`<blockquote>⏳ ᴀʟʀᴇᴀᴅʏ ᴄʟᴀɪᴍᴇᴅ ᴛᴏᴅᴀʏ! ɴᴇxᴛ ɪɴ ${remaining} ʜᴏᴜʀs</blockquote>`, { parse_mode: 'HTML' });
      }
      const reward = db.settings.dailyReward || 10;
      const current = db.wallet.get(userId) || 0;
      db.wallet.set(userId, current + reward);
      db.dailyClaims.set(userId, now);
      await ctx.reply(`<blockquote>🎯 ᴅᴀɪʟʏ ᴄʟᴀɪᴍ!\n💰 +$${reward}\n📊 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ: $${current + reward}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎰 sᴘɪɴ': {
      const userId = ctx.from.id;
      const now = Date.now();
      const lastSpin = db.spins.get(userId) || 0;
      if (now - lastSpin < 3600000) {
        const remaining = Math.ceil((3600000 - (now - lastSpin)) / 60000);
        return ctx.reply(`<blockquote>⏳ ᴡᴀɪᴛ ${remaining} ᴍɪɴᴜᴛᴇs</blockquote>`, { parse_mode: 'HTML' });
      }
      const rewards = db.settings.spinRewards || [0, 5, 10, 25, 50, 100];
      const reward = rewards[Math.floor(Math.random() * rewards.length)];
      const current = db.wallet.get(userId) || 0;
      db.wallet.set(userId, current + reward);
      db.spins.set(userId, now);
      await ctx.reply(`<blockquote>🎰 sᴘɪɴ!\nʏᴏᴜ ᴡᴏɴ $${reward}!\n💰 ɴᴇᴡ ʙᴀʟᴀɴᴄᴇ: $${current + reward}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '⬆️ ᴜᴘɢʀᴀᴅᴇ ᴘʟᴀɴ': {
      const currentPlan = db.users.get(ctx.from.id)?.plan || 'Free';
      const plans = db.plans.map((p, i) => `${i+1}. ${p.name} - $${p.price}\n   📊 ${p.features.join(', ')}`).join('\n\n');
      await ctx.reply(`<blockquote>⬆️ ᴜᴘɢʀᴀᴅᴇ ᴘʟᴀɴ\nᴄᴜʀʀᴇɴᴛ: ${currentPlan}\n━━━━━━━━━━━━━━━━━━━\n\n${plans}\n\nsᴇɴᴅ /upgrade_plan [ɴᴜᴍʙᴇʀ]\nᴇxᴀᴍᴘʟᴇ: /upgrade_plan 2</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    // ==========================================
    // ✅ ғɪxᴇᴅ ᴜᴘɢʀᴀᴅᴇ ᴄᴏᴍᴍᴀɴᴅ - WORKS NOW!
    // ==========================================
    case '/upgrade_plan': {
      const args = text.split(' ');
      if (args.length < 2) {
        const plans = db.plans.map((p, i) => `${i+1}. ${p.name} - $${p.price}`).join('\n');
        return ctx.reply(`<blockquote>❌ ᴜsᴀɢᴇ: /upgrade_plan [ɴᴜᴍʙᴇʀ]\n\nᴀᴠᴀɪʟᴀʙʟᴇ ᴘʟᴀɴs:\n${plans}</blockquote>`, { parse_mode: 'HTML' });
      }
      const planIndex = parseInt(args[1]) - 1;
      if (isNaN(planIndex) || planIndex < 0 || planIndex >= db.plans.length) {
        return ctx.reply(`<blockquote>❌ ɪɴᴠᴀʟɪᴅ ᴘʟᴀɴ ɴᴜᴍʙᴇʀ! ᴜsᴇ 1-${db.plans.length}</blockquote>`, { parse_mode: 'HTML' });
      }
      const plan = db.plans[planIndex];
      const userId = ctx.from.id;
      const balance = db.wallet.get(userId) || 0;
      
      if (balance < plan.price) {
        return ctx.reply(`<blockquote>❌ ɴᴇᴇᴅ $${plan.price - balance} ᴍᴏʀᴇ ᴛᴏ ᴜᴘɢʀᴀᴅᴇ ᴛᴏ ${plan.name}!\n💰 ʏᴏᴜʀ ʙᴀʟᴀɴᴄᴇ: $${balance}</blockquote>`, { parse_mode: 'HTML' });
      }
      
      db.wallet.set(userId, balance - plan.price);
      const user = db.users.get(userId);
      user.plan = plan.name;
      db.users.set(userId, user);
      
      await ctx.reply(`<blockquote>✅ sᴜᴄᴄᴇssғᴜʟʟʏ ᴜᴘɢʀᴀᴅᴇᴅ ᴛᴏ ${plan.name} ᴘʟᴀɴ!\n💰 ʀᴇᴍᴀɪɴɪɴɢ ʙᴀʟᴀɴᴄᴇ: $${db.wallet.get(userId)}\n\n✨ ɴᴇᴡ ғᴇᴀᴛᴜʀᴇs:\n${plan.features.join('\n')}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    // ==========================================
    // ᴏᴛʜᴇʀ ᴄᴏᴍᴍᴀɴᴅs...
    // ==========================================
    case '📋 ᴘʟᴀɴs': {
      const plans = db.plans.map((p) => `📋 ${p.name}\n   💰 $${p.price}\n   ✨ ${p.features.join(', ')}`).join('\n\n');
      await ctx.reply(`<blockquote>💰 ᴀᴠᴀɪʟᴀʙʟᴇ ᴘʟᴀɴs\n━━━━━━━━━━━━━━━━━━━\n\n${plans}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📊 ᴍʏ ᴘʟᴀɴ': {
      const user = db.users.get(ctx.from.id);
      const plan = user?.plan || 'Free';
      const planDetails = db.plans.find(p => p.name === plan) || db.plans[0];
      const userProjects = Array.from(db.projects.values()).filter(p => p.userId === ctx.from.id);
      await ctx.reply(`<blockquote>📊 ʏᴏᴜʀ ᴘʟᴀɴ\n━━━━━━━━━━━━━━━━━━━\nᴘʟᴀɴ: ${plan}\nᴘʀɪᴄᴇ: $${planDetails.price}\nғᴇᴀᴛᴜʀᴇs: ${planDetails.features.join(', ')}\nᴘʀᴏᴊᴇᴄᴛs: ${userProjects.length}\nᴡᴀʟʟᴇᴛ: $${db.wallet.get(ctx.from.id) || 0}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '👛 ᴍʏ ᴡᴀʟʟᴇᴛ': {
      const balance = db.wallet.get(ctx.from.id) || 0;
      await ctx.reply(`<blockquote>👛 ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ\n━━━━━━━━━━━━━━━━━━━\n💰 ʙᴀʟᴀɴᴄᴇ: $${balance}</blockquote>`, { parse_mode: 'HTML' });
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
      await ctx.reply(`<blockquote>🔗 ʀᴇғᴇʀʀᴀʟ\n━━━━━━━━━━━━━━━━━━━\nᴄᴏᴅᴇ: <code>${referralCode}</code>\nʀᴇғᴇʀʀᴀʟs: ${referredUsers}\nʙᴏɴᴜs: $${db.settings.referralBonus}\n\nsʜᴀʀᴇ: ${inviteLink}</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('📤 sʜᴀʀᴇ', `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=Join%20this%20awesome%20bot!`), Markup.button.copytext('📋 ᴄᴏᴘʏ', referralCode)]) });
      break;
    }
    
    case '📊 ʀᴇғᴇʀʀᴀʟ sᴛᴀᴛs': {
      const userId = ctx.from.id;
      const referredUsers = Array.from(db.referrals.values()).filter(r => r.referrerId === userId);
      const totalEarned = referredUsers.reduce((sum, r) => sum + (r.bonusEarned || 0), 0);
      if (referredUsers.length === 0) return ctx.reply(`<blockquote>📊 ɴᴏ ʀᴇғᴇʀʀᴀʟs ʏᴇᴛ!</blockquote>`, { parse_mode: 'HTML' });
      const userList = referredUsers.map((r, i) => `${i+1}. 👤 ${r.userName || r.userId}\n   💰 $${r.bonusEarned || 0}`).join('\n\n');
      await ctx.reply(`<blockquote>📊 ʀᴇғᴇʀʀᴀʟ sᴛᴀᴛs\n━━━━━━━━━━━━━━━━━━━\nᴛᴏᴛᴀʟ: ${referredUsers.length}\nᴇᴀʀɴᴇᴅ: $${totalEarned}\n\n${userList}</blockquote>`, { parse_mode: 'HTML' });
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
      if (sorted.length === 0) return ctx.reply(`<blockquote>🏆 ɴᴏ ʀᴇғᴇʀʀᴀʟs ʏᴇᴛ!</blockquote>`, { parse_mode: 'HTML' });
      const leaderboard = sorted.map(([userId, data], i) => {
        const user = db.users.get(userId);
        const name = user ? user.first_name : userId;
        return `${i+1}. 🥇 ${name}\n   👥 ${data.count} ʀᴇғᴇʀʀᴀʟs\n   💰 $${data.total} ᴇᴀʀɴᴇᴅ`;
      }).join('\n\n');
      await ctx.reply(`<blockquote>🏆 ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ\n━━━━━━━━━━━━━━━━━━━\n${leaderboard}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '🎫 ᴛɪᴄᴋᴇᴛ': {
      ctx.session.adminAction = 'ticket';
      ctx.reply(`<blockquote>🎫 ᴄʀᴇᴀᴛᴇ ᴛɪᴄᴋᴇᴛ\nᴅᴇsᴄʀɪʙᴇ ʏᴏᴜʀ ɪssᴜᴇ:</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🎟️ ᴄᴏᴜᴘᴏɴ': {
      ctx.session.adminAction = 'redeem_coupon';
      ctx.reply(`<blockquote>🎟️ sᴇɴᴅ ᴄᴏᴜᴘᴏɴ ᴄᴏᴅᴇ:</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '📢 ᴜᴘᴅᴀᴛᴇ ᴄʜᴀɴɴᴇʟ': {
      await ctx.reply(`<blockquote>📢 ᴊᴏɪɴ ᴜᴘᴅᴀᴛᴇ ᴄʜᴀɴɴᴇʟ\n🔗 https://t.me/PREMIUM_BOT_HOSTING_UPDATE</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('📢 ᴊᴏɪɴ', 'https://t.me/PREMIUM_BOT_HOSTING_UPDATE')]) });
      break;
    }
    
    case '📞 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ': {
      await ctx.reply(`<blockquote>📞 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ\n💬 ${SUPPORT_LINK}</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('💬 ᴄʜᴀᴛ', SUPPORT_LINK)]) });
      break;
    }
    
    case '💝 ᴅᴏɴᴀᴛᴇ': {
      await ctx.reply(`<blockquote>💝 sᴜᴘᴘᴏʀᴛ ᴅᴇᴠᴇʟᴏᴘᴍᴇɴᴛ\n⭐ ᴅᴏɴᴀᴛᴇ ᴛᴏ sᴜᴘᴘᴏʀᴛ ᴜs!\n\nᴛʜᴀɴᴋ ʏᴏᴜ! ❤️</blockquote>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([Markup.button.url('⭐ ᴅᴏɴᴀᴛᴇ', DONATE_LINK)]) });
      break;
    }
    
    case '⚙️ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ': {
      if (!isAdmin(ctx)) return ctx.reply(`<blockquote>❌ ᴜɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ</blockquote>`, { parse_mode: 'HTML' });
      await ctx.reply('⚙️ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ', adminKeyboard);
      break;
    }
    
    case '🔙 ʙᴀᴄᴋ ᴛᴏ ᴍᴀɪɴ': {
      ctx.reply('🔙 ᴍᴀɪɴ ᴍᴇɴᴜ', mainKeyboard(ctx));
      break;
    }
    
    // ==========================================
    // ᴀᴅᴍɪɴ ʙᴜᴛᴛᴏɴs - sʜᴏʀᴛᴇɴᴇᴅ ғᴏʀ ʙʀᴇᴠɪᴛʏ
    // ==========================================
    case '👥 ᴀʟʟ ᴜsᴇʀs': {
      if (!isAdmin(ctx)) return;
      const users = Array.from(db.users.values());
      const list = users.map((u, i) => `${i+1}. 👤 ${u.first_name}\n   ᴘʟᴀɴ: ${u.plan || 'Free'}\n   ᴡᴀʟʟᴇᴛ: $${db.wallet.get(u.id) || 0}`).join('\n\n');
      await ctx.reply(`<blockquote>📊 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${users.length}\n\n${list || 'ɴᴏ ᴜsᴇʀs'}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    case '📊 sᴛᴀᴛs': {
      if (!isAdmin(ctx)) return;
      await ctx.reply(`<blockquote>📊 ʙᴏᴛ sᴛᴀᴛs\n━━━━━━━━━━━━━━━━━━━\n👥 ᴜsᴇʀs: ${db.users.size}\n📁 ᴘʀᴏᴊᴇᴄᴛs: ${db.projects.size}\n✅ ʀᴜɴɴɪɴɢ: ${Array.from(db.projects.values()).filter(p => p.status === 'running').length}\n💰 ᴡᴀʟʟᴇᴛ: $${Array.from(db.wallet.values()).reduce((a, b) => a + b, 0)}\n🔗 ʀᴇғᴇʀʀᴀʟs: ${db.referrals.size}\n📅 ${formatDate()}</blockquote>`, { parse_mode: 'HTML' });
      break;
    }
    
    // ᴀᴅᴍɪɴ ᴀᴄᴛɪᴏɴs
    case '🎁 ᴀᴅᴅ ᴘᴏɪɴᴛs': {
      if (!isAdmin(ctx)) return;
      ctx.session.adminAction = 'add_points';
      ctx.reply(`<blockquote>ғᴏʀᴍᴀᴛ: ᴜsᴇʀ_ɪᴅ ᴘᴏɪɴᴛs\nᴇxᴀᴍᴘʟᴇ: 123456789 100</blockquote>`, { parse_mode: 'HTML', ...Markup.keyboard(['🔙 ᴄᴀɴᴄᴇʟ']).resize() });
      break;
    }
    
    case '🔙 ʙᴀᴄᴋ ᴛᴏ ᴀᴅᴍɪɴ': {
      if (!isAdmin(ctx)) return;
      await ctx.reply('🔙 ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ', adminKeyboard);
      break;
    }
    
    // ==========================================
    // ᴅᴇғᴀᴜʟᴛ - ʜᴀɴᴅʟᴇ ᴀᴅᴍɪɴ ᴀᴄᴛɪᴏɴs
    // ==========================================
    default: {
      if (ctx.session.adminAction) {
        const action = ctx.session.adminAction;
        
        switch(action) {
          case 'add_points': {
            const [targetId, points] = text.split(' ');
            if (!targetId || !points || isNaN(points)) return ctx.reply(`<blockquote>❌ ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ</blockquote>`, { parse_mode: 'HTML' });
            const current = db.wallet.get(targetId) || 0;
            db.wallet.set(targetId, current + parseInt(points));
            await ctx.reply(`<blockquote>✅ ᴀᴅᴅᴇᴅ ${points} ᴘᴏɪɴᴛs ᴛᴏ ${targetId}</blockquote>`, { parse_mode: 'HTML' });
            ctx.session.adminAction = null;
            break;
          }
          case 'ticket': {
            const ticketId = generateId();
            db.tickets.set(ticketId, { id: ticketId, userId: ctx.from.id, message: text, createdAt: Date.now(), status: 'open' });
            await ctx.reply(`<blockquote>✅ ᴛɪᴄᴋᴇᴛ #${ticketId} ᴄʀᴇᴀᴛᴇᴅ!</blockquote>`, { parse_mode: 'HTML' });
            for (const adminId of ADMIN_IDS) {
              await ctx.telegram.sendMessage(adminId, `<blockquote>🎫 ɴᴇᴡ ᴛɪᴄᴋᴇᴛ #${ticketId}\nғʀᴏᴍ: ${ctx.from.first_name}\n${text}</blockquote>`, { parse_mode: 'HTML' });
            }
            ctx.session.adminAction = null;
            break;
          }
          case 'redeem_coupon': {
            const coupon = db.coupons.get(text);
            if (!coupon) return ctx.reply(`<blockquote>❌ ɪɴᴠᴀʟɪᴅ ᴄᴏᴜᴘᴏɴ</blockquote>`, { parse_mode: 'HTML' });
            if (coupon.used >= coupon.limit) return ctx.reply(`<blockquote>❌ ᴄᴏᴜᴘᴏɴ ᴜsᴇᴅ ᴜᴘ</blockquote>`, { parse_mode: 'HTML' });
            const userId = ctx.from.id;
            const current = db.wallet.get(userId) || 0;
            const bonus = Math.floor(current * (coupon.discount / 100));
            db.wallet.set(userId, current + bonus);
            coupon.used++;
            db.coupons.set(text, coupon);
            await ctx.reply(`<blockquote>✅ ᴄᴏᴜᴘᴏɴ ʀᴇᴅᴇᴇᴍᴇᴅ! +$${bonus}</blockquote>`, { parse_mode: 'HTML' });
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
      break;
    }
  }
});

// ============================================
// ᴍᴇᴅɪᴀ ʜᴀɴᴅʟᴇʀs
// ============================================
bot.on(['photo', 'video'], async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!ctx.session) ctx.session = {};
  
  const action = ctx.session.adminAction;
  if (action === 'set_menu_image' && ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    db.settings.menuImage = photo.file_id;
    await ctx.reply(`<blockquote>✅ ᴍᴇɴᴜ ɪᴍᴀɢᴇ sᴇᴛ</blockquote>`, { parse_mode: 'HTML' });
    ctx.session.adminAction = null;
  } else if (action === 'set_menu_video' && ctx.message.video) {
    db.settings.menuVideo = ctx.message.video.file_id;
    await ctx.reply(`<blockquote>✅ ᴍᴇɴᴜ ᴠɪᴅᴇᴏ sᴇᴛ</blockquote>`, { parse_mode: 'HTML' });
    ctx.session.adminAction = null;
  }
});

// ============================================
// ᴀᴄᴛɪᴏɴ ʜᴀɴᴅʟᴇʀs
// ============================================
bot.action('confirm_reset_referrals', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ ᴜɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ');
  db.referrals.clear();
  db.referralCodes.clear();
  await ctx.answerCbQuery('✅ ʀᴇsᴇᴛ ᴀʟʟ ʀᴇғᴇʀʀᴀʟs!');
  await ctx.editMessageText(`<blockquote>✅ ᴀʟʟ ʀᴇғᴇʀʀᴀʟs ʀᴇsᴇᴛ!</blockquote>`, { parse_mode: 'HTML' });
});

bot.action('cancel_reset_referrals', async (ctx) => {
  await ctx.answerCbQuery('❌ ᴄᴀɴᴄᴇʟʟᴇᴅ');
  await ctx.editMessageText(`<blockquote>❌ ʀᴇsᴇᴛ ᴄᴀɴᴄᴇʟʟᴇᴅ</blockquote>`, { parse_mode: 'HTML' });
});

// ============================================
// ᴄʀᴏɴ ᴊᴏʙs
// ============================================
cron.schedule('0 0 * * *', () => {
  console.log('🔄 ᴅᴀɪʟʏ ʀᴇsᴇᴛ ᴇxᴇᴄᴜᴛᴇᴅ');
});

cron.schedule('0 */6 * * *', async () => {
  const backupDir = `./backups/auto_backup_${Date.now()}`;
  await fs.copy('./projects', backupDir);
  console.log('💾 ᴀᴜᴛᴏ ʙᴀᴄᴋᴜᴘ ᴄʀᴇᴀᴛᴇᴅ');
});

// ============================================
// ᴇʀʀᴏʀ ʜᴀɴᴅʟɪɴɢ
// ============================================
bot.catch((err, ctx) => {
  console.error('ʙᴏᴛ ᴇʀʀᴏʀ:', err);
  ctx.reply(`<blockquote>❌ ᴇʀʀᴏʀ: ${err.message}</blockquote>`, { parse_mode: 'HTML' });
});

// ============================================
// ✅ sᴛᴀʀᴛ ʙᴏᴛ
// ============================================
console.log('🚀 sᴛᴀʀᴛɪɴɢ ᴘʀᴇᴍɪᴜᴍ ʜᴏsᴛɪɴɢ ʙᴏᴛ...');

bot.launch()
  .then(() => {
    console.log('✅ ᴘʀᴇᴍɪᴜᴍ ʜᴏsᴛɪɴɢ ʀᴏʙᴏᴛ ɪs ᴏɴʟɪɴᴇ!');
    console.log(`👤 ᴀᴅᴍɪɴs: ${ADMIN_IDS.join(', ')}`);
    console.log(`📢 ᴄʜᴀɴɴᴇʟ: ${CHANNEL_ID}`);
    console.log(`👥 ᴜsᴇʀs: ${db.users.size}`);
    console.log(`📁 ᴘʀᴏᴊᴇᴄᴛs: ${db.projects.size}`);
    console.log(`🔗 ʀᴇғᴇʀʀᴀʟs: ${db.referrals.size}`);
    console.log('\n🎯 ʙᴏᴛ ɪs ʀᴇᴀᴅʏ! sᴇɴᴅ /start ᴛᴏ ᴛᴇsᴛ\n');
  })
  .catch((err) => {
    console.error('❌ ғᴀɪʟᴇᴅ ᴛᴏ ʟᴀᴜɴᴄʜ:', err.message);
    process.exit(1);
  });

// ✅ ᴋᴇᴇᴘ ᴘʀᴏᴄᴇss ᴀʟɪᴠᴇ
setInterval(() => {}, 60000);

// ɢʀᴀᴄᴇғᴜʟ sʜᴜᴛᴅᴏᴡɴ
process.once('SIGINT', () => {
  console.log('\n🛑 sᴛᴏᴘᴘɪɴɢ ʙᴏᴛ...');
  bot.stop('SIGINT');
  setTimeout(() => process.exit(0), 2000);
});

process.once('SIGTERM', () => {
  console.log('\n🛑 sᴛᴏᴘᴘɪɴɢ ʙᴏᴛ...');
  bot.stop('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
});

process.on('uncaughtException', (err) => {
  console.error('❌ ᴜɴᴄᴀᴜɢʜᴛ ᴇxᴄᴇᴘᴛɪᴏɴ:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ ᴜɴʜᴀɴᴅʟᴇᴅ ʀᴇᴊᴇᴄᴛɪᴏɴ:', reason);
});

module.exports = bot;
