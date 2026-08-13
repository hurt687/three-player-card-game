const status = document.querySelector("#status");
const room = document.querySelector("#room");
const handElement = document.querySelector("#hand");
const handCount = document.querySelector("#handCount");
const turnElement = document.querySelector("#turn");
const lastPlay = document.querySelector("#lastPlay");
const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
let playerNumber = 0; let cards = []; let selectedIndex = null;
const redSuits = new Set(["♥", "♦"]);
function cardName(card) { return card.joker ? `${card.rank}→${card.chosenRank || "?"}` : `${card.suit}${card.rank}`; }
function renderHand() {
  handElement.innerHTML = ""; handCount.textContent = `${cards.length} 张`;
  cards.forEach((card, index) => { const button = document.createElement("button"); button.className = `playing-card ${redSuits.has(card.suit) ? "red" : ""} ${selectedIndex === index ? "selected" : ""}`; button.innerHTML = `<span>${card.suit}</span><strong>${card.rank}</strong>`; button.onclick = () => { selectedIndex = index; renderHand(); }; handElement.appendChild(button); });
}
socket.onopen = () => { status.textContent = "已连接，等待其他玩家加入"; };
socket.onmessage = (event) => { const data = JSON.parse(event.data);
  if (data.type === "welcome") { playerNumber = data.player; status.textContent = `你是玩家 ${playerNumber}`; }
  if (data.type === "hand") { cards = data.cards; selectedIndex = null; renderHand(); }
  if (data.type === "state") { room.textContent = `房间 ${data.count}/3`; data.players.forEach((player) => { const element = document.querySelector(`#p${player.player}`); if (element) element.textContent = `${player.cards} 张牌`; }); turnElement.textContent = data.started ? (data.turn === playerNumber ? "轮到你出牌" : `轮到玩家 ${data.turn}`) : "等待三人开始"; if (data.lastPlay) lastPlay.textContent = `玩家 ${data.lastPlay.player} 打出 ${data.lastPlay.cards.map(cardName).join(" ")}`; if (data.count === 3 && data.started) status.textContent = "游戏开始！"; }
  if (data.type === "started") status.textContent = "已发牌，每人18张";
  if (data.type === "winner") status.textContent = `玩家 ${data.player} 获胜！`;
  if (data.type === "full") status.textContent = "房间已满";
};
document.querySelector("#playButton").onclick = () => { if (selectedIndex === null) { status.textContent = "请先选择牌"; return; } socket.send(JSON.stringify({ type: "play", indexes: [selectedIndex], asRank: document.querySelector("#jokerRank").value })); };
socket.onerror = () => { status.textContent = "连接失败，请检查服务器"; };
