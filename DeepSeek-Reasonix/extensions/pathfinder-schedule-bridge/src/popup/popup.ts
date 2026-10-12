import "./popup.css";

type PopupResponse = { status: string; message?: string };

const statusElement = document.querySelector<HTMLElement>("#status")!;
const form = document.querySelector<HTMLFormElement>("#pair-form")!;
const codeInput = document.querySelector<HTMLInputElement>("#pair-code")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;

const labels: Record<string, string> = {
  OK: "已连接。需要实时数据时，请打开并登录 Schedule Builder。",
  EXTENSION_REQUIRED: "没有发现正在运行的 Pathfinder UCD。",
  PAIRING_REQUIRED: "已发现 Pathfinder，请完成一次配对。",
  LOGIN_REQUIRED: "请在浏览器中登录 UC Davis Schedule Builder。",
  BROWSER_REQUIRED: "请打开 UC Davis Schedule Builder。",
  SITE_VERSION_UNSUPPORTED: "Schedule Builder 已更新，需要升级扩展。",
  INTERNAL_ERROR: "连接出现错误，请重新检测。",
};

async function send(message: object): Promise<PopupResponse> {
  return chrome.runtime.sendMessage(message) as Promise<PopupResponse>;
}

function render(response: PopupResponse): void {
  statusElement.textContent = response.message || labels[response.status] || `状态：${response.status}`;
  form.hidden = response.status !== "PAIRING_REQUIRED";
}

async function refresh(): Promise<void> {
  render(await send({ type: "bridge.status" }));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void send({ type: "bridge.pair", code: codeInput.value }).then(render);
});
retry.addEventListener("click", () => void refresh());
void refresh();
