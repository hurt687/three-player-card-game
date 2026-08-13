const status = document.querySelector("#status");
const players = document.querySelector("#players");
const socket = new WebSocket(`ws://${location.host}`);

socket.addEventListener("open", () => { status.textContent = "已连接，可以邀请朋友加入"; });
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") status.textContent = `你是玩家 ${data.player}`;
  if (data.type === "room") {
    players.textContent = `${data.count} / ${data.max} 人`;
    if (data.count === 3) status.textContent = "三位玩家已到齐，准备开始！";
  }
  if (data.type === "full") status.textContent = "房间已满，请稍后再试";
});
socket.addEventListener("error", () => { status.textContent = "连接失败，请确认服务器已启动"; });
