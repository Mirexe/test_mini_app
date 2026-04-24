const socket = io('https://test-mini-app-dnwv.onrender.com'); // замените на реальный URL бэкенда

let currentRoomId = null;
let gameActive = false;
let myTurn = false;
let myBoard = null;         // 10x10 с кораблями (0/1) для отображения
let enemyBoard = null;      // поле противника (0 - ?, 1-промах, 2-попадание)
let gameOver = false;

// Элементы DOM
const lobbyDiv = document.getElementById('lobby');
const gameArea = document.getElementById('gameArea');
const myBoardDiv = document.getElementById('myBoard');
const enemyBoardDiv = document.getElementById('enemyBoard');
const gameStatusSpan = document.getElementById('gameStatus');
const newGameBtn = document.getElementById('newGameBtn');
const roomInfoDiv = document.getElementById('roomInfo');

function showMessage(text, isError = false) {
  const overlay = document.getElementById('messageOverlay');
  overlay.textContent = text;
  overlay.style.opacity = '1';
  overlay.style.backgroundColor = isError ? '#aa2e1ecc' : '#000000cc';
  setTimeout(() => {
    overlay.style.opacity = '0';
  }, 2000);
}

function renderBoard(container, boardData, isEnemy, onClickCallback) {
  container.innerHTML = '';
  container.classList.toggle('enemy', isEnemy);
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      let value = boardData[i][j];
      
      if (!isEnemy && value === 1) {
        cell.classList.add('ship');
      }
      if (value === 2) {
        cell.classList.add('hit');
      } else if (value === 1 && isEnemy) {
        // на вражеском поле 1 означает промах?
        // В enemyBoard храним: 0 - не стреляли, 1 - промах, 2 - попадание
        if (value === 1) cell.classList.add('miss');
      }
      // отображаем статус для вражеского поля
      if (isEnemy) {
        if (value === 1) cell.classList.add('miss');
        if (value === 2) cell.classList.add('hit');
      } else {
        // на своем поле: показать попадания/промахи противника
        if (value === 2) cell.classList.add('hit');
        if (value === 1 && !cell.classList.contains('ship')) cell.classList.add('miss');
      }
      
      cell.addEventListener('click', (function(x, y) {
        return () => {
          if (isEnemy && gameActive && myTurn && !gameOver && enemyBoard[x][y] === 0) {
            socket.emit('fire', { roomId: currentRoomId, x, y });
          } else if (!myTurn && isEnemy && !gameOver) {
            showMessage('Сейчас не ваш ход!');
          } else if (enemyBoard[x][y] !== 0 && isEnemy) {
            showMessage('Вы уже стреляли сюда');
          }
        };
      })(i, j));
      
      container.appendChild(cell);
    }
  }
}

function updateUI() {
  if (myBoard && enemyBoard) {
    renderBoard(myBoardDiv, myBoard, false, null);
    renderBoard(enemyBoardDiv, enemyBoard, true, null);
    if (gameOver) {
      gameStatusSpan.innerText = gameOver === true ? 'Игра окончена! Нажмите "Новая игра"' : gameStatusSpan.innerText;
      newGameBtn.style.display = 'block';
    } else {
      gameStatusSpan.innerText = myTurn ? '🔥 Ваш ход! Нажмите на клетку противника' : '⏳ Ожидание хода противника...';
      newGameBtn.style.display = 'none';
    }
  }
}

// События Socket.IO
socket.on('connect', () => {
  console.log('Connected to server');
  showMessage('Соединение установлено');
});

socket.on('gameCreated', ({ roomId }) => {
  currentRoomId = roomId;
  roomInfoDiv.innerHTML = `✅ Код игры: <strong>${roomId}</strong><br>Отправьте его другу для подключения`;
  showMessage(`Игра создана! Код: ${roomId}`);
});

socket.on('gameStart', ({ yourBoard, enemyBoard: enemy, turn, gameOver: isGameOver, winner }) => {
  myBoard = yourBoard;
  enemyBoard = enemy;
  myTurn = turn;
  gameOver = isGameOver;
  gameActive = true;
  lobbyDiv.style.display = 'none';
  gameArea.style.display = 'block';
  updateUI();
  showMessage(turn ? 'Ваш ход!' : 'Ход противника...');
});

socket.on('gameState', ({ state }) => {
  if (!state) return;
  myBoard = state.yourBoard;
  enemyBoard = state.enemyBoard;
  myTurn = state.turn;
  gameOver = state.gameOver;
  if (state.winner !== null && state.winner !== undefined) {
    gameStatusSpan.innerText = state.winner === true ? '🏆 ПОБЕДА! 🏆' : '❌ Поражение...';
  }
  updateUI();
});

socket.on('message', ({ text }) => {
  showMessage(text);
});

socket.on('error', ({ message }) => {
  showMessage(message, true);
});

// Лобби кнопки
document.getElementById('createBtn').addEventListener('click', () => {
  socket.emit('createGame');
});

document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId = document.getElementById('roomIdInput').value.trim();
  if (!roomId) {
    showMessage('Введите код комнаты', true);
    return;
  }
  socket.emit('joinGame', { roomId });
  currentRoomId = roomId;
  roomInfoDiv.innerHTML = `🔄 Подключение к комнате ${roomId}...`;
});

newGameBtn.addEventListener('click', () => {
  window.location.reload(); // простой перезапуск
});
