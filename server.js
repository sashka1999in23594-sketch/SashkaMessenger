const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Настраиваем CORS для клиента с GitHub Pages
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// PeerJS сервер (для звонков)
const peerServer = ExpressPeerServer(server, {
  path: '/peerjs',
  allow_discovery: true
});
app.use('/peerjs', peerServer);

app.use(express.static('public'));

// ---- Хранилище данных (в памяти, можно заменить на БД) ----
let users = [];
let chats = [];
let messages = {};   // { chatId: [ ... ] }
let comments = {};   // { chatId: { msgId: [ ... ] } }

const ADMIN = {
  name: 'sashka1999in2359',
  password: 'Master_302'
};

// Инициализация админа и системных чатов
function initData() {
  const adminHash = crypto.createHash('sha256').update(ADMIN.password).digest('hex');
  if (!users.find(u => u.name === ADMIN.name)) {
    users.push({
      id: 'admin_0',
      name: ADMIN.name,
      passwordHash: adminHash,
      avatar: null,
      description: 'Главный администратор',
      blocked: false,
      isAdmin: true,
      online: false,
      allowDM: false
    });
  }
  if (!chats.find(c => c.id === 'system')) {
    chats.push({
      id: 'system',
      type: 'system',
      name: 'SashkaMessenger',
      avatar: null,
      members: [],
      description: 'Системные уведомления',
      creatorId: 'admin_0',
      bannedUsers: [],
      mutedUsers: [],
      adminIds: ['admin_0']
    });
    messages['system'] = [];
  }
  if (!chats.find(c => c.id === 'suggest')) {
    chats.push({
      id: 'suggest',
      type: 'suggest',
      name: 'Предложка SashkaMessenger',
      avatar: null,
      members: [],
      description: 'Ваши предложения',
      creatorId: 'admin_0'
    });
    messages['suggest'] = [];
  }
}
initData();

// ---- Socket.IO обработка ----
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('login', ({ name, password }, callback) => {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    let user = users.find(u => u.name === name && u.passwordHash === hash);
    if (!user) {
      // Регистрация
      if (users.find(u => u.name === name)) {
        return callback({ error: 'Имя занято' });
      }
      user = {
        id: 'user_' + Date.now(),
        name,
        passwordHash: hash,
        avatar: null,
        description: '',
        blocked: false,
        isAdmin: false,
        online: true,
        allowDM: true
      };
      users.push(user);
    } else {
      if (user.blocked) return callback({ error: 'Аккаунт заблокирован' });
      user.online = true;
    }
    currentUser = user;
    socket.join('user_' + user.id);
    // Отправить список чатов и прочее
    callback({ success: true, user: { ...user, passwordHash: undefined } });
    io.emit('users_online', getOnlineUsers());
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      currentUser.online = false;
      io.emit('users_online', getOnlineUsers());
    }
  });

  // Получить список чатов
  socket.on('get_chats', (cb) => {
    if (!currentUser) return cb([]);
    const myChats = chats.filter(c => 
      c.type === 'system' || c.type === 'suggest' || c.members.includes(currentUser.id)
    );
    cb(myChats);
  });

  // Получить сообщения чата
  socket.on('get_messages', (chatId, cb) => {
    if (!currentUser) return cb([]);
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return cb([]);
    let msgs = messages[chatId] || [];
    if (chat.type === 'suggest' && !currentUser.isAdmin) {
      msgs = msgs.filter(m => m.fromId === currentUser.id || m.system);
    }
    cb(msgs);
  });

  // Отправить сообщение
  socket.on('send_message', (data, cb) => {
    if (!currentUser) return cb({ error: 'Не авторизован' });
    const { chatId, text, file, fileType, fileName, videoBlob } = data;
    const chat = chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(currentUser.id)) return cb({ error: 'Нет доступа' });
    if (chat.bannedUsers?.includes(currentUser.id)) return cb({ error: 'Забанены' });
    if (chat.type === 'channel' && !chat.adminIds?.includes(currentUser.id)) return cb({ error: 'Нельзя писать' });
    if (chat.type === 'system' && !currentUser.isAdmin) return cb({ error: 'Только админ' });

    const msg = {
      id: 'msg_' + Date.now(),
      from: currentUser.name,
      fromId: currentUser.id,
      text: text || '',
      file: file || null,
      fileType: fileType || null,
      fileName: fileName || null,
      videoBlob: videoBlob || null,
      time: Date.now(),
      system: false,
      anonymous: chat.type === 'channel'
    };

    if (!messages[chatId]) messages[chatId] = [];
    messages[chatId].push(msg);

    // Рассылка всем в чате
    io.to(chatId).emit('new_message', { chatId, msg });
    cb({ success: true });
  });

  // Присоединиться к комнате чата
  socket.on('join_chat', (chatId) => {
    if (!currentUser) return;
    const chat = chats.find(c => c.id === chatId);
    if (chat && (chat.members.includes(currentUser.id) || chat.type === 'system' || chat.type === 'suggest')) {
      socket.join(chatId);
    }
  });

  // ... остальные обработчики: создание чатов, админка, звонки ...
});

function getOnlineUsers() {
  return users.filter(u => u.online).map(u => u.name);
}

server.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});
