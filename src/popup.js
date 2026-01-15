const exportBtn = document.getElementById("exportBtn");
const detectBtn = document.getElementById("detectBtn");
const progressList = document.getElementById("progressList");
const logList = document.getElementById("logList");
const sheetIdInput = document.getElementById("sheetId");
const autoExportToggle = document.getElementById("autoExport");

const steps = ["page", "extract", "sheet", "attachments"];

const updateStepStatus = (step, status) => {
  const item = progressList.querySelector(`[data-step="${step}"]`);
  if (!item) {
    return;
  }
  item.classList.remove("done", "error");
  if (status === "done") {
    item.classList.add("done");
  }
  if (status === "error") {
    item.classList.add("error");
  }
};

const addLog = (message) => {
  const entry = document.createElement("div");
  entry.className = "log-item";
  entry.textContent = message;
  logList.prepend(entry);
};

const resetSteps = () => {
  steps.forEach((step) => updateStepStatus(step, "pending"));
};

const getActiveTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
};

const sendMessageToBackground = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response);
    });
  });

const triggerExport = async () => {
  resetSteps();
  const tab = await getActiveTab();
  const sheetId = sheetIdInput.value.trim();
  const autoExport = autoExportToggle.checked;
  chrome.storage.local.set({ sheetId, autoExport });

  addLog("بدء عملية الاستخلاص...");
  await sendMessageToBackground({
    type: "START_EXPORT",
    tabId: tab.id,
    sheetId,
  });
};

const detectPage = async () => {
  resetSteps();
  const tab = await getActiveTab();
  addLog("التحقق من صفحة المنافسة...");
  await sendMessageToBackground({ type: "DETECT_PAGE", tabId: tab.id });
};

exportBtn.addEventListener("click", () => {
  triggerExport().catch((error) => {
    addLog(`خطأ: ${error.message || error}`);
    updateStepStatus("extract", "error");
  });
});

detectBtn.addEventListener("click", () => {
  detectPage().catch((error) => {
    addLog(`خطأ: ${error.message || error}`);
    updateStepStatus("page", "error");
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PROGRESS") {
    updateStepStatus(message.step, message.status);
    if (message.message) {
      addLog(message.message);
    }
  }
});

chrome.storage.local.get(["sheetId", "autoExport"], (data) => {
  if (data.sheetId) {
    sheetIdInput.value = data.sheetId;
  }
  autoExportToggle.checked = Boolean(data.autoExport);
});
