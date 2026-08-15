#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import telebot
import time
import os
import subprocess
import psutil
import re
import json
import sys
import zipfile
import shutil
import threading
from telebot import types
from datetime import datetime
from pathlib import Path

# --- Configuration ---
API_TOKEN = os.environ.get('TOKEN') or '8928335304:AAFnShZwxZdkVL9NIgqwA0Kt1LdnWzJHRc8'
ADMIN_ID = 7158115683
CHANNEL_ID = "@MRANONIMOUS01" 
bot = telebot.TeleBot(API_TOKEN, parse_mode='HTML')

# Use absolute paths to avoid confusion
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "users_data.json")
SETTINGS_FILE = os.path.join(BASE_DIR, "bot_settings.json")
DEPLOY_DIR = os.path.join(BASE_DIR, "deployed_bots")
LOGS_DIR = os.path.join(BASE_DIR, "bot_logs")

# Create directories
for dir_name in [DEPLOY_DIR, LOGS_DIR]:
    Path(dir_name).mkdir(exist_ok=True)

# --- Persistence Functions ---
def save_db():
    try:
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(users_db, f, ensure_ascii=False, indent=4)
    except Exception as e:
        log_error(f"Failed to save DB: {e}")

def load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: 
            return {}
    return {}

def save_settings():
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, ensure_ascii=False, indent=4)
    except Exception as e:
        log_error(f"Failed to save settings: {e}")

def load_settings():
    default = {
        "points_per_referral": 2, 
        "hosting_cost": 4,        
        "maintenance": False,
        "welcome_video": None,
        "bot_username": None,
        "new_user_notify": True
    }
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except: 
            return default
    return default

users_db = load_db()
settings = load_settings()
running_processes = {}

