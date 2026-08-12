require('dotenv').config();

module.exports = {
    token: process.env.BOT_TOKEN || '8190763429:AAEOqtHtckg81tztgLc8BEiBE98QFWeb4H4', 
    adminIds: (process.env.ADMIN_IDS || '7158115683').split(',').map(id => parseInt(id.trim())),
    announceChannel: process.env.ANNOUNCE_CHANNEL || '@MRANONIMOUS01',
    webUrl: process.env.WEB_URL || 'https://p-h.up.railway.app', 
    botUsername: process.env.BOT_USERNAME || '@PREMIUM_VPS_BOT_HOSTING_ROBOT',
    pointsPerServer: parseInt(process.env.POINTS_PER_SERVER) || 5,
    maxServers: parseInt(process.env.MAX_SERVERS) || 3,
    referralBonus: parseInt(process.env.REFERRAL_BONUS) || 3,
    dailyBonus: parseInt(process.env.DAILY_BONUS) || 2,
    maintenance: false,
    port: parseInt(process.env.PORT) || 3000
};
