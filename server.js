const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const multer = require('multer');
const archiver = require('archiver');
const mime = require('mime-types');
const { exec, spawn } = require('child_process');
const config = require('./config');
const Database = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const db = new Database();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================
// FILE UPLOAD CONFIG
// ============================================
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const serverId = req.params.serverId;
        const serverDir = path.join(__dirname, 'servers', serverId);
        await fs.ensureDir(serverDir);
        cb(null, serverDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ============================================
// REAL SYSTEM STATS
// ============================================
function getSystemStats() {
    try {
        const os = require('os');
        const cpus = os.cpus();
        const totalCpu = cpus.reduce((acc, cpu) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b);
            const idle = cpu.times.idle;
            return acc + ((total - idle) / total * 100);
        }, 0);
        const cpuUsage = (totalCpu / cpus.length).toFixed(1);

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        return {
            cpu: cpuUsage,
            ram: Math.round(usedMem / 1024 / 1024),
            ramTotal: Math.round(totalMem / 1024 / 1024),
            disk: getDiskUsage(),
            uptime: os.uptime(),
            platform: os.platform(),
            hostname: os.hostname()
        };
    } catch (error) {
        return { cpu: 0, ram: 0, ramTotal: 0, disk: { total: 0, used: 0, free: 0, percentage: 0 }, uptime: 0 };
    }
}

function getDiskUsage() {
    try {
        if (process.platform === 'win32') {
            const result = require('child_process').execSync('wmic logicaldisk get size,freespace').toString();
            const lines = result.split('\n').filter(line => line.trim() && !line.includes('Size'));
            let total = 0, free = 0;
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    free += parseInt(parts[0]) || 0;
                    total += parseInt(parts[1]) || 0;
                }
            }
            return {
                total: Math.round(total / 1024 / 1024 / 1024),
                used: Math.round((total - free) / 1024 / 1024 / 1024),
                free: Math.round(free / 1024 / 1024 / 1024),
                percentage: total > 0 ? Math.round(((total - free) / total) * 100) : 0
            };
        } else {
            const result = require('child_process').execSync('df -k /').toString();
            const lines = result.split('\n');
            const data = lines[1].trim().split(/\s+/);
            const total = parseInt(data[1]) / 1024 / 1024;
            const used = parseInt(data[2]) / 1024 / 1024;
            return {
                total: Math.round(total),
                used: Math.round(used),
                free: Math.round(total - used),
                percentage: Math.round((used / total) * 100)
            };
        }
    } catch (error) {
        return { total: 0, used: 0, free: 0, percentage: 0 };
    }
}

// ============================================
// REAL SERVER MANAGEMENT
// ============================================
function getServerFiles(serverId, subPath = '') {
    const serverDir = path.join(__dirname, 'servers', serverId, subPath);
    if (!fs.existsSync(serverDir)) {
        fs.ensureDirSync(serverDir);
        return [];
    }

    const items = fs.readdirSync(serverDir);
    const files = [];
    for (const item of items) {
        const fullPath = path.join(serverDir, item);
        const stat = fs.statSync(fullPath);
        files.push({
            name: item,
            type: stat.isDirectory() ? 'folder' : 'file',
            size: stat.isDirectory() ? '-' : (stat.size / 1024).toFixed(1) + ' KB',
            path: path.join(subPath, item),
            modified: stat.mtime,
            isDirectory: stat.isDirectory()
        });
    }
    return files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    });
}

function getServerLogs(serverId) {
    const logFile = path.join(__dirname, 'servers', serverId, 'logs.txt');
    if (!fs.existsSync(logFile)) {
        return [{ time: new Date().toLocaleTimeString(), type: 'info', msg: '🟢 Server created' }];
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.map(line => {
        try { return JSON.parse(line); } 
        catch { return { time: new Date().toLocaleTimeString(), type: 'info', msg: line }; }
    });
}

function getServerProcess(serverId) {
    const pidFile = path.join(__dirname, 'servers', serverId, 'pid.txt');
    if (fs.existsSync(pidFile)) {
        try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
            process.kill(pid, 0);
            return { pid, running: true };
        } catch {
            return { pid: null, running: false };
        }
    }
    return { pid: null, running: false };
}

// ============================================
// API ROUTES
// ============================================

// System Stats
app.get('/api/stats', (req, res) => {
    const stats = getSystemStats();
    res.json({
        ...stats,
        servers: db.getTotalServers(),
        users: db.getTotalUsers()
    });
});

// User data
app.get('/api/user/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = db.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// User servers with real stats
app.get('/api/servers/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = db.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const servers = user.servers.map(server => {
        const processInfo = getServerProcess(server.id);
        const logs = getServerLogs(server.id);
        
        return {
            ...server,
            status: processInfo.running ? 'running' : 'stopped',
            pid: processInfo.pid,
            logs: logs.slice(-10)
        };
    });

    res.json(servers);
});

// Server files
app.get('/api/files/:serverId', (req, res) => {
    const serverId = req.params.serverId;
    const subPath = req.query.path || '';
    const files = getServerFiles(serverId, subPath);
    res.json({ files, path: subPath });
});

