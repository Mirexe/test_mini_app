const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // для тестов, при деплое замените на ваш GitHub Pages URL
    methods: ["GET", "POST"]
  }
});

// Хранилище комнат
const rooms = new Map(); // roomId -> { players: [socketId, socketId?], boards, shots, turn, gameOver, winner }

// Функция генерации случайной доски с кораблями (без касаний)
function generateRandomBoard() {
  const size = 10;
  const board = Array(size).fill().map(() => Array(size).fill(0));
  const ships = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  
  const canPlace = (row, col, length, horizontal) => {
    if (horizontal) {
      if (col + length > size) return false;
      for (let i = -1; i <= length; i++) {
        for (let j = -1; j <= 1; j++) {
          const r = row + j;
          const c = col + (i === -1 ? -1 : i === length ? length : i);
          if (r >= 0 && r < size && c >= 0 && c < size) {
            if (board[r][c] === 1) return false;
          }
        }
      }
    } else {
      if (row + length > size) return false;
      for (let i = -1; i <= length; i++) {
        for (let j = -1; j <= 1; j++) {
          const r = row + (i === -1 ? -1 : i === length ? length : i);
          const c = col + j;
          if (r >= 0 && r < size && c >= 0 && c < size) {
            if (board[r][c] === 1) return false;
          }
        }
      }
    }
    return true;
  };
  
  const placeShip = (row, col, length, horizontal) => {
    if (horizontal) {
      for (let i = 0; i < length; i++) {
        board[row][col + i] = 1;
      }
    } else {
      for (let i = 0; i < length; i++) {
        board[row + i][col] = 1;
      }
    }
  };
  
  for (const length of ships) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 500) {
      const horizontal = Math.random() < 0.5;
      const row = Math.floor(Math.random() * size);
      const col = Math.floor(Math.random() * size);
      if (canPlace(row, col, length, horizontal)) {
        placeShip(row, col, length, horizontal);
        placed = true;
      }
      attempts++;
    }
    if (!placed) {
      // Если не удалось расставить, перезапускаем генерацию
      return generateRandomBoard();
    }
  }
  return board;
}