def log_error(error_msg, user_id=None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open("error_logs.txt", "a", encoding='utf-8') as f:
            f.write(f"[{timestamp}] User: {user_id} - {error_msg}\n")
    except:
        pass

# --- Premium UI ---
def premium_text(title, content, icon="✦", footer=None):
    divider = "▰▰▰▰▰▰▰▰▰▰▰▰▰▰"
    html = f"""
<b>╔════════════════════╗</b>
<b>║  {icon} {title}</b>
<b>╚════════════════════╝</b>

<blockquote>{content}</blockquote>
"""
    if footer:
        html += f"""
<blockquote>{footer}</blockquote>
"""
    html += f"""
<blockquote>━ {divider} ━</blockquote>
"""
    return html

def success_text(title, content):
    return premium_text(f"✅ {title}", content, "✨", "ᴛʜᴀɴᴋ ʏᴏᴜ ғᴏʀ ᴄʜᴏᴏsɪɴɢ 𝕻ʀᴇᴍɪᴜᴍ 𝕮ʟᴏᴜᴅ 𝕳ᴏsᴛɪɴɢ")

def error_text(title, content):
    return premium_text(f"❌ {title}", content, "⚠️", "ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ᴏʀ ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ")

def info_text(title, content):
    return premium_text(f"ℹ️ {title}", content, "📌", "ɴᴇᴇᴅ ʜᴇʟᴘ? ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ")

# --- Admin Notification ---
def notify_admin_new_user(user_id, user_name, username=None, referrer=None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total_users = len(users_db)
    notification = f"""
<b>╔═══════════════════╗</b>
<b>║  🆕 ɴᴇᴡ ᴜsᴇʀ ᴊᴏɪɴᴇᴅ</b>
<b>╚═══════════════════╝</b>

<blockquote>👤 <b>ᴜsᴇʀ ɪᴅ:</b> {user_id}
📛 <b>ɴᴀᴍᴇ:</b> {user_name}
{f'🔖 <b>ᴜsᴇʀɴᴀᴍᴇ:</b> @{username}' if username else ''}
🕐 <b>ᴊᴏɪɴᴇᴅ:</b> {timestamp}</blockquote>

<blockquote>📊 <b>sᴛᴀᴛɪsᴛɪᴄs:</b>
• ᴛᴏᴛᴀʟ ᴜsᴇʀs: {total_users}
• ʀᴜɴɴɪɴɢ ʙᴏᴛs: {len(running_processes)}</blockquote>
"""
    if referrer:
        notification += f"""
<blockquote>🔗 <b>ʀᴇғᴇʀʀᴇʀ:</b> {referrer}
💰 <b>ʙᴏɴᴜs:</b> +{settings.get('points_per_referral', 2)} points</blockquote>
"""
    try:
        bot.send_message(ADMIN_ID, notification)
        return True
    except:
        return False

# --- PYTHON ONLY Hosting Logic ---
def install_dependencies(file_path, user_id, f_name):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        libs = re.findall(r'^(?:import|from)\s+([\w\d_]+)', content, re.MULTILINE)
        installed = []
        failed = []
        std_lib = ['os', 'sys', 'time', 'json', 're', 'datetime', 'math', 'random', 
                  'collections', 'itertools', 'typing', 'pathlib', 'threading',
                  'subprocess', 'socket', 'ssl', 'hashlib', 'base64', 'string',
                  'logging', 'tempfile', 'shutil', 'glob', 'pickle', 'csv', 'io']
        for lib in set(libs):
            if lib in std_lib:
                continue
            try:
                __import__(lib)
            except ImportError:
                try:
                    subprocess.run([sys.executable, '-m', 'pip', 'install', lib, '--quiet'],
                                 capture_output=True, timeout=30)
                    installed.append(lib)
                except:
                    failed.append(lib)
        return installed, failed
    except:
        return [], []

def run_user_file(f_path, user_id, f_name):
    # FIXED: Use absolute path and verify
    abs_path = os.path.abspath(f_path)
    
    if not os.path.exists(abs_path):
        error_msg = f"File not found: {abs_path}"
        log_error(error_msg, user_id)
        bot.send_message(user_id, error_text("File Error", f"<code>{error_msg}</code>"))
        return False, "File not found"
    
    ext = os.path.splitext(f_name)[1].lower()
    
    # PYTHON ONLY
    if ext != '.py':
        bot.send_message(user_id, error_text("Wrong Bot", 
            "This bot only deploys <b>Python (.py)</b> files."))
        return False, "Wrong bot - Use JS bot"
    
    try:
        log_file = os.path.join(LOGS_DIR, f"{user_id}_{f_name.replace('.','_')}.log")
        with open(log_file, 'w', encoding='utf-8') as lf:
            lf.write(f"=== Bot Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")
            lf.write(f"User ID: {user_id}\n")
            lf.write(f"File: {f_name}\n")
            lf.write(f"Path: {abs_path}\n")
            lf.write("="*50 + "\n\n")
        
        # FIXED: Use absolute path in command
        process = subprocess.Popen(
            [sys.executable, abs_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=os.path.dirname(abs_path)
        )
        
        running_processes[abs_path] = {
            'process': process,
            'user_id': user_id,
            'f_name': f_name,
            'start_time': datetime.now(),
            'log_file': log_file,
            'pid': process.pid
        }
        
        threading.Thread(target=monitor_logs, args=(abs_path, process, log_file), daemon=True).start()
        time.sleep(3)
        
        if process.poll() is not None:
            with open(log_file, 'r', encoding='utf-8') as lf:
                error_msg = lf.read()[-2000:]
            bot.send_message(user_id, error_text("Deployment Failed", 
                f"<b>Runtime Error</b>\n\n<pre>{error_msg[:1500]}</pre>"))
            if abs_path in running_processes:
                del running_processes[abs_path]
            return False, "Runtime error"
        
        bot.send_message(user_id, success_text("Bot Deployed", 
            f"📄 <b>File:</b> {f_name}\n🟢 <b>Status:</b> Running\n📊 <b>PID:</b> {process.pid}\n🐍 <b>Type:</b> Python"))
        return True, "Running"
        
    except Exception as e:
        bot.send_message(user_id, error_text("Server Error", f"<code>{str(e)}</code>"))
        return False, str(e)

def monitor_logs(f_path, process, log_file):
    while process.poll() is None:
        try:
            line = process.stdout.readline()
            if line:
                with open(log_file, 'a', encoding='utf-8') as lf:
                    lf.write(line)
                if os.path.getsize(log_file) > 10 * 1024 * 1024:
                    with open(log_file, 'r', encoding='utf-8') as lf:
                        lines = lf.readlines()
                    with open(log_file, 'w', encoding='utf-8') as lf:
                        lf.writelines(lines[-5000:])
        except:
            break

def stop_bot(f_path):
    abs_path = os.path.abspath(f_path)
    if abs_path in running_processes:
        try:
            running_processes[abs_path]['process'].terminate()
            time.sleep(2)
            if running_processes[abs_path]['process'].poll() is None:
                running_processes[abs_path]['process'].kill()
            del running_processes[abs_path]
            return True
        except:
            return False
    return False

# --- Channel Announcement ---
def announce_deployment(user_id, file_name):
    try:
        user = bot.get_chat(user_id)
        user_name = user.first_name or "User"
        user_mention = f'<a href="tg://user?id={user_id}">{user_name}</a>'
    except:
        user_mention = f"User {user_id}"
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    announcement = f"""
<b>╔══════════════════╗</b>
<b>║✦🄽🄴🅆 🄱🄾🅃 🄳🄴🄿🄻🄾🅈🄴🄳✦</b>
<b>╚══════════════════╝</b>

<blockquote>👤 <b>ᴅᴇᴘʟᴏʏᴇᴅ ʙʏ:</b> {user_mention}
📄 <b>ғɪʟᴇ:</b> {file_name}
🕐 <b>ᴛɪᴍᴇ:</b> {timestamp}
⚡ <b>sᴛᴀᴛᴜs:</b> 🟢 ʀᴜɴɴɪɴɢ
📂 <b>ᴛʏᴘᴇ:</b> 🐍 ᴘʏᴛʜᴏɴ</blockquote>

<blockquote>━━━━━━━━━━━━━━━━━━━━━━━
🎯 <b>🄳🄴🄿🄻🄾🅈 🅄🅁🅂 🄽🄾🅆</b>
💡 ᴘʀᴇᴍɪᴜᴍ 24/7 ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ
⚡ ғᴀsᴛ & ʀᴇʟɪᴀʙʟᴇ sᴇʀᴠɪᴄᴇ
🛡️ sᴇᴄᴜʀᴇ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ
━━━━━━━━━━━━━━━━━━━━━━━</blockquote>

<blockquote>💰 <b>ᴄᴏsᴛ:</b> ᴏɴʟʏ {settings['hosting_cost']} points
✨ <b>Features:</b> ᴀᴜᴛᴏ-ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs, ʀᴇᴀʟ-ᴛɪᴍᴇ ʟᴏɢs, 24/7 ᴜᴘᴛɪᴍᴇ</blockquote>
"""
    
    markup = types.InlineKeyboardMarkup(row_width=2)
    markup.add(
        types.InlineKeyboardButton("🚀 ᴅᴇᴘʟᴏʏ ɴᴏᴡ", url=f"https://t.me/{settings.get('bot_username', 'your_bot')}")
    )
    
    try:
        bot.send_message(CHANNEL_ID, announcement, reply_markup=markup)
        return True
    except:
        return False

# --- Handlers ---
@bot.message_handler(commands=['start', 'help'])
def start(message):
    uid = str(message.from_user.id)
    
    if settings['maintenance'] and uid != str(ADMIN_ID):
        return bot.send_message(message.chat.id, premium_text("🔧 Maintenance", "Bot is under maintenance.", "🔄"))
    
    is_new = uid not in users_db
    
    if is_new:
        users_db[uid] = {'points': 10, 'files': [], 'joined': str(datetime.now()), 'total_deployments': 0}
        referrer = None
        params = message.text.split()
        if len(params) > 1:
            ref_id = params[1]
            if ref_id in users_db and ref_id != uid:
                users_db[ref_id]['points'] += settings.get('points_per_referral', 2)
                referrer = ref_id
                try:
                    bot.send_message(int(ref_id), premium_text("🎁 Referral Bonus!", 
                        f"User {uid} joined!\n💰 +{settings['points_per_referral']} points"))
                except:
                    pass
        save_db()
        if settings.get('new_user_notify', True):
            user = message.from_user
            notify_admin_new_user(uid, user.first_name, user.username, referrer)
    
    if not settings.get('bot_username'):
        settings['bot_username'] = bot.get_me().username
        save_settings()
    
    user_data = users_db[uid]
    points = user_data.get('points', 0)
    
    welcome_text = f"""
<b>🐍 ᴘʏᴛʜᴏɴ ᴘʀᴇᴍɪᴜᴍ ᴄʟᴏᴜᴅ ʜᴏsᴛɪɴɢ ✦</b>
<b>🌐 24/7 ᴘʏᴛʜᴏɴ ᴄʟᴏᴜᴅ ᴅᴇᴘʟᴏʏᴍᴇɴᴛ</b>

━━━━━━━━━━━━━━━━━━━━

<b>👋 ᴡᴇʟᴄᴏᴍᴇ{f' back' if not is_new else ''}, {message.from_user.first_name}!</b>

<b>📊 ʏᴏᴜʀ ᴅᴀsʜʙᴏᴀʀᴅ:</b>
• 💰 ᴘᴏɪɴᴛs: {points}
• 🤖 ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: {len(running_processes)}

━━━━━━━━━━━━━━━━━━━━━

<b>✨ ғᴇᴀᴛᴜʀᴇs:</b>
• 📤 ᴅᴇᴘʟᴏʏ ᴘʏᴛʜᴏɴ (.py) ᴏɴʟʏ
• 🚀 ᴀᴜᴛᴏ ᴅᴇᴘᴇɴᴅᴇɴᴄɪᴇs
• 🔍 ʀᴇᴀʟ-ᴛɪᴍᴇ ʟᴏɢs
• ⚡ 24/7 ᴜᴘᴛɪᴍᴇ

💡 ᴜsᴇ ʙᴜᴛᴛᴏɴs ʙᴇʟᴏᴡ!
"""
    
    bot.send_message(message.chat.id, premium_text("ᴡᴇʟᴄᴏᴍᴇ", welcome_text, "🐍"), 
                     reply_markup=main_keyboard(uid))

def main_keyboard(user_id):
    markup = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
    buttons = [
        "✦ Deploy Py", "✦ My Files",
        "✦ Points", "✦ Stats",
        "✦ Referral", "✦ Logs",
        "✦ Channel", "✦ Support", 
        "✦ More Bots", "✦ Daily"
    ]
    row = []
    for i, btn in enumerate(buttons):
        row.append(types.KeyboardButton(btn))
        if (i + 1) % 2 == 0:
            markup.add(*row)
            row = []
    if row:
        markup.add(*row)
    if str(user_id) == str(ADMIN_ID):
        markup.add(types.KeyboardButton("✦ Admin Panel"), types.KeyboardButton("✦ All Files"))
    return markup

@bot.message_handler(func=lambda m: m.text == "✦ Deploy Py")
def deploy_bot(message):
    uid = str(message.from_user.id)
    points = users_db.get(uid, {}).get('points', 0)
    cost = settings['hosting_cost']
    
    if points < cost:
        return bot.send_message(message.chat.id, premium_text("💎 Insufficient Points",
            f"💰 Balance: {points} pts\n💎 Required: {cost} pts\n\n💡 Invite friends to earn more!"))
    
    msg = bot.send_message(message.chat.id, premium_text("📤 Deploy Python Bot",
        f"📂 Supported: .py, .zip\n💰 Cost: {cost} pts\n💎 Balance: {points} pts\n\n📌 <b>Python only!</b>", "🐍"))
    bot.register_next_step_handler(msg, process_upload)

def process_upload(message):
    if not message.document:
        return bot.send_message(message.chat.id, error_text("No File", "Please send a valid file."))
    
    uid = str(message.from_user.id)
    original_fname = message.document.file_name
    f_name = original_fname
    
    # FIXED: Use absolute path with os.path.join
    safe_filename = f"{uid}_{f_name}"
    f_path = os.path.join(DEPLOY_DIR, safe_filename)
    f_path = os.path.abspath(f_path)  # Convert to absolute path
    
    print(f"📥 Upload: {f_name}")
    print(f"📁 Saving to: {f_path}")
    
    # PYTHON ONLY
    valid_extensions = ['.py', '.zip']
    if not any(f_name.lower().endswith(ext) for ext in valid_extensions):
        return bot.send_message(message.chat.id, error_text("Wrong Format",
            f"❌ This bot only deploys <b>Python (.py)</b> files!\nSupported: {', '.join(valid_extensions)}"))
    
    prog_msg = bot.send_message(message.chat.id, premium_text("⏳ Processing...", 
        f"📦 File: {f_name}\n⏳ Status: Uploading...", "⚙️"))
    
    try:
        # Download file
        f_info = bot.get_file(message.document.file_id)
        file_content = bot.download_file(f_info.file_path)
        os.makedirs(DEPLOY_DIR, exist_ok=True)
        with open(f_path, 'wb') as f:
            f.write(file_content)
        
        final_path = f_path
        final_name = f_name
        
        # Handle ZIP files
        if f_name.endswith('.zip'):
            extract_dir = os.path.join(DEPLOY_DIR, f"{uid}_{f_name.replace('.zip', '')}")
            extract_dir = os.path.abspath(extract_dir)
            with zipfile.ZipFile(f_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
            os.remove(f_path)
            
            # Find main Python file
            main_file = None
            for root, dirs, files in os.walk(extract_dir):
                for file in files:
                    if file.endswith('.py'):
                        main_file = os.path.join(root, file)
                        break
                if main_file:
                    break
            
            if not main_file:
                return bot.send_message(message.chat.id, error_text("Invalid ZIP", 
                    "No Python (.py) file found in archive."))
            
            final_path = os.path.abspath(main_file)
            final_name = os.path.basename(main_file)
            print(f"📦 Extracted: {final_path}")
        
        # Verify it's a Python file
        if not final_name.endswith('.py'):
            return bot.send_message(message.chat.id, error_text("Wrong Format", 
                "❌ This bot only deploys <b>Python (.py)</b> files!"))
        
        # Verify file exists
        if not os.path.exists(final_path):
            return bot.send_message(message.chat.id, error_text("File Error", 
                f"File not found: {final_path}"))
        
        # Install dependencies
        bot.edit_message_text(premium_text("⏳ Processing...", 
            f"📦 Installing Python dependencies...", "⚙️"), message.chat.id, prog_msg.message_id)
        installed, failed = install_dependencies(final_path, uid, final_name)
        
        if installed:
            bot.edit_message_text(premium_text("⏳ Processing...", 
                f"✅ Installed: {', '.join(installed)}", "⚙️"), 
                message.chat.id, prog_msg.message_id)
        
        # Run the bot
        success, status = run_user_file(final_path, int(uid), final_name)
        
        if success:
            # Update user data
            if final_name not in users_db[uid]['files']:
                users_db[uid]['files'].append(final_name)
            users_db[uid]['points'] -= settings['hosting_cost']
            users_db[uid]['total_deployments'] = users_db[uid].get('total_deployments', 0) + 1
            save_db()
            
            bot.edit_message_text(success_text("Deployment Successful!",
                f"📄 File: {final_name}\n🟢 Status: Running\n💰 Remaining: {users_db[uid]['points']} pts"),
                message.chat.id, prog_msg.message_id)
            
            announce_deployment(int(uid), final_name)
        else:
            bot.edit_message_text(error_text("Deployment Failed", 
                f"📄 File: {final_name}\n❌ Status: {status}"), message.chat.id, prog_msg.message_id)
            
    except Exception as e:
        log_error(str(e), uid)
        bot.edit_message_text(error_text("Deployment Error", f"❌ {str(e)}"), 
                             message.chat.id, prog_msg.message_id)

# --- Rest of handlers ---
@bot.message_handler(func=lambda m: m.text == "✦ My Files")
def show_my_files(message):
    uid = str(message.from_user.id)
    files = users_db.get(uid, {}).get('files', [])
    
    if not files:
        return bot.send_message(message.chat.id, info_text("📂 No Files", "Use <b>✦ Deploy Py</b> to get started!"))
    
    for f_name in files:
        f_path = os.path.join(DEPLOY_DIR, f"{uid}_{f_name}")
        f_path = os.path.abspath(f_path)
        is_running = f_path in running_processes and running_processes[f_path]['process'].poll() is None
        status = "🟢 Running" if is_running else "🔴 Stopped"
        pid = running_processes[f_path]['pid'] if is_running else "N/A"
        
        runtime = ""
        if is_running:
            start_time = running_processes[f_path]['start_time']
            minutes = int((datetime.now() - start_time).total_seconds() // 60)
            runtime = f"⏱️ {minutes}m" if minutes < 60 else f"⏱️ {minutes//60}h {minutes%60}m"
        
        markup = types.InlineKeyboardMarkup(row_width=2)
        markup.add(
            types.InlineKeyboardButton("▶️ Start", callback_data=f"run_{f_name}_{uid}"),
            types.InlineKeyboardButton("⏹ Stop", callback_data=f"stop_{f_name}_{uid}")
        )
        markup.add(
            types.InlineKeyboardButton("📥 Download", callback_data=f"down_{f_name}_{uid}"),
            types.InlineKeyboardButton("📋 Logs", callback_data=f"logs_{f_name}_{uid}")
        )
        markup.add(types.InlineKeyboardButton("🗑️ Delete", callback_data=f"del_{f_name}_{uid}"))
        
        bot.send_message(message.chat.id, premium_text(f"📄 {f_name}", 
            f"Status: {status}\nPID: {pid}\n🐍 Python\n{runtime}", "🤖"), reply_markup=markup)

@bot.message_handler(func=lambda m: m.text == "✦ Points")
def show_points(message):
    uid = str(message.from_user.id)
    user_data = users_db.get(uid, {})
    points = user_data.get('points', 0)
    deployments = user_data.get('total_deployments', 0)
    files = user_data.get('files', [])
    
    bot.send_message(message.chat.id, premium_text("💰 Points Dashboard",
        f"💎 Balance: {points} pts\n📤 Deployments: {deployments}\n📂 Active Bots: {len(files)}\n💸 Cost/Bot: {settings['hosting_cost']} pts\n\n💡 Referral: +{settings['points_per_referral']} pts", "💎"))

@bot.message_handler(func=lambda m: m.text == "✦ Stats")
def show_stats(message):
    total_users = len(users_db)
    active_users = sum(1 for u in users_db if len(users_db[u].get('files', [])) > 0)
    total_bots = len(running_processes)
    total_files = sum(len(data.get('files', [])) for data in users_db.values())
    total_points = sum(data.get('points', 0) for data in users_db.values())
    
    bot.send_message(message.chat.id, premium_text("📊 Platform Statistics",
        f"👥 Users: {total_users}\n📤 Active: {active_users}\n🤖 Running Bots: {total_bots}\n📄 Deployed Files: {total_files}\n💰 Total Points: {total_points}", "📊"))

@bot.message_handler(func=lambda m: m.text == "✦ Referral")
def referral_link(message):
    ref_link = f"https://t.me/{settings.get('bot_username', 'your_bot')}?start={message.from_user.id}"
    bot.send_message(message.chat.id, premium_text("🔗 Referral System",
        f"💰 Bonus: {settings['points_per_referral']} pts per referral\n\n📎 Your Link:\n<code>{ref_link}</code>", "🎯"))

@bot.message_handler(func=lambda m: m.text == "✦ Logs")
def view_logs(message):
    uid = str(message.from_user.id)
    files = users_db.get(uid, {}).get('files', [])
    if not files:
        return bot.send_message(message.chat.id, info_text("No Logs", "No bots deployed yet."))
    
    markup = types.InlineKeyboardMarkup(row_width=1)
    for f_name in files:
        markup.add(types.InlineKeyboardButton(f"📄 {f_name}", callback_data=f"viewlog_{f_name}_{uid}"))
    
    bot.send_message(message.chat.id, premium_text("📋 View Logs", "Select a bot:", "📜"), reply_markup=markup)

@bot.message_handler(func=lambda m: m.text == "✦ Channel")
def channel(message):
    markup = types.InlineKeyboardMarkup()
    markup.add(types.InlineKeyboardButton("📢 Join Channel", url=f"https://t.me/{CHANNEL_ID.replace('@','')}"))
    bot.send_message(message.chat.id, premium_text("📢 Stay Updated", f"Channel: {CHANNEL_ID}", "📡"), reply_markup=markup)

@bot.message_handler(func=lambda m: m.text == "✦ Support")
def support(message):
    bot.send_message(message.chat.id, premium_text("📞 Support Center",
        f"👤 Owner: @MRANONIMOUS01\n📢 Channel: {CHANNEL_ID}\n\n💡 Python bot only!", "💬"))

@bot.message_handler(func=lambda m: m.text == "✦ More Bots")
def more_bots(message):
    bot.send_message(message.chat.id, premium_text("ᴍᴏʀᴇ ʙᴏᴛs",
        f"""
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
""", "🔮"))

@bot.message_handler(func=lambda m: m.text == "✦ Daily")
def daily_reward(message):
    uid = str(message.from_user.id)
    last_claim = users_db[uid].get('last_daily', None)
    today = datetime.now().strftime('%Y-%m-%d')
    
    if last_claim == today:
        return bot.send_message(message.chat.id, premium_text("⏳ Daily Reward", "Already claimed today!", "⏰"))
    
    reward = 5
    users_db[uid]['points'] += reward
    users_db[uid]['last_daily'] = today
    save_db()
    
    bot.send_message(message.chat.id, premium_text("🎉 Daily Reward", 
        f"💰 +{reward} points\n💎 New Balance: {users_db[uid]['points']} pts", "⭐"))

@bot.message_handler(func=lambda m: m.text == "✦ Admin Panel" and str(m.from_user.id) == str(ADMIN_ID))
def admin_panel(message):
    total_users = len(users_db)
    active_users = sum(1 for u in users_db if len(users_db[u].get('files', [])) > 0)
    bot.send_message(message.chat.id, premium_text("👑 Admin Panel",
        f"Users: {total_users}\nActive: {active_users}\nBots: {len(running_processes)}", "🔐"),
        reply_markup=admin_keyboard())

def admin_keyboard():
    markup = types.InlineKeyboardMarkup(row_width=2)
    m_text = "🔴 Maintenance ON" if settings['maintenance'] else "🟢 Maintenance OFF"
    notify_text = "🔔 Notify ON" if settings.get('new_user_notify', True) else "🔕 Notify OFF"
    buttons = [
        ("➕ Add Points", "adm_add_pts"),
        ("🌍 Global Add Points", "adm_global_add_pts"),
        ("📢 Broadcast", "adm_broadcast"),
        ("🎥 Set Video", "adm_set_video"),
        ("💾 Backup", "adm_backup"),
        (m_text, "adm_toggle_maint"),
        (notify_text, "adm_toggle_notify"),
        ("🖥 Server Stats", "adm_stats"),
        ("🧹 Clean Bots", "adm_clean"),
        ("📊 System Info", "adm_system")
    ]
    for text, callback in buttons:
        markup.add(types.InlineKeyboardButton(text, callback_data=callback))
    if settings.get('welcome_video'):
        markup.add(types.InlineKeyboardButton("❌ Remove Video", callback_data="adm_del_video"))
    return markup

@bot.message_handler(func=lambda m: m.text == "✦ All Files" and str(m.from_user.id) == str(ADMIN_ID))
def admin_all_files(message):
    bot.send_message(message.chat.id, premium_text("🌍 Global File Control", "Managing all deployed Python bots", "🔍"))
    found = False
    for target_uid, data in users_db.items():
        for f_name in data.get('files', []):
            found = True
            f_path = os.path.join(DEPLOY_DIR, f"{target_uid}_{f_name}")
            f_path = os.path.abspath(f_path)
            is_running = f_path in running_processes and running_processes[f_path]['process'].poll() is None
            status = "🟢" if is_running else "🔴"
            markup = types.InlineKeyboardMarkup(row_width=2)
            markup.add(
                types.InlineKeyboardButton("▶️ RUN", callback_data=f"run_{f_name}_{target_uid}"),
                types.InlineKeyboardButton("⏹ STOP", callback_data=f"stop_{f_name}_{target_uid}")
            )
            markup.add(
                types.InlineKeyboardButton("📥 DOWNLOAD", callback_data=f"down_{f_name}_{target_uid}"),
                types.InlineKeyboardButton("🗑️ DELETE", callback_data=f"del_{f_name}_{target_uid}")
            )
            markup.add(types.InlineKeyboardButton("📋 LOGS", callback_data=f"logs_{f_name}_{target_uid}"))
            bot.send_message(message.chat.id, f"👤 User: {target_uid}\n📄 File: {f_name} {status}", reply_markup=markup)
            time.sleep(0.2)
    if not found:
        bot.send_message(message.chat.id, info_text("No Files", "No deployed bots found."))

@bot.callback_query_handler(func=lambda call: True)
def callback_handler(call):
    uid = str(call.from_user.id)
    data = call.data
    
    if data.startswith("viewlog_"):
        try:
            _, f_name, target_uid = data.split("_", 2)
            log_file = os.path.join(LOGS_DIR, f"{target_uid}_{f_name.replace('.','_')}.log")
            if os.path.exists(log_file):
                with open(log_file, 'r', encoding='utf-8') as f:
                    content = f.read()[-2000:]
                bot.send_message(call.message.chat.id, premium_text(f"📋 Logs: {f_name}", 
                    f"<code>{content}</code>", "📜"))
            else:
                bot.answer_callback_query(call.id, "No log file found.")
        except:
            bot.answer_callback_query(call.id, "Error reading logs.")
        return
    
    if "_" in data and not data.startswith("adm_") and not data.startswith("viewlog_"):
        parts = data.split("_")
        action = parts[0]
        f_name = "_".join(parts[1:-1])
        target_uid = parts[-1]
        f_path = os.path.join(DEPLOY_DIR, f"{target_uid}_{f_name}")
        f_path = os.path.abspath(f_path)
        
        if action == "stop":
            if stop_bot(f_path):
                bot.answer_callback_query(call.id, "⏹ Bot stopped!")
                bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=None)
            else:
                bot.answer_callback_query(call.id, "Failed to stop bot.")
                
        elif action == "run":
            success, status = run_user_file(f_path, int(target_uid), f_name)
            if success:
                bot.answer_callback_query(call.id, "▶️ Bot started!")
                bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=None)
            else:
                bot.answer_callback_query(call.id, f"Failed: {status[:50]}")
                
        elif action == "down":
            if os.path.exists(f_path):
                with open(f_path, 'rb') as f:
                    bot.send_document(call.message.chat.id, f, caption=f"📥 {f_name}")
            else:
                bot.answer_callback_query(call.id, "File not found!")
                
        elif action == "del":
            try:
                if f_path in running_processes:
                    stop_bot(f_path)
                if os.path.exists(f_path):
                    if os.path.isdir(f_path):
                        shutil.rmtree(f_path)
                    else:
                        os.remove(f_path)
                if target_uid in users_db and f_name in users_db[target_uid]['files']:
                    users_db[target_uid]['files'].remove(f_name)
                    save_db()
                log_file = os.path.join(LOGS_DIR, f"{target_uid}_{f_name.replace('.','_')}.log")
                if os.path.exists(log_file):
                    os.remove(log_file)
                bot.delete_message(call.message.chat.id, call.message.message_id)
                bot.answer_callback_query(call.id, "🗑️ Deleted!")
            except Exception as e:
                bot.answer_callback_query(call.id, f"Error: {str(e)[:50]}")
                
        elif action == "logs":
            log_file = os.path.join(LOGS_DIR, f"{target_uid}_{f_name.replace('.','_')}.log")
            if os.path.exists(log_file):
                with open(log_file, 'r', encoding='utf-8') as f:
                    content = f.read()[-2000:]
                bot.send_message(call.message.chat.id, premium_text(f"📋 Logs: {f_name}", 
                    f"<code>{content}</code>", "📜"))
            else:
                bot.answer_callback_query(call.id, "No log file found.")
        return
    
    # Admin functions
    if uid == str(ADMIN_ID):
        if data == "adm_toggle_maint":
            settings['maintenance'] = not settings['maintenance']
            save_settings()
            bot.answer_callback_query(call.id, f"Maintenance: {'ON' if settings['maintenance'] else 'OFF'}")
            bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=admin_keyboard())
            
        elif data == "adm_toggle_notify":
            settings['new_user_notify'] = not settings.get('new_user_notify', True)
            save_settings()
            bot.answer_callback_query(call.id, f"Notifications: {'ON' if settings['new_user_notify'] else 'OFF'}")
            bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=admin_keyboard())
            
        elif data == "adm_broadcast":
            msg = bot.send_message(call.message.chat.id, premium_text("📢 Broadcast", "Send your message below:", "📨"))
            bot.register_next_step_handler(msg, broadcast_logic)
            
        elif data == "adm_set_video":
            msg = bot.send_message(call.message.chat.id, premium_text("🎥 Set Video", "Send the video file:", "📹"))
            bot.register_next_step_handler(msg, save_video_logic)
            
        elif data == "adm_del_video":
            settings['welcome_video'] = None
            save_settings()
            bot.answer_callback_query(call.id, "✅ Video removed!")
            bot.edit_message_reply_markup(call.message.chat.id, call.message.message_id, reply_markup=admin_keyboard())
            
        elif data == "adm_add_pts":
            msg = bot.send_message(call.message.chat.id, premium_text("➕ Add Points", "Send User ID:", "👤"))
            bot.register_next_step_handler(msg, lambda m: bot.register_next_step_handler(
                bot.send_message(m.chat.id, premium_text("💰 Amount", "Enter points:", "💎")),
                lambda p: admin_add_pts(m.text, p.text, m.chat.id)
            ))
            
        elif data == "adm_global_add_pts":
            msg = bot.send_message(call.message.chat.id, premium_text("🌍 Global Add Points", 
                "Enter points to add to ALL users:", "💎"))
            bot.register_next_step_handler(msg, admin_global_add_pts)
            
        elif data == "adm_stats":
            cpu = psutil.cpu_percent()
            ram = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            bot.send_message(call.message.chat.id, premium_text("🖥 Server Stats",
                f"CPU: {cpu}%\nRAM: {ram.percent}%\nDisk: {disk.percent}%\nBots: {len(running_processes)}\nUsers: {len(users_db)}", "📊"))
            
        elif data == "adm_backup":
            backup_file = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            shutil.copy(DB_FILE, backup_file)
            with open(backup_file, 'rb') as f:
                bot.send_document(call.message.chat.id, f, caption="💾 Database Backup")
            os.remove(backup_file)
            bot.answer_callback_query(call.id, "✅ Backup created!")
            
        elif data == "adm_clean":
            cleaned = 0
            for f_path in list(running_processes.keys()):
                if running_processes[f_path]['process'].poll() is not None:
                    del running_processes[f_path]
                    cleaned += 1
            bot.answer_callback_query(call.id, f"🧹 Cleaned {cleaned} dead processes!")
            
        elif data == "adm_system":
            bot.send_message(call.message.chat.id, premium_text("🔧 System Info",
                f"Python: {sys.version.split()[0]}\nPlatform: {sys.platform}\nDB Size: {os.path.getsize(DB_FILE)//1024}KB", "⚙️"))

def broadcast_logic(message):
    text = message.text
    count = 0
    for uid in users_db:
        try:
            bot.send_message(int(uid), premium_text("📢 Announcement", text, "📨"))
            count += 1
            time.sleep(0.05)
        except:
            pass
    bot.send_message(message.chat.id, premium_text("✅ Broadcast Complete", f"Sent to {count} users", "📨"))

def admin_add_pts(target, points, chat_id):
    try:
        points = int(points)
        if target in users_db:
            users_db[target]['points'] += points
            save_db()
            bot.send_message(chat_id, success_text("✅ Points Added", 
                f"User: {target}\nAdded: +{points}\nNew Balance: {users_db[target]['points']}"))
        else:
            bot.send_message(chat_id, error_text("User Not Found", "Invalid User ID"))
    except:
        bot.send_message(chat_id, error_text("Error", "Invalid input"))

def admin_global_add_pts(message):
    try:
        points = int(message.text)
        if points <= 0:
            return bot.send_message(message.chat.id, error_text("Invalid", "Enter positive number"))
        
        count = 0
        for uid in users_db:
            users_db[uid]['points'] += points
            count += 1
        save_db()
        
        bot.send_message(message.chat.id, success_text("🌍 Global Points Added",
            f"Added: +{points} to {count} users\nTotal Distributed: {points * count}"))
    except:
        bot.send_message(message.chat.id, error_text("Error", "Invalid input"))

def save_video_logic(message):
    if message.video:
        settings['welcome_video'] = message.video.file_id
        save_settings()
        bot.send_message(message.chat.id, success_text("✅ Video Set", "Welcome video updated!"))
    else:
        bot.send_message(message.chat.id, error_text("Not a Video", "Please send a video file."))

# --- Start Bot ---
if __name__ == "__main__":
    print("=" * 60)
    print("🐍 PYTHON PREMIUM HOSTING BOT v2.0")
    print("=" * 60)
    print(f"🕐 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"👥 Users: {len(users_db)}")
    print(f"📁 Base Dir: {BASE_DIR}")
    print(f"📁 Deploy Dir: {DEPLOY_DIR}")
    print("=" * 60)
    print("✅ Python bot is running...")
    print("=" * 60)
    
    try:
        bot.infinity_polling(timeout=10, long_polling_timeout=5)
    except KeyboardInterrupt:
        print("\n🛑 Bot stopped")
    except Exception as e:
        print(f"❌ Error: {e}")
