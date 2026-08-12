const fs = require('fs');
const path = require('path');

class Database {
    constructor() {
        this.dataDir = './database';
        this.usersFile = path.join(this.dataDir, 'users.json');
        this.serversFile = path.join(this.dataDir, 'servers.json');
        this.ticketsFile = path.join(this.dataDir, 'tickets.json');
        this.promosFile = path.join(this.dataDir, 'promos.json');
        this.settingsFile = path.join(this.dataDir, 'settings.json');
        this.bannedFile = path.join(this.dataDir, 'banned.json');
        this.channelsFile = path.join(this.dataDir, 'channels.json');
        
        this.ensureDirectory();
        this.data = this.loadAll();
    }

    ensureDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    loadAll() {
        return {
            users: this.loadFile(this.usersFile, {}),
            servers: this.loadFile(this.serversFile, {}),
            tickets: this.loadFile(this.ticketsFile, {}),
            promos: this.loadFile(this.promosFile, {}),
            settings: this.loadFile(this.settingsFile, {}),
            banned: this.loadFile(this.bannedFile, []),
            channels: this.loadFile(this.channelsFile, [])
        };
    }

    loadFile(file, defaultData) {
        try {
            if (fs.existsSync(file)) {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            }
            return defaultData;
        } catch (error) {
            return defaultData;
        }
    }

    saveFile(file, data) {
        try {
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
        } catch (error) {}
    }

    saveAll() {
        this.saveFile(this.usersFile, this.data.users);
        this.saveFile(this.serversFile, this.data.servers);
        this.saveFile(this.ticketsFile, this.data.tickets);
        this.saveFile(this.promosFile, this.data.promos);
        this.saveFile(this.settingsFile, this.data.settings);
        this.saveFile(this.bannedFile, this.data.banned);
        this.saveFile(this.channelsFile, this.data.channels);
    }

    getUser(userId) {
        return this.data.users[userId] || null;
    }

    createUser(userId, username) {
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                id: userId,
                username: username || 'Unknown',
                points: 0,
                servers: [],
                referrals: [],
                referredBy: null,
                lastDaily: 0,
                createdAt: Date.now()
            };
            this.saveAll();
        }
        return this.data.users[userId];
    }

    updateUser(userId, data) {
        if (this.data.users[userId]) {
            this.data.users[userId] = { ...this.data.users[userId], ...data };
            this.saveAll();
            return true;
        }
        return false;
    }

    addPoints(userId, amount) {
        if (this.data.users[userId]) {
            this.data.users[userId].points += amount;
            this.saveAll();
            return true;
        }
        return false;
    }

    addReferral(userId, referredId) {
        if (this.data.users[userId]) {
            if (!this.data.users[userId].referrals) {
                this.data.users[userId].referrals = [];
            }
            this.data.users[userId].referrals.push(referredId);
            this.saveAll();
            return true;
        }
        return false;
    }

    addServer(userId, serverData) {
        const user = this.getUser(userId);
        if (!user) return null;
        
        if (user.servers.length >= 3) {
            return null;
        }

        const serverId = Math.random().toString(36).substring(7);
        const server = {
            id: serverId,
            ...serverData,
            status: 'stopped',
            created: Date.now()
        };
        
        user.servers.push(server);
        this.data.servers[serverId] = { userId, ...server };
        this.saveAll();
        
        // Create server directory
        const serverDir = path.join(__dirname, 'servers', serverId);
        if (!fs.existsSync(serverDir)) {
            fs.mkdirSync(serverDir, { recursive: true });
        }
        
        return serverId;
    }

    getServers(userId) {
        const user = this.getUser(userId);
        return user ? user.servers : [];
    }

    updateServer(userId, serverId, data) {
        const user = this.getUser(userId);
        if (!user) return false;
        
        const index = user.servers.findIndex(s => s.id === serverId);
        if (index === -1) return false;
        
        user.servers[index] = { ...user.servers[index], ...data };
        if (this.data.servers[serverId]) {
            this.data.servers[serverId] = { ...this.data.servers[serverId], ...data };
        }
        this.saveAll();
        return true;
    }

    deleteServer(userId, serverId) {
        const user = this.getUser(userId);
        if (!user) return false;
        
        user.servers = user.servers.filter(s => s.id !== serverId);
        delete this.data.servers[serverId];
        this.saveAll();
        return true;
    }

    createTicket(userId, subject, message) {
        const ticketId = Math.random().toString(36).substring(7).toUpperCase();
        this.data.tickets[ticketId] = {
            id: ticketId,
            userId,
            subject,
            message,
            status: 'open',
            replies: [],
            createdAt: Date.now()
        };
        this.saveAll();
        return ticketId;
    }

    getTickets(userId) {
        return Object.values(this.data.tickets).filter(t => t.userId === userId);
    }

    getAllTickets() {
        return Object.values(this.data.tickets);
    }

    resolveTicket(ticketId) {
        if (this.data.tickets[ticketId]) {
            this.data.tickets[ticketId].status = 'resolved';
            this.saveAll();
            return true;
        }
        return false;
    }

    createPromo(code, points) {
        this.data.promos[code] = {
            code,
            points,
            used: [],
            createdAt: Date.now()
        };
        this.saveAll();
        return true;
    }

    redeemPromo(code, userId) {
        if (this.data.promos[code]) {
            const promo = this.data.promos[code];
            if (promo.used.includes(userId)) {
                return 'already_used';
            }
            promo.used.push(userId);
            this.addPoints(userId, promo.points);
            this.saveAll();
            return true;
        }
        return false;
    }

    isBanned(userId) {
        return this.data.banned.includes(userId);
    }

    banUser(userId) {
        if (!this.data.banned.includes(userId)) {
            this.data.banned.push(userId);
            this.saveAll();
            return true;
        }
        return false;
    }

    unbanUser(userId) {
        this.data.banned = this.data.banned.filter(id => id !== userId);
        this.saveAll();
        return true;
    }

    getForceChannels() {
        return this.data.channels;
    }

    addChannel(channel) {
        if (!this.data.channels.includes(channel)) {
            this.data.channels.push(channel);
            this.saveAll();
            return true;
        }
        return false;
    }

    removeChannel(channel) {
        this.data.channels = this.data.channels.filter(c => c !== channel);
        this.saveAll();
        return true;
    }

    getTotalUsers() {
        return Object.keys(this.data.users).length;
    }

    getTotalServers() {
        return Object.keys(this.data.servers).length;
    }
}

module.exports = Database;