// Проверка, уничтожен ли корабль после попадания
function isSunk(board, shots, x, y) {
  const queue = [[x, y]];
  const visited = new Set();
  const shipCells = [];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    const key = `${cx},${cy}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (board[cx][cy] === 1) {
      shipCells.push([cx, cy]);
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dx, dy]) => {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && board[nx][ny] === 1 && !visited.has(`${nx},${ny}`)) {
          queue.push([nx, ny]);
        }
      });
    }
  }
  return shipCells.every(([cx, cy]) => shots[cx][cy] === 2);
}

// Проверка победы (все корабли подбиты)
function checkWin(board, shots) {
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      if (board[i][j] === 1 && shots[i][j] !== 2) return false;
    }
  }
  return true;
}

// Обновление состояния игры для игрока (его доска и вражеская)
function getPlayerState(room, playerIdx) {
  const opponentIdx = playerIdx === 0 ? 1 : 0;
  const yourBoard = room.boards[playerIdx];
  const enemyShots = room.shots[opponentIdx]; // выстрелы по противнику, сделанные этим игроком
  return {
    yourBoard: yourBoard,
    enemyBoard: enemyShots,
    turn: room.turn === playerIdx,
    gameOver: room.gameOver,
    winner: room.winner
  };
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Создание игры
  socket.on('createGame', () => {
    const roomId = Math.random().toString(36).substring(2, 8);
    rooms.set(roomId, {
      players: [socket.id, null],
      boards: [null, null],
      shots: [
        Array(10).fill().map(() => Array(10).fill(0)),
        Array(10).fill().map(() => Array(10).fill(0))
      ],
      turn: null,
      gameOver: false,
      winner: null
    });
    socket.join(roomId);
    socket.emit('gameCreated', { roomId });
  });
  
  // Присоединение к игре
  socket.on('joinGame', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Комната не найдена' });
      return;
    }
    if (room.players[1] !== null) {
      socket.emit('error', { message: 'Комната уже заполнена' });
      return;
    }
    room.players[1] = socket.id;
    socket.join(roomId);
    
    // Генерируем доски для обоих игроков
    const board1 = generateRandomBoard();
    const board2 = generateRandomBoard();
    room.boards[0] = board1;
    room.boards[1] = board2;
    // Очищаем shots
    room.shots[0] = Array(10).fill().map(() => Array(10).fill(0));
    room.shots[1] = Array(10).fill().map(() => Array(10).fill(0));
    room.turn = Math.random() < 0.5 ? 0 : 1;
    room.gameOver = false;
    room.winner = null;
    
    // Отправляем каждому игроку его состояние
    const player0Socket = io.sockets.sockets.get(room.players[0]);
    const player1Socket = io.sockets.sockets.get(room.players[1]);
    if (player0Socket) {
      player0Socket.emit('gameStart', getPlayerState(room, 0));
    }
    if (player1Socket) {
      player1Socket.emit('gameStart', getPlayerState(room, 1));
    }
    // Оповещаем о начале
    io.to(roomId).emit('message', { text: `Игра началась! Ходит ${room.turn === 0 ? 'Игрок 1' : 'Игрок 2'}` });
  });
  
  // Выстрел
  socket.on('fire', ({ roomId, x, y }) => {
    const room = rooms.get(roomId);
    if (!room || room.gameOver) return;
    
    // Определяем индекс игрока (0 или 1)
    let playerIdx = room.players[0] === socket.id ? 0 : room.players[1] === socket.id ? 1 : -1;
    if (playerIdx === -1 || room.turn !== playerIdx) {
      socket.emit('error', { message: 'Не ваш ход' });
      return;
    }
    
    const opponentIdx = playerIdx === 0 ? 1 : 0;
    const opponentBoard = room.boards[opponentIdx];
    const myShotsOnOpponent = room.shots[playerIdx];
    
    // Проверка, что не стреляли ранее
    if (myShotsOnOpponent[x][y] !== 0) {
      socket.emit('error', { message: 'Сюда уже стреляли' });
      return;
    }
    
    const hit = opponentBoard[x][y] === 1;
    if (hit) {
      myShotsOnOpponent[x][y] = 2; // попадание
      // Проверка на уничтожение корабля
      const sunk = isSunk(opponentBoard, myShotsOnOpponent, x, y);
      if (sunk) {
        io.to(roomId).emit('message', { text: `Игрок ${playerIdx+1} уничтожил корабль!` });
      }
      // Проверка победы
      if (checkWin(opponentBoard, myShotsOnOpponent)) {
        room.gameOver = true;
        room.winner = playerIdx;
        const finalState0 = getPlayerState(room, 0);
        const finalState1 = getPlayerState(room, 1);
        io.to(roomId).emit('gameState', { for: room.players[0], state: finalState0 });
        io.to(roomId).emit('gameState', { for: room.players[1], state: finalState1 });
        io.to(roomId).emit('message', { text: `Игра окончена! Победил Игрок ${playerIdx+1}` });
        return;
      }
      // Ход остается за текущим игроком
    } else {
      myShotsOnOpponent[x][y] = 1; // промах
      room.turn = opponentIdx; // смена хода
      io.to(roomId).emit('message', { text: `Игрок ${playerIdx+1} промахнулся. Ходит Игрок ${opponentIdx+1}` });
    }
    
    // Отправляем обновленные состояния обоим игрокам
    const state0 = getPlayerState(room, 0);
    const state1 = getPlayerState(room, 1);
    const p0socket = io.sockets.sockets.get(room.players[0]);
    const p1socket = io.sockets.sockets.get(room.players[1]);
    if (p0socket) p0socket.emit('gameState', { state: state0 });
    if (p1socket) p1socket.emit('gameState', { state: state1 });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Удаляем игрока из комнат
    for (const [roomId, room] of rooms.entries()) {
      if (room.players[0] === socket.id || room.players[1] === socket.id) {
        const other = room.players[0] === socket.id ? room.players[1] : room.players[0];
        if (other) {
          const otherSocket = io.sockets.sockets.get(other);
          if (otherSocket) {
            otherSocket.emit('message', { text: 'Противник отключился. Игра закончена.' });
          }
        }
        rooms.delete(roomId);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