// Server console logs
app.get('/api/console/:serverId', (req, res) => {
    const serverId = req.params.serverId;
    const logs = getServerLogs(serverId);
    res.json({ logs });
});

// Create server from dashboard
app.post('/api/server/create', async (req, res) => {
    const { userId, name, type } = req.body;
    
    const user = db.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.servers.length >= config.maxServers) {
        return res.status(400).json({ error: 'Server limit reached' });
    }
    
    if (user.points < config.pointsPerServer) {
        return res.status(400).json({ error: 'Insufficient points' });
    }
    
    db.addPoints(userId, -config.pointsPerServer);
    const serverId = db.addServer(userId, { name, type });
    
    if (!serverId) {
        return res.status(500).json({ error: 'Failed to create server' });
    }
    
    res.json({ success: true, serverId });
});

// Start server (REAL process)
app.post('/api/server/start', async (req, res) => {
    const { userId, serverId } = req.body;
    
    const user = db.getUser(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const server = user.servers.find(s => s.id === serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    try {
        const serverDir = path.join(__dirname, 'servers', serverId);
        await fs.ensureDir(serverDir);

        let entryFile = path.join(serverDir, 'index.js');
        let startCommand = 'node';
        
        if (server.type === 'python') {
            entryFile = path.join(serverDir, 'main.py');
            startCommand = 'python3';
        } else if (server.type === 'nodejs') {
            entryFile = path.join(serverDir, 'index.js');
            startCommand = 'node';
        }

        // Create default file if doesn't exist
        if (!fs.existsSync(entryFile)) {
            if (server.type === 'python') {
                fs.writeFileSync(entryFile, 
                    '#!/usr/bin/env python3\n' +
                    'import time\n' +
                    'import os\n\n' +
                    'print("🐍 Python server running!")\n' +
                    'print(f"📂 Working directory: {os.getcwd()}")\n' +
                    'print("⚡ Server is ready!")\n\n' +
                    'while True:\n' +
                    '    time.sleep(1)\n'
                );
            } else {
                fs.writeFileSync(entryFile, 
                    '#!/usr/bin/env node\n' +
                    'console.log("🟢 Node.js server running!");\n' +
                    'console.log(`📂 Working directory: ${process.cwd()}`);\n' +
                    'console.log("⚡ Server is ready!");\n\n' +
                    'setInterval(() => {}, 1000);\n'
                );
            }
        }

        // Create package.json for Node.js
        if (server.type === 'nodejs') {
            const pkgPath = path.join(serverDir, 'package.json');
            if (!fs.existsSync(pkgPath)) {
                fs.writeFileSync(pkgPath, JSON.stringify({
                    name: server.name.toLowerCase().replace(/\s/g, '-'),
                    version: '1.0.0',
                    scripts: { start: 'node index.js' }
                }, null, 2));
            }
        }

        // Start the process
        const child = spawn(startCommand, [entryFile], {
            cwd: serverDir,
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PORT: 3000 + Math.floor(Math.random() * 1000) }
        });

        // Save PID
        fs.writeFileSync(path.join(serverDir, 'pid.txt'), child.pid.toString());

        // Log output
        const logStream = fs.createWriteStream(path.join(serverDir, 'logs.txt'), { flags: 'a' });
        const log = {
            time: new Date().toLocaleTimeString(),
            type: 'success',
            msg: `🟢 Server started successfully (PID: ${child.pid})`
        };
        logStream.write(JSON.stringify(log) + '\n');

        child.stdout.on('data', (data) => {
            const logEntry = {
                time: new Date().toLocaleTimeString(),
                type: 'info',
                msg: data.toString().trim()
            };
            logStream.write(JSON.stringify(logEntry) + '\n');
        });

        child.stderr.on('data', (data) => {
            const logEntry = {
                time: new Date().toLocaleTimeString(),
                type: 'error',
                msg: data.toString().trim()
            };
            logStream.write(JSON.stringify(logEntry) + '\n');
        });

        child.on('close', (code) => {
            const logEntry = {
                time: new Date().toLocaleTimeString(),
                type: 'info',
                msg: `Process exited with code ${code}`
            };
            logStream.write(JSON.stringify(logEntry) + '\n');
            logStream.end();
            db.updateServer(userId, serverId, { status: 'stopped' });
        });

        // Store process reference
        if (!global.serverProcesses) global.serverProcesses = {};
        global.serverProcesses[serverId] = child;

        db.updateServer(userId, serverId, { status: 'running' });
        res.json({ success: true, pid: child.pid });

    } catch (error) {
        console.error('Error starting server:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stop server
app.post('/api/server/stop', (req, res) => {
    const { userId, serverId } = req.body;
    
    try {
        const serverDir = path.join(__dirname, 'servers', serverId);
        const pidFile = path.join(serverDir, 'pid.txt');
        
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
            try { process.kill(pid); } catch (e) {}
            fs.unlinkSync(pidFile);
        }

        if (global.serverProcesses && global.serverProcesses[serverId]) {
            try { global.serverProcesses[serverId].kill(); } catch (e) {}
            delete global.serverProcesses[serverId];
        }

        // Log stop
        const logStream = fs.createWriteStream(path.join(serverDir, 'logs.txt'), { flags: 'a' });
        const log = {
            time: new Date().toLocaleTimeString(),
            type: 'info',
            msg: '⏹️ Server stopped'
        };
        logStream.write(JSON.stringify(log) + '\n');
        logStream.end();

        db.updateServer(userId, serverId, { status: 'stopped' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Restart server
app.post('/api/server/restart', async (req, res) => {
    const { userId, serverId } = req.body;
    
    try {
        const serverDir = path.join(__dirname, 'servers', serverId);
        const pidFile = path.join(serverDir, 'pid.txt');
        
        // Stop
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
            try { process.kill(pid); } catch (e) {}
            fs.unlinkSync(pidFile);
        }
        if (global.serverProcesses && global.serverProcesses[serverId]) {
            try { global.serverProcesses[serverId].kill(); } catch (e) {}
            delete global.serverProcesses[serverId];
        }

        // Wait
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Start again
        const user = db.getUser(userId);
        const server = user.servers.find(s => s.id === serverId);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        let entryFile = path.join(serverDir, 'index.js');
        let startCommand = 'node';
        if (server.type === 'python') {
            entryFile = path.join(serverDir, 'main.py');
            startCommand = 'python3';
        }

        const child = spawn(startCommand, [entryFile], {
            cwd: serverDir,
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        fs.writeFileSync(path.join(serverDir, 'pid.txt'), child.pid.toString());
        if (!global.serverProcesses) global.serverProcesses = {};
        global.serverProcesses[serverId] = child;

        const logStream = fs.createWriteStream(path.join(serverDir, 'logs.txt'), { flags: 'a' });
        const log = {
            time: new Date().toLocaleTimeString(),
            type: 'success',
            msg: `🔄 Server restarted (PID: ${child.pid})`
        };
        logStream.write(JSON.stringify(log) + '\n');
        logStream.end();

        db.updateServer(userId, serverId, { status: 'running' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete server
app.delete('/api/server/:userId/:serverId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    const serverId = req.params.serverId;
    
    try {
        const serverDir = path.join(__dirname, 'servers', serverId);
        const pidFile = path.join(serverDir, 'pid.txt');
        
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
            try { process.kill(pid); } catch (e) {}
            fs.unlinkSync(pidFile);
        }
        if (global.serverProcesses && global.serverProcesses[serverId]) {
            try { global.serverProcesses[serverId].kill(); } catch (e) {}
            delete global.serverProcesses[serverId];
        }
        
        if (fs.existsSync(serverDir)) {
            fs.removeSync(serverDir);
        }

        const result = db.deleteServer(userId, serverId);
        res.json({ success: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload file - REAL
app.post('/api/upload/:serverId', upload.single('file'), (req, res) => {
    const serverId = req.params.serverId;
    const file = req.file;
    
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Log upload
    const logStream = fs.createWriteStream(path.join(__dirname, 'servers', serverId, 'logs.txt'), { flags: 'a' });
    const log = {
        time: new Date().toLocaleTimeString(),
        type: 'info',
        msg: `📤 File uploaded: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`
    };
    logStream.write(JSON.stringify(log) + '\n');
    logStream.end();

    res.json({ success: true, filename: file.originalname, size: file.size });
});

// Create folder
app.post('/api/folder/:serverId', async (req, res) => {
    const serverId = req.params.serverId;
    const { folderName } = req.body;
    const serverDir = path.join(__dirname, 'servers', serverId);
    const folderPath = path.join(serverDir, folderName);
    
    try {
        if (!fs.existsSync(folderPath)) {
            fs.ensureDirSync(folderPath);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Folder already exists' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete file
app.delete('/api/file/:serverId', (req, res) => {
    const serverId = req.params.serverId;
    const filename = req.query.filename;
    const serverDir = path.join(__dirname, 'servers', serverId);
    const filePath = path.join(serverDir, filename);
    
    try {
        if (fs.existsSync(filePath)) {
            fs.removeSync(filePath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Download file
app.get('/api/download/:serverId', (req, res) => {
    const serverId = req.params.serverId;
    const filename = req.query.filename;
    const serverDir = path.join(__dirname, 'servers', serverId);
    const filePath = path.join(serverDir, filename);
    
    if (fs.existsSync(filePath)) {
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filename)}"`);
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// ============================================
// SOCKET.IO - REAL-TIME STATS
// ============================================
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);
    
    const interval = setInterval(() => {
        const stats = getSystemStats();
        socket.emit('stats', {
            ...stats,
            servers: db.getTotalServers(),
            users: db.getTotalUsers()
        });
    }, 2000);
    
    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// ============================================
// SERVE HTML PAGES
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard/:userId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============================================
// START SERVER
// ============================================
const PORT = config.port || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📁 Server files stored in ./servers/`);
});

module.exports = { app, server, io };
